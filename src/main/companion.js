'use strict';

/**
 * Handy-Begleiter im eigenen WLAN.
 *
 * Die Desktop-App startet einen kleinen Webserver und liefert darüber eine
 * installierbare Web-App aus. Das Handy verbindet sich per QR-Code direkt mit
 * diesem Rechner – ohne Cloud, ohne Konto, ohne Zugangsschlüssel und ohne
 * App Store. Damit funktioniert es auf iOS und Android gleichermaßen.
 *
 * Abgesichert wird der Zugriff durch ein Zufalls-Token, das nur im QR-Code
 * steckt, und dadurch, dass der Server ausschließlich im lokalen Netz erreichbar
 * ist. Ohne laufende Desktop-App gibt es nichts zu erreichen.
 */

const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const MOBILE_DIR = path.join(__dirname, '..', 'mobile');
const DEFAULT_PORT = 7788;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

/** Alle IPv4-Adressen dieses Rechners im lokalen Netz. */
function localAddresses() {
  const found = [];
  for (const [name, entries] of Object.entries(os.networkInterfaces())) {
    for (const entry of entries || []) {
      if (entry.family !== 'IPv4' || entry.internal) continue;
      found.push({ name, address: entry.address });
    }
  }
  // Übliche Heimnetz-Bereiche zuerst, das ist fast immer die richtige Adresse.
  return found.sort((a, b) => Number(b.address.startsWith('192.168.')) - Number(a.address.startsWith('192.168.')));
}

class Companion {
  /**
   * @param {import('./store').Store} store
   * @param {import('./scheduler').Scheduler} scheduler
   * @param {() => Electron.BrowserWindow|null} getWindow
   */
  constructor(store, scheduler, getWindow) {
    this.store = store;
    this.scheduler = scheduler;
    this.getWindow = getWindow;
    this.server = null;
    this.port = null;
    this.devices = new Map();
  }

  /** Token aus den Einstellungen, wird bei Bedarf erzeugt. */
  token() {
    let value = this.store.settings().companionToken;
    if (!value) {
      value = crypto.randomBytes(16).toString('hex');
      this.store.saveSettings({ companionToken: value });
    }
    return value;
  }

  newToken() {
    const value = crypto.randomBytes(16).toString('hex');
    this.store.saveSettings({ companionToken: value });
    this.devices.clear();
    return value;
  }

  status() {
    const addresses = localAddresses();
    return {
      running: Boolean(this.server?.listening),
      port: this.port,
      token: this.server?.listening ? this.token() : null,
      addresses: addresses.map((entry) => entry.address),
      url: this.server?.listening && addresses.length
        ? `http://${addresses[0].address}:${this.port}/#${this.token()}`
        : null,
      devices: [...this.devices.values()],
    };
  }

  start(port = this.store.settings().companionPort || DEFAULT_PORT) {
    if (this.server?.listening) return Promise.resolve(this.status());

    return new Promise((resolve, reject) => {
      this.server = http.createServer((request, response) => this.handle(request, response));

      this.server.on('error', (error) => {
        this.server = null;
        reject(new Error(
          error.code === 'EADDRINUSE'
            ? `Der Anschluss ${port} ist belegt. Wähle in den Einstellungen einen anderen.`
            : error.message
        ));
      });

      this.server.listen(port, '0.0.0.0', () => {
        this.port = port;
        this.token();
        this.store.saveSettings({ companionEnabled: true, companionPort: port });
        resolve(this.status());
      });
    });
  }

  stop() {
    if (!this.server) return Promise.resolve();
    return new Promise((resolve) => {
      this.server.close(() => {
        this.server = null;
        this.port = null;
        this.store.saveSettings({ companionEnabled: false });
        resolve();
      });
    });
  }

  // ---------------------------------------------------------------- Anfragen

  handle(request, response) {
    const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);

    // Antworten sind nur für dieses Gerät bestimmt und dürfen nirgends liegen bleiben.
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');

