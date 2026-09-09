'use strict';

/**
 * Lokaler Datenspeicher.
 *
 * Alles liegt als lesbares JSON im Benutzerprofil, eine Datei je Sammlung.
 * Geschrieben wird atomar (temporaere Datei + Umbenennen), damit ein Absturz
 * mitten im Schreibvorgang niemals eine halbe Datei hinterlaesst. Zusaetzlich
 * wird vor jeder Ueberschreibung eine Vorgaengerversion aufgehoben und einmal
 * pro Tag ein vollstaendiger Schnappschuss angelegt.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SCHEMA_VERSION = 1;

/** Sammlungen und ihre Startwerte. */
const COLLECTIONS = {
  posts: [],
  ideas: [],
  media: [],
  channels: [],
  analytics: [],
  series: [],
  tasks: [],
  hashtagSets: [],
  templates: [],
  notes: [],
  activity: [],
};

const DEFAULT_SETTINGS = {
  schemaVersion: SCHEMA_VERSION,
  theme: 'dark',
  accent: 'violet',
  locale: 'de-DE',
  startOfWeek: 1,
  notifications: true,
  leadTimeMinutes: 15,
  autoOpenUploadPage: false,
  copyToClipboardOnDue: true,
  minimizeToTray: true,
  launchOnStartup: false,
  weeklyGoal: { posts: 5, ideas: 10, streams: 3 },
  activePlatforms: ['youtube', 'youtube_shorts', 'tiktok', 'instagram_reels', 'twitch', 'x'],
  queueSlots: [],
  onboardingDone: false,
  backupKeepDays: 14,
  connections: {},
  companionEnabled: false,
  companionPort: 7788,
  companionToken: null,
  autoUpdateCheck: true,
  lastUpdateCheck: null,
  lastKnownVersion: null,
  updateNotifiedFor: null,
};

class Store {
  /**
   * @param {string} rootDir Verzeichnis fuer die Daten (z. B. %APPDATA%/Content Helper).
   */
  constructor(rootDir) {
    this.root = rootDir;
    this.dataDir = path.join(rootDir, 'data');
    this.backupDir = path.join(rootDir, 'backups');
    this.mediaDir = path.join(rootDir, 'media');
    this.cache = new Map();
    this.writeTimers = new Map();
    this.writeDelay = 250;
    this._ensureDirs();
    this._load();
    this._migrate();
    this._dailySnapshot();
  }

