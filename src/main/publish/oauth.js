'use strict';

/**
 * Anmelden bei den Plattformen – für eine Desktop-App ohne eigenen Server.
 *
 * Zwei Wege, je nachdem, was die Plattform zulässt:
 *
 * - Systembrowser mit Rückleitung auf diesen Rechner (127.0.0.1). So verlangen
 *   es Google und TikTok. Die Anmeldung läuft im gewohnten Browser, in dem man
 *   meist schon angemeldet ist, und die App sieht das Passwort nie.
 *
 * - Anmeldefenster der App, das die Rückleitung abfängt, bevor sie irgendwo
 *   ankommt. Für Meta, LinkedIn und X, die als Rückleitung eine https-Adresse
 *   verlangen. Die Adresse muss nicht einmal existieren – das Fenster liest den
 *   Code aus der Adresszeile und schließt sich.
 *
 * Beide Wege sind mit PKCE abgesichert: Ein abgefangener Code nützt ohne das
 * Geheimnis, das nur die App kennt, niemandem.
 */

const http = require('http');
const crypto = require('crypto');

const TIMEOUT_MS = 5 * 60_000;

const base64url = (buffer) => buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/**
 * PKCE-Paar. TikTok weicht vom Standard ab und will die Prüfsumme als
 * Hex-Zeichenkette statt base64url.
 */
function pkcePair({ hex = false } = {}) {
  const verifier = base64url(crypto.randomBytes(48));
  const digest = crypto.createHash('sha256').update(verifier).digest();
  return { verifier, challenge: hex ? digest.toString('hex') : base64url(digest) };
}

const newState = () => base64url(crypto.randomBytes(16));

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

/** Laufende Anmeldungen, damit „Abbrechen“ in der Oberfläche greift. */
const pending = new Map();

function cancel(key) {
  pending.get(key)?.();
}

/**
 * Anmeldung im Systembrowser mit Rückleitung auf diesen Rechner.
 *
 * @param {{key: string, name: string, buildUrl: (redirectUri: string) => string,
 *          port?: number, callbackPath?: string, openExternal: (url: string) => Promise<void>}} options
 * @returns {Promise<{params: URLSearchParams, redirectUri: string}>}
 */
function loopback({ key, name, buildUrl, port = 0, callbackPath = '/', openExternal }) {
  return new Promise((resolve, reject) => {
    const server = http.createServer();
    let timer = null;

    const finish = (fn, value) => {
      clearTimeout(timer);
      pending.delete(key);
      server.close(() => {});
      fn(value);
    };

    server.on('error', (error) => reject(new Error(
      error.code === 'EADDRINUSE'
        ? `Der Anschluss ${port} ist belegt. Bitte das Programm schließen, das ihn nutzt, und erneut versuchen.`
        : error.message
    )));

    server.listen(port, '127.0.0.1', () => {
      const redirectUri = `http://127.0.0.1:${server.address().port}${callbackPath}`;
      timer = setTimeout(() => finish(reject, new Error('Die Anmeldung wurde nicht innerhalb von fünf Minuten abgeschlossen.')), TIMEOUT_MS);
      pending.set(key, () => finish(reject, new Error('Die Anmeldung wurde abgebrochen.')));

      server.on('request', (request, response) => {
        const url = new URL(request.url, 'http://127.0.0.1');
        if (url.pathname !== callbackPath) {
          response.writeHead(404);
          return response.end();
        }
        const params = url.searchParams;
        const failed = params.get('error');
        response.writeHead(failed ? 400 : 200, { 'Content-Type': 'text/html; charset=utf-8' });
        response.end(failed
          ? resultPage('Anmeldung abgebrochen', 'Du kannst dieses Fenster schließen.', false)
          : resultPage('Verbunden', `Der Content Helper ist jetzt mit ${name} verbunden. Du kannst dieses Fenster schließen.`));
        finish(resolve, { params, redirectUri });
      });

      openExternal(buildUrl(redirectUri)).catch(() => {});
    });
  });
}

