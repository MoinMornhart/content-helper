'use strict';

/**
 * Rauchtest.
 *
 * Startet die App unsichtbar mit einem eigenen, leeren Datenordner, legt
 * Beispieldaten an und ruft jede Ansicht nacheinander auf. Gemeldet wird jeder
 * Fehler aus der Oberflaeche und jede Ansicht, die nicht sauber gerendert hat.
 *
 * Aufruf:  npm test
 * Beendet sich mit Code 1, wenn etwas schiefgeht – damit taugt es auch fuer
 * eine automatische Pruefung vor dem Veroeffentlichen.
 */

const path = require('path');
const fs = require('fs');
const os = require('os');
const { app, BrowserWindow } = require('electron');

const { Store } = require('../src/main/store');
const { Scheduler } = require('../src/main/scheduler');
const { Updater } = require('../src/main/updater');
const { registerIpc } = require('../src/main/ipc');

const VIEWS = ['dashboard', 'calendar', 'queue', 'composer', 'ideas', 'scripts', 'media', 'analytics', 'coach', 'channels', 'settings'];

const problems = [];
const logs = [];

/** Beispieldaten, damit die Ansichten nicht nur Leerzustaende zeigen. */
function seed(store) {
  const day = (offset) => {
    const date = new Date();
    date.setDate(date.getDate() + offset);
    date.setHours(18, 0, 0, 0);
    return date;
  };
  const key = (date) => date.toISOString().slice(0, 10);

  const published = store.insert('posts', {
    title: 'Fünf Fehler beim Streamen, die Zuschauer kosten',
    body: 'Die meisten Streams verlieren ihr Publikum in den ersten zehn Minuten.\n\nHier die fünf häufigsten Ursachen und was dagegen hilft.',
    hashtags: ['streaming', 'twitch'],
    platforms: ['twitch', 'youtube_shorts'],
    format: 'Listicle',
    status: 'published',
    publishedAt: day(-6).toISOString(),
    scheduledAt: day(-6).toISOString(),
    checklist: [{ text: 'Thumbnail gebaut', done: true }],
  });

  store.insert('posts', {
    title: 'Mein Setup 2026 – was sich bewährt hat',
    body: 'Nach einem Jahr im Dauerbetrieb: was geblieben ist und was rausgeflogen.',
    platforms: ['youtube', 'x'],
    format: 'Review',
    status: 'scheduled',
    scheduledAt: day(2).toISOString(),
  });

  store.insert('posts', {
    title: 'Kurzclip aus dem letzten Stream',
    body: 'Der Moment, in dem alles schiefging.',
    platforms: ['tiktok', 'instagram_reels'],
    status: 'draft',
  });

  store.insert('ideas', { title: 'Vergleich: OBS gegen Streamlabs', status: 'inbox', score: 4, notes: 'Beide eine Woche testen.' });
  store.insert('ideas', { title: 'Was ein Stream wirklich kostet', status: 'doing', score: 5 });

  store.insert('analytics', {
    platformId: 'twitch', postId: published.id, date: key(day(-6)), title: published.title,
    metrics: { avgViewers: 34, peakViewers: 71, hoursWatched: 88, chatMessages: 420, followersGained: 12 }, source: 'manual',
  });
  store.insert('analytics', {
    platformId: 'youtube_shorts', postId: published.id, date: key(day(-5)), title: published.title,
    metrics: { views: 14200, completionRate: 52, likes: 640, comments: 47, subsGained: 88 }, source: 'manual',
  });
  store.insert('analytics', {
    platformId: 'youtube', date: key(day(-20)), title: 'Älteres Video',
    metrics: { views: 8100, ctr: 3.1, avgViewSec: 210, watchHours: 470, likes: 320 }, source: 'manual',
  });

  store.insert('media', { name: 'stream-clip-01.mp4', filePath: 'C:/Beispiel/stream-clip-01.mp4', ext: 'mp4', size: 48210000, tags: ['twitch', 'clip'] });
  store.saveSettings({ onboardingDone: true, queueSlots: [{ days: [1, 3, 5], time: '18:00', platformId: null }] });
  store.flush();
}

app.whenReady().then(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'content-helper-test-'));
  app.setPath('userData', tmp);

  const store = new Store(tmp);
  seed(store);

  let win = null;
  const scheduler = new Scheduler(store, () => win);
  const updater = new Updater(store, () => win);
  registerIpc(store, scheduler, updater, () => win);

  win = new BrowserWindow({
    width: 1440,
    height: 920,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'src', 'main', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  win.webContents.on('console-message', (...args) => {
    const info = typeof args[0] === 'object' && args[0]?.message !== undefined
      ? args[0]
      : { level: args[1], message: args[2], sourceId: args[4] };
    const line = `[${info.level}] ${info.message}`;
    logs.push(line);
    // Stufe 3 ist "error"; neuere Fassungen liefern den Namen als Zeichenkette.
    if (info.level === 3 || info.level === 'error') problems.push(`Meldung: ${line}`);
  });

  win.webContents.on('render-process-gone', (_event, details) => {
    problems.push(`Oberflaeche abgestuerzt: ${details.reason}`);
  });

  await win.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'index.html'));
  await wait(1200);

  const booted = await win.webContents.executeJavaScript(
    'Boolean(window.__app && document.querySelectorAll(".nav-item").length)'
  );
  if (!booted) problems.push('Das Grundgeruest wurde nicht aufgebaut.');

  for (const view of VIEWS) {
    try {
      await win.webContents.executeJavaScript(`window.__app.goto(${JSON.stringify(view)})`);
      await wait(700);
      const report = await win.webContents.executeJavaScript(`(() => {
        const host = document.querySelector('.view');
        const text = host ? host.textContent : '';
        return {
          nodes: host ? host.querySelectorAll('*').length : 0,
          failed: text.includes('konnte nicht geladen werden'),
          message: text.slice(0, 200),
        };
      })()`);
      if (report.failed) problems.push(`Ansicht "${view}" meldet einen Ladefehler: ${report.message}`);
      else if (report.nodes < 5) problems.push(`Ansicht "${view}" ist praktisch leer (${report.nodes} Elemente).`);
      else process.stdout.write(`  ok   ${view.padEnd(12)} ${report.nodes} Elemente\n`);
    } catch (error) {
      problems.push(`Ansicht "${view}" warf: ${error.message}`);
    }
  }

  store.flush();
  // Der temporaere Ordner haelt noch offene Dateien der Laufzeit – das Loeschen
  // darf das Ergebnis des Tests nicht beeinflussen.
  try {
    fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 3 });
  } catch { /* Reste raeumt Windows selbst auf */ }

  if (problems.length) {
    process.stdout.write(`\nFEHLGESCHLAGEN – ${problems.length} Problem(e):\n`);
    for (const problem of problems) process.stdout.write(`  - ${problem}\n`);
    app.exit(1);
  } else {
    process.stdout.write(`\nAlle ${VIEWS.length} Ansichten laden sauber.\n`);
    app.exit(0);
  }
});

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
