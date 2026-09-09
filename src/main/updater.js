'use strict';

/**
 * Update-Pruefung ohne API-Schluessel.
 *
 * Fragt die oeffentliche Release-Adresse des Projekts auf GitHub ab und
 * vergleicht die dort veroeffentlichte Version mit der laufenden. Gefunden wird
 * nur informiert – heruntergeladen und installiert wird nichts im Hintergrund,
 * der Nutzer entscheidet. Ohne Netzverbindung bleibt die App vollstaendig
 * benutzbar, die Pruefung scheitert dann still.
 */

const { app, net, shell, Notification } = require('electron');

const REPO = 'MoinMornhart/content-helper';
const API_URL = `https://api.github.com/repos/${REPO}/releases/latest`;
const RELEASES_PAGE = `https://github.com/${REPO}/releases/latest`;

const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000; // laufende Sitzungen zusaetzlich alle sechs Stunden
const STARTUP_DELAY_MS = 4_000;               // kurz nach dem Start, damit das Fenster zuerst erscheint
const MIN_GAP_MS = 30 * 60 * 1000;            // Drosselung fuer wiederholte Pruefungen innerhalb einer Sitzung

/**
 * Vergleicht zwei Versionen nach dem Muster major.minor.patch.
 * Vorabversionen (1.2.0-beta.1) gelten als aelter als die fertige 1.2.0.
 * @returns {number} negativ wenn a < b, 0 bei Gleichstand, positiv wenn a > b
 */
function compareVersions(a, b) {
  const parse = (value) => {
    const [core, pre = ''] = String(value).replace(/^v/i, '').split('-');
    const parts = core.split('.').map((part) => parseInt(part, 10) || 0);
    return { parts, pre };
  };
  const left = parse(a);
  const right = parse(b);

  for (let i = 0; i < 3; i += 1) {
    const diff = (left.parts[i] || 0) - (right.parts[i] || 0);
    if (diff !== 0) return diff;
  }
  if (left.pre === right.pre) return 0;
  if (!left.pre) return 1;
  if (!right.pre) return -1;
  return left.pre.localeCompare(right.pre);
}

class Updater {
  /**
   * @param {import('./store').Store} store
   * @param {() => Electron.BrowserWindow|null} getWindow
   */
  constructor(store, getWindow) {
    this.store = store;
    this.getWindow = getWindow;
    this.timer = null;
    this.lastCheck = 0;
    this.lastResult = null;
  }

  /**
   * Beim Start wird immer geprueft – der Nutzer soll eine neue Version sofort
   * beim Oeffnen sehen und nicht erst nach Stunden Laufzeit. Die Drosselung
   * gilt nur fuer weitere Pruefungen innerhalb derselben Sitzung.
   */
  start() {
    if (this.timer) return;
    setTimeout(() => this.check({ skipThrottle: true }), STARTUP_DELAY_MS);
    this.timer = setInterval(() => this.check(), CHECK_INTERVAL_MS);
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
  }

  /** Holt die Release-Daten; wirft bei Netz- oder Serverfehlern. */
  fetchLatest() {
    return new Promise((resolve, reject) => {
      const request = net.request({ method: 'GET', url: API_URL });
      request.setHeader('Accept', 'application/vnd.github+json');
      request.setHeader('User-Agent', `ContentHelper/${app.getVersion()}`);

      const timeout = setTimeout(() => {
        request.abort();
        reject(new Error('Zeitüberschreitung bei der Update-Prüfung.'));
      }, 12_000);

      request.on('response', (response) => {
        let body = '';
        response.on('data', (chunk) => { body += chunk; });
        response.on('end', () => {
          clearTimeout(timeout);
          if (response.statusCode === 404) return resolve(null); // noch kein Release veroeffentlicht
          if (response.statusCode !== 200) {
            return reject(new Error(`GitHub antwortete mit Status ${response.statusCode}.`));
          }
          try {
            resolve(JSON.parse(body));
          } catch {
            reject(new Error('Die Antwort von GitHub war nicht lesbar.'));
          }
        });
      });

      request.on('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });

      request.end();
    });
  }

  /**
   * Fuehrt eine Pruefung durch.
   * @param {{manual?: boolean, skipThrottle?: boolean}} options
   *   manual   – vom Nutzer ausgeloest: prueft auch bei abgeschalteter Automatik.
   *   skipThrottle – Drosselung uebergehen (Programmstart).
   */
  async check(options = {}) {
    // Aeltere Aufrufe uebergaben ein einfaches true fuer "erzwingen".
    const { manual = options === true, skipThrottle = options === true } =
      typeof options === 'object' && options !== null ? options : {};

    const settings = this.store.settings();
    if (!manual && settings.autoUpdateCheck === false) {
      return { available: false, disabled: true };
    }
    if (!manual && !skipThrottle && Date.now() - this.lastCheck < MIN_GAP_MS) {
      return this.lastResult || { available: false, cached: true };
    }
    this.lastCheck = Date.now();

    let release;
    try {
      release = await this.fetchLatest();
    } catch (error) {
      this.lastResult = { available: false, offline: true, error: error.message };
      return this.lastResult;
    }

    if (!release || !release.tag_name) {
      this.lastResult = { available: false, noReleases: true, current: app.getVersion() };
      return this.lastResult;
    }

    const current = app.getVersion();
    const latest = String(release.tag_name).replace(/^v/i, '');
    const available = compareVersions(latest, current) > 0;

    const result = {
      available,
      current,
      latest,
      name: release.name || `Version ${latest}`,
      notes: (release.body || '').slice(0, 4000),
      url: release.html_url || RELEASES_PAGE,
      publishedAt: release.published_at || null,
      asset: (release.assets || []).find((entry) => /\.exe$/i.test(entry.name))?.browser_download_url || null,
    };
    this.lastResult = result;

    this.store.saveSettings({ lastUpdateCheck: new Date().toISOString(), lastKnownVersion: latest });

    if (available) this.announce(result);
    return result;
  }

  /** Meldet eine neue Version an die Oberflaeche – hoechstens einmal je Version. */
  announce(result) {
    const settings = this.store.settings();
    const win = this.getWindow();
    if (win && !win.isDestroyed()) win.webContents.send('update:available', result);

    if (settings.updateNotifiedFor === result.latest) return;
    this.store.saveSettings({ updateNotifiedFor: result.latest });

    if (settings.notifications !== false && Notification.isSupported()) {
      const notification = new Notification({
        title: `Content Helper ${result.latest} ist da`,
        body: 'Klicken, um die Release-Seite mit den Neuerungen zu öffnen.',
      });
      notification.on('click', () => shell.openExternal(result.url));
      notification.show();
    }
  }

  openReleasePage() {
    return shell.openExternal(this.lastResult?.url || RELEASES_PAGE);
  }
}

module.exports = { Updater, compareVersions, RELEASES_PAGE };