/**
 * Anmeldung in einem Fenster der App, das die Rückleitung abfängt.
 *
 * @param {{key: string, name: string, url: string, redirectUri: string, parent?: Electron.BrowserWindow}} options
 * @returns {Promise<{params: URLSearchParams, redirectUri: string}>}
 */
function appWindow({ key, name, url, redirectUri, parent = null }) {
  const { BrowserWindow } = require('electron');

  return new Promise((resolve, reject) => {
    const win = new BrowserWindow({
      width: 520,
      height: 720,
      parent: parent || undefined,
      modal: Boolean(parent),
      title: `Bei ${name} anmelden`,
      autoHideMenuBar: true,
      backgroundColor: '#ffffff',
      webPreferences: {
        // Eigene, dauerhafte Sitzung je Plattform: Wer einmal angemeldet war,
        // muss beim Erneuern nur noch bestätigen.
        partition: `persist:anmeldung-${key}`,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });

    let done = false;
    const finish = (fn, value) => {
      if (done) return;
      done = true;
      pending.delete(key);
      if (!win.isDestroyed()) win.destroy();
      fn(value);
    };

    const inspect = (event, target) => {
      if (!target || !target.startsWith(redirectUri)) return;
      event?.preventDefault?.();
      const parsed = new URL(target);
      // Manche Plattformen hängen die Werte hinter „#“ statt „?“ an.
      const params = new URLSearchParams(parsed.search || parsed.hash.replace(/^#/, '?'));
      finish(resolve, { params, redirectUri });
    };

    win.webContents.on('will-redirect', (event, target) => inspect(event, target));
    win.webContents.on('will-navigate', (event, target) => inspect(event, target));
    win.webContents.on('did-redirect-navigation', (event, target) => inspect(null, target));
    win.webContents.on('did-navigate', (event, target) => inspect(null, target));
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

    win.on('closed', () => finish(reject, new Error('Das Anmeldefenster wurde geschlossen.')));
    pending.set(key, () => finish(reject, new Error('Die Anmeldung wurde abgebrochen.')));

    win.loadURL(url).catch((error) => {
      // Ein Abbruch durch das Abfangen der Rückleitung ist kein Fehler.
      if (!done && !/ERR_ABORTED/.test(error.message)) finish(reject, new Error(`Die Anmeldeseite von ${name} lädt nicht: ${error.message}`));
    });
  });
}

/** Prüft die Rückleitung auf Fehler und passenden Zustand, liefert den Code. */
function codeFrom(params, expectedState, name) {
  const error = params.get('error');
  if (error) {
    const text = params.get('error_description') || params.get('error_message') || error;
    throw new Error(/denied|cancel/i.test(error) ? 'Der Zugriff wurde abgelehnt.' : `${name} meldet: ${text}`);
  }
  if (expectedState && params.get('state') !== expectedState) throw new Error('Die Rückleitung passte nicht zur Anfrage. Bitte erneut versuchen.');
  const code = params.get('code');
  if (!code) throw new Error(`${name} hat keinen Anmeldecode geschickt.`);
  return code;
}

/**
 * Ablage der Anmeldung unter settings.connections[namespace].
 * Merkmale bleiben auf diesem PC – der Abgleich zwischen PCs überträgt sie nicht.
 */
class TokenStore {
  constructor(store, namespace) {
    this.store = store;
    this.namespace = namespace;
  }

  get() {
    return this.store.settings().connections?.[this.namespace] || {};
  }

  save(patch) {
    const connections = { ...(this.store.settings().connections || {}) };
    connections[this.namespace] = { ...(connections[this.namespace] || {}), ...patch };
    this.store.saveSettings({ connections });
    return connections[this.namespace];
  }

  clear() {
    const connections = { ...(this.store.settings().connections || {}) };
    delete connections[this.namespace];
    this.store.saveSettings({ connections });
  }
}

const form = (params) => new URLSearchParams(
  Object.entries(params).filter(([, value]) => value !== undefined && value !== null && value !== '')
).toString();

module.exports = { pkcePair, newState, loopback, appWindow, codeFrom, cancel, TokenStore, form, resultPage };
