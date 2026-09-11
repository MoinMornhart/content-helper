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
const { createPublisher } = require('../src/main/publish');
const { registerIpc } = require('../src/main/ipc');

/** Sprache der Bilder: `npm run screenshots:en` übergibt --en. */
const LANG = process.argv.includes('--en') ? 'en' : 'de';
const L = (de, en) => (LANG === 'en' ? en : de);
const OUT = path.join(__dirname, '..', 'docs', 'screenshots', ...(LANG === 'en' ? ['en'] : []));
const CHANNEL = L('Beispielkanal', 'Demo Channel');
const CHANNEL_CLIPS = L('Beispielkanal Clips', 'Demo Channel Clips');
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
    [L('Minecraft: Meine Basis nach 100 Tagen', 'Minecraft: My base after 100 days'), 48200, -52, 17, 'Case Study'],
    [L('Redstone einfach erklärt – in 10 Minuten', 'Redstone explained simply – in 10 minutes'), 36900, -45, 17, 'Tutorial'],
    [L('7 Minecraft-Fehler, die fast jeder macht', '7 Minecraft mistakes almost everyone makes'), 31400, -38, 17, 'Listicle'],
    [L('Minecraft-Farmen, die sich wirklich lohnen', 'Minecraft farms that are actually worth it'), 27100, -31, 17, 'Tutorial'],
    [L('Ich baue in Minecraft eine ganze Stadt', 'I build a whole city in Minecraft'), 24800, -24, 18, 'Vlog'],
    [L('Mein Schreibtisch-Setup 2026', 'My desk setup 2026'), 8400, -49, 11, 'Review'],
    [L('So schneide ich meine Videos', 'How I edit my videos'), 7100, -42, 11, 'Tutorial'],
    [L('Fragen und Antworten zum Kanal', 'Q&A about the channel'), 5200, -35, 12, 'Q&A'],
    [L('Rückblick auf das letzte Jahr', 'Looking back at last year'), 6300, -28, 11, 'Vlog'],
    [L('Warum ich jetzt öfter streame', 'Why I stream more often now'), 5900, -17, 12, 'Vlog'],
    [L('Minecraft Survival: Die ersten 24 Stunden', 'Minecraft Survival: the first 24 hours'), 29600, -10, 17, 'Vlog'],
    [L('Die beste Minecraft-Mod des Jahres', 'The best Minecraft mod of the year'), 22300, -4, 17, 'Review'],
  ];

  for (const [title, views, offset, hour, format] of history) {
    const when = at(offset, hour);
    const post = store.insert('posts', {
      title, body: '', platforms: ['youtube'], format, status: 'published',
      publishedAt: when.toISOString(), scheduledAt: when.toISOString(),
      accountId: MAIN, accountName: CHANNEL,
    });
    store.insert('analytics', {
      platformId: 'youtube', postId: post.id, date: key(when), title,
      metrics: { views, likes: Math.round(views * 0.045), comments: Math.round(views * 0.006) },
      source: 'youtube', accountId: MAIN, accountName: CHANNEL,
    });
  }

  // --- Kurzvideos und Streams
  for (const [title, views, offset] of [
    [L('Redstone-Trick in 30 Sekunden', 'Redstone trick in 30 seconds'), 61200, -20],
    [L('Der schnellste Weg zu Diamanten', 'The fastest way to diamonds'), 44800, -13],
    [L('Creeper-Falle, die wirklich klappt', 'A creeper trap that actually works'), 38700, -6],
  ]) {
    const when = at(offset, 19);
    store.insert('analytics', {
      platformId: 'youtube_shorts', date: key(when), title,
      metrics: { views, completionRate: 58, likes: Math.round(views * 0.07) },
      source: 'manual', accountId: CLIPS, accountName: CHANNEL_CLIPS,
    });
  }
  for (const [title, avg, peak, offset] of [
    [L('Werkstatt-Abend: Wir bauen weiter', 'Workshop night: building on'), 41, 88, -15],
    [L('Community-Abend mit Zuschauerwünschen', 'Community night with viewer requests'), 56, 112, -8],
    [L('Speedrun-Versuch Nummer 3', 'Speedrun attempt number 3'), 63, 131, -1],
  ]) {
    const when = at(offset, 19);
    store.insert('analytics', {
      platformId: 'twitch', date: key(when), title,
      metrics: { avgViewers: avg, peakViewers: peak, streamMinutes: 190, hoursWatched: Math.round(avg * 3.2) },
      source: 'twitch',
    });
  }

  // --- Geplante Beiträge der nächsten Tage
  const upcoming = [
    [L('Minecraft-Basis: Teil 2 – der Keller', 'Minecraft base: part 2 – the basement'), ['youtube', 'x'], 1, 17, 'scheduled', 'Tutorial'],
    [L('Redstone-Tür in 20 Sekunden', 'Redstone door in 20 seconds'), ['youtube_shorts', 'tiktok', 'instagram_reels'], 2, 19, 'scheduled', 'Hook & Payoff'],
    [L('Stream: Wir bauen die Stadt fertig', 'Stream: finishing the city'), ['twitch'], 3, 19, 'scheduled', 'Werkstatt-Stream'],
    [L('Die 5 besten Seeds für Einsteiger', 'The 5 best seeds for beginners'), ['youtube'], 5, 17, 'scheduled', 'Listicle'],
    [L('Wochenrückblick', 'Weekly recap'), ['newsletter'], 6, 7, 'scheduled', 'Wochenrückblick'],
    [L('Community-Frage: Was bauen wir als Nächstes?', 'Community question: what should we build next?'), ['threads', 'bluesky'], 0, 12, 'scheduled', null],
  ];
  let composerId = null;
  for (const [title, platforms, offset, hour, status, format] of upcoming) {
    const when = at(offset, hour);
    const post = store.insert('posts', {
      title,
      body: title === upcoming[0][0]
        ? L('Letztes Mal ging es um die Grundmauern – heute geht es nach unten.\n\nIch zeige, wie der Keller geplant ist, welche Fehler ich gemacht habe und was ich beim nächsten Mal anders mache.\n\nWas soll als Nächstes gebaut werden?',
          'Last time was all about the foundations – today we go down.\n\nI’ll show how the basement is planned, which mistakes I made and what I’d do differently next time.\n\nWhat should we build next?')
        : L('Kurz, konkret, ohne Einleitung.', 'Short, concrete, no intro.'),
      hashtags: title === upcoming[0][0] ? ['minecraft', 'survival', L('bauen', 'building')] : ['minecraft'],
      platforms, format, status,
      scheduledAt: when.toISOString(),
      checklist: [
        { text: L('Thumbnail gebaut', 'Thumbnail done'), done: true },
        { text: L('Kapitelmarken gesetzt', 'Chapter markers set'), done: false },
        { text: L('Beschreibung mit Links gefüllt', 'Description filled with links'), done: true },
      ],
    });
    if (!composerId) {
      composerId = post.id;
      // Der Composer zeigt ein gewähltes Video und den Stand bei YouTube.
      const video = store.insert('media', { name: L('basis-teil-2-keller.mp4', 'base-part-2-basement.mp4'), filePath: L('C:/Beispiel/basis-teil-2-keller.mp4', 'C:/Example/base-part-2-basement.mp4'), ext: 'mp4', size: 1843200000, tags: ['minecraft'] });
      store.update('posts', post.id, {
        mediaIds: [video.id],
        publishOptions: { youtube: { privacy: 'public', madeForKids: false } },
        delivery: { youtube: { state: 'scheduled', progress: 1, url: 'https://youtu.be/beispiel', scheduledFor: when.toISOString(), finishedAt: at(0, 9).toISOString() } },
      });
    }
  }

  // --- Ideen in allen Spalten
  const ideas = [
    [L('Vergleich: Vanilla gegen Modpack', 'Comparison: vanilla vs. modpack'), 'inbox', 4],
    [L('Was eine Minecraft-Stadt wirklich kostet', 'What a Minecraft city really costs'), 'inbox', 3],
    [L('Anfängerfehler beim Redstone', 'Beginner mistakes with redstone'), 'doing', 5],
    [L('Kurzvideo aus Clip: Der Creeper-Moment', 'Short from a clip: the creeper moment'), 'ready', 4],
    [L('Mythos: Diamanten gibt es nur tief unten', 'Myth: diamonds only spawn deep down'), 'ready', 3],
    [L('Hinter den Kulissen: So entsteht ein Video', 'Behind the scenes: how a video is made'), 'done', 4],
  ];
  for (const [title, status, score] of ideas) {
    store.insert('ideas', { title, status, score, platforms: ['youtube'], source: L('Beispiel', 'Example') });
  }

  store.saveSettings({
    onboardingDone: true,
    language: LANG,
    activePlatforms: ['youtube', 'youtube_shorts', 'tiktok', 'instagram_reels', 'twitch', 'x', 'threads', 'bluesky', 'newsletter'],
    queueSlots: [
      { days: [2, 4], time: '17:00', platformId: null },
      { days: [1, 3, 5], time: '19:00', platformId: 'youtube_shorts' },
      { days: [6], time: '19:00', platformId: 'twitch' },
    ],
    weeklyGoal: { posts: 5, ideas: 10, streams: 3 },
    connections: {
      // Erfundene Anmeldung – in diesem Lauf wird nichts abgefragt.
      twitch: { clientId: 'beispiel', refreshToken: 'beispiel', login: 'beispielkanal', userId: '1', displayName: CHANNEL, signedInAt: at(-12, 10).toISOString(), lastSync: at(0, 8).toISOString() },
      youtubeChannels: [
        { channelId: MAIN, name: CHANNEL, createPosts: true, lastSync: at(0, 8, 40).toISOString(), lastSource: 'feed', addedAt: at(-60, 10).toISOString() },
        { channelId: CLIPS, name: CHANNEL_CLIPS, createPosts: false, lastSync: at(0, 8, 40).toISOString(), lastSource: 'feed', addedAt: at(-30, 10).toISOString() },
      ],
    },
  });
  // Erfundene Anmeldungen zum Veröffentlichen – in diesem Lauf wird nichts hochgeladen.
  store.saveSettings({
    connections: {
      ...store.settings().connections,
      publishCredentials: {
        google: { clientId: 'beispiel', clientSecret: 'beispiel' },
        tiktok: { clientKey: 'beispiel', clientSecret: 'beispiel' },
      },
      youtubeUpload: { refreshToken: 'beispiel', channelTitle: CHANNEL, connectedAt: at(-3, 10).toISOString() },
      tiktokPublish: { refreshToken: 'beispiel', displayName: CHANNEL, username: 'beispielkanal', connectedAt: at(-3, 10).toISOString() },
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
  const publisher = createPublisher(store, { getWindow: () => win });
  scheduler.setPublisher(publisher);
  registerIpc(store, scheduler, updater, companion, connectors, cloudSync, () => win, publisher);

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
  await shot('publishing', 'publishing');
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
