'use strict';

/**
 * Einstiegspunkt der Desktop-App.
 *
 * Verantwortlich fuer Fenster, Menue, Tray-Symbol und den Lebenszyklus.
 * Fachlogik liegt bewusst woanders: Daten im Store, Termine im Scheduler,
 * die Schnittstelle zur Oberflaeche in ipc.js.
 */

const path = require('path');
const { app, BrowserWindow, Menu, Tray, shell, nativeImage } = require('electron');
const { Store } = require('./store');
const { Scheduler } = require('./scheduler');
const { registerIpc } = require('./ipc');
const { Updater } = require('./updater');

const isDev = process.argv.includes('--dev');
const startHidden = process.argv.includes('--hidden');

let mainWindow = null;
let tray = null;
let store = null;
let scheduler = null;
let updater = null;
let quitting = false;

const getWindow = () => mainWindow;

// Nur eine Instanz: ein zweiter Start holt das bestehende Fenster nach vorn.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => showWindow());
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1040,
    minHeight: 680,
    show: false,
    backgroundColor: '#0d0b14',
    title: 'Content Helper',
    icon: path.join(__dirname, '..', 'renderer', 'assets', 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: true,
    },
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  mainWindow.once('ready-to-show', () => {
    if (!startHidden) mainWindow.show();
    if (isDev) mainWindow.webContents.openDevTools({ mode: 'detach' });
  });

  // Im Entwicklungsmodus landen Meldungen der Oberflaeche auch im Terminal.
  if (isDev) {
    mainWindow.webContents.on('console-message', (...args) => {
      const info = typeof args[0] === 'object' && args[0]?.message !== undefined
        ? args[0]
        : { level: args[1], message: args[2], lineNumber: args[3], sourceId: args[4] };
      console.log(`[Oberflaeche/${info.level}] ${info.message}  (${info.sourceId}:${info.lineNumber})`);
    });
  }

  // Externe Links gehoeren in den Systembrowser, nicht in die App.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('close', (event) => {
    if (quitting || !store.settings().minimizeToTray) return;
    event.preventDefault();
    mainWindow.hide();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function showWindow() {
  if (!mainWindow) return createWindow();
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

/** Schickt die Oberflaeche auf eine Ansicht (Menue, Tray, Tastenkuerzel). */
function goto(view) {
  showWindow();
  mainWindow?.webContents.send('nav:goto', { view });
}

function buildMenu() {
  const template = [
    {
      label: 'Datei',
      submenu: [
        { label: 'Neuer Beitrag', accelerator: 'CmdOrCtrl+N', click: () => mainWindow?.webContents.send('nav:action', { action: 'new-post' }) },
        { label: 'Neue Idee', accelerator: 'CmdOrCtrl+I', click: () => mainWindow?.webContents.send('nav:action', { action: 'new-idea' }) },
        { type: 'separator' },
        { label: 'Sicherung exportieren', click: () => mainWindow?.webContents.send('nav:action', { action: 'export-backup' }) },
        { label: 'Sicherung einlesen', click: () => mainWindow?.webContents.send('nav:action', { action: 'import-backup' }) },
        { type: 'separator' },
        { label: 'Beenden', accelerator: 'CmdOrCtrl+Q', click: () => { quitting = true; app.quit(); } },
      ],
    },
    {
      label: 'Ansicht',
      submenu: [
        { label: 'Dashboard', accelerator: 'CmdOrCtrl+1', click: () => goto('dashboard') },
        { label: 'Kalender', accelerator: 'CmdOrCtrl+2', click: () => goto('calendar') },
        { label: 'Composer', accelerator: 'CmdOrCtrl+3', click: () => goto('composer') },
        { label: 'Ideen', accelerator: 'CmdOrCtrl+4', click: () => goto('ideas') },
        { label: 'Analytics', accelerator: 'CmdOrCtrl+5', click: () => goto('analytics') },
        { label: 'Coach', accelerator: 'CmdOrCtrl+6', click: () => goto('coach') },
        { type: 'separator' },
        { role: 'reload', label: 'Neu laden' },
        { role: 'toggleDevTools', label: 'Entwicklerwerkzeuge' },
        { type: 'separator' },
        { role: 'resetZoom', label: 'Zoom zuruecksetzen' },
        { role: 'zoomIn', label: 'Groesser' },
        { role: 'zoomOut', label: 'Kleiner' },
        { role: 'togglefullscreen', label: 'Vollbild' },
      ],
    },
    {
      label: 'Bearbeiten',
      submenu: [
        { role: 'undo', label: 'Rueckgaengig' },
        { role: 'redo', label: 'Wiederholen' },
        { type: 'separator' },
        { role: 'cut', label: 'Ausschneiden' },
        { role: 'copy', label: 'Kopieren' },
        { role: 'paste', label: 'Einfuegen' },
        { role: 'selectAll', label: 'Alles auswaehlen' },
      ],
    },
    {
      label: 'Hilfe',
      submenu: [
        { label: 'Datenordner oeffnen', click: () => shell.openPath(store.paths().data) },
        { label: 'Projektseite auf GitHub', click: () => shell.openExternal('https://github.com/MoinMornhart/content-helper') },
        { label: 'Ueber Content Helper', click: () => goto('settings') },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function buildTray() {
  const icon = nativeImage.createFromPath(path.join(__dirname, '..', 'renderer', 'assets', 'tray.png'));
  tray = new Tray(icon);
  tray.setToolTip('Content Helper');
  refreshTray();
  tray.on('click', () => showWindow());
  setInterval(refreshTray, 60_000);
}

function refreshTray() {
  if (!tray) return;
  const summary = scheduler.summary();
  const next = summary.next
    ? `Naechster: ${summary.next.title} – ${new Date(summary.next.at).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' })}`
    : 'Nichts geplant';

  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: next, enabled: false },
      { label: `${summary.scheduledCount} geplant · ${summary.dueCount} faellig · ${summary.missedCount} verpasst`, enabled: false },
      { type: 'separator' },
      { label: 'Fenster oeffnen', click: () => showWindow() },
      { label: 'Neuer Beitrag', click: () => { showWindow(); mainWindow?.webContents.send('nav:action', { action: 'new-post' }); } },
      { label: 'Kalender', click: () => goto('calendar') },
      { type: 'separator' },
      { label: 'Beenden', click: () => { quitting = true; app.quit(); } },
    ])
  );

  tray.setToolTip(summary.dueCount ? `Content Helper – ${summary.dueCount} faellig` : 'Content Helper');
}

app.whenReady().then(() => {
  app.setAppUserModelId('de.mornhart.contenthelper');

  store = new Store(app.getPath('userData'));
  scheduler = new Scheduler(store, getWindow);

  updater = new Updater(store, getWindow);

  registerIpc(store, scheduler, updater, getWindow);
  createWindow();
  buildMenu();
  buildTray();
  scheduler.start();
  updater.start();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('before-quit', () => {
  quitting = true;
  scheduler?.stop();
  updater?.stop();
  store?.flush();
});

app.on('window-all-closed', () => {
  // Unter Windows laeuft die App im Tray weiter, damit Termine nicht verpasst werden.
  if (process.platform !== 'darwin' && !store?.settings().minimizeToTray) app.quit();
});
