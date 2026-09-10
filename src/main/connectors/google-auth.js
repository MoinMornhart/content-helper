'use strict';

/**
 * Google-Anmeldung für den YouTube-Upload.
 *
 * Verwendet den für Desktop-Programme vorgesehenen Weg: Die Anmeldung läuft im
 * Systembrowser, Google leitet auf einen kurzlebigen Server auf diesem Rechner
 * zurück. Es gibt also keine Webseite, auf der Zugangsdaten landen könnten, und
 * das Passwort bekommt die App zu keinem Zeitpunkt zu sehen.
 *
 * Abgesichert mit PKCE: Die App erzeugt vor der Anmeldung ein Geheimnis, sendet
 * nur dessen Prüfsumme mit und weist sich beim Einlösen mit dem Original aus.
 * Damit nützt ein abgefangener Rückleitungscode niemandem etwas.
 *
 * Was gespeichert wird, ist ein Erneuerungsmerkmal, mit dem sich die App
 * selbstständig neue, kurzlebige Zugriffsmerkmale holt. Es liegt im lokalen
 * Datenordner und lässt sich jederzeit mit einem Klick zurückziehen.
 */

const http = require('http');
const crypto = require('crypto');
const { shell } = require('electron');

const httpClient = require('./http');

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';

/** Nur das Nötigste: hochladen und den eigenen Kanal lesen. */
const SCOPES = [
  'https://www.googleapis.com/auth/youtube.upload',
  'https://www.googleapis.com/auth/youtube.readonly',
];

/** Wie lange auf die Rückleitung aus dem Browser gewartet wird. */
const AUTH_TIMEOUT_MS = 5 * 60 * 1000;

const base64url = (buffer) => buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** Antwortseite im Browser – der Nutzer soll sehen, dass es geklappt hat. */
function resultPage(title, message, ok = true) {
  return `<!doctype html><html lang="de"><head><meta charset="utf-8">
<title>${title}</title><style>
body{margin:0;height:100vh;display:grid;place-items:center;background:#0b0912;color:#f1eefb;
font:16px/1.6 "Segoe UI",system-ui,sans-serif}
.box{max-width:420px;padding:34px;text-align:center;background:#171423;border:1px solid rgba(255,255,255,.09);border-radius:18px}
.mark{width:54px;height:54px;margin:0 auto 18px;border-radius:50%;display:grid;place-items:center;font-size:26px;
background:${ok ? 'linear-gradient(135deg,#7c3aed,#ec4899)' : '#f87171'};color:#fff}
h1{font-size:19px;margin:0 0 8px}p{margin:0;color:#a79fc0;font-size:14px}
</style></head><body><div class="box"><div class="mark">${ok ? '✓' : '✕'}</div>
<h1>${title}</h1><p>${message}</p></div></body></html>`;
}

class GoogleAuth {
  /**
   * @param {import('../store').Store} store
   * @param {string} namespace Schlüssel unter settings.connections
   */
  constructor(store, namespace = 'youtubeUpload') {
    this.store = store;
    this.namespace = namespace;
    this.accessToken = null;
    this.accessExpires = 0;
    this.pending = null;
  }

  config() {
    return this.store.settings().connections?.[this.namespace] || {};
  }

  saveConfig(patch) {
    const connections = { ...(this.store.settings().connections || {}) };
    connections[this.namespace] = { ...(connections[this.namespace] || {}), ...patch };
    this.store.saveSettings({ connections });
    return connections[this.namespace];
  }

  isConnected() {
    const config = this.config();
    return Boolean(config.clientId && config.clientSecret && config.refreshToken);
  }

  // ---------------------------------------------------------------- Anmeldung

  /**
   * Führt die Anmeldung durch: Server starten, Browser öffnen, Rückleitung
   * abwarten, Code gegen Merkmale eintauschen.
   *
   * @param {{clientId: string, clientSecret: string}} credentials
   * @returns {Promise<{email: string|null}>}
   */
  async authorize({ clientId, clientSecret }) {
    if (!clientId?.trim() || !clientSecret?.trim()) {
      throw new Error('Client-ID und Client-Secret der Google-Anwendung fehlen.');
    }
    if (this.pending) throw new Error('Es läuft bereits eine Anmeldung. Bitte das Browserfenster abschliessen.');

    this.saveConfig({ clientId: clientId.trim(), clientSecret: clientSecret.trim() });

    const verifier = base64url(crypto.randomBytes(48));
    const challenge = base64url(crypto.createHash('sha256').update(verifier).digest());
    const state = base64url(crypto.randomBytes(16));

    const { server, port } = await this.startLoopback();
    const redirectUri = `http://127.0.0.1:${port}`;

    const url = `${AUTH_URL}?${new URLSearchParams({
      client_id: clientId.trim(),
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: SCOPES.join(' '),
      code_challenge: challenge,
      code_challenge_method: 'S256',
      state,
      access_type: 'offline',
      prompt: 'consent',
      include_granted_scopes: 'true',
    })}`;

    const code = await this.waitForCode(server, state).finally(() => {
      shell.beep?.();
    });

    await shell.openExternal(url).catch(() => {});

    const received = await code;
    const tokens = await this.exchange({
      grant_type: 'authorization_code',
      code: received,
      code_verifier: verifier,
      redirect_uri: redirectUri,
    });

    if (!tokens.refresh_token) {
      throw new Error('Google hat kein Erneuerungsmerkmal geschickt. Entziehe der Anwendung unter myaccount.google.com/permissions den Zugriff und versuche es erneut.');
    }

    this.saveConfig({
      refreshToken: tokens.refresh_token,
      connectedAt: new Date().toISOString(),
      scopes: tokens.scope || SCOPES.join(' '),
      lastError: null,
    });
    this.accessToken = tokens.access_token;
    this.accessExpires = Date.now() + (tokens.expires_in || 3600) * 1000;

    return { connectedAt: this.config().connectedAt };
  }

