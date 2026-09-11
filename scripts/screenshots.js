'use strict';

/**
 * Bildschirmfotos für das README.
 *
 * Startet die App unsichtbar mit einem eigenen, leeren Datenordner, füllt ihn
 * mit erfundenen Beispieldaten und fotografiert die wichtigsten Ansichten.
 * Echte Nutzerdaten kommen dabei nie vor, und es wird nichts aus dem Netz
 * geholt: Verbindungen, Update-Prüfung und Handy-Zugang bleiben aus.
 *
 *     npm run screenshots
 *
 * Die Bilder landen unter docs/screenshots/ und lassen sich jederzeit neu
 * erzeugen – etwa nach einer Änderung an der Oberfläche.
 */

const path = require('path');
const fs = require('fs');
const os = require('os');
const { app, BrowserWindow } = require('electron');

const { Store } = require('../src/main/store');
const { Scheduler } = require('../src/main/scheduler');
const { Updater } = require('../src/main/updater');
const { Companion } = require('../src/main/companion');
const { Connectors } = require('../src/main/connectors');
const { CloudSync } = require('../src/main/sync/cloud-sync');
const { registerIpc } = require('../src/main/ipc');

const OUT = path.join(__dirname, '..', 'docs', 'screenshots');
const WIDTH = 1440;
const HEIGHT = 900;

const MAIN = 'UCbeispielbeispielbeisp1';
const CLIPS = 'UCbeispielclipsclipsclip';

// ------------------------------------------------------------------ Beispieldaten

