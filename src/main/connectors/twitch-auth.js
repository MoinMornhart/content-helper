'use strict';

/**
 * Anmeldung bei Twitch – wie bei jeder anderen App.
 *
 * Statt Kennung und Geheimnis von Hand einzutragen, meldet sich der Nutzer
 * einfach an: Die App holt sich einen kurzen Code, öffnet twitch.tv/activate im
 * Browser, der Nutzer bestätigt mit seinem gewohnten Twitch-Konto – fertig.
 * Das ist der sogenannte Geräte-Ablauf, gedacht für Programme, die kein
 * Geheimnis sicher aufbewahren können. Genau das trifft auf eine Desktop-App zu.
 *
 * Was dadurch entfällt: das Client-Secret, das Eintippen des Kanalnamens und
 * das erneute Anmelden nach ein paar Stunden.
 *
 * Was bleibt: eine Client-ID. Twitch gibt ohne registrierte Anwendung keine
 * Daten heraus – das ist eine Vorgabe der Plattform, kein Umsetzungsdetail.
 * Sie ist aber kein Geheimnis (sie steht in jedem öffentlichen Programm im
 * Klartext), muss genau einmal hinterlegt werden und lässt sich fest einbauen,
 * sodass niemand sie je wieder sieht.
 *
 * Nebeneffekt der Anmeldung: Mit einem Nutzer-Merkmal liefert Twitch Zahlen,
 * die es einer bloss registrierten Anwendung verweigert – allen voran die
 * Followerzahl und die Abonnenten des eigenen Kanals.
 */

const { shell } = require('electron');
const http = require('./http');
const { t } = require('../i18n');

const DEVICE_URL = 'https://id.twitch.tv/oauth2/device';
const TOKEN_URL = 'https://id.twitch.tv/oauth2/token';
const REVOKE_URL = 'https://id.twitch.tv/oauth2/revoke';
const VALIDATE_URL = 'https://id.twitch.tv/oauth2/validate';

/**
 * Fest eingebaute Client-ID.
 *
 * Ist hier eine hinterlegt, muss niemand mehr etwas eintragen – die App meldet
 * sich direkt an. Ohne Eintrag fragt die Oberfläche einmalig danach.
 */
const BUILT_IN_CLIENT_ID = '';

/** Nur, was die App tatsächlich auswertet. */
const SCOPES = [
  'user:read:email',              // wer ist angemeldet
  'moderator:read:followers',     // Followerzahl des eigenen Kanals
  'channel:read:subscriptions',   // Abonnentenzahl
];

class TwitchAuth {
  /** @param {import('../store').Store} store */
  constructor(store) {
    this.store = store;
    this.accessToken = null;
    this.accessExpires = 0;
    /** Laufende Anmeldung, damit sie sich abbrechen lässt. */
    this.pending = null;
  }

  config() {
    return this.store.settings().connections?.twitch || {};
  }

  saveConfig(patch) {
    const connections = { ...(this.store.settings().connections || {}) };
    connections.twitch = { ...(connections.twitch || {}), ...patch };
    this.store.saveSettings({ connections });
    return connections.twitch;
  }

  /** Eingebaute Kennung hat Vorrang, sonst die selbst hinterlegte. */
  clientId() {
    return BUILT_IN_CLIENT_ID || this.config().clientId || '';
  }

  needsClientId() {
    return !this.clientId();
  }

  isSignedIn() {
    return Boolean(this.config().refreshToken);
  }

  // ---------------------------------------------------------------- Anmelden

