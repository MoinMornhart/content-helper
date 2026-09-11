'use strict';

/**
 * Instagram und Facebook – eine Anmeldung bei Meta für beide.
 *
 * Angemeldet wird über Facebook, weil nur dieser Weg das Hochladen einer Datei
 * vom eigenen Rechner erlaubt; mit der reinen Instagram-Anmeldung müsste das
 * Video erst im Internet liegen. Voraussetzung ist ein Instagram-Profi-Konto
 * (Business oder Creator), das mit einer Facebook-Seite verbunden ist.
 *
 * - Facebook plant selbst: Das Reel wird vorab hochgeladen und von Facebook
 *   zum Termin veröffentlicht (10 Minuten bis 29 Tage im Voraus).
 * - Instagram kann das über die Schnittstelle nicht; dort geht das Reel genau
 *   zum Termin raus.
 *
 * Die Seiten-Merkmale, die Meta nach der Anmeldung ausgibt, laufen nicht ab –
 * einmal anmelden genügt.
 */

const defaultHttp = require('../../connectors/http');
const { newState, appWindow, codeFrom, TokenStore, form } = require('../oauth');
const { credentialsFor } = require('../credentials');
const { probe } = require('../media-info');
const { sleep, parseJson, retryable, permanent, poll, clip, length, RELOGIN } = require('./common');

const VERSION = 'v25.0';
const GRAPH = `https://graph.facebook.com/${VERSION}`;
const DIALOG = `https://www.facebook.com/${VERSION}/dialog/oauth`;
const REDIRECT = 'https://www.facebook.com/connect/login_success.html';
const SCOPES = [
  'pages_show_list',
  'pages_read_engagement',
  'pages_manage_posts',
  'business_management',
  'instagram_basic',
  'instagram_content_publish',
];

/** Gemeinsame Anmeldung und Schnittstelle. */
class MetaAuth {
  constructor(store, deps = {}) {
    this.store = store;
    this.http = deps.http || defaultHttp;
    this.getWindow = deps.getWindow || (() => null);
    this.tokens = new TokenStore(store, 'meta');
  }

  creds() {
    return credentialsFor(this.store, 'meta');
  }

  isSignedIn() {
    return this.creds().complete && Boolean(this.tokens.get().pages?.length);
  }

  /** Die gewählte Facebook-Seite samt verbundenem Instagram-Konto. */
  page() {
    const config = this.tokens.get();
    return (config.pages || []).find((page) => page.id === config.pageId) || config.pages?.[0] || null;
  }

  selectPage(pageId) {
    const config = this.tokens.get();
    if (!(config.pages || []).some((page) => page.id === pageId)) throw new Error('Diese Seite gehört nicht zur Anmeldung.');
    this.tokens.save({ pageId });
  }

