'use strict';

/**
 * YouTube: hochladen und von YouTube zum Termin freischalten lassen.
 *
 * Der Upload passiert sofort nach dem Einplanen, als „privat mit
 * Veröffentlichungszeit“. Zum Termin schaltet YouTube selbst frei – der PC darf
 * dann aus sein. Wird der Termin verschoben oder zurückgenommen, zieht die App
 * das bei YouTube nach.
 *
 * Hochgeladen wird fortsetzbar: Bricht die Leitung ab, fragt die App YouTube,
 * wie viel angekommen ist, und macht dort weiter – auch nach einem Neustart.
 *
 * Anmeldung im Systembrowser mit Rückleitung auf 127.0.0.1; eingebettete
 * Anmeldefenster lässt Google nicht zu.
 */

const defaultHttp = require('../../connectors/http');
const { pkcePair, newState, loopback, codeFrom, TokenStore, form } = require('../oauth');
const { credentialsFor } = require('../credentials');
const { mimeOf } = require('../media-info');
const { sleep, parseJson, retryable, permanent, statusError, length, RELOGIN } = require('./common');

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
const API = 'https://www.googleapis.com/youtube/v3';
const UPLOAD = 'https://www.googleapis.com/upload/youtube/v3';

const SCOPES = [
  'https://www.googleapis.com/auth/youtube.upload',
  'https://www.googleapis.com/auth/youtube.readonly',
];

/** Blockgröße beim Hochladen – YouTube verlangt Vielfache von 256 KB. */
const CHUNK = 64 * 1024 * 1024;

class YouTubePublisher {
  constructor(store, deps = {}) {
    this.store = store;
    this.http = deps.http || defaultHttp;
    this.sleep = deps.sleep || sleep;
    this.openExternal = deps.openExternal || ((url) => require('electron').shell.openExternal(url));
    this.tokens = new TokenStore(store, 'youtubeUpload');
    this.access = null;

    this.id = 'youtube';
    this.name = 'YouTube';
    this.platformIds = ['youtube', 'youtube_shorts'];
    this.nativeSchedule = true;
    this.minLeadMs = 15 * 60_000;
  }

  creds() {
    return credentialsFor(this.store, 'google');
  }

  isConnected() {
    return this.creds().complete && Boolean(this.tokens.get().refreshToken);
  }

  nameFor(platformId) {
    return platformId === 'youtube_shorts' ? 'YouTube Shorts' : 'YouTube';
  }

  // ---------------------------------------------------------------- Anmeldung

  async signIn() {
    const creds = this.creds();
    if (!creds.complete) throw new Error('Für YouTube ist die Google-Anwendung noch nicht eingerichtet.');

    const { verifier, challenge } = pkcePair();
    const state = newState();
    const { params, redirectUri } = await loopback({
      key: this.id,
      name: 'YouTube',
      openExternal: this.openExternal,
      buildUrl: (redirect) => `${AUTH_URL}?${form({
        client_id: creds.clientId,
        redirect_uri: redirect,
        response_type: 'code',
        scope: SCOPES.join(' '),
        code_challenge: challenge,
        code_challenge_method: 'S256',
        state,
        access_type: 'offline',
        prompt: 'consent',
      })}`,
    });

    const tokens = await this.tokenRequest({
      grant_type: 'authorization_code',
      code: codeFrom(params, state, 'Google'),
      code_verifier: verifier,
      redirect_uri: redirectUri,
    });
    if (!tokens.refresh_token) {
      throw new Error('Google hat kein Erneuerungsmerkmal geschickt. Entziehe dem Content Helper unter myaccount.google.com/permissions den Zugriff und melde dich erneut an.');
    }

    this.access = { token: tokens.access_token, expires: Date.now() + (tokens.expires_in || 3600) * 1000 };
    this.tokens.save({ refreshToken: tokens.refresh_token, connectedAt: new Date().toISOString(), lastError: null });

    const channel = await this.api('GET', '/channels?part=snippet&mine=true').catch(() => null);
    const item = channel?.items?.[0];
    if (item) {
      this.tokens.save({
        channelId: item.id,
        channelTitle: item.snippet?.title || null,
        avatar: item.snippet?.thumbnails?.default?.url || null,
      });
    }
    return this.status();
  }

