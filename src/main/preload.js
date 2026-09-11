'use strict';

/**
 * Bruecke zwischen Oberflaeche und Hauptprozess.
 *
 * Die Oberflaeche laeuft ohne Node-Zugriff. Alles, was sie darf, steht
 * ausdruecklich hier – nichts anderes ist erreichbar.
 */

const { contextBridge, ipcRenderer } = require('electron');

const platforms = require('../shared/platforms.json');
const metrics = require('../shared/metrics.json');
const { loadDictionary } = require('./i18n');

const invoke = (channel, payload) => ipcRenderer.invoke(channel, payload);

/** Registriert einen Ereignis-Empfaenger und liefert die Abmeldefunktion zurueck. */
function on(channel, handler) {
  const listener = (_event, payload) => handler(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld('ch', {
  /** Statisches Plattform- und Kennzahlenwissen, direkt beim Start verfuegbar. */
  catalog: { platforms, metrics, i18n: { en: loadDictionary() } },

  db: {
    list: (collection) => invoke('db:list', { collection }),
    get: (collection, id) => invoke('db:get', { collection, id }),
    insert: (collection, entry) => invoke('db:insert', { collection, entry }),
    update: (collection, id, patch) => invoke('db:update', { collection, id, patch }),
    remove: (collection, id) => invoke('db:remove', { collection, id }),
    replace: (collection, items) => invoke('db:replace', { collection, items }),
    stats: () => invoke('db:stats'),
  },

  settings: {
    get: () => invoke('settings:get'),
    save: (patch) => invoke('settings:save', { patch }),
  },

  backup: {
    export: () => invoke('backup:export'),
    import: (merge) => invoke('backup:import', { merge }),
    openFolder: () => invoke('backup:openFolder'),
  },

  media: {
    pick: () => invoke('media:pick'),
    pickImage: () => invoke('media:pickImage'),
    reveal: (filePath) => invoke('media:reveal', { filePath }),
    open: (filePath) => invoke('media:open', { filePath }),
    thumbnail: (filePath) => invoke('media:thumbnail', { filePath }),
    probe: (filePath) => invoke('media:probe', { filePath }),
  },

  publish: {
    status: () => invoke('publish:status'),
    setup: (provider, values) => invoke('publish:setup', { provider, values }),
    signIn: (id) => invoke('publish:signIn', { id }),
    cancelSignIn: (id) => invoke('publish:cancelSignIn', { id }),
    signOut: (id) => invoke('publish:signOut', { id }),
    selectPage: (pageId) => invoke('publish:selectPage', { pageId }),
    tiktokInfo: () => invoke('publish:tiktokInfo'),
    now: (postId) => invoke('publish:now', { postId }),
    retry: (postId, platformId) => invoke('publish:retry', { postId, platformId }),
    detectClipboard: (provider) => invoke('publish:detectClipboard', { provider }),
    importFile: (provider) => invoke('publish:importFile', { provider }),
    onProgress: (handler) => on('publish:progress', handler),
    onChanged: (handler) => on('publish:changed', handler),
  },

  files: {
    readText: (filters) => invoke('files:readText', { filters }),
    saveText: (options) => invoke('files:saveText', options),
  },

  calendar: {
    export: (includePublished) => invoke('calendar:export', { includePublished }),
    subscription: () => invoke('calendar:subscription'),
  },

  scheduler: {
    summary: () => invoke('scheduler:summary'),
    tick: () => invoke('scheduler:tick'),
    onChanged: (handler) => on('scheduler:changed', handler),
  },

  connectors: {
    status: () => invoke('connectors:status'),
    connect: (name, credentials) => invoke('connectors:connect', { name, credentials }),
    sync: (name) => invoke('connectors:sync', { name }),
    options: (name, options, accountId) => invoke('connectors:options', { name, options, accountId }),
    disconnect: (name, accountId) => invoke('connectors:disconnect', { name, accountId }),
    preview: (name, accountId) => invoke('connectors:preview', { name, accountId }),
    onChanged: (handler) => on('connectors:changed', handler),
  },

  youtube: {
    syncChannel: (accountId) => invoke('youtube:syncChannel', { accountId }),
  },

  twitch: {
    authStatus: () => invoke('twitch:authStatus'),
    setClientId: (clientId) => invoke('twitch:setClientId', { clientId }),
    signIn: () => invoke('twitch:signIn'),
    cancelAuth: () => invoke('twitch:cancelAuth'),
    signOut: () => invoke('twitch:signOut'),
    onAuth: (handler) => on('twitch:auth', handler),
  },

  sync: {
    status: () => invoke('sync:status'),
    folders: () => invoke('sync:folders'),
    pickFolder: () => invoke('sync:pickFolder'),
    create: (folder) => invoke('sync:create', { folder }),
    join: (folder, code) => invoke('sync:join', { folder, code }),
    code: () => invoke('sync:code'),
    leave: () => invoke('sync:leave'),
    fetchHere: (value) => invoke('sync:fetchHere', { value }),
    now: () => invoke('sync:now'),
    onChanged: (handler) => on('sync:changed', handler),
  },

  companion: {
    status: () => invoke('companion:status'),
    start: (port) => invoke('companion:start', { port }),
    stop: () => invoke('companion:stop'),
    newToken: () => invoke('companion:newToken'),
    onChanged: (handler) => on('companion:changed', handler),
  },

  update: {
    check: (force) => invoke('update:check', { force }),
    status: () => invoke('update:status'),
    install: () => invoke('update:install'),
    openReleasePage: () => invoke('update:openReleasePage'),
    onAvailable: (handler) => on('update:available', handler),
    onProgress: (handler) => on('update:progress', handler),
    onReady: (handler) => on('update:ready', handler),
    onState: (handler) => on('update:state', handler),
  },

  system: {
    openExternal: (url) => invoke('system:openExternal', { url }),
    copy: (text) => invoke('system:copy', { text }),
    notify: (title, body) => invoke('system:notify', { title, body }),
    paths: () => invoke('system:paths'),
    version: () => invoke('system:version'),
    setStartup: (enabled) => invoke('system:setStartup', { enabled }),
  },

  nav: {
    onGoto: (handler) => on('nav:goto', handler),
    onAction: (handler) => on('nav:action', handler),
  },
});