function seed(store) {
  const at = (offsetDays, hour, minute = 0) => {
    const date = new Date();
    date.setDate(date.getDate() + offsetDays);
    date.setHours(hour, minute, 0, 0);
    return date;
  };
  const key = (date) => date.toISOString().slice(0, 10);

  // --- Vergangene Videos: ein erkennbares Muster für den Assistenten
  const history = [
    ['Minecraft: Meine Basis nach 100 Tagen', 48200, -52, 17, 'Case Study'],
    ['Redstone einfach erklärt – in 10 Minuten', 36900, -45, 17, 'Tutorial'],
    ['7 Minecraft-Fehler, die fast jeder macht', 31400, -38, 17, 'Listicle'],
    ['Minecraft-Farmen, die sich wirklich lohnen', 27100, -31, 17, 'Tutorial'],
    ['Ich baue in Minecraft eine ganze Stadt', 24800, -24, 18, 'Vlog'],
    ['Mein Schreibtisch-Setup 2026', 8400, -49, 11, 'Review'],
    ['So schneide ich meine Videos', 7100, -42, 11, 'Tutorial'],
    ['Fragen und Antworten zum Kanal', 5200, -35, 12, 'Q&A'],
    ['Rückblick auf das letzte Jahr', 6300, -28, 11, 'Vlog'],
    ['Warum ich jetzt öfter streame', 5900, -17, 12, 'Vlog'],
    ['Minecraft Survival: Die ersten 24 Stunden', 29600, -10, 17, 'Vlog'],
    ['Die beste Minecraft-Mod des Jahres', 22300, -4, 17, 'Review'],
  ];

  for (const [title, views, offset, hour, format] of history) {
    const when = at(offset, hour);
    const post = store.insert('posts', {
      title, body: '', platforms: ['youtube'], format, status: 'published',
      publishedAt: when.toISOString(), scheduledAt: when.toISOString(),
      accountId: MAIN, accountName: 'Beispielkanal',
    });
    store.insert('analytics', {
      platformId: 'youtube', postId: post.id, date: key(when), title,
      metrics: { views, likes: Math.round(views * 0.045), comments: Math.round(views * 0.006) },
      source: 'youtube', accountId: MAIN, accountName: 'Beispielkanal',
    });
  }

  // --- Kurzvideos und Streams
  for (const [title, views, offset] of [['Redstone-Trick in 30 Sekunden', 61200, -20], ['Der schnellste Weg zu Diamanten', 44800, -13], ['Creeper-Falle, die wirklich klappt', 38700, -6]]) {
    const when = at(offset, 19);
    store.insert('analytics', {
      platformId: 'youtube_shorts', date: key(when), title,
      metrics: { views, completionRate: 58, likes: Math.round(views * 0.07) },
      source: 'manual', accountId: CLIPS, accountName: 'Beispielkanal Clips',
    });
  }
  for (const [title, avg, peak, offset] of [['Werkstatt-Abend: Wir bauen weiter', 41, 88, -15], ['Community-Abend mit Zuschauerwünschen', 56, 112, -8], ['Speedrun-Versuch Nummer 3', 63, 131, -1]]) {
    const when = at(offset, 19);
    store.insert('analytics', {
      platformId: 'twitch', date: key(when), title,
      metrics: { avgViewers: avg, peakViewers: peak, streamMinutes: 190, hoursWatched: Math.round(avg * 3.2) },
      source: 'twitch',
    });
  }

  // --- Geplante Beiträge der nächsten Tage
  const upcoming = [
    ['Minecraft-Basis: Teil 2 – der Keller', ['youtube', 'x'], 1, 17, 'scheduled', 'Tutorial'],
    ['Redstone-Tür in 20 Sekunden', ['youtube_shorts', 'tiktok', 'instagram_reels'], 2, 19, 'scheduled', 'Hook & Payoff'],
    ['Stream: Wir bauen die Stadt fertig', ['twitch'], 3, 19, 'scheduled', 'Werkstatt-Stream'],
    ['Die 5 besten Seeds für Einsteiger', ['youtube'], 5, 17, 'scheduled', 'Listicle'],
    ['Wochenrückblick', ['newsletter'], 6, 7, 'scheduled', 'Wochenrückblick'],
    ['Community-Frage: Was bauen wir als Nächstes?', ['threads', 'bluesky'], 0, 12, 'scheduled', null],
  ];
  let composerId = null;
  for (const [title, platforms, offset, hour, status, format] of upcoming) {
    const when = at(offset, hour);
    const post = store.insert('posts', {
      title,
      body: title.startsWith('Minecraft-Basis')
        ? 'Letztes Mal ging es um die Grundmauern – heute geht es nach unten.\n\nIch zeige, wie der Keller geplant ist, welche Fehler ich gemacht habe und was ich beim nächsten Mal anders mache.\n\nWas soll als Nächstes gebaut werden?'
        : 'Kurz, konkret, ohne Einleitung.',
      hashtags: title.startsWith('Minecraft-Basis') ? ['minecraft', 'survival', 'bauen'] : ['minecraft'],
      platforms, format, status,
      scheduledAt: when.toISOString(),
      checklist: [
        { text: 'Thumbnail gebaut', done: true },
        { text: 'Kapitelmarken gesetzt', done: false },
        { text: 'Beschreibung mit Links gefüllt', done: true },
      ],
    });
    if (!composerId) composerId = post.id;
  }

  // --- Ideen in allen Spalten
  const ideas = [
    ['Vergleich: Vanilla gegen Modpack', 'inbox', 4],
    ['Was eine Minecraft-Stadt wirklich kostet', 'inbox', 3],
    ['Anfängerfehler beim Redstone', 'doing', 5],
    ['Kurzvideo aus Clip: Der Creeper-Moment', 'ready', 4],
    ['Mythos: Diamanten gibt es nur tief unten', 'ready', 3],
    ['Hinter den Kulissen: So entsteht ein Video', 'done', 4],
  ];
  for (const [title, status, score] of ideas) {
    store.insert('ideas', { title, status, score, platforms: ['youtube'], source: 'Beispiel' });
  }

  store.saveSettings({
    onboardingDone: true,
    activePlatforms: ['youtube', 'youtube_shorts', 'tiktok', 'instagram_reels', 'twitch', 'x', 'threads', 'bluesky', 'newsletter'],
    queueSlots: [
      { days: [2, 4], time: '17:00', platformId: null },
      { days: [1, 3, 5], time: '19:00', platformId: 'youtube_shorts' },
      { days: [6], time: '19:00', platformId: 'twitch' },
    ],
    weeklyGoal: { posts: 5, ideas: 10, streams: 3 },
    connections: {
      // Erfundene Anmeldung – in diesem Lauf wird nichts abgefragt.
      twitch: { clientId: 'beispiel', refreshToken: 'beispiel', login: 'beispielkanal', userId: '1', displayName: 'Beispielkanal', signedInAt: at(-12, 10).toISOString(), lastSync: at(0, 8).toISOString() },
      youtubeChannels: [
        { channelId: MAIN, name: 'Beispielkanal', createPosts: true, lastSync: at(0, 8, 40).toISOString(), lastSource: 'feed', addedAt: at(-60, 10).toISOString() },
        { channelId: CLIPS, name: 'Beispielkanal Clips', createPosts: false, lastSync: at(0, 8, 40).toISOString(), lastSource: 'feed', addedAt: at(-30, 10).toISOString() },
      ],
    },
  });
  store.flush();

  return { composerId };
}

