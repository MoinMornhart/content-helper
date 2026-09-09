'use strict';

/**
 * Test des Handy-Begleiters.
 *
 * Startet den Webserver mit einem eigenen, leeren Datenordner und prueft von
 * aussen, was ein Telefon tatsaechlich tun wuerde: ohne Schluessel abgewiesen
 * werden, mit Schluessel den Stand abrufen, eine Idee anlegen, einen Beitrag
 * abhaken und Kennzahlen erfassen. Geprueft wird jeweils, ob die Aenderung
 * auch wirklich im Datenbestand ankommt.
 *
 * Laeuft mit reinem Node, ohne Electron:  node scripts/test-companion.js
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const { Store } = require('../src/main/store');
const { Companion } = require('../src/main/companion');

const PORT = 7799;
const results = [];

function check(name, condition, detail = '') {
  results.push({ name, ok: Boolean(condition), detail });
  process.stdout.write(`  ${condition ? 'ok  ' : 'FEHL'} ${name}${detail && !condition ? ` – ${detail}` : ''}\n`);
}

/** Kleiner HTTP-Aufruf gegen den laufenden Server. */
function request(method, pathname, { token = null, body = null } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const req = http.request(
      {
        host: '127.0.0.1',
        port: PORT,
        method,
        path: pathname,
        headers: {
          'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Safari',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
        },
      },
      (response) => {
        let raw = '';
        response.on('data', (chunk) => { raw += chunk; });
        response.on('end', () => {
          let json = null;
          try { json = JSON.parse(raw); } catch { /* nicht jede Antwort ist JSON */ }
          resolve({ status: response.statusCode, json, raw });
        });
      }
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'content-helper-companion-'));
  const store = new Store(tmp);

  const post = store.insert('posts', {
    title: 'Testbeitrag',
    body: 'Inhalt',
    platforms: ['youtube'],
    status: 'scheduled',
    scheduledAt: new Date(Date.now() + 3600_000).toISOString(),
    checklist: [{ text: 'Thumbnail', done: false }],
  });

  // Der Scheduler wird hier nur fuer die Zusammenfassung gebraucht.
  const scheduler = { summary: () => ({ dueCount: 0, missedCount: 0, scheduledCount: 1, next: null }) };
  const companion = new Companion(store, scheduler, () => null);

  const status = await companion.start(PORT);
  check('Server startet', status.running, 'nicht gestartet');
  check('Token vorhanden', /^[a-f0-9]{32}$/.test(status.token || ''), status.token);
  check('Adresse im lokalen Netz gefunden', status.addresses.length > 0, 'keine IPv4-Adresse');

  const token = status.token;

  // ---------------------------------------------------------------- Zugriffsschutz
  const denied = await request('GET', '/api/state');
  check('Ohne Schluessel abgewiesen', denied.status === 401, `Status ${denied.status}`);

  const wrong = await request('GET', '/api/state', { token: 'f'.repeat(32) });
  check('Falscher Schluessel abgewiesen', wrong.status === 401, `Status ${wrong.status}`);

  const shortToken = await request('GET', '/api/state', { token: 'abc' });
  check('Zu kurzer Schluessel abgewiesen', shortToken.status === 401, `Status ${shortToken.status}`);

  // ---------------------------------------------------------------- Statische Dateien
  const page = await request('GET', '/');
  check('Handy-App wird ausgeliefert', page.status === 200 && page.raw.includes('Content Helper'), `Status ${page.status}`);

  const manifest = await request('GET', '/manifest.webmanifest');
  check('Manifest wird ausgeliefert', manifest.status === 200 && manifest.raw.includes('standalone'), `Status ${manifest.status}`);

  const escape = await request('GET', '/../main/store.js');
  check('Ausbruch aus dem Ordner verhindert', escape.status === 404 || !escape.raw.includes('SCHEMA_VERSION'), `Status ${escape.status}`);

  // ---------------------------------------------------------------- Daten lesen
  const state = await request('GET', '/api/state', { token });
  check('Stand abrufbar', state.status === 200 && Array.isArray(state.json?.posts), `Status ${state.status}`);
  check('Beitrag enthalten', state.json?.posts?.some((entry) => entry.id === post.id));

  const catalog = await request('GET', '/api/catalog', { token });
  check('Plattform-Katalog abrufbar', catalog.status === 200 && catalog.json?.length === 20, `${catalog.json?.length} Eintraege`);

  // ---------------------------------------------------------------- Schreiben
  const idea = await request('POST', '/api/ideas', { token, body: { title: 'Idee vom Handy' } });
  check('Idee wird angelegt', idea.status === 200 && idea.json?.ok);
  check('Idee liegt im Bestand', store.list('ideas').some((entry) => entry.title === 'Idee vom Handy'));

  const emptyIdea = await request('POST', '/api/ideas', { token, body: { title: '  ' } });
  check('Leere Idee wird abgelehnt', emptyIdea.status === 400, `Status ${emptyIdea.status}`);

  const checklist = await request('POST', '/api/checklist', { token, body: { id: post.id, index: 0, done: true } });
  check('Checklistenpunkt wird abgehakt', checklist.status === 200 && store.get('posts', post.id).checklist[0].done === true);

  const published = await request('POST', '/api/post-status', { token, body: { id: post.id, status: 'published' } });
  const stored = store.get('posts', post.id);
  check('Beitrag wird als veroeffentlicht gesetzt', published.status === 200 && stored.status === 'published');
  check('Veroeffentlichungszeitpunkt gesetzt', Boolean(stored.publishedAt));

  const numbers = await request('POST', '/api/analytics', {
    token,
    body: { platformId: 'youtube', date: '2026-09-09', title: 'Testbeitrag', metrics: { views: 1234, ctr: 4.8 } },
  });
  const entry = store.list('analytics')[0];
  check('Kennzahlen werden erfasst', numbers.status === 200 && entry?.metrics?.views === 1234);
  check('Quelle wird vermerkt', entry?.source === 'handy');

  const unknown = await request('POST', '/api/gibtsnicht', { token, body: {} });
  check('Unbekannter Aufruf ergibt 404', unknown.status === 404, `Status ${unknown.status}`);

  // ---------------------------------------------------------------- Geraete und Abschalten
  const afterCalls = companion.status();
  check('Geraet wird erkannt', afterCalls.devices.some((device) => device.name === 'iPhone'), JSON.stringify(afterCalls.devices));

  companion.newToken();
  const oldToken = await request('GET', '/api/state', { token });
  check('Alter Schluessel gilt nicht mehr', oldToken.status === 401, `Status ${oldToken.status}`);

  await companion.stop();
  check('Server laesst sich beenden', companion.status().running === false);

  store.flush();
  try {
    fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 3 });
  } catch { /* Reste raeumt das System auf */ }

  const failed = results.filter((result) => !result.ok);
  if (failed.length) {
    process.stdout.write(`\nFEHLGESCHLAGEN – ${failed.length} von ${results.length} Pruefungen.\n`);
    process.exit(1);
  }
  process.stdout.write(`\nAlle ${results.length} Pruefungen bestanden.\n`);
})().catch((error) => {
  process.stdout.write(`\nAbbruch: ${error.stack}\n`);
  process.exit(1);
});
