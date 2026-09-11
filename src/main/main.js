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
const { Companion } = require('./companion');
const { Connectors } = require('./connectors');
const { CloudSync } = require('./sync/cloud-sync');
const { createPublisher } = require('./publish');
const i18n = require('./i18n');

const { t } = i18n;

const isDev = process.argv.includes('--dev');
const startHidden = process.argv.includes('--hidden');

let mainWindow = null;
let tray = null;
let store = null;
let scheduler = null;
let updater = null;
let companion = null;
let connectors = null;
let cloudSync = null;
let publisher = null;
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
      label: t('Datei'),
      submenu: [
        { label: t('Neuer Beitrag'), accelerator: 'CmdOrCtrl+N', click: () => mainWindow?.webContents.send('nav:action', { action: 'new-post' }) },
        { label: t('Neue Idee'), accelerator: 'CmdOrCtrl+I', click: () => mainWindow?.webContents.send('nav:action', { action: 'new-idea' }) },
        { type: 'separator' },
        { label: t('Sicherung exportieren'), click: () => mainWindow?.webContents.send('nav:action', { action: 'export-backup' }) },
        { label: t('Sicherung einlesen'), click: () => mainWindow?.webContents.send('nav:action', { action: 'import-backup' }) },
        { type: 'separator' },
        { label: t('Beenden'), accelerator: 'CmdOrCtrl+Q', click: () => { quitting = true; app.quit(); } },
      ],
    },
    {
      label: t('Ansicht'),
      submenu: [
        { label: 'Dashboard', accelerator: 'CmdOrCtrl+1', click: () => goto('dashboard') },
        { label: t('Kalender'), accelerator: 'CmdOrCtrl+2', click: () => goto('calendar') },
        { label: 'Composer', accelerator: 'CmdOrCtrl+3', click: () => goto('composer') },
        { label: t('Ideen'), accelerator: 'CmdOrCtrl+4', click: () => goto('ideas') },
        { label: 'Analytics', accelerator: 'CmdOrCtrl+5', click: () => goto('analytics') },
        { label: 'Coach', accelerator: 'CmdOrCtrl+6', click: () => goto('coach') },
        { type: 'separator' },
        { role: 'reload', label: t('Neu laden') },
        { role: 'toggleDevTools', label: t('Entwicklerwerkzeuge') },
        { type: 'separator' },
        { role: 'resetZoom', label: t('Zoom zuruecksetzen') },
        { role: 'zoomIn', label: t('Groesser') },
        { role: 'zoomOut', label: t('Kleiner') },
        { role: 'togglefullscreen', label: t('Vollbild') },
      ],
    },
    {
      label: t('Bearbeiten'),
      submenu: [
        { role: 'undo', label: t('Rueckgaengig') },
        { role: 'redo', label: t('Wiederholen') },
        { type: 'separator' },
        { role: 'cut', label: t('Ausschneiden') },
        { role: 'copy', label: t('Kopieren') },
        { role: 'paste', label: t('Einfuegen') },
        { role: 'selectAll', label: t('Alles auswaehlen') },
      ],
    },
    {
      label: t('Hilfe'),
      submenu: [
        { label: t('Datenordner oeffnen'), click: () => shell.openPath(store.paths().data) },
        { label: t('Projektseite auf GitHub'), click: () => shell.openExternal('https://github.com/MoinMornhart/content-helper') },
        { label: t('Ueber Content Helper'), click: () => goto('settings') },
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
    ? t('Naechster: {title} – {when}', {
      title: summary.next.title,
      when: new Date(summary.next.at).toLocaleString(i18n.locale(), { dateStyle: 'short', timeStyle: 'short' }),
    })
    : t('Nichts geplant');

  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: next, enabled: false },
      {
        label: t('{scheduled} geplant · {due} faellig · {missed} verpasst', {
          scheduled: summary.scheduledCount,
          due: summary.dueCount,
          missed: summary.missedCount,
        }),
        enabled: false,
      },
      { type: 'separator' },
      { label: t('Fenster oeffnen'), click: () => showWindow() },
      { label: t('Neuer Beitrag'), click: () => { showWindow(); mainWindow?.webContents.send('nav:action', { action: 'new-post' }); } },
      { label: t('Kalender'), click: () => goto('calendar') },
      { type: 'separator' },
      { label: t('Beenden'), click: () => { quitting = true; app.quit(); } },
    ])
  );

  tray.setToolTip(summary.dueCount ? t('Content Helper – {count} faellig', { count: summary.dueCount }) : 'Content Helper');
}

app.whenReady().then(() => {
  app.setAppUserModelId('de.mornhart.contenthelper');

  store = new Store(app.getPath('userData'));
  i18n.init(() => store.settings().language);
  scheduler = new Scheduler(store, getWindow);

  updater = new Updater(store, getWindow);

  companion = new Companion(store, scheduler, getWindow);

  connectors = new Connectors(store, getWindow);
  cloudSync = new CloudSync(store, getWindow);

  // Veröffentlicht nur der PC, der auch abholt – sonst ginge bei mehreren
  // verbundenen PCs jeder Beitrag doppelt raus.
  publisher = createPublisher(store, {
    getWindow,
    isPrimary: () => connectors.fetchesHere(),
    notify: (title, body) => scheduler.notify(title, body),
  });
  scheduler.setPublisher(publisher);

  registerIpc(store, scheduler, updater, companion, connectors, cloudSync, getWindow, publisher);
  createWindow();
  buildMenu();
  buildTray();
  // Sprache umgestellt: Menü und Infobereich neu aufbauen.
  store.onChange((change) => {
    if (change.type === 'settings' && change.patch && 'language' in change.patch) {
      buildMenu();
      refreshTray();
    }
  });
  scheduler.start();
  updater.start();
  connectors.start();
  cloudSync.start();
  publisher.start();

  // Der Handy-Begleiter startet nur, wenn er zuletzt aktiv war.
  if (store.settings().companionEnabled) {
    companion.start().catch((error) => console.error('Handy-Begleiter:', error.message));
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('before-quit', () => {
  quitting = true;
  scheduler?.stop();
  updater?.stop();
  companion?.stop();
  connectors?.stop();
  cloudSync?.stop();
  publisher?.stop();
  store?.flush();
});

app.on('window-all-closed', () => {
  // Unter Windows laeuft die App im Tray weiter, damit Termine nicht verpasst werden.
  if (process.platform !== 'darwin' && !store?.settings().minimizeToTray) app.quit();
});