// ------------------------------------------------------------------ Aufnahme

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

app.whenReady().then(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'content-helper-shots-'));
  app.setPath('userData', tmp);
  fs.mkdirSync(OUT, { recursive: true });

  const store = new Store(tmp);
  const { composerId } = seed(store);

  let win = null;
  const scheduler = new Scheduler(store, () => win);
  const updater = new Updater(store, () => win);
  const companion = new Companion(store, scheduler, () => win);
  const connectors = new Connectors(store, () => win);
  const cloudSync = new CloudSync(store, () => win);
  registerIpc(store, scheduler, updater, companion, connectors, cloudSync, () => win);

  // Aus scripts/ gestartet meldet Electron seine eigene Versionsnummer, weil dort
  // keine package.json liegt. Auf dem Bild soll die Nummer der App stehen.
  const { ipcMain } = require('electron');
  ipcMain.removeHandler('system:version');
  ipcMain.handle('system:version', () => ({
    ok: true,
    data: {
      app: require('../package.json').version,
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node,
      platform: process.platform,
    },
  }));

  // Die echten Cloud-Ordner dieses PCs verraten den Benutzernamen – aufs
  // öffentliche Bild gehört ein Beispielpfad.
  ipcMain.removeHandler('sync:folders');
  ipcMain.handle('sync:folders', () => ({
    ok: true,
    data: [
      { provider: 'onedrive', label: 'OneDrive', path: 'C:\\Users\\Creator\\OneDrive' },
      { provider: 'dropbox', label: 'Dropbox', path: 'C:\\Users\\Creator\\Dropbox' },
    ],
  }));

  win = new BrowserWindow({
    width: WIDTH,
    height: HEIGHT,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'src', 'main', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      offscreen: true,
    },
  });
  win.webContents.setFrameRate(30);

  await win.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'index.html'));
  await wait(1500);

  const js = (code) => win.webContents.executeJavaScript(code);
  const look = (patch) => js(`window.__app.store.saveSettings(${JSON.stringify(patch)})`);

  /** Ansicht öffnen, rendern lassen, fotografieren. */
  async function shot(name, view, params = {}) {
    await js(`window.__app.goto(${JSON.stringify(view)}, ${JSON.stringify(params)})`);
    await wait(1100);
    const image = await win.webContents.capturePage();
    const file = path.join(OUT, `${name}.png`);
    fs.writeFileSync(file, image.resize({ width: 1280, quality: 'best' }).toPNG());
    process.stdout.write(`  ${name.padEnd(14)} ${(fs.statSync(file).size / 1024).toFixed(0)} KB\n`);
  }

  // Titelbild: Dashboard mit Hintergrund, damit das Anpassbare gleich sichtbar ist.
  await look({ appearance: { background: 'aurora', dim: 50 } });
  await shot('dashboard', 'dashboard');

  // Galerie im Standardaussehen.
  await look({ appearance: { background: 'none', dim: 55 } });
  await shot('calendar', 'calendar');
  await shot('composer', 'composer', { id: composerId });
  await shot('assistant', 'assistant');
  await shot('analytics', 'analytics');
  await shot('connections', 'connections');
  await shot('ideas', 'ideas');
  await shot('settings', 'settings');
  await shot('devices', 'devices');

  // Helles Farbschema als Gegenstück.
  await look({ theme: 'light', accent: 'blue' });
  await shot('calendar-light', 'calendar');

  store.flush();
  try {
    fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 3 });
  } catch { /* Reste räumt Windows selbst auf */ }

  process.stdout.write(`\nBilder liegen unter ${path.relative(process.cwd(), OUT)}\n`);
  app.exit(0);
});
