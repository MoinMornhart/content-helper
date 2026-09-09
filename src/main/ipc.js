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
 * @param {() => Electron.BrowserWindow|null} getWindow
 */
function registerIpc(store, scheduler, updater, getWindow) {
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

  // ------------------------------------------------------------- Scheduler
  handle('scheduler:summary', () => scheduler.summary());
  handle('scheduler:tick', () => scheduler.tick());

  // ------------------------------------------------------------- Aktualisierung
  handle('update:check', ({ force }) => updater.check({ manual: Boolean(force), skipThrottle: true }));
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
