'use strict';

/**
 * TikTok: direkt posten über die Content Posting API.
 *
 * TikTok kann nicht selbst planen – der Beitrag geht genau zum Termin raus, der
 * PC muss dann laufen. Hochgeladen wird in Blöcken; bricht ein Block ab, geht es
 * mit genau diesem Block weiter, solange die Upload-Adresse gilt (eine Stunde).
 *
 * TikTok schreibt vor, was die App vor dem Posten zeigen muss: den Namen des
 * Kontos, eine Sichtbarkeit ohne Vorauswahl, Schalter für Kommentare, Duette
 * und Stitches und die Kennzeichnung werblicher Inhalte. Das liegt im Composer;
 * hier wird es geprüft und übertragen.
 *
 * Anmeldung im Systembrowser mit Rückleitung auf 127.0.0.1 – der einzige Weg,
 * den TikTok für Desktop-Programme zulässt.
 */

const defaultHttp = require('../../connectors/http');
const { pkcePair, newState, loopback, codeFrom, TokenStore, form } = require('../oauth');
const { credentialsFor } = require('../credentials');
const { mimeOf, probe } = require('../media-info');
const { sleep, parseJson, retryable, permanent, statusError, poll, clip, length, RELOGIN } = require('./common');

const AUTH_URL = 'https://www.tiktok.com/v2/auth/authorize/';
const BASE = 'https://open.tiktokapis.com';
const SCOPES = ['user.info.basic', 'video.publish', 'video.upload'];
/** Fester Anschluss: TikTok verlangt die Rückleitung genau so, wie sie registriert ist. */
const PORT = 51789;
const CALLBACK = '/callback/';

const MB = 1024 * 1024;
const CHUNK = 10 * MB;
const SESSION_TTL_MS = 55 * 60_000;

/** TikToks Fehlercodes in Sätze übersetzen. */
const ERRORS = {
  unaudited_client_can_only_post_to_private_accounts: () => permanent('Die TikTok-Anwendung des Content Helpers ist von TikTok noch nicht geprüft. Bis dahin sind nur private Posts möglich – stell die Sichtbarkeit auf „Nur ich“.'),
  spam_risk_too_many_posts: () => permanent('TikTok lässt für dieses Konto heute keine weiteren Posts zu. Morgen erneut einplanen.'),
  spam_risk_user_banned_from_posting: () => permanent('TikTok hat das Posten für dieses Konto gesperrt.'),
  reached_active_user_cap: () => retryable('TikTok hat das Tageslimit der Anwendung erreicht. Neuer Versuch folgt.'),
  privacy_level_option_mismatch: () => permanent('Diese Sichtbarkeit bietet TikTok für dein Konto nicht an. Bitte im Composer neu wählen.'),
  access_token_invalid: () => permanent(`TikTok: Die Anmeldung ist abgelaufen. ${RELOGIN}`),
  scope_not_authorized: () => permanent(`TikTok: Die Anmeldung erlaubt das Posten nicht. ${RELOGIN}`),
  rate_limit_exceeded: () => retryable('TikTok bremst gerade – zu viele Anfragen. Es geht gleich weiter.'),
  file_format_check_failed: () => permanent('TikTok nimmt dieses Videoformat nicht an (MP4, MOV oder WebM mit H.264/H.265).'),
  duration_check_failed: () => permanent('Das Video ist für dein TikTok-Konto zu lang.'),
  frame_rate_check_failed: () => permanent('TikTok verlangt 23 bis 60 Bilder pro Sekunde.'),
  picture_size_check_failed: () => permanent('Die Bildgröße passt nicht – TikTok verlangt 360 bis 4096 Pixel Kantenlänge.'),
};

class TikTokPublisher {
  constructor(store, deps = {}) {
    this.store = store;
    this.http = deps.http || defaultHttp;
    this.sleep = deps.sleep || sleep;
    this.openExternal = deps.openExternal || ((url) => require('electron').shell.openExternal(url));
    this.tokens = new TokenStore(store, 'tiktokPublish');

    this.id = 'tiktok';
    this.name = 'TikTok';
    this.platformIds = ['tiktok'];
    this.nativeSchedule = false;
  }

  creds() {
    return credentialsFor(this.store, 'tiktok');
  }

  isConnected() {
    return this.creds().complete && Boolean(this.tokens.get().refreshToken);
  }

  // ---------------------------------------------------------------- Anmeldung