    if (url.pathname.startsWith('/api/')) return this.handleApi(request, response, url);
    return this.serveStatic(url.pathname, response);
  }

  /** Statische Dateien der Handy-App. Pfade werden streng begrenzt. */
  serveStatic(pathname, response) {
    const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
    const target = path.join(MOBILE_DIR, relative);

    if (!target.startsWith(MOBILE_DIR) || !fs.existsSync(target) || !fs.statSync(target).isFile()) {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return response.end('Nicht gefunden');
    }

    response.writeHead(200, { 'Content-Type': MIME[path.extname(target)] || 'application/octet-stream' });
    fs.createReadStream(target).pipe(response);
  }

  authorized(request, url) {
    const header = request.headers.authorization || '';
    const provided = header.startsWith('Bearer ') ? header.slice(7) : url.searchParams.get('t');
    if (!provided) return false;
    const expected = this.token();
    if (provided.length !== expected.length) return false;
    return crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
  }

  async handleApi(request, response, url) {
    const send = (status, payload) => {
      response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify(payload));
    };

    if (!this.authorized(request, url)) return send(401, { error: 'Nicht verbunden. Bitte den QR-Code erneut scannen.' });

    // Gerät merken, damit die Desktop-App zeigen kann, wer verbunden ist.
    const agent = String(request.headers['user-agent'] || 'Unbekanntes Gerät');
    const key = crypto.createHash('sha1').update(agent).digest('hex').slice(0, 8);
    this.devices.set(key, {
      id: key,
      name: shortDeviceName(agent),
      lastSeen: new Date().toISOString(),
    });

    try {
      const body = ['POST', 'PUT'].includes(request.method) ? await readJson(request) : null;
      const result = await this.route(request.method, url.pathname, body);
      if (result === undefined) return send(404, { error: 'Unbekannter Aufruf' });
      return send(200, result);
    } catch (error) {
      return send(400, { error: error.message });
    }
  }

  /** Die Schnittstelle für die Handy-App – bewusst klein gehalten. */
  async route(method, pathname, body) {
    const store = this.store;

    if (method === 'GET' && pathname === '/api/state') {
      const now = Date.now();
      const posts = store.list('posts');
      const relevant = posts
        .filter((post) => ['scheduled', 'due', 'missed', 'ready', 'draft'].includes(post.status))
        .sort((a, b) => new Date(a.scheduledAt || 8.64e15) - new Date(b.scheduledAt || 8.64e15))
        .slice(0, 60)
        .map((post) => ({
          id: post.id,
          title: post.title || (post.body || '').slice(0, 60),
          body: post.body || '',
          hashtags: post.hashtags || [],
          platforms: post.platforms || [],
          status: post.status,
          scheduledAt: post.scheduledAt || null,
          checklist: post.checklist || [],
        }));

      return {
        serverTime: new Date(now).toISOString(),
        summary: this.scheduler.summary(),
        posts: relevant,
        ideas: store.list('ideas')
          .filter((idea) => !['done', 'archived'].includes(idea.status))
          .slice(0, 40)
          .map((idea) => ({ id: idea.id, title: idea.title, status: idea.status, score: idea.score || 0 })),
        platforms: store.settings().activePlatforms || [],
        goal: store.settings().weeklyGoal || {},
      };
    }

    if (method === 'GET' && pathname === '/api/catalog') {
      // Nur die Felder, die das Handy tatsächlich anzeigt.
      return require('../shared/platforms.json').map((platform) => ({
        id: platform.id,
        name: platform.name,
        short: platform.short,
        glyph: platform.glyph,
        color: platform.color,
        metrics: platform.metrics,
      }));
    }

    if (method === 'POST' && pathname === '/api/ideas') {
      if (!body?.title?.trim()) throw new Error('Ohne Titel geht es nicht.');
      const created = store.insert('ideas', {
        title: body.title.trim(),
        notes: body.notes || '',
        status: 'inbox',
        score: 0,
        platforms: [],
        source: 'Handy',
      });
      this.notifyDesktop();
      return { ok: true, id: created.id };
    }

    if (method === 'POST' && pathname === '/api/post-status') {
      const post = store.get('posts', body?.id);
      if (!post) throw new Error('Der Beitrag ist nicht mehr da.');
      const patch = { status: body.status };
      if (body.status === 'published') patch.publishedAt = new Date().toISOString();
      store.update('posts', post.id, patch);
      this.notifyDesktop();
      return { ok: true };
    }

    if (method === 'POST' && pathname === '/api/checklist') {
      const post = store.get('posts', body?.id);
      if (!post) throw new Error('Der Beitrag ist nicht mehr da.');
      const checklist = (post.checklist || []).map((item, index) =>
        index === body.index ? { ...item, done: Boolean(body.done) } : item);
      store.update('posts', post.id, { checklist });
      this.notifyDesktop();
      return { ok: true };
    }

    if (method === 'POST' && pathname === '/api/analytics') {
      if (!body?.platformId) throw new Error('Kanal fehlt.');
      store.insert('analytics', {
        platformId: body.platformId,
        date: body.date || new Date().toISOString().slice(0, 10),
        postId: body.postId || null,
        title: body.title || '',
        metrics: body.metrics || {},
        source: 'handy',
      });
      this.notifyDesktop();
      return { ok: true };
    }

    if (method === 'POST' && pathname === '/api/note') {
      if (!body?.text?.trim()) throw new Error('Kein Text übergeben.');
      store.insert('notes', { type: 'quick', title: body.text.trim().slice(0, 80), text: body.text.trim(), source: 'Handy' });
      this.notifyDesktop();
      return { ok: true };
    }

    return undefined;
  }

  /** Die Desktop-Oberfläche soll Änderungen vom Handy sofort zeigen. */
  notifyDesktop() {
    const win = this.getWindow();
    if (win && !win.isDestroyed()) win.webContents.send('companion:changed', {});
  }
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let raw = '';
    request.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 512_000) {
        reject(new Error('Die Anfrage ist zu groß.'));
        request.destroy();
      }
    });
    request.on('end', () => {
      if (!raw.trim()) return resolve(null);
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error('Die Anfrage war kein gültiges JSON.'));
      }
    });
    request.on('error', reject);
  });
}

/** Aus der Browserkennung einen lesbaren Gerätenamen ableiten. */
function shortDeviceName(agent) {
  if (/iPhone/i.test(agent)) return 'iPhone';
  if (/iPad/i.test(agent)) return 'iPad';
  if (/Android/i.test(agent)) return 'Android-Gerät';
  if (/Macintosh/i.test(agent)) return 'Mac';
  if (/Windows/i.test(agent)) return 'Windows-Gerät';
  return 'Gerät im Netzwerk';
}

module.exports = { Companion, localAddresses, DEFAULT_PORT };
