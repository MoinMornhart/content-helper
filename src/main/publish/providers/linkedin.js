'use strict';

/**
 * LinkedIn: Beiträge und Videos im eigenen Profil.
 *
 * LinkedIn kann nicht vorausplanen; der Beitrag geht zum Termin raus. Videos
 * werden in Teilen hochgeladen, die LinkedIn selbst vorgibt, und danach
 * zusammengesetzt.
 *
 * Eigenheit: Die Anmeldung gilt 60 Tage und lässt sich nicht still erneuern.
 * Die App meldet sich eine Woche vorher; das Erneuern ist ein Klick, weil das
 * Anmeldefenster sich die LinkedIn-Sitzung merkt.
 */

const defaultHttp = require('../../connectors/http');
const { newState, appWindow, codeFrom, TokenStore, form } = require('../oauth');
const { credentialsFor } = require('../credentials');
const { probe } = require('../media-info');
const { sleep, parseJson, permanent, statusError, poll, length, RELOGIN } = require('./common');
const { t } = require('../../i18n');

const AUTH_URL = 'https://www.linkedin.com/oauth/v2/authorization';
const TOKEN_URL = 'https://www.linkedin.com/oauth/v2/accessToken';
const API = 'https://api.linkedin.com';
/** Die Rückleitung wird im Anmeldefenster abgefangen; die Seite muss nicht existieren. */
const REDIRECT = 'https://moinmornhart.github.io/content-helper/anmeldung/';
const SCOPES = ['openid', 'profile', 'w_member_social'];
/** LinkedIn verlangt eine Schnittstellenfassung; alte werden nach einem Jahr abgeschaltet. */
const VERSION = '202608';

class LinkedInPublisher {
  constructor(store, deps = {}) {
    this.store = store;
    this.http = deps.http || defaultHttp;
    this.sleep = deps.sleep || sleep;
    this.getWindow = deps.getWindow || (() => null);
    this.tokens = new TokenStore(store, 'linkedinPublish');

    this.id = 'linkedin';
    this.name = 'LinkedIn';
    this.platformIds = ['linkedin'];
    this.nativeSchedule = false;
  }

  creds() {
    return credentialsFor(this.store, 'linkedin');
  }

  isConnected() {
    const config = this.tokens.get();
    return this.creds().complete && Boolean(config.accessToken) && Boolean(config.personUrn);
  }

  async signIn() {
    const creds = this.creds();
    if (!creds.complete) throw new Error(t('Für LinkedIn ist die Anwendung noch nicht eingerichtet.'));

    const state = newState();
    const { params } = await appWindow({
      key: this.id,
      name: 'LinkedIn',
      parent: this.getWindow(),
      redirectUri: REDIRECT,
      url: `${AUTH_URL}?${form({ response_type: 'code', client_id: creds.clientId, redirect_uri: REDIRECT, state, scope: SCOPES.join(' ') })}`,
    });

    const response = await this.http.request(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: form({
        grant_type: 'authorization_code',
        code: codeFrom(params, state, 'LinkedIn'),
        redirect_uri: REDIRECT,
        client_id: creds.clientId,
        client_secret: creds.clientSecret,
      }),
    });
    const tokens = parseJson(response.text) || {};
    if (response.status >= 400) {
      throw new Error(t('{name} meldet: {detail}', { name: 'LinkedIn', detail: tokens.error_description || tokens.error || response.status }));
    }

    const me = await this.http.request(`${API}/v2/userinfo`, {
      headers: { Authorization: `Bearer ${tokens.access_token}`, Accept: 'application/json' },
    });
    const user = parseJson(me.text) || {};
    if (!user.sub) throw new Error(t('LinkedIn hat das Profil nicht herausgegeben.'));

