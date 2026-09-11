'use strict';

/**
 * Verwaltung der Verbindungen.
 *
 * Hält die einzelnen Anbindungen, gleicht sie regelmässig ab und tastet einen
 * laufenden Twitch-Stream engmaschiger ab als den Rest. Fehler bleiben immer
 * an der jeweiligen Verbindung hängen – eine gestörte Anbindung darf die andere
 * nicht mitreissen und die App schon gar nicht anhalten.
 */

const { TwitchConnector } = require('./twitch');
const { YouTubeConnector } = require('./youtube');
const { t } = require('../i18n');

/** Vollständiger Abgleich: alle 20 Minuten reicht, die Zahlen ändern sich langsam. */
const SYNC_INTERVAL_MS = 20 * 60 * 1000;

/** Während eines Streams zählt jede Stichprobe – alle zwei Minuten. */
const LIVE_INTERVAL_MS = 2 * 60 * 1000;

/** Nach dem Start kurz warten, damit das Fenster zuerst erscheint. */
const STARTUP_DELAY_MS = 8_000;

class Connectors {
  /**
   * @param {import('../store').Store} store
   * @param {() => Electron.BrowserWindow|null} getWindow
   */
  constructor(store, getWindow) {
    this.store = store;
    this.getWindow = getWindow;
    this.twitch = new TwitchConnector(store);
    this.youtube = new YouTubeConnector(store);
    this.syncTimer = null;
    this.liveTimer = null;
    this.running = false;
  }

  get all() {
    return { twitch: this.twitch, youtube: this.youtube };
  }

  connector(name) {
    const found = this.all[name];
    if (!found) throw new Error(t('Unbekannte Verbindung: {name}', { name }));
    return found;
  }

  start() {
    if (this.syncTimer) return;
    setTimeout(() => this.syncAll(), STARTUP_DELAY_MS);
    this.syncTimer = setInterval(() => this.syncAll(), SYNC_INTERVAL_MS);
    this.liveTimer = setInterval(() => this.sampleLive(), LIVE_INTERVAL_MS);
  }

  stop() {
    clearInterval(this.syncTimer);
    clearInterval(this.liveTimer);
    this.syncTimer = null;
    this.liveTimer = null;
  }

  /**
   * Gleicht alle eingerichteten Verbindungen ab.
   * @returns {Promise<Record<string, object>>} Ergebnis je Verbindung
   */
  /**
   * Holt dieser PC die Zahlen ab? Sind mehrere PCs gekoppelt, übernimmt das nur
   * einer – sonst machten sich die Twitch-Anmeldungen gegenseitig ungültig, und
   * jedes Video käme von jedem PC einmal an. Die anderen bekommen die Zahlen
   * über den Abgleich.
   */
  fetchesHere() {
    const sync = this.store.settings().sync;
    return !(sync?.enabled && sync.fetchHere === false);
  }

  assertFetchesHere() {
    if (this.fetchesHere()) return;
    throw new Error(t('YouTube und Twitch werden auf einem anderen deiner PCs abgeholt. Umstellen kannst du das unter „PCs verbinden“.'));
  }

  async syncAll() {
    if (this.running) return { skipped: true };
    if (!this.fetchesHere()) return { skipped: true, reason: t('Abgeholt wird auf einem anderen PC.') };
    this.running = true;
    const results = {};

    for (const [name, connector] of Object.entries(this.all)) {
      if (!connector.isConfigured()) continue;
      try {
        results[name] = await connector.sync();
      } catch (error) {
        connector.saveConfig({ lastError: error.message, lastSync: connector.config().lastSync || null });
        results[name] = { error: error.message };
      }
    }

    this.running = false;
    if (Object.keys(results).length) this.notify(results);
    return results;
  }

  /** Nur den laufenden Stream abtasten – günstig genug für zwei Minuten Takt. */
  async sampleLive() {
    if (!this.twitch.isConfigured() || !this.fetchesHere()) return null;
    try {
      const live = await this.twitch.sampleLive();
      // Ein beendeter Stream erzeugt einen neuen Messwert, das gehört gemeldet.
      if (live?.ended) this.notify({ twitch: { live } });
      return live;
    } catch (error) {
      this.twitch.saveConfig({ lastError: error.message });
      return null;
    }
  }

  notify(payload) {
    const win = this.getWindow();
    if (win && !win.isDestroyed()) win.webContents.send('connectors:changed', payload);
  }

  status() {
    return {
      twitch: this.twitch.status(),
      youtube: this.youtube.status(),
    };
  }
}

module.exports = { Connectors };
