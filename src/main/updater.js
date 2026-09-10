'use strict';

/**
 * Aktualisierung – die App holt sich neue Fassungen selbst.
 *
 * In der installierten Fassung übernimmt electron-updater die Arbeit: Es prüft
 * beim Start und danach regelmässig die Veröffentlichungen des Projekts, lädt
 * eine neuere Fassung im Hintergrund herunter und legt sie bereit. Eingespielt
 * wird sie beim nächsten Beenden – oder sofort, wenn der Nutzer im Hinweis auf
 * „Neu starten“ klickt. Es gibt dabei nichts von Hand herunterzuladen.
 *
 * Bewusste Grenze: Der Neustart wird nicht ohne Zutun erzwungen. Ein Programm,
 * das sich mitten in der Arbeit selbst beendet, verliert Vertrauen und
 * womöglich ungespeicherte Eingaben.
 *
 * Aus dem Quellordner heraus gestartet gibt es keine installierte Fassung, die
 * sich ersetzen liesse. Dann wird nur nachgesehen und gemeldet – über die
 * öffentliche Release-Adresse, ohne Zugangsschlüssel.
 */

const { app, net, shell, Notification } = require('electron');

const REPO = 'MoinMornhart/content-helper';
const API_URL = `https://api.github.com/repos/${REPO}/releases/latest`;
const RELEASES_PAGE = `https://github.com/${REPO}/releases/latest`;