  async signIn() {
    const creds = this.creds();
    if (!creds.complete) throw new Error('Für TikTok ist die Anwendung noch nicht eingerichtet.');

    const { verifier, challenge } = pkcePair({ hex: true });
    const state = newState();
    const { params, redirectUri } = await loopback({
      key: this.id,
      name: 'TikTok',
      port: PORT,
      callbackPath: CALLBACK,
      openExternal: this.openExternal,
      buildUrl: (redirect) => `${AUTH_URL}?${form({
        client_key: creds.clientKey,
        scope: SCOPES.join(','),
        response_type: 'code',
        redirect_uri: redirect,
        state,
        code_challenge: challenge,
        code_challenge_method: 'S256',
      })}`,
    });

    await this.tokenRequest({
      grant_type: 'authorization_code',
      code: codeFrom(params, state, 'TikTok'),
      redirect_uri: redirectUri,
      code_verifier: verifier,
    });

    const user = await this.call('GET', '/v2/user/info/?fields=open_id,avatar_url,display_name,username').catch(() => null);
    if (user?.user) {
      this.tokens.save({
        displayName: user.user.display_name || null,
        username: user.user.username || null,
        avatar: user.user.avatar_url || null,
      });
    }
    this.tokens.save({ connectedAt: new Date().toISOString(), lastError: null });
    return this.status();
  }