  async tokenRequest(params) {
    const creds = this.creds();
    const response = await this.http.request(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: form({ client_id: creds.clientId, client_secret: creds.clientSecret, ...params }),
    });
    const payload = parseJson(response.text) || {};
    if (response.status >= 400) {
      if (payload.error === 'invalid_grant') {
        this.tokens.save({ lastError: 'Die Anmeldung ist abgelaufen oder wurde zurückgezogen.' });
        throw permanent(`YouTube: Die Anmeldung ist abgelaufen oder wurde zurückgezogen. ${RELOGIN}`);
      }
      throw statusError('Google', response.status, payload.error_description || payload.error);
    }
    return payload;
  }

  async token() {
    if (this.access && Date.now() < this.access.expires - 60_000) return this.access.token;
    const { refreshToken } = this.tokens.get();
    if (!refreshToken) throw permanent(`Für YouTube besteht keine Anmeldung. ${RELOGIN}`);
    const tokens = await this.tokenRequest({ grant_type: 'refresh_token', refresh_token: refreshToken });
    this.access = { token: tokens.access_token, expires: Date.now() + (tokens.expires_in || 3600) * 1000 };
    return this.access.token;
  }

  async signOut() {
    const { refreshToken } = this.tokens.get();
    if (refreshToken) {
      await this.http.request(REVOKE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: form({ token: refreshToken }),
      }).catch(() => {});
    }
    this.access = null;
    this.tokens.clear();
  }

  // ---------------------------------------------------------------- Schnittstelle

  /** Aufruf der YouTube-Schnittstelle mit verständlichen Fehlern. */
  async api(method, path, body = null) {
    const response = await this.http.request(`${API}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${await this.token()}`,
        Accept: 'application/json',
        ...(body ? { 'Content-Type': 'application/json; charset=UTF-8' } : {}),
      },
      body: body ? JSON.stringify(body) : null,
    });
    const payload = parseJson(response.text);
    if (response.status >= 400) throw this.error(response.status, payload);
    return payload;
  }

  /** Googles Fehlergründe in Sätze übersetzen. */
  error(status, payload) {
    const reason = payload?.error?.errors?.[0]?.reason || payload?.error?.status || '';
    const message = payload?.error?.message || '';

    if (reason === 'quotaExceeded' || reason === 'rateLimitExceeded' && /quota/i.test(message)) {
      // Das Kontingent erneuert sich um Mitternacht pazifischer Zeit.
      const next = new Date();
      next.setUTCHours(8, 5, 0, 0);
      if (next.getTime() <= Date.now()) next.setUTCDate(next.getUTCDate() + 1);
      return retryable('Das Tageskontingent von YouTube ist aufgebraucht. Der Upload läuft automatisch weiter, sobald es sich erneuert (9 Uhr deutscher Zeit).', { retryAt: next.toISOString() });
    }
    if (reason === 'uploadLimitExceeded') return permanent('YouTube hat für diesen Kanal heute keine weiteren Uploads zugelassen. Bitte morgen erneut versuchen.');
    if (reason === 'youtubeSignupRequired') return permanent('Zu diesem Google-Konto gibt es noch keinen YouTube-Kanal.');
    if (reason === 'invalidTitle') return permanent('YouTube lehnt den Titel ab – höchstens 100 Zeichen, keine spitzen Klammern.');
    if (reason === 'invalidDescription') return permanent('YouTube lehnt die Beschreibung ab – höchstens 5000 Zeichen, keine spitzen Klammern.');
    if (reason === 'invalidPublishAt') return permanent('YouTube lehnt den Veröffentlichungstermin ab.');
    if (reason === 'forbidden' || status === 403) return permanent(`YouTube verweigert das: ${message || 'keine Berechtigung'}.`);
    return statusError('YouTube', status, message);
  }

  // ---------------------------------------------------------------- Veröffentlichen

  check(content) {
    const problems = [];
    if (!content.video) problems.push('Für YouTube fehlt das Video – bitte im Composer eine Videodatei wählen.');
    if (!content.title) problems.push('YouTube braucht einen Titel.');
    if (length(content.title) > 100) problems.push(`Der Titel ist ${length(content.title)} Zeichen lang, YouTube erlaubt 100.`);
    if (/[<>]/.test(content.title)) problems.push('YouTube erlaubt im Titel keine spitzen Klammern.');
    return problems;
  }

  resource(content, scheduledFor) {
    const options = content.options || {};
    const privacy = options.privacy || 'public';
    // Geplant wird nur öffentlich; Privates und Nichtgelistetes geht direkt so hoch.
    const planned = scheduledFor && privacy === 'public';

    let description = String(content.text || '').replace(/[<>]/g, '');
    if (length(description) > 5000) description = [...description].slice(0, 5000).join('');

    let tagBudget = 480;
    const tags = [];
    for (const tag of content.hashtags || []) {
      if (tag.length + 1 > tagBudget) break;
      tags.push(tag);
      tagBudget -= tag.length + 1;
    }

    return {
      planned,
      body: {
        snippet: {
          title: content.title,
          description,
          tags,
          categoryId: String(options.categoryId || '22'),
        },
        status: {
          privacyStatus: planned ? 'private' : privacy,
          ...(planned ? { publishAt: new Date(scheduledFor).toISOString() } : {}),
          selfDeclaredMadeForKids: Boolean(options.madeForKids),
          containsSyntheticMedia: Boolean(options.synthetic),
        },
      },
    };
  }

  async publish(job) {
    const { video } = job;
    const mime = mimeOf(video.ext);
    const { planned, body } = this.resource(job, job.scheduledFor);
    let session = job.session;
    let offset = 0;
    let uploaded = null;

    // Gibt es schon eine Upload-Sitzung? Dann nachfragen, wie weit sie ist.
    if (session?.uploadUrl) {
      const response = await this.http.request(session.uploadUrl, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${await this.token()}`, 'Content-Range': `bytes */${video.size}`, 'Content-Length': '0' },
      });
      if (response.status === 308) {
        offset = rangeEnd(response.headers.range);
      } else if (response.status === 200 || response.status === 201) {
        uploaded = parseJson(response.text);
      } else {
        session = null; // abgelaufen – neu beginnen
      }
    }

    if (!session?.uploadUrl) {
      const response = await this.http.request(`${UPLOAD}/videos?uploadType=resumable&part=snippet,status`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${await this.token()}`,
          'Content-Type': 'application/json; charset=UTF-8',
          'X-Upload-Content-Length': String(video.size),
          'X-Upload-Content-Type': mime,
        },
        body: JSON.stringify(body),
      });
      if (response.status >= 400 || !response.headers.location) throw this.error(response.status, parseJson(response.text));
      session = { uploadUrl: response.headers.location };
      job.saveSession(session);
      offset = 0;
    }

    while (!uploaded) {
      const end = Math.min(offset + CHUNK, video.size);
      const response = await this.http.uploadFile(session.uploadUrl, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${await this.token()}`,
          'Content-Type': mime,
          'Content-Range': `bytes ${offset}-${end - 1}/${video.size}`,
        },
        filePath: video.path,
        start: offset,
        end,
        onProgress: (sent) => job.onProgress((offset + sent) / video.size),
      });

      if (response.status === 308) {
        offset = response.headers.range ? rangeEnd(response.headers.range) : end;
        continue;
      }
      if (response.status === 200 || response.status === 201) {
        uploaded = parseJson(response.text);
        break;
      }
      if (response.status === 404 || response.status === 410) {
        job.saveSession(null);
        throw retryable('Die Upload-Sitzung bei YouTube ist abgelaufen. Der Upload beginnt beim nächsten Versuch neu.');
      }
      throw this.error(response.status, parseJson(response.text));
    }

    const videoId = uploaded?.id;
    if (!videoId) throw retryable('YouTube hat den Upload angenommen, aber keine Video-Kennung geliefert.');

    let message = null;
    if (job.thumbnail) {
      job.onProgress(1, 'processing');
      const response = await this.http.uploadFile(`${UPLOAD}/thumbnails/set?videoId=${encodeURIComponent(videoId)}&uploadType=media`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${await this.token()}`, 'Content-Type': mimeOf(job.thumbnail.ext) },
        filePath: job.thumbnail.path,
      }).catch((error) => ({ status: 0, text: error.message }));
      if (response.status >= 400 || response.status === 0) {
        const reason = parseJson(response.text)?.error?.message || response.text;
        message = `Das Video ist oben, das Thumbnail nicht: ${reason}. Eigene Thumbnails setzt YouTube erst nach Bestätigung des Kanals frei.`;
      }
    }

    return {
      state: planned ? 'scheduled' : 'published',
      remoteId: videoId,
      url: `https://youtu.be/${videoId}`,
      message,
    };
  }

  /** Termin bei YouTube verschieben. */
  async reschedule({ remoteId, scheduledFor }) {
    const current = await this.api('GET', `/videos?part=status&id=${encodeURIComponent(remoteId)}`);
    const status = current?.items?.[0]?.status;
    if (!status) throw permanent('Das Video gibt es bei YouTube nicht mehr.');
    await this.api('PUT', '/videos?part=status', {
      id: remoteId,
      status: { ...status, privacyStatus: 'private', publishAt: new Date(scheduledFor).toISOString() },
    });
  }

  /** Geplante Freischaltung zurücknehmen – das Video bleibt privat liegen. */
  async cancel({ remoteId }) {
    const current = await this.api('GET', `/videos?part=status&id=${encodeURIComponent(remoteId)}`);
    const status = current?.items?.[0]?.status;
    if (!status) return;
    const next = { ...status, privacyStatus: 'private' };
    delete next.publishAt;
    await this.api('PUT', '/videos?part=status', { id: remoteId, status: next });
  }

  status() {
    const config = this.tokens.get();
    const creds = this.creds();
    return {
      connected: this.isConnected(),
      needsSetup: !creds.complete,
      builtIn: creds.builtIn,
      account: config.channelTitle || null,
      avatar: config.avatar || null,
      connectedAt: config.connectedAt || null,
      lastError: config.lastError || null,
    };
  }
}

/** „bytes=0-12345“ → nächste Startposition 12346. */
function rangeEnd(header) {
  const match = /bytes=\d+-(\d+)/.exec(header || '');
  return match ? Number(match[1]) + 1 : 0;
}

module.exports = { YouTubePublisher, rangeEnd, CHUNK };
