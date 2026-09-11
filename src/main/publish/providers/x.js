'use strict';

/**
 * X (Twitter): Posts mit Text und Video.
 *
 * X kann nicht vorausplanen; der Post geht zum Termin raus. Die Anmeldung läuft
 * als öffentliche Anwendung ohne Geheimnis (PKCE), die Rückleitung fängt das
 * Anmeldefenster ab.
 *
 * Wichtig für den Herausgeber: X rechnet seit 2026 jeden Post über die
 * Schnittstelle einzeln ab (derzeit 1,5 Cent, mit Link 20 Cent) – bezahlt vom
 * Entwicklerkonto, dem die Anwendung gehört.
 */

const crypto = require('crypto');
const defaultHttp = require('../../connectors/http');
const { pkcePair, newState, appWindow, codeFrom, TokenStore, form } = require('../oauth');
const { credentialsFor } = require('../credentials');
const { mimeOf, probe } = require('../media-info');
const { sleep, parseJson, retryable, permanent, statusError, poll, length, RELOGIN } = require('./common');

const AUTH_URL = 'https://x.com/i/oauth2/authorize';
const API = 'https://api.x.com';
const REDIRECT = 'https://moinmornhart.github.io/content-helper/anmeldung/';
const SCOPES = ['tweet.read', 'tweet.write', 'users.read', 'media.write', 'offline.access'];
const SEGMENT = 4 * 1024 * 1024;

class XPublisher {
  constructor(store, deps = {}) {
    this.store = store;
    this.http = deps.http || defaultHttp;
    this.sleep = deps.sleep || sleep;
    this.getWindow = deps.getWindow || (() => null);
    this.tokens = new TokenStore(store, 'xPublish');

    this.id = 'x';
    this.name = 'X';
    this.platformIds = ['x'];
    this.nativeSchedule = false;
  }

  creds() {
    return credentialsFor(this.store, 'x');
  }

  isConnected() {
    return this.creds().complete && Boolean(this.tokens.get().refreshToken);
  }

  async signIn() {
    const creds = this.creds();
    if (!creds.complete) throw new Error('Für X ist die Anwendung noch nicht eingerichtet.');

    const { verifier, challenge } = pkcePair();
    const state = newState();
    const { params } = await appWindow({
      key: this.id,
      name: 'X',
      parent: this.getWindow(),
      redirectUri: REDIRECT,
      url: `${AUTH_URL}?${form({
        response_type: 'code',
        client_id: creds.clientId,
        redirect_uri: REDIRECT,
        scope: SCOPES.join(' '),
        state,
        code_challenge: challenge,
        code_challenge_method: 'S256',
      })}`,
    });

    await this.tokenRequest({
      grant_type: 'authorization_code',
      code: codeFrom(params, state, 'X'),
      redirect_uri: REDIRECT,
      code_verifier: verifier,
    });

    const me = await this.call('GET', '/2/users/me?user.fields=profile_image_url').catch(() => null);
    if (me?.data) {
      this.tokens.save({ userId: me.data.id, name: me.data.name, username: me.data.username, avatar: me.data.profile_image_url || null });
    }
    this.tokens.save({ connectedAt: new Date().toISOString(), lastError: null });
    return this.status();
  }