  async tokenRequest(params) {
    const creds = this.creds();
    const response = await this.http.request(`${BASE}/v2/oauth/token/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: form({ client_key: creds.clientKey, client_secret: creds.clientSecret, ...params }),
    });
    const payload = parseJson(response.text) || {};
    if (response.status >= 400 || payload.error) {
      if (/invalid_grant|refresh/i.test(`${payload.error} ${payload.error_description}`)) {
        this.tokens.save({ lastError: 'Die Anmeldung ist abgelaufen.' });
        throw permanent(`TikTok: Die Anmeldung ist abgelaufen. ${RELOGIN}`);
      }
      throw statusError('TikTok', response.status >= 400 ? response.status : 400, payload.error_description || payload.error);
    }
    this.tokens.save({
      accessToken: payload.access_token,
      accessExpires: Date.now() + (payload.expires_in || 86400) * 1000,
      refreshToken: payload.refresh_token,
      refreshExpires: Date.now() + (payload.refresh_expires_in || 31536000) * 1000,
      openId: payload.open_id || this.tokens.get().openId || null,
    });
    return payload;
  }

  async token() {
    const config = this.tokens.get();
    if (config.accessToken && Date.now() < (config.accessExpires || 0) - 60_000) return config.accessToken;
    if (!config.refreshToken) throw permanent(`Für TikTok besteht keine Anmeldung. ${RELOGIN}`);
    const payload = await this.tokenRequest({ grant_type: 'refresh_token', refresh_token: config.refreshToken });
    return payload.access_token;
  }

  async signOut() {
    const creds = this.creds();
    const { accessToken } = this.tokens.get();
    if (accessToken) {
      await this.http.request(`${BASE}/v2/oauth/revoke/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: form({ client_key: creds.clientKey, client_secret: creds.clientSecret, token: accessToken }),
      }).catch(() => {});
    }
    this.tokens.clear();
  }

  // ---------------------------------------------------------------- Schnittstelle

  async call(method, path, body = null) {
    const response = await this.http.request(`${BASE}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${await this.token()}`,
        Accept: 'application/json',
        ...(body ? { 'Content-Type': 'application/json; charset=UTF-8' } : {}),
      },
      body: body ? JSON.stringify(body) : null,
    });
    const payload = parseJson(response.text) || {};
    const code = payload.error?.code;
    if (code && code !== 'ok') {
      throw (ERRORS[code] || (() => statusError('TikTok', response.status >= 400 ? response.status : 400, payload.error.message || code)))();
    }
    if (response.status >= 400) throw statusError('TikTok', response.status, payload.error?.message);
    return payload.data || {};
  }

  /** Was das Konto darf – TikTok verlangt, dass die App genau das anbietet. */
  async creatorInfo() {
    return this.call('POST', '/v2/post/publish/creator_info/query/', {});
  }

  // ---------------------------------------------------------------- Veröffentlichen

  check(content) {
    const options = content.options || {};
    const problems = [];
    if (!content.video) problems.push('Für TikTok fehlt das Video – bitte im Composer eine Videodatei wählen.');
    else if (!['mp4', 'mov', 'webm'].includes(content.video.ext)) problems.push('TikTok nimmt nur MP4, MOV oder WebM.');
    else if (content.video.size > 4 * 1024 * MB) problems.push('TikTok nimmt höchstens 4 GB.');
    if (!options.privacy) problems.push('Für TikTok ist noch keine Sichtbarkeit gewählt – TikTok verlangt, dass du sie selbst festlegst.');
    if (options.commercial && !options.yourBrand && !options.brandedContent) problems.push('Werblicher Inhalt ist markiert, aber nicht, für wen – bitte „Eigene Marke“ oder „Bezahlte Partnerschaft“ wählen.');
    if (options.brandedContent && options.privacy === 'SELF_ONLY') problems.push('Bezahlte Partnerschaften dürfen bei TikTok nicht privat sein.');
    const caption = [content.title, content.text].filter(Boolean).join('\n\n');
    if (length(caption) > 2200) problems.push(`Der Text ist ${length(caption)} Zeichen lang, TikTok erlaubt 2200.`);
    return problems;
  }

  async publish(job) {
    const { video } = job;
    const options = job.options || {};
    const info = await this.creatorInfo();

    if (Array.isArray(info.privacy_level_options) && !info.privacy_level_options.includes(options.privacy)) {
      throw permanent('Diese Sichtbarkeit bietet TikTok für dein Konto nicht an. Bitte im Composer neu wählen.');
    }
    const limit = info.max_video_post_duration_sec;
    const duration = probe(video.path).durationSec;
    if (limit && duration && duration > limit) {
      throw permanent(`Das Video ist ${Math.round(duration)} Sekunden lang, dein TikTok-Konto erlaubt ${limit}.`);
    }

    let session = job.session;
    if (!session || Date.now() - (session.createdAt || 0) > SESSION_TTL_MS) {
      const plan = chunkPlan(video.size);
      const data = await this.call('POST', '/v2/post/publish/video/init/', {
        post_info: {
          title: clip([job.title, job.text].filter(Boolean).join('\n\n'), 2200),
          privacy_level: options.privacy,
          disable_comment: !options.allowComments || Boolean(info.comment_disabled),
          disable_duet: !options.allowDuet || Boolean(info.duet_disabled),
          disable_stitch: !options.allowStitch || Boolean(info.stitch_disabled),
          video_cover_timestamp_ms: Number(options.coverMs) || 1000,
          brand_content_toggle: Boolean(options.commercial && options.brandedContent),
          brand_organic_toggle: Boolean(options.commercial && options.yourBrand),
          is_aigc: Boolean(options.aiGenerated),
        },
        source_info: {
          source: 'FILE_UPLOAD',
          video_size: video.size,
          chunk_size: plan.chunkSize,
          total_chunk_count: plan.count,
        },
      });
      session = { publishId: data.publish_id, uploadUrl: data.upload_url, ...plan, next: 0, createdAt: Date.now() };
      job.saveSession(session);
    }

    const mime = mimeOf(video.ext);
    for (let index = session.next; index < session.count; index += 1) {
      const first = index * session.chunkSize;
      const last = index === session.count - 1 ? video.size - 1 : first + session.chunkSize - 1;
      const response = await this.http.uploadFile(session.uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': mime, 'Content-Range': `bytes ${first}-${last}/${video.size}` },
        filePath: video.path,
        start: first,
        end: last + 1,
        onProgress: (sent) => job.onProgress((first + sent) / video.size),
      });
      if (response.status === 403 || response.status === 404) {
        job.saveSession(null);
        throw retryable('Die Upload-Adresse von TikTok ist abgelaufen. Der Upload beginnt beim nächsten Versuch neu.');
      }
      if (response.status === 416) {
        job.saveSession(null);
        throw retryable('TikTok hat einen Block anders erwartet. Der Upload beginnt beim nächsten Versuch neu.');
      }
      if (response.status !== 206 && response.status !== 201 && response.status !== 200) {
        throw statusError('TikTok', response.status, parseJson(response.text)?.error?.message);
      }
      session = { ...session, next: index + 1 };
      job.saveSession(session);
    }

    // TikTok verarbeitet und prüft das Video danach noch.
    job.onProgress(1, 'processing');
    const result = await poll(async () => {
      const data = await this.call('POST', '/v2/post/publish/status/fetch/', { publish_id: session.publishId });
      if (data.status === 'PUBLISH_COMPLETE') return { done: true, data };
      if (data.status === 'FAILED') return { failed: true, reason: data.fail_reason };
      return null;
    }, { every: 5_000, times: 48, wait: this.sleep });

    if (result?.failed) {
      throw (ERRORS[result.reason] || (() => permanent(`TikTok hat das Video abgelehnt (${result.reason || 'ohne Begründung'}).`)))();
    }

    const username = this.tokens.get().username;
    const postId = result?.data?.publicaly_available_post_id?.[0];
    return {
      state: 'published',
      remoteId: postId ? String(postId) : session.publishId,
      url: postId && username ? `https://www.tiktok.com/@${username}/video/${postId}` : (username ? `https://www.tiktok.com/@${username}` : null),
      message: result ? null : 'Das Video ist bei TikTok angekommen und wird noch geprüft – bei öffentlichen Posts kann das dauern.',
    };
  }

  status() {
    const config = this.tokens.get();
    const creds = this.creds();
    return {
      connected: this.isConnected(),
      needsSetup: !creds.complete,
      builtIn: creds.builtIn,
      account: config.displayName || config.username || null,
      username: config.username || null,
      avatar: config.avatar || null,
      connectedAt: config.connectedAt || null,
      lastError: config.lastError || null,
    };
  }
}

/**
 * Blockaufteilung nach TikToks Regeln: unter 5 MB am Stück, sonst Blöcke von
 * 10 MB; der letzte Block nimmt den Rest mit (darf bis 128 MB groß sein).
 */
function chunkPlan(size) {
  if (size < 5 * MB) return { chunkSize: size, count: 1 };
  const count = Math.max(1, Math.floor(size / CHUNK));
  return { chunkSize: CHUNK, count };
}

module.exports = { TikTokPublisher, chunkPlan, PORT, CALLBACK };