const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const STARTUP_DELAY_MS = 4_000;
const MIN_GAP_MS = 30 * 60 * 1000;

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
    /** Steht eine heruntergeladene Fassung zum Einspielen bereit? */
    this.ready = null;
    this.downloading = false;

    /** Selbstaktualisierung gibt es nur in der installierten Fassung. */
    this.canSelfUpdate = app.isPackaged;
    this.native = null;

    if (this.canSelfUpdate) this.setupNative();
  }

  // ---------------------------------------------------------------- Selbstaktualisierung

  setupNative() {
    const { autoUpdater } = require('electron-updater');
    this.native = autoUpdater;

    autoUpdater.autoDownload = true;          // im Hintergrund holen, ohne Nachfrage
    autoUpdater.autoInstallOnAppQuit = true;  // spaetestens beim Beenden einspielen
    autoUpdater.allowPrerelease = false;
    autoUpdater.logger = null;

    autoUpdater.on('checking-for-update', () => this.send('update:state', { state: 'checking' }));

    autoUpdater.on('update-available', (info) => {
      this.lastResult = { available: true, current: app.getVersion(), latest: info.version, notes: info.releaseNotes || '' };
      this.send('update:available', { ...this.lastResult, autoDownload: true });
      this.downloading = true;
    });

    autoUpdater.on('update-not-available', () => {
      this.lastResult = { available: false, current: app.getVersion(), latest: app.getVersion() };
      this.send('update:state', { state: 'current' });
    });

    autoUpdater.on('download-progress', (progress) => {
      this.send('update:progress', {
        percent: Math.round(progress.percent),
        transferred: progress.transferred,
        total: progress.total,
        bytesPerSecond: progress.bytesPerSecond,
      });
    });

    autoUpdater.on('update-downloaded', (info) => {
      this.downloading = false;
      this.ready = { version: info.version, notes: info.releaseNotes || '' };
      this.store.saveSettings({ pendingUpdateVersion: info.version });
      this.send('update:ready', this.ready);
      this.notifyReady(info.version);
    });

    autoUpdater.on('error', (error) => {
      this.downloading = false;
      const message = String(error?.message || error);
      this.store.saveSettings({ lastUpdateError: message });
      this.send('update:state', { state: 'error', message });
    });
  }

  /** Meldet die fertige Fassung; ein Klick startet neu und spielt sie ein. */
  notifyReady(version) {
    if (this.store.settings().notifications === false || !Notification.isSupported()) return;
    const notification = new Notification({
      title: `Version ${version} ist bereit`,
      body: 'Sie wird beim nächsten Beenden eingespielt. Klicken, um jetzt neu zu starten.',
    });
    notification.on('click', () => this.install());
    notification.show();
  }

  /** Startet neu und spielt die heruntergeladene Fassung ein. */
  install() {
    if (!this.ready || !this.native) return false;
    this.store.flush();
    setImmediate(() => this.native.quitAndInstall(false, true));
    return true;
  }

  // ---------------------------------------------------------------- Ablauf

  start() {
    if (this.timer) return;
    setTimeout(() => this.check({ skipThrottle: true }), STARTUP_DELAY_MS);
    this.timer = setInterval(() => this.check(), CHECK_INTERVAL_MS);
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
  }

  /**
   * Prüft auf eine neuere Fassung. In der installierten App wird dabei
   * gleichzeitig heruntergeladen.
   *
   * @param {{manual?: boolean, skipThrottle?: boolean}} options
   */
  async check(options = {}) {
    const { manual = options === true, skipThrottle = options === true } =
      typeof options === 'object' && options !== null ? options : {};

    const settings = this.store.settings();
    if (!manual && settings.autoUpdateCheck === false) return { available: false, disabled: true };
    if (!manual && !skipThrottle && Date.now() - this.lastCheck < MIN_GAP_MS) {
      return this.lastResult || { available: false, cached: true };
    }
    this.lastCheck = Date.now();
    this.store.saveSettings({ lastUpdateCheck: new Date().toISOString() });

    // Bereits heruntergeladen – nichts weiter zu tun.
    if (this.ready) {
      return { available: true, downloaded: true, current: app.getVersion(), latest: this.ready.version };
    }

    if (this.canSelfUpdate) {
      try {
        const result = await this.native.checkForUpdates();
        const latest = result?.updateInfo?.version || app.getVersion();
        this.lastResult = {
          available: compareVersions(latest, app.getVersion()) > 0,
          current: app.getVersion(),
          latest,
          downloading: this.downloading,
          selfUpdate: true,
        };
        return this.lastResult;
      } catch (error) {
        this.lastResult = { available: false, offline: true, error: error.message, current: app.getVersion() };
        return this.lastResult;
      }
    }

    return this.checkViaApi();
  }

  /**
   * Nachsehen ohne installierte Fassung: fragt die öffentliche Release-Adresse
   * ab. Kein Konto, kein Zugangsschlüssel.
   */
  async checkViaApi() {
    let release;
    try {
      release = await this.fetchLatest();
    } catch (error) {
      this.lastResult = { available: false, offline: true, error: error.message, current: app.getVersion() };
      return this.lastResult;
    }

    if (!release?.tag_name) {
      this.lastResult = { available: false, noReleases: true, current: app.getVersion() };
      return this.lastResult;
    }

    const current = app.getVersion();
    const latest = String(release.tag_name).replace(/^v/i, '');
    const available = compareVersions(latest, current) > 0;

    this.lastResult = {
      available,
      current,
      latest,
      name: release.name || `Version ${latest}`,
      notes: (release.body || '').slice(0, 4000),
      url: release.html_url || RELEASES_PAGE,
      publishedAt: release.published_at || null,
      // Aus dem Quellordner heraus gibt es nichts zu ersetzen.
      sourceCheckout: true,
    };
    this.store.saveSettings({ lastKnownVersion: latest });

    if (available) this.announce(this.lastResult);
    return this.lastResult;
  }

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
          if (response.statusCode === 404) return resolve(null);
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

  /** Hinweis, wenn nicht selbst aktualisiert werden kann – hoechstens einmal je Version. */
  announce(result) {
    const settings = this.store.settings();
    this.send('update:available', { ...result, autoDownload: false });

    if (settings.updateNotifiedFor === result.latest) return;
    this.store.saveSettings({ updateNotifiedFor: result.latest });

    if (settings.notifications !== false && Notification.isSupported()) {
      const notification = new Notification({
        title: `Content Helper ${result.latest} ist da`,
        body: 'Klicken, um die Veröffentlichung zu öffnen.',
      });
      notification.on('click', () => shell.openExternal(result.url || RELEASES_PAGE));
      notification.show();
    }
  }

  send(channel, payload) {
    const win = this.getWindow();
    if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
  }

  openReleasePage() {
    return shell.openExternal(this.lastResult?.url || RELEASES_PAGE);
  }

  status() {
    return {
      current: app.getVersion(),
      canSelfUpdate: this.canSelfUpdate,
      downloading: this.downloading,
      ready: this.ready,
      lastCheck: this.store.settings().lastUpdateCheck || null,
      lastResult: this.lastResult,
    };
  }
}

module.exports = { Updater, compareVersions, RELEASES_PAGE };
