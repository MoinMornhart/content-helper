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

const invoke = (channel, payload) => ipcRenderer.invoke(channel, payload);

/** Registriert einen Ereignis-Empfaenger und liefert die Abmeldefunktion zurueck. */
function on(channel, handler) {
  const listener = (_event, payload) => handler(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld('ch', {
  /** Statisches Plattform- und Kennzahlenwissen, direkt beim Start verfuegbar. */
  catalog: { platforms, metrics },

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
  },

  files: {
    readText: (filters) => invoke('files:readText', { filters }),
    saveText: (options) => invoke('files:saveText', options),
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
    options: (name, options) => invoke('connectors:options', { name, options }),
    disconnect: (name) => invoke('connectors:disconnect', { name }),
    preview: (name) => invoke('connectors:preview', { name }),
    onChanged: (handler) => on('connectors:changed', handler),
  },

  twitch: {
    authStatus: () => invoke('twitch:authStatus'),
    setClientId: (clientId) => invoke('twitch:setClientId', { clientId }),
    signIn: () => invoke('twitch:signIn'),
    cancelAuth: () => invoke('twitch:cancelAuth'),
    signOut: () => invoke('twitch:signOut'),
    onAuth: (handler) => on('twitch:auth', handler),
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