  _ensureDirs() {
    for (const dir of [this.root, this.dataDir, this.backupDir, this.mediaDir]) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  _file(name) {
    return path.join(this.dataDir, `${name}.json`);
  }

  _readJson(file, fallback) {
    try {
      const raw = fs.readFileSync(file, 'utf8');
      if (!raw.trim()) return fallback;
      return JSON.parse(raw);
    } catch (err) {
      if (err.code === 'ENOENT') return fallback;
      // Beschaedigte Datei: beiseitelegen statt Daten still zu verlieren.
      try {
        fs.renameSync(file, `${file}.broken-${Date.now()}`);
      } catch { /* ignorieren */ }
      return fallback;
    }
  }

  _load() {
    for (const [name, initial] of Object.entries(COLLECTIONS)) {
      const value = this._readJson(this._file(name), null);
      this.cache.set(name, Array.isArray(value) ? value : structuredClone(initial));
    }
    const settings = this._readJson(this._file('settings'), null);
    this.cache.set('settings', { ...structuredClone(DEFAULT_SETTINGS), ...(settings || {}) });
  }

  _migrate() {
    const settings = this.cache.get('settings');
    const from = settings.schemaVersion || 0;
    if (from >= SCHEMA_VERSION) return;
    // Platz fuer kuenftige Migrationsschritte: if (from < 2) { ... }
    settings.schemaVersion = SCHEMA_VERSION;
    this._writeNow('settings');
  }

  /** Einmal taeglich ein vollstaendiger Schnappschuss aller Sammlungen. */
  _dailySnapshot() {
    const stamp = new Date().toISOString().slice(0, 10);
    const target = path.join(this.backupDir, `snapshot-${stamp}.json`);
    if (fs.existsSync(target)) return;
    try {
      fs.writeFileSync(target, JSON.stringify(this.exportAll(), null, 2), 'utf8');
    } catch { /* Backup darf den Start nie blockieren */ }
    this._pruneBackups();
  }

  _pruneBackups() {
    const keepDays = this.cache.get('settings').backupKeepDays || 14;
    const limit = Date.now() - keepDays * 86400000;
    try {
      for (const file of fs.readdirSync(this.backupDir)) {
        const full = path.join(this.backupDir, file);
        if (fs.statSync(full).mtimeMs < limit) fs.unlinkSync(full);
      }
    } catch { /* ignorieren */ }
  }

  _writeNow(name) {
    const file = this._file(name);
    const tmp = `${file}.tmp`;
    const payload = JSON.stringify(this.cache.get(name), null, 2);
    fs.writeFileSync(tmp, payload, 'utf8');
    if (fs.existsSync(file)) {
      try {
        fs.copyFileSync(file, `${file}.bak`);
      } catch { /* ignorieren */ }
    }
    fs.renameSync(tmp, file);
  }

  /** Gebuendeltes Schreiben: viele schnelle Aenderungen ergeben einen Schreibvorgang. */
  _scheduleWrite(name) {
    clearTimeout(this.writeTimers.get(name));
    this.writeTimers.set(
      name,
      setTimeout(() => {
        try {
          this._writeNow(name);
        } catch { /* ignorieren */ }
        this.writeTimers.delete(name);
      }, this.writeDelay)
    );
  }

  /** Erzwingt das Schreiben aller offenen Aenderungen (z. B. beim Beenden). */
  flush() {
    for (const name of this.writeTimers.keys()) {
      clearTimeout(this.writeTimers.get(name));
      try {
        this._writeNow(name);
      } catch { /* ignorieren */ }
    }
    this.writeTimers.clear();
  }

  // ---------------------------------------------------------------- Sammlungen

  list(collection) {
    if (!this.cache.has(collection)) throw new Error(`Unbekannte Sammlung: ${collection}`);
    return this.cache.get(collection);
  }

  get(collection, id) {
    return this.list(collection).find((entry) => entry.id === id) || null;
  }

  insert(collection, entry) {
    const now = new Date().toISOString();
    const record = {
      ...entry,
      id: entry.id || crypto.randomUUID(),
      createdAt: entry.createdAt || now,
      updatedAt: now,
    };
    this.list(collection).unshift(record);
    this._scheduleWrite(collection);
    return record;
  }

  update(collection, id, patch) {
    const items = this.list(collection);
    const index = items.findIndex((entry) => entry.id === id);
    if (index === -1) return null;
    items[index] = { ...items[index], ...patch, id, updatedAt: new Date().toISOString() };
    this._scheduleWrite(collection);
    return items[index];
  }

  remove(collection, id) {
    const items = this.list(collection);
    const index = items.findIndex((entry) => entry.id === id);
    if (index === -1) return false;
    items.splice(index, 1);
    this._scheduleWrite(collection);
    return true;
  }

  /** Ersetzt eine ganze Sammlung (Import, Sortierung, Massenbearbeitung). */
  replace(collection, items) {
    if (!this.cache.has(collection)) throw new Error(`Unbekannte Sammlung: ${collection}`);
    this.cache.set(collection, items);
    this._scheduleWrite(collection);
    return items;
  }

  // ---------------------------------------------------------------- Einstellungen

  settings() {
    return this.cache.get('settings');
  }

  saveSettings(patch) {
    const merged = { ...this.cache.get('settings'), ...patch };
    this.cache.set('settings', merged);
    this._scheduleWrite('settings');
    return merged;
  }

  // ---------------------------------------------------------------- Sicherung

  exportAll() {
    const bundle = {
      app: 'Content Helper',
      schemaVersion: SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      settings: this.cache.get('settings'),
      collections: {},
    };
    for (const name of Object.keys(COLLECTIONS)) {
      bundle.collections[name] = this.cache.get(name);
    }
    return bundle;
  }

  importAll(bundle, { merge = false } = {}) {
    if (!bundle || typeof bundle !== 'object' || !bundle.collections) {
      throw new Error('Die Datei enthaelt kein gueltiges Content-Helper-Backup.');
    }
    for (const name of Object.keys(COLLECTIONS)) {
      const incoming = Array.isArray(bundle.collections[name]) ? bundle.collections[name] : [];
      if (merge) {
        const existing = this.cache.get(name);
        const known = new Set(existing.map((entry) => entry.id));
        this.cache.set(name, [...incoming.filter((entry) => !known.has(entry.id)), ...existing]);
      } else {
        this.cache.set(name, incoming);
      }
      this._scheduleWrite(name);
    }
    if (bundle.settings) this.saveSettings(bundle.settings);
    this.flush();
    return true;
  }

  paths() {
    return { root: this.root, data: this.dataDir, backups: this.backupDir, media: this.mediaDir };
  }

  stats() {
    const counts = {};
    for (const name of Object.keys(COLLECTIONS)) counts[name] = this.cache.get(name).length;
    let bytes = 0;
    try {
      for (const file of fs.readdirSync(this.dataDir)) {
        bytes += fs.statSync(path.join(this.dataDir, file)).size;
      }
    } catch { /* ignorieren */ }
    return { counts, bytes };
  }
}

module.exports = { Store, COLLECTIONS, DEFAULT_SETTINGS, SCHEMA_VERSION };