  /** Kurzlebiger Server auf einem freien Anschluss, nur für die Rückleitung. */
  startLoopback() {
    return new Promise((resolve, reject) => {
      const server = http.createServer();
      server.on('error', reject);
      server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
    });
  }

  /** Wartet auf die Rückleitung und liefert den Code. */
  waitForCode(server, expectedState) {
    return new Promise((resolve, reject) => {
      const finish = (fn, value) => {
        clearTimeout(timer);
        this.pending = null;
        server.close(() => {});
        fn(value);
      };

      const timer = setTimeout(() => {
        finish(reject, new Error('Die Anmeldung wurde nicht innerhalb von fünf Minuten abgeschlossen.'));
      }, AUTH_TIMEOUT_MS);

      this.pending = { cancel: () => finish(reject, new Error('Die Anmeldung wurde abgebrochen.')) };

      server.on('request', (request, response) => {
        const url = new URL(request.url, 'http://127.0.0.1');
        const code = url.searchParams.get('code');
        const error = url.searchParams.get('error');
        const state = url.searchParams.get('state');

        const send = (status, page) => {
          response.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' });
          response.end(page);
        };

        if (error) {
          send(400, resultPage('Anmeldung abgebrochen', 'Du kannst dieses Fenster schliessen.', false));
          return finish(reject, new Error(error === 'access_denied' ? 'Der Zugriff wurde abgelehnt.' : `Google meldet: ${error}`));
        }
        if (state !== expectedState) {
          send(400, resultPage('Etwas stimmt nicht', 'Die Rückleitung passt nicht zur Anfrage. Bitte erneut versuchen.', false));
          return finish(reject, new Error('Die Rückleitung passte nicht zur Anfrage.'));
        }
        if (!code) {
          send(400, resultPage('Kein Code erhalten', 'Bitte die Anmeldung erneut starten.', false));
          return;
        }

        send(200, resultPage('Verbunden', 'Der Content Helper darf jetzt Videos in deinen Kanal hochladen. Du kannst dieses Fenster schliessen.'));
        return finish(resolve, code);
      });
    });
  }

  /** Bricht eine laufende Anmeldung ab. */
  cancel() {
    this.pending?.cancel();
  }

  // ---------------------------------------------------------------- Merkmale

  async exchange(params) {
    const { clientId, clientSecret } = this.config();
    const body = new URLSearchParams({ client_id: clientId, client_secret: clientSecret, ...params }).toString();

    return httpClient.json(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    }).catch((error) => {
      throw new Error(
        /invalid_grant/i.test(error.message)
          ? 'Die Anmeldung ist abgelaufen oder wurde zurückgezogen. Bitte erneut verbinden.'
          : `Google meldet: ${error.message}`
      );
    });
  }

  /** Gültiges Zugriffsmerkmal, wird bei Bedarf erneuert. */
  async token() {
    if (this.accessToken && Date.now() < this.accessExpires - 60_000) return this.accessToken;

    const { refreshToken } = this.config();
    if (!refreshToken) throw new Error('Für YouTube ist keine Anmeldung hinterlegt.');

    const tokens = await this.exchange({ grant_type: 'refresh_token', refresh_token: refreshToken });
    this.accessToken = tokens.access_token;
    this.accessExpires = Date.now() + (tokens.expires_in || 3600) * 1000;
    return this.accessToken;
  }

  /** Zieht den Zugriff zurück – bei Google und lokal. */
  async revoke() {
    const { refreshToken } = this.config();
    if (refreshToken) {
      await httpClient.request(REVOKE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ token: refreshToken }).toString(),
      }).catch(() => { /* auch ohne Erfolg lokal aufraeumen */ });
    }

    this.accessToken = null;
    this.accessExpires = 0;
    const connections = { ...(this.store.settings().connections || {}) };
    delete connections[this.namespace];
    this.store.saveSettings({ connections });
  }

  status() {
    const config = this.config();
    return {
      connected: this.isConnected(),
      hasCredentials: Boolean(config.clientId && config.clientSecret),
      connectedAt: config.connectedAt || null,
      channelTitle: config.channelTitle || null,
      channelId: config.channelId || null,
      lastError: config.lastError || null,
    };
  }
}

module.exports = { GoogleAuth, SCOPES };