  /**
   * Startet die Anmeldung.
   *
   * Liefert sofort den Code zurück, den der Nutzer im Browser bestätigen soll,
   * und wartet im Hintergrund auf die Bestätigung.
   *
   * @param {(status: object) => void} onUpdate Rückmeldung an die Oberfläche
   * @returns {Promise<{userCode: string, url: string, expiresIn: number}>}
   */
  async begin(onUpdate = () => {}) {
    const clientId = this.clientId();
    if (!clientId) throw new Error(t('Es ist keine Twitch-Client-ID hinterlegt.'));
    if (this.pending) throw new Error(t('Es läuft bereits eine Anmeldung.'));

    const start = await http.json(DEVICE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: clientId, scopes: SCOPES.join(' ') }).toString(),
    }).catch((error) => {
      throw new Error(
        /invalid client/i.test(error.message)
          ? t('Diese Client-ID kennt Twitch nicht. Bitte im Entwicklerbereich prüfen.')
          : t('Twitch meldet: {message}', { message: error.message })
      );
    });

    const url = start.verification_uri || 'https://www.twitch.tv/activate';
    this.pending = { cancelled: false };

    // Der Browser geht sofort auf, damit der Nutzer den Code direkt eingeben kann.
    shell.openExternal(start.user_code ? `${url}?public=true` : url).catch(() => {});

    // Im Hintergrund auf die Bestätigung warten.
    this.poll(start, onUpdate).catch((error) => onUpdate({ state: 'error', message: error.message }));

    return {
      userCode: start.user_code,
      url,
      expiresIn: start.expires_in || 1800,
    };
  }

  /** Fragt Twitch im vorgegebenen Takt, ob der Nutzer bestätigt hat. */
  async poll(start, onUpdate) {
    const clientId = this.clientId();
    const interval = Math.max(5, start.interval || 5) * 1000;
    const deadline = Date.now() + (start.expires_in || 1800) * 1000;

    while (Date.now() < deadline) {
      if (this.pending?.cancelled) {
        this.pending = null;
        return onUpdate({ state: 'cancelled' });
      }

      await wait(interval);

      let tokens = null;
      try {
        tokens = await http.json(TOKEN_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            client_id: clientId,
            device_code: start.device_code,
            grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
            scopes: SCOPES.join(' '),
          }).toString(),
        });
      } catch (error) {
        // Solange der Nutzer nicht bestätigt hat, ist das der Normalfall.
        if (/authorization_pending|pending/i.test(error.message)) continue;
        if (/slow ?down/i.test(error.message)) { await wait(interval); continue; }
        this.pending = null;
        throw new Error(t('Twitch meldet: {message}', { message: error.message }));
      }

      this.pending = null;
      this.accessToken = tokens.access_token;
      this.accessExpires = Date.now() + (tokens.expires_in || 14400) * 1000;
      this.saveConfig({
        refreshToken: tokens.refresh_token,
        signedInAt: new Date().toISOString(),
        scopes: (tokens.scope || SCOPES).join ? (tokens.scope || SCOPES).join(' ') : String(tokens.scope || ''),
        lastError: null,
      });

      const user = await this.currentUser().catch(() => null);
      if (user) {
        this.saveConfig({
          login: user.login,
          userId: user.id,
          displayName: user.display_name,
          avatar: user.profile_image_url,
        });
      }
      return onUpdate({ state: 'done', user });
    }

    this.pending = null;
    throw new Error(t('Die Anmeldung wurde nicht rechtzeitig bestätigt.'));
  }

  cancel() {
    if (this.pending) this.pending.cancelled = true;
  }

  // ---------------------------------------------------------------- Merkmale

  /** Gültiges Nutzer-Merkmal, wird bei Bedarf erneuert. */
  async token() {
    if (this.accessToken && Date.now() < this.accessExpires - 60_000) return this.accessToken;

    const { refreshToken, clientSecret } = this.config();
    if (!refreshToken) throw new Error(t('Für Twitch ist keine Anmeldung hinterlegt.'));

    const params = {
      client_id: this.clientId(),
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    };
    // Oeffentliche Anwendungen brauchen kein Geheimnis; hat der Nutzer eines
    // hinterlegt, wird es mitgeschickt.
    if (clientSecret) params.client_secret = clientSecret;

    const tokens = await http.json(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(params).toString(),
    }).catch((error) => {
      this.saveConfig({ lastError: t('Die Anmeldung bei Twitch ist abgelaufen. Bitte erneut anmelden.') });
      throw new Error(t('Die Anmeldung bei Twitch ist abgelaufen ({message}). Bitte erneut anmelden.', { message: error.message }));
    });

    this.accessToken = tokens.access_token;
    this.accessExpires = Date.now() + (tokens.expires_in || 14400) * 1000;
    if (tokens.refresh_token) this.saveConfig({ refreshToken: tokens.refresh_token });
    return this.accessToken;
  }

  /** Ruft einen Helix-Endpunkt mit dem Nutzer-Merkmal auf. */
  async call(path, params = {}) {
    const token = await this.token();
    const query = new URLSearchParams(
      Object.entries(params).filter(([, value]) => value !== null && value !== undefined)
    ).toString();

    return http.json(`https://api.twitch.tv/helix/${path}${query ? `?${query}` : ''}`, {
      headers: { 'Client-Id': this.clientId(), Authorization: `Bearer ${token}` },
    });
  }

  /** Wer ist angemeldet? */
  async currentUser() {
    const payload = await this.call('users');
    return payload.data?.[0] || null;
  }

  /** Followerzahl – nur mit Anmeldung verfügbar. */
  async followerCount() {
    const { userId } = this.config();
    if (!userId) return null;
    const payload = await this.call('channels/followers', { broadcaster_id: userId, first: 1 });
    return typeof payload.total === 'number' ? payload.total : null;
  }

  /** Abonnentenzahl – ebenfalls nur mit Anmeldung. */
  async subscriberCount() {
    const { userId } = this.config();
    if (!userId) return null;
    const payload = await this.call('subscriptions', { broadcaster_id: userId, first: 1 }).catch(() => null);
    return typeof payload?.total === 'number' ? payload.total : null;
  }

  /** Prüft, ob das gespeicherte Merkmal noch gilt. */
  async validate() {
    const token = await this.token();
    return http.json(VALIDATE_URL, { headers: { Authorization: `OAuth ${token}` } });
  }

  async signOut() {
    const token = this.accessToken;
    if (token) {
      await http.request(REVOKE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ client_id: this.clientId(), token }).toString(),
      }).catch(() => { /* lokal trotzdem aufraeumen */ });
    }
    this.accessToken = null;
    this.accessExpires = 0;
    this.saveConfig({ refreshToken: null, signedInAt: null, scopes: null });
  }

  status() {
    const config = this.config();
    return {
      signedIn: this.isSignedIn(),
      needsClientId: this.needsClientId(),
      builtInClientId: Boolean(BUILT_IN_CLIENT_ID),
      login: config.login || null,
      displayName: config.displayName || null,
      userId: config.userId || null,
      avatar: config.avatar || null,
      signedInAt: config.signedInAt || null,
      lastError: config.lastError || null,
    };
  }
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

module.exports = { TwitchAuth, SCOPES, BUILT_IN_CLIENT_ID };