  async tokenRequest(params) {
    const response = await this.http.request(`${API}/2/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: form({ client_id: this.creds().clientId, ...params }),
    });
    const payload = parseJson(response.text) || {};
    if (response.status >= 400) {
      if (params.grant_type === 'refresh_token') {
        this.tokens.save({ lastError: 'Die Anmeldung ist abgelaufen.' });
        throw permanent(`X: Die Anmeldung ist abgelaufen. ${RELOGIN}`);
      }
      throw new Error(`X meldet: ${payload.error_description || payload.error || response.status}`);
    }
    // X gibt bei jedem Erneuern ein neues Erneuerungsmerkmal aus; das alte verfällt.
    this.tokens.save({
      accessToken: payload.access_token,
      accessExpires: Date.now() + (payload.expires_in || 7200) * 1000,
      refreshToken: payload.refresh_token || this.tokens.get().refreshToken,
    });
    return payload;
  }

  async token() {
    const config = this.tokens.get();
    if (config.accessToken && Date.now() < (config.accessExpires || 0) - 60_000) return config.accessToken;
    if (!config.refreshToken) throw permanent(`Für X besteht keine Anmeldung. ${RELOGIN}`);
    return (await this.tokenRequest({ grant_type: 'refresh_token', refresh_token: config.refreshToken })).access_token;
  }

  signOut() {
    this.tokens.clear();
  }

  async call(method, path, body = null) {
    const response = await this.http.request(`${API}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${await this.token()}`,
        Accept: 'application/json',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : null,
    });
    const payload = parseJson(response.text) || {};
    if (response.status >= 400) throw this.error(response, payload);
    return payload;
  }

  error(response, payload) {
    const detail = payload.detail || payload.title || payload.errors?.[0]?.message || '';
    if (response.status === 402 || /credit/i.test(detail)) return permanent('Das Guthaben des X-Entwicklerkontos ist aufgebraucht – X rechnet jeden Post einzeln ab.');
    if (response.status === 429) {
      const reset = Number(response.headers['x-rate-limit-reset']);
      return retryable('X bremst gerade – zu viele Posts. Es geht weiter, sobald X wieder zulässt.', reset ? { retryAt: new Date(reset * 1000 + 5000).toISOString() } : {});
    }
    if (response.status === 403 && /duplicate/i.test(detail)) return permanent('X lehnt doppelte Posts ab – derselbe Text wurde schon gepostet.');
    return statusError('X', response.status, detail);
  }

  check(content) {
    const problems = [];
    const text = content.text || content.title || '';
    if (!text && !content.video) problems.push('Für X fehlt Text oder Video.');
    if (length(text) > 280) problems.push(`Der Text ist ${length(text)} Zeichen lang, X erlaubt 280 (ohne Premium).`);
    if (content.video) {
      if (!['mp4', 'mov'].includes(content.video.ext)) problems.push('X nimmt Videos als MP4 oder MOV.');
      const { durationSec } = probe(content.video.path);
      if (durationSec && durationSec > 140 && !content.options?.premium) problems.push('Ohne X Premium dürfen Videos höchstens 2:20 Minuten lang sein.');
    }
    return problems;
  }

  async publish(job) {
    let mediaId = null;

    if (job.video) {
      let session = job.session;
      if (!session?.mediaId) {
        const init = await this.call('POST', '/2/media/upload/initialize', {
          media_type: mimeOf(job.video.ext),
          total_bytes: job.video.size,
          media_category: 'tweet_video',
        });
        session = { mediaId: init.data?.id, next: 0 };
        if (!session.mediaId) throw retryable('X hat den Upload nicht angenommen.');
        job.saveSession(session);
      }

      const segments = Math.ceil(job.video.size / SEGMENT);
      for (let index = session.next; index < segments; index += 1) {
        const start = index * SEGMENT;
        const end = Math.min(start + SEGMENT, job.video.size);
        const boundary = `----ContentHelper${crypto.randomBytes(8).toString('hex')}`;
        const response = await this.http.uploadFile(`${API}/2/media/upload/${session.mediaId}/append`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${await this.token()}`, 'Content-Type': `multipart/form-data; boundary=${boundary}` },
          filePath: job.video.path,
          start,
          end,
          prefix: `--${boundary}\r\nContent-Disposition: form-data; name="segment_index"\r\n\r\n${index}\r\n`
            + `--${boundary}\r\nContent-Disposition: form-data; name="media"; filename="video"\r\nContent-Type: application/octet-stream\r\n\r\n`,
          suffix: `\r\n--${boundary}--\r\n`,
          onProgress: (sent) => job.onProgress((start + sent) / job.video.size),
        });
        if (response.status >= 400) throw this.error(response, parseJson(response.text) || {});
        session = { ...session, next: index + 1 };
        job.saveSession(session);
      }

      job.onProgress(1, 'processing');
      const finalized = await this.call('POST', `/2/media/upload/${session.mediaId}/finalize`);
      let info = finalized.data?.processing_info;
      if (info && info.state !== 'succeeded') {
        const outcome = await poll(async () => {
          const status = await this.call('GET', `/2/media/upload?command=STATUS&media_id=${session.mediaId}`);
          info = status.data?.processing_info;
          if (!info || info.state === 'succeeded') return 'ok';
          if (info.state === 'failed') return { error: info.error?.message || 'Verarbeitung fehlgeschlagen' };
          return null;
        }, { every: 5_000, times: 120, wait: this.sleep });
        if (outcome?.error) throw permanent(`X konnte das Video nicht verarbeiten: ${outcome.error}`);
        if (!outcome) throw retryable('X verarbeitet das Video noch. Neuer Versuch folgt.');
      }
      mediaId = session.mediaId;
    }

    const tweet = await this.call('POST', '/2/tweets', {
      text: job.text || job.title || '',
      ...(mediaId ? { media: { media_ids: [mediaId] } } : {}),
    });
    const id = tweet.data?.id;
    const username = this.tokens.get().username;
    return { state: 'published', remoteId: id, url: id ? `https://x.com/${username || 'i'}/status/${id}` : null };
  }

  status() {
    const config = this.tokens.get();
    const creds = this.creds();
    return {
      connected: this.isConnected(),
      needsSetup: !creds.complete,
      builtIn: creds.builtIn,
      account: config.username ? `@${config.username}` : null,
      avatar: config.avatar || null,
      connectedAt: config.connectedAt || null,
      lastError: config.lastError || null,
    };
  }
}

module.exports = { XPublisher, REDIRECT, SEGMENT };