  async signIn() {
    const creds = this.creds();
    if (!creds.complete) throw new Error('Für Instagram und Facebook ist die Meta-Anwendung noch nicht eingerichtet.');

    const state = newState();
    const { params } = await appWindow({
      key: 'meta',
      name: 'Facebook',
      parent: this.getWindow(),
      redirectUri: REDIRECT,
      url: `${DIALOG}?${form({
        client_id: creds.appId,
        redirect_uri: REDIRECT,
        state,
        response_type: 'code',
        ...(creds.configId ? { config_id: creds.configId } : { scope: SCOPES.join(',') }),
      })}`,
    });

    const short = await this.graph('GET', '/oauth/access_token', {
      client_id: creds.appId,
      client_secret: creds.appSecret,
      redirect_uri: REDIRECT,
      code: codeFrom(params, state, 'Facebook'),
    }, { token: false });

    // Langlebiges Nutzer-Merkmal – daraus abgeleitete Seiten-Merkmale laufen nicht ab.
    const long = await this.graph('GET', '/oauth/access_token', {
      grant_type: 'fb_exchange_token',
      client_id: creds.appId,
      client_secret: creds.appSecret,
      fb_exchange_token: short.access_token,
    }, { token: false });

    const me = await this.graph('GET', '/me', { fields: 'id,name' }, { token: long.access_token });
    const accounts = await this.graph('GET', '/me/accounts', {
      fields: 'id,name,access_token,picture{url},instagram_business_account{id,username,profile_picture_url}',
      limit: 100,
    }, { token: long.access_token });

    const pages = (accounts.data || []).map((page) => ({
      id: page.id,
      name: page.name,
      token: page.access_token,
      picture: page.picture?.data?.url || null,
      instagram: page.instagram_business_account
        ? {
            id: page.instagram_business_account.id,
            username: page.instagram_business_account.username || null,
            picture: page.instagram_business_account.profile_picture_url || null,
          }
        : null,
    }));
    if (!pages.length) {
      throw new Error('Zu diesem Facebook-Konto gibt es keine Seite, auf die der Content Helper zugreifen darf. Instagram- und Facebook-Posts laufen über eine Facebook-Seite.');
    }

    const preferred = pages.find((page) => page.instagram) || pages[0];
    this.tokens.save({
      userName: me.name || null,
      userId: me.id || null,
      userToken: long.access_token,
      pages,
      pageId: preferred.id,
      connectedAt: new Date().toISOString(),
      lastError: null,
    });
  }

  signOut() {
    this.tokens.clear();
  }

  /**
   * Aufruf der Graph-API. Meta liefert Fehler verschachtelt; die häufigen
   * werden in Sätze übersetzt.
   */
  async graph(method, path, params = {}, { token } = {}) {
    const accessToken = token === false ? null : (token || this.page()?.token);
    const all = { ...params, ...(accessToken ? { access_token: accessToken } : {}) };
    const url = path.startsWith('https://') ? path : `${GRAPH}${path}`;
    const response = method === 'GET' || method === 'DELETE'
      ? await this.http.request(`${url}?${form(all)}`, { method, headers: { Accept: 'application/json' } })
      : await this.http.request(url, {
          method,
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
          body: form(all),
        });
    const payload = parseJson(response.text) || {};
    if (response.status >= 400 || payload.error) throw metaError(payload.error || {}, response.status);
    return payload;
  }

  status() {
    const config = this.tokens.get();
    const creds = this.creds();
    const page = this.page();
    return {
      signedIn: this.isSignedIn(),
      needsSetup: !creds.complete,
      builtIn: creds.builtIn,
      userName: config.userName || null,
      pages: (config.pages || []).map(({ id, name, picture, instagram }) => ({ id, name, picture, instagram })),
      pageId: page?.id || null,
      connectedAt: config.connectedAt || null,
      lastError: config.lastError || null,
    };
  }
}

function metaError(error, status) {
  const code = error.code;
  const sub = error.error_subcode;
  const text = error.error_user_msg || error.message || `Status ${status}`;
  if (code === 190) return permanent(`Meta: Die Anmeldung ist abgelaufen oder wurde zurückgezogen. ${RELOGIN}`);
  if (code === 10 || code === 200) return permanent(`Meta verweigert das – der Content Helper hat dafür keine Berechtigung (${text}).`);
  if (code === 9 && sub === 2207042) return permanent('Instagram erlaubt über die Schnittstelle höchstens 100 Posts in 24 Stunden.');
  if ([4, 17, 32, 613].includes(code)) return retryable('Meta bremst gerade – zu viele Anfragen. Es geht gleich weiter.');
  if (code === 1 || code === 2 || status >= 500 || error.is_transient) return retryable(`Meta hat gerade ein Problem: ${text}`);
  return permanent(`Meta meldet: ${text}`);
}

