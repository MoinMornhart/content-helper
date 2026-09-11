'use strict';

/**
 * Alle Aufrufe, die die Oberflaeche im Hauptprozess ausloesen darf.
 * Jeder Kanal ist eng geschnitten: Sammlungen sind auf die bekannten Namen
 * begrenzt, Dateizugriffe laufen ausschliesslich ueber Systemdialoge.
 */

const fs = require('fs');
const path = require('path');
const { ipcMain, dialog, shell, clipboard, Notification, app, nativeImage } = require('electron');
const { COLLECTIONS } = require('./store');
const { saveManual } = require('./publish/credentials');
const oauth = require('./publish/oauth');
const { probe } = require('./publish/media-info');
const { detectKeys } = require('./publish/key-detect');

const MEDIA_FILTERS = [
  { name: 'Medien', extensions: ['mp4', 'mov', 'mkv', 'webm', 'avi', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'mp3', 'wav', 'm4a'] },
  { name: 'Videos', extensions: ['mp4', 'mov', 'mkv', 'webm', 'avi'] },
  { name: 'Bilder', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] },
  { name: 'Alle Dateien', extensions: ['*'] },
];

function assertCollection(name) {
  if (!Object.prototype.hasOwnProperty.call(COLLECTIONS, name)) {
    throw new Error(`Unbekannte Sammlung: ${name}`);
  }
  return name;
}

/**
 * @param {import('./store').Store} store
 * @param {import('./scheduler').Scheduler} scheduler
 * @param {import('./updater').Updater} updater
 * @param {import('./companion').Companion} companion
 * @param {import('./connectors').Connectors} connectors
 * @param {import('./sync/cloud-sync').CloudSync} sync
 * @param {() => Electron.BrowserWindow|null} getWindow
 * @param {import('./publish/publisher').Publisher|null} publisher
 */