    this.tokens.save({
      accessToken: tokens.access_token,
      expiresAt: new Date(Date.now() + (tokens.expires_in || 5184000) * 1000).toISOString(),
      refreshToken: tokens.refresh_token || null,
      personUrn: `urn:li:person:${user.sub}`,
      name: user.name || null,
      avatar: user.picture || null,
      connectedAt: new Date().toISOString(),
      lastError: null,
    });
    return this.status();
  }

  async token() {
    const config = this.tokens.get();
    if (!config.accessToken) throw permanent(t('Für LinkedIn besteht keine Anmeldung. {relogin}', { relogin: t(RELOGIN) }));
    if (Date.parse(config.expiresAt || 0) > Date.now() + 60_000) return config.accessToken;

    if (config.refreshToken) {
      const creds = this.creds();
      const response = await this.http.request(TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body: form({ grant_type: 'refresh_token', refresh_token: config.refreshToken, client_id: creds.clientId, client_secret: creds.clientSecret }),
      });
      const tokens = parseJson(response.text) || {};
      if (response.status < 400 && tokens.access_token) {
        this.tokens.save({
          accessToken: tokens.access_token,
          expiresAt: new Date(Date.now() + (tokens.expires_in || 5184000) * 1000).toISOString(),
          refreshToken: tokens.refresh_token || config.refreshToken,
        });
        return tokens.access_token;
      }
    }
    this.tokens.save({ lastError: t('Die Anmeldung ist nach 60 Tagen abgelaufen.') });
    throw permanent(t('Die LinkedIn-Anmeldung ist nach 60 Tagen abgelaufen – LinkedIn verlangt dann eine neue Bestätigung. {relogin}', { relogin: t(RELOGIN) }));
  }

  signOut() {
    this.tokens.clear();
  }

  async rest(method, path, body = null) {
    const response = await this.http.request(`${API}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${await this.token()}`,
        'LinkedIn-Version': VERSION,
        'X-Restli-Protocol-Version': '2.0.0',
        Accept: 'application/json',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : null,
    });
    const payload = parseJson(response.text);
    if (response.status >= 400) throw statusError('LinkedIn', response.status, payload?.message);
    return { payload, headers: response.headers };
  }

  check(content) {
    const problems = [];
    if (!content.text && !content.video) problems.push(t('Für LinkedIn fehlt Text oder Video.'));
    if (length(content.text) > 3000) {
      problems.push(t('Der Text ist {count} Zeichen lang, {name} erlaubt {max}.', { count: length(content.text), name: 'LinkedIn', max: 3000 }));
    }
    if (content.video) {
      if (content.video.ext !== 'mp4') problems.push(t('LinkedIn nimmt Videos nur als MP4.'));
      const { durationSec } = probe(content.video.path);
      if (durationSec && (durationSec < 3 || durationSec > 1800)) problems.push(t('LinkedIn-Videos müssen zwischen 3 Sekunden und 30 Minuten lang sein.'));
    }
    return problems;
  }

  async publish(job) {
    const author = this.tokens.get().personUrn;
    let videoUrn = null;

    if (job.video) {
      let session = job.session;
      if (!session?.video) {
        const { payload } = await this.rest('POST', '/rest/videos?action=initializeUpload', {
          initializeUploadRequest: { owner: author, fileSizeBytes: job.video.size, uploadCaptions: false, uploadThumbnail: false },
        });
        const value = payload.value || {};
        session = { video: value.video, uploadToken: value.uploadToken || '', parts: value.uploadInstructions || [], etags: [] };
        job.saveSession(session);
      }

      for (let index = session.etags.length; index < session.parts.length; index += 1) {
        const part = session.parts[index];
        const response = await this.http.uploadFile(part.uploadUrl, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/octet-stream' },
          filePath: job.video.path,
          start: part.firstByte,
          end: part.lastByte + 1,
          onProgress: (sent) => job.onProgress((part.firstByte + sent) / job.video.size),
        });
        if (response.status >= 400) throw statusError('LinkedIn', response.status);
        session = { ...session, etags: [...session.etags, response.headers.etag] };
        job.saveSession(session);
      }

      job.onProgress(1, 'processing');
      await this.rest('POST', '/rest/videos?action=finalizeUpload', {
        finalizeUploadRequest: { video: session.video, uploadToken: session.uploadToken, uploadedPartIds: session.etags },
      });

      const ready = await poll(async () => {
        const { payload } = await this.rest('GET', `/rest/videos/${encodeURIComponent(session.video)}`);
        if (payload?.status === 'AVAILABLE') return true;
        if (payload?.status === 'PROCESSING_FAILED') return false;
        return null;
      }, { every: 5_000, times: 120, wait: this.sleep });
      if (ready === false) throw permanent(t('LinkedIn konnte das Video nicht verarbeiten.'));
      videoUrn = session.video;
    }

    const { headers } = await this.rest('POST', '/rest/posts', {
      author,
      commentary: littleText(job.text || job.title || ''),
      visibility: 'PUBLIC',
      distribution: { feedDistribution: 'MAIN_FEED', targetEntities: [], thirdPartyDistributionChannels: [] },
      ...(videoUrn ? { content: { media: { title: job.title || '', id: videoUrn } } } : {}),
      lifecycleState: 'PUBLISHED',
      isReshareDisabledByAuthor: false,
    });
    const urn = headers['x-restli-id'] || headers['x-linkedin-id'] || null;
    return { state: 'published', remoteId: urn, url: urn ? `https://www.linkedin.com/feed/update/${urn}` : null };
  }

  status() {
    const config = this.tokens.get();
    const creds = this.creds();
    const expires = config.expiresAt ? Date.parse(config.expiresAt) : null;
    return {
      connected: this.isConnected(),
      needsSetup: !creds.complete,
      builtIn: creds.builtIn,
      account: config.name || null,
      avatar: config.avatar || null,
      connectedAt: config.connectedAt || null,
      expiresAt: config.expiresAt || null,
      expiringSoon: Boolean(expires && !config.refreshToken && expires - Date.now() < 7 * 86400_000),
      lastError: config.lastError || null,
    };
  }
}

/**
 * LinkedIns Textformat: Sonderzeichen müssen maskiert werden, sonst schneidet
 * LinkedIn den Text an der Stelle ab. Hashtags werden zu echten Hashtags.
 */
function littleText(text) {
  const escape = (part) => part.replace(/[\\|{}@[\]()<>*_~]/g, (char) => `\\${char}`).replace(/#/g, '\\#');
  const out = [];
  let last = 0;
  for (const match of String(text).matchAll(/#([\p{L}\p{N}_]+)/gu)) {
    out.push(escape(text.slice(last, match.index)));
    out.push(`{hashtag|\\#|${match[1]}}`);
    last = match.index + match[0].length;
  }
  out.push(escape(text.slice(last)));
  return out.join('');
}

module.exports = { LinkedInPublisher, littleText, REDIRECT, VERSION };