/** Ein Video an Metas Upload-Server schicken – für Instagram und Facebook gleich. */
async function ruploadFile(http, url, token, video, onProgress) {
  const response = await http.uploadFile(url, {
    method: 'POST',
    headers: { Authorization: `OAuth ${token}`, offset: '0', file_size: String(video.size) },
    filePath: video.path,
    onProgress: (sent) => onProgress(sent / video.size),
  });
  const payload = parseJson(response.text) || {};
  if (response.status >= 400 || payload.error || payload.debug_info?.type === 'ProcessingFailedError') {
    throw metaError(payload.error || { message: payload.debug_info?.message }, response.status);
  }
  return payload;
}

// ------------------------------------------------------------------ Instagram

class InstagramPublisher {
  constructor(auth, deps = {}) {
    this.auth = auth;
    this.sleep = deps.sleep || sleep;
    this.id = 'instagram';
    this.name = 'Instagram';
    this.platformIds = ['instagram_reels'];
    this.nativeSchedule = false;
  }

  isConnected() {
    return this.auth.isSignedIn() && Boolean(this.auth.page()?.instagram);
  }

  check(content) {
    const problems = [];
    if (!content.video) problems.push('Für Instagram-Reels fehlt das Video – bitte im Composer eine Videodatei wählen.');
    else if (!['mp4', 'mov'].includes(content.video.ext)) problems.push('Instagram nimmt nur MP4 oder MOV.');
    else {
      const { durationSec } = probe(content.video.path);
      if (durationSec && durationSec < 3) problems.push('Instagram-Reels müssen mindestens 3 Sekunden lang sein.');
      if (durationSec && durationSec > 900) problems.push('Instagram-Reels dürfen über die Schnittstelle höchstens 15 Minuten lang sein.');
    }
    if (length(content.text) > 2200) problems.push(`Der Text ist ${length(content.text)} Zeichen lang, Instagram erlaubt 2200.`);
    if ((content.hashtags || []).length > 30) problems.push('Instagram erlaubt höchstens 30 Hashtags.');
    return problems;
  }

  async publish(job) {
    const page = this.auth.page();
    const igId = page.instagram.id;
    let session = job.session;

    // Container gelten 24 Stunden.
    if (!session || Date.now() - (session.createdAt || 0) > 23 * 3600_000) {
      const container = await this.auth.graph('POST', `/${igId}/media`, {
        media_type: 'REELS',
        upload_type: 'resumable',
        caption: clip(job.text, 2200),
        share_to_feed: job.options?.shareToFeed === false ? 'false' : 'true',
        ...(job.options?.coverMs ? { thumb_offset: String(job.options.coverMs) } : {}),
      });
      session = { containerId: container.id, uploaded: false, createdAt: Date.now() };
      job.saveSession(session);
    }

    if (!session.uploaded) {
      await ruploadFile(this.auth.http, `https://rupload.facebook.com/ig-api-upload/${VERSION}/${session.containerId}`, page.token, job.video, (share) => job.onProgress(share));
      session = { ...session, uploaded: true };
      job.saveSession(session);
    }

    job.onProgress(1, 'processing');
    const state = await poll(async () => {
      const info = await this.auth.graph('GET', `/${session.containerId}`, { fields: 'status_code,status' });
      if (info.status_code === 'FINISHED') return 'ok';
      if (info.status_code === 'ERROR') return { error: info.status || 'Verarbeitung fehlgeschlagen' };
      if (info.status_code === 'EXPIRED') return { expired: true };
      return null;
    }, { every: 10_000, times: 60, wait: this.sleep });

    if (state?.expired) {
      job.saveSession(null);
      throw retryable('Der Upload bei Instagram ist verfallen. Er beginnt beim nächsten Versuch neu.');
    }
    if (state?.error) throw permanent(`Instagram konnte das Video nicht verarbeiten: ${state.error}`);
    if (!state) throw retryable('Instagram verarbeitet das Video noch. Neuer Versuch folgt.');

    const published = await this.auth.graph('POST', `/${igId}/media_publish`, { creation_id: session.containerId });
    const link = await this.auth.graph('GET', `/${published.id}`, { fields: 'permalink' }).catch(() => ({}));
    return { state: 'published', remoteId: published.id, url: link.permalink || `https://www.instagram.com/${page.instagram.username || ''}` };
  }