function registerIpc(store, scheduler, updater, companion, connectors, sync, getWindow, publisher = null) {
  const handle = (channel, fn) => {
    ipcMain.handle(channel, async (_event, payload = {}) => {
      try {
        return { ok: true, data: await fn(payload) };
      } catch (error) {
        return { ok: false, error: error.message || String(error) };
      }
    });
  };

  // ------------------------------------------------------------- Datenbank
  handle('db:list', ({ collection }) => store.list(assertCollection(collection)));
  handle('db:get', ({ collection, id }) => store.get(assertCollection(collection), id));
  handle('db:insert', ({ collection, entry }) => store.insert(assertCollection(collection), entry));
  handle('db:update', ({ collection, id, patch }) => store.update(assertCollection(collection), id, patch));
  handle('db:remove', ({ collection, id }) => store.remove(assertCollection(collection), id));
  handle('db:replace', ({ collection, items }) => store.replace(assertCollection(collection), items));
  handle('db:stats', () => store.stats());

  // ------------------------------------------------------------- Einstellungen
  handle('settings:get', () => store.settings());
  handle('settings:save', ({ patch }) => store.saveSettings(patch));

  // ------------------------------------------------------------- Sicherung
  handle('backup:export', async () => {
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    const result = await dialog.showSaveDialog(getWindow(), {
      title: 'Sicherung speichern',
      defaultPath: path.join(app.getPath('documents'), `content-helper-backup-${stamp}.json`),
      filters: [{ name: 'JSON-Sicherung', extensions: ['json'] }],
    });
    if (result.canceled || !result.filePath) return { canceled: true };
    store.flush();
    fs.writeFileSync(result.filePath, JSON.stringify(store.exportAll(), null, 2), 'utf8');
    return { canceled: false, filePath: result.filePath };
  });

  handle('backup:import', async ({ merge }) => {
    const result = await dialog.showOpenDialog(getWindow(), {
      title: 'Sicherung einlesen',
      properties: ['openFile'],
      filters: [{ name: 'JSON-Sicherung', extensions: ['json'] }],
    });
    if (result.canceled || !result.filePaths?.[0]) return { canceled: true };
    const bundle = JSON.parse(fs.readFileSync(result.filePaths[0], 'utf8'));
    store.importAll(bundle, { merge: Boolean(merge) });
    return { canceled: false, filePath: result.filePaths[0] };
  });

  handle('backup:openFolder', () => {
    shell.openPath(store.paths().backups);
    return true;
  });

  // ------------------------------------------------------------- Medien
  handle('media:pick', async () => {
    const result = await dialog.showOpenDialog(getWindow(), {
      title: 'Medien hinzufuegen',
      properties: ['openFile', 'multiSelections'],
      filters: MEDIA_FILTERS,
    });
    if (result.canceled) return [];
    return result.filePaths.map((filePath) => {
      let size = 0;
      let modified = null;
      try {
        const stat = fs.statSync(filePath);
        size = stat.size;
        modified = new Date(stat.mtimeMs).toISOString();
      } catch { /* Datei ggf. nicht lesbar */ }
      return {
        filePath,
        name: path.basename(filePath),
        ext: path.extname(filePath).slice(1).toLowerCase(),
        size,
        modified,
      };
    });
  });

  /** Bild fuer den Hintergrund der Oberflaeche auswaehlen. */
  handle('media:pickImage', async () => {
    const result = await dialog.showOpenDialog(getWindow(), {
      title: 'Hintergrundbild wählen',
      properties: ['openFile'],
      filters: [{ name: 'Bilder', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'] }],
    });
    if (result.canceled || !result.filePaths?.[0]) return { canceled: true };
    const filePath = result.filePaths[0];
    return { canceled: false, filePath, name: path.basename(filePath) };
  });

  handle('media:reveal', ({ filePath }) => {
    shell.showItemInFolder(filePath);
    return true;
  });

  handle('media:open', ({ filePath }) => shell.openPath(filePath));

  /** Bildvorschau als Data-URL – nur fuer Bilder, Videos liefern null. */
  handle('media:thumbnail', ({ filePath }) => {
    const ext = path.extname(filePath).slice(1).toLowerCase();
    if (!['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'].includes(ext)) return null;
    const image = nativeImage.createFromPath(filePath);
    if (image.isEmpty()) return null;
    return image.resize({ width: 320, quality: 'good' }).toDataURL();
  });

  // ------------------------------------------------------------- Dateien
  handle('files:readText', async ({ filters }) => {
    const result = await dialog.showOpenDialog(getWindow(), {
      title: 'Datei einlesen',
      properties: ['openFile'],
      filters: filters?.length ? filters : [{ name: 'CSV', extensions: ['csv', 'tsv', 'txt'] }],
    });
    if (result.canceled || !result.filePaths?.[0]) return { canceled: true };
    const filePath = result.filePaths[0];
    let text = fs.readFileSync(filePath, 'utf8');
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // BOM entfernen
    return { canceled: false, filePath, name: path.basename(filePath), text };
  });

  handle('files:saveText', async ({ defaultName, text, filters }) => {
    const result = await dialog.showSaveDialog(getWindow(), {
      title: 'Datei speichern',
      defaultPath: path.join(app.getPath('documents'), defaultName || 'export.txt'),
      filters: filters?.length ? filters : [{ name: 'Textdatei', extensions: ['txt'] }],
    });
    if (result.canceled || !result.filePath) return { canceled: true };
    fs.writeFileSync(result.filePath, text ?? '', 'utf8');
    return { canceled: false, filePath: result.filePath };
  });

  // ------------------------------------------------------------- Kalender
  /** Plan als Kalenderdatei speichern – zum Einlesen in jede Kalender-App. */
  handle('calendar:export', async ({ includePublished }) => {
    const { buildCalendar } = require('./calendar');
    const platforms = new Map(require('../shared/platforms.json').map((entry) => [entry.id, entry]));

    const ics = buildCalendar(store.list('posts'), {
      platforms,
      reminderMinutes: store.settings().leadTimeMinutes ?? 15,
      includePublished: includePublished !== false,
    });

    const result = await dialog.showSaveDialog(getWindow(), {
      title: 'Kalender speichern',
      defaultPath: path.join(app.getPath('documents'), 'content-helper.ics'),
      filters: [{ name: 'Kalender', extensions: ['ics'] }],
    });
    if (result.canceled || !result.filePath) return { canceled: true };

    fs.writeFileSync(result.filePath, ics, 'utf8');
    return { canceled: false, filePath: result.filePath, events: (ics.match(/BEGIN:VEVENT/g) || []).length };
  });

  /** Adresse zum Abonnieren, sofern der Handy-Begleiter läuft. */
  handle('calendar:subscription', () => {
    const info = companion.status();
    return {
      running: info.running,
      url: info.calendarUrl,
      webcal: info.calendarUrl ? info.calendarUrl.replace(/^http:/, 'webcal:') : null,
      addresses: info.addresses,
    };
  });

  // ------------------------------------------------------------- Scheduler
  handle('scheduler:summary', () => scheduler.summary());
  handle('scheduler:tick', () => scheduler.tick());

  // ------------------------------------------------------------- Verbindungen
  handle('connectors:status', () => connectors.status());

  /** Zugangsdaten hinterlegen und sofort gegen die Gegenstelle prüfen. */
  handle('connectors:connect', async ({ name, credentials }) => {
    const connector = connectors.connector(name);
    if (name === 'twitch') {
      connector.saveConfig({
        clientId: String(credentials.clientId || '').trim(),
        clientSecret: String(credentials.clientSecret || '').trim(),
      });
      const channel = await connector.verify(credentials.login);
      return { channel, status: connector.status() };
    }
    if (name === 'youtube') {
      const channel = await connector.resolve(credentials.channel);
      return { channel, status: connector.status() };
    }
    throw new Error(`Unbekannte Verbindung: ${name}`);
  });

  // --- Anmeldung mit dem Twitch-Konto statt Kennung und Geheimnis
  handle('twitch:authStatus', () => connectors.twitch.auth.status());

  handle('twitch:setClientId', ({ clientId }) => {
    connectors.twitch.auth.saveConfig({ clientId: String(clientId || '').trim() });
    return connectors.twitch.auth.status();
  });

  /** Startet die Anmeldung und meldet den Fortschritt an die Oberflaeche. */
  handle('twitch:signIn', async () => {
    const start = await connectors.twitch.auth.begin((update) => {
      const win = getWindow();
      if (win && !win.isDestroyed()) win.webContents.send('twitch:auth', update);
      if (update.state === 'done') {
        // Direkt nach der Anmeldung einmal alles holen.
        connectors.twitch.sync().catch(() => {});
      }
    });
    return start;
  });

  handle('twitch:cancelAuth', () => {
    connectors.twitch.auth.cancel();
    return true;
  });

  handle('twitch:signOut', async () => {
    await connectors.twitch.auth.signOut();
    return connectors.twitch.auth.status();
  });

  handle('connectors:sync', async ({ name }) => {
    connectors.assertFetchesHere();
    if (name) {
      const connector = connectors.connector(name);
      try {
        return { [name]: await connector.sync() };
      } catch (error) {
        connector.saveConfig({ lastError: error.message });
        throw error;
      }
    }
    return connectors.syncAll();
  });

  /** Einstellungen einer Verbindung – bei YouTube je Kanal. */
  handle('connectors:options', ({ name, options, accountId }) => {
    if (name === 'youtube' && accountId) connectors.youtube.updateChannel(accountId, options);
    else connectors.connector(name).saveConfig(options);
    return connectors.status();
  });

  /** Trennt eine Verbindung – bei YouTube einen einzelnen Kanal. */
  handle('connectors:disconnect', ({ name, accountId }) => {
    if (name === 'youtube') connectors.youtube.disconnect(accountId || null);
    else connectors.connector(name).disconnect();
    return connectors.status();
  });

  /** Gleicht nur einen einzelnen YouTube-Kanal ab. */
  handle('youtube:syncChannel', async ({ accountId }) => {
    connectors.assertFetchesHere();
    const channel = connectors.youtube.channel(accountId);
    if (!channel) throw new Error('Dieser Kanal ist nicht mehr verbunden.');
    try {
      return await connectors.youtube.syncChannel(channel);
    } catch (error) {
      connectors.youtube.updateChannel(accountId, { lastError: error.message });
      throw error;
    }
  });

  handle('connectors:preview', async ({ name, accountId }) => {
    if (name === 'twitch') {
      return {
        live: await connectors.twitch.currentStream(),
        broadcasts: await connectors.twitch.recentBroadcasts(5),
        clips: await connectors.twitch.topClips({ days: 7, limit: 5 }),
      };
    }
    if (name === 'youtube') {
      const { videos, source } = await connectors.youtube.recentVideos(accountId || undefined);
      return { videos: videos.slice(0, 5), source };
    }
    throw new Error(`Unbekannte Verbindung: ${name}`);
  });

  // ------------------------------------------------------------- Veröffentlichen
  const needPublisher = () => {
    if (!publisher) throw new Error('Das Veröffentlichen ist nicht gestartet.');
    return publisher;
  };
  const publishStatus = () => (publisher
    ? { ...publisher.status(), meta: publisher.meta.status() }
    : { primary: true, busy: null, providers: [], meta: null });
  /** Instagram und Facebook teilen sich die Meta-Anmeldung. */
  const signInTarget = (id) => {
    const target = id === 'meta' ? needPublisher().meta : needPublisher().byId[id];
    if (!target) throw new Error(`Unbekannte Plattform: ${id}`);
    return target;
  };

  handle('publish:status', () => publishStatus());
  handle('publish:setup', ({ provider, values }) => {
    saveManual(store, provider, values || {});
    return publishStatus();
  });
  handle('publish:signIn', async ({ id }) => {
    await signInTarget(id).signIn();
    return publishStatus();
  });
  handle('publish:cancelSignIn', ({ id }) => {
    oauth.cancel(id);
    return true;
  });
  handle('publish:signOut', async ({ id }) => {
    await signInTarget(id).signOut();
    return publishStatus();
  });
  handle('publish:selectPage', ({ pageId }) => {
    needPublisher().meta.selectPage(pageId);
    return publishStatus();
  });
  handle('publish:tiktokInfo', () => needPublisher().byId.tiktok.creatorInfo());
  handle('publish:now', ({ postId }) => needPublisher().publishNow(postId));
  handle('publish:retry', ({ postId, platformId }) => needPublisher().retry(postId, platformId || null));
  handle('media:probe', ({ filePath }) => probe(filePath));

  /**
   * Einrichten: Kennungen in der Zwischenablage erkennen. Die Oberfläche
   * bekommt nur, was wie eine Kennung dieser Plattform aussieht – nie den
   * übrigen Inhalt der Zwischenablage.
   */
  handle('publish:detectClipboard', ({ provider }) => detectKeys(provider, clipboard.readText()));

  /** Einrichten: heruntergeladene Datei mit den Kennungen einlesen (etwa Googles JSON). */
  handle('publish:importFile', async ({ provider }) => {
    const result = await dialog.showOpenDialog(getWindow(), {
      title: 'Datei mit den Zugangsdaten wählen',
      properties: ['openFile'],
      filters: [{ name: 'JSON oder Text', extensions: ['json', 'txt'] }, { name: 'Alle Dateien', extensions: ['*'] }],
    });
    if (result.canceled || !result.filePaths?.[0]) return { canceled: true };
    const file = result.filePaths[0];
    if (fs.statSync(file).size > 1024 * 1024) throw new Error('Die Datei ist zu groß für Zugangsdaten.');
    return { canceled: false, found: detectKeys(provider, fs.readFileSync(file, 'utf8')) };
  });

  // ------------------------------------------------------------- Mehrere PCs
  handle('sync:status', () => sync.status());
  handle('sync:folders', () => sync.detectFolders());

  handle('sync:pickFolder', async () => {
    const result = await dialog.showOpenDialog(getWindow(), {
      title: 'Cloud-Ordner wählen',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (result.canceled || !result.filePaths?.[0]) return { canceled: true };
    return { canceled: false, path: result.filePaths[0] };
  });

  handle('sync:create', ({ folder }) => sync.create({ folder }));
  handle('sync:join', ({ folder, code }) => sync.join({ folder, code }));
  handle('sync:code', () => sync.showCode());
  handle('sync:leave', () => { sync.leave(); return sync.status(); });
  handle('sync:fetchHere', ({ value }) => { sync.setFetchHere(Boolean(value)); return sync.status(); });
  handle('sync:now', () => sync.syncNow());

  // ------------------------------------------------------------- Handy-Begleiter
  handle('companion:status', () => companion.status());
  handle('companion:start', ({ port }) => companion.start(port || undefined));
  handle('companion:stop', async () => { await companion.stop(); return companion.status(); });
  handle('companion:newToken', () => { companion.newToken(); return companion.status(); });

  // ------------------------------------------------------------- Aktualisierung
  handle('update:check', ({ force }) => updater.check({ manual: Boolean(force), skipThrottle: true }));
  handle('update:status', () => updater.status());
  handle('update:install', () => updater.install());
  handle('update:openReleasePage', () => updater.openReleasePage());

  // ------------------------------------------------------------- System
  handle('system:openExternal', ({ url }) => {
    if (!/^https?:\/\//i.test(url || '')) throw new Error('Nur http- und https-Adressen sind erlaubt.');
    return shell.openExternal(url);
  });

  handle('system:copy', ({ text }) => {
    clipboard.writeText(text ?? '');
    return true;
  });

  handle('system:notify', ({ title, body }) => {
    if (!Notification.isSupported()) return false;
    new Notification({ title, body }).show();
    return true;
  });

  handle('system:paths', () => store.paths());
  handle('system:version', () => ({
    app: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    platform: process.platform,
  }));

  handle('system:setStartup', ({ enabled }) => {
    app.setLoginItemSettings({ openAtLogin: Boolean(enabled), args: ['--hidden'] });
    return app.getLoginItemSettings().openAtLogin;
  });
}

module.exports = { registerIpc };