  status() {
    const page = this.auth.page();
    return {
      connected: this.isConnected(),
      account: page?.instagram?.username ? `@${page.instagram.username}` : null,
      avatar: page?.instagram?.picture || null,
      hint: this.auth.isSignedIn() && !page?.instagram
        ? 'Mit dieser Facebook-Seite ist kein Instagram-Profikonto verbunden.'
        : null,
    };
  }
}

// ------------------------------------------------------------------ Facebook

class FacebookPublisher {
  constructor(auth) {
    this.auth = auth;
    this.id = 'facebook';
    this.name = 'Facebook';
    this.platformIds = ['facebook'];
    this.nativeSchedule = true;
    this.minLeadMs = 15 * 60_000;
    this.maxLeadMs = 28 * 86400_000;
  }

  isConnected() {
    return this.auth.isSignedIn() && Boolean(this.auth.page());
  }

  check(content) {
    const problems = [];
    if (content.video) {
      if (!['mp4', 'mov'].includes(content.video.ext)) problems.push('Facebook-Reels gehen nur als MP4 oder MOV.');
      const { durationSec } = probe(content.video.path);
      if (durationSec && durationSec > 90) problems.push(`Das Video ist ${Math.round(durationSec)} Sekunden lang – Facebook nimmt über die Schnittstelle nur Reels bis 90 Sekunden.`);
      if (durationSec && durationSec < 3) problems.push('Facebook-Reels müssen mindestens 3 Sekunden lang sein.');
    } else if (!content.text) {
      problems.push('Für Facebook fehlt Text oder Video.');
    }
    return problems;
  }

  async publish(job) {
    const page = this.auth.page();
    const unix = job.scheduledFor ? Math.floor(Date.parse(job.scheduledFor) / 1000) : null;

    if (!job.video) {
      const post = await this.auth.graph('POST', `/${page.id}/feed`, {
        message: job.text,
        ...(unix ? { published: 'false', scheduled_publish_time: String(unix) } : {}),
      });
      return { state: unix ? 'scheduled' : 'published', remoteId: post.id, url: `https://www.facebook.com/${post.id}` };
    }

    let session = job.session;
    if (!session?.videoId) {
      const start = await this.auth.graph('POST', `/${page.id}/video_reels`, { upload_phase: 'start' });
      session = { videoId: start.video_id, uploaded: false };
      job.saveSession(session);
    }
    if (!session.uploaded) {
      await ruploadFile(this.auth.http, `https://rupload.facebook.com/video-upload/${VERSION}/${session.videoId}`, page.token, job.video, (share) => job.onProgress(share));
      session = { ...session, uploaded: true };
      job.saveSession(session);
    }

    job.onProgress(1, 'processing');
    await this.auth.graph('POST', `/${page.id}/video_reels`, {
      upload_phase: 'finish',
      video_id: session.videoId,
      video_state: unix ? 'SCHEDULED' : 'PUBLISHED',
      description: job.text,
      ...(job.title ? { title: job.title } : {}),
      ...(unix ? { scheduled_publish_time: String(unix) } : {}),
    });

    return { state: unix ? 'scheduled' : 'published', remoteId: session.videoId, url: `https://www.facebook.com/reel/${session.videoId}` };
  }

  /** Facebook kann den Termin nicht ändern: löschen, der Publisher lädt neu hoch. */
  async cancel({ remoteId }) {
    await this.auth.graph('DELETE', `/${remoteId}`);
  }

  status() {
    const page = this.auth.page();
    return { connected: this.isConnected(), account: page?.name || null, avatar: page?.picture || null };
  }
}

module.exports = { MetaAuth, InstagramPublisher, FacebookPublisher, metaError, SCOPES: SCOPES, REDIRECT };
