'use strict';

/**
 * Abgleich zwischen mehreren PCs über einen Cloud-Ordner.
 *
 * Content Helper hat bewusst kein Konto und keinen eigenen Server. Damit
 * mehrere PCs trotzdem dieselben Daten sehen – auch an verschiedenen Orten –,
 * dient ein Ordner als Transportweg, den der Nutzer ohnehin synchronisiert:
 * OneDrive, Dropbox, Google Drive oder iCloud. Die App legt dort nur Dateien ab
 * und liest sie wieder; das Hin- und Hertragen übernimmt das Cloud-Programm.
 *
 * Drei Entscheidungen tragen das Ganze:
 *
 * 1. Verschlüsselt. Der Code, den PC A erzeugt und PC B eingibt, ist zugleich
 *    der Schlüssel. Was im Cloud-Ordner liegt, ist mit AES-256-GCM verschlüsselt;
 *    der Anbieter sieht nur unlesbare Dateien.
 *
 * 2. Jeder PC schreibt nur in seinen eigenen Unterordner. Cloud-Programme
 *    erzeugen „Konfliktkopien“, sobald zwei Rechner dieselbe Datei ändern. Mit
 *    einem Änderungsprotokoll je Gerät kann das nicht passieren – gelesen wird
 *    alles, geschrieben nur das Eigene.
 *
 * 3. Die jüngere Änderung gewinnt, je Datensatz. Jeder Datensatz trägt seinen
 *    Änderungszeitpunkt; bei Gleichstand entscheidet eine feste Regel, damit
 *    alle PCs ohne Absprache beim selben Ergebnis landen. Löschungen werden als
 *    Grabstein gemerkt, sonst tauchte Gelöschtes vom anderen PC wieder auf.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const { t } = require('../i18n');

const ROOT_NAME = 'Content Helper Sync';

/** Was abgeglichen wird. Das Aktivitätsprotokoll bleibt je PC. */
const SYNCED = ['posts', 'ideas', 'media', 'channels', 'analytics', 'series', 'tasks', 'hashtagSets', 'templates', 'notes'];

/**
 * Einstellungen, die für alle PCs gelten sollen. Aussehen, Fenster- und
 * Erinnerungsverhalten bleiben bewusst je Gerät – ein Laptop darf hell sein,
 * während der Streaming-PC dunkel bleibt.
 */
const SHARED_KEYS = ['activePlatforms', 'queueSlots', 'weeklyGoal', 'startOfWeek', 'leadTimeMinutes'];

const PULL_MS = 15_000;
const FLUSH_DELAY_MS = 3_000;
const HEARTBEAT_MS = 5 * 60_000;
const SNAPSHOT_MS = 6 * 3600_000;
const PRUNE_AFTER_MS = 14 * 86400_000;
const TOMBSTONE_KEEP_MS = 60 * 86400_000;

// ------------------------------------------------------------------ Code

/** Crockford-Base32: ohne I, L, O und U – nichts, was sich beim Abtippen verwechseln lässt. */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const SECRET_BYTES = 12;

/** 12 Zufallsbytes als „CH-XXXXX-XXXXX-XXXXX-XXXXX“. */
function encodeCode(bytes) {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
    value &= (1 << bits) - 1;
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return `CH-${out.match(/.{1,5}/g).join('-')}`;
}

/**
 * Liest einen Code zurück. Nachsichtig beim Tippen: Kleinbuchstaben,
 * Leerzeichen und fehlende Bindestriche sind egal, I/L werden zu 1, O zu 0.
 */
function decodeCode(code) {
  const clean = String(code || '')
    .toUpperCase()
    .replace(/^\s*CH-?/, '')
    .replace(/[\s-]/g, '')
    .replace(/[IL]/g, '1')
    .replace(/O/g, '0');

  if (!/^[0-9A-HJKMNP-TV-Z]{20}$/.test(clean)) {
    throw new Error(t('Das ist kein gültiger Code. Er sieht so aus: CH-XXXXX-XXXXX-XXXXX-XXXXX.'));
  }

  let bits = 0;
  let value = 0;
  const bytes = [];
  for (const char of clean) {
    value = (value << 5) | ALPHABET.indexOf(char);
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
      value &= (1 << bits) - 1;
    }
  }
  return Buffer.from(bytes.slice(0, SECRET_BYTES));
}

/** Der Ordnername des Raums – aus dem Code abgeleitet, verrät ihn aber nicht. */
function spaceIdFor(secret) {
  return crypto.createHash('sha256').update('content-helper-space:').update(secret).digest('hex').slice(0, 16);
}

/** Schlüssel aus dem Code. Bewusst langsam (scrypt), damit Durchprobieren sinnlos ist. */
function deriveKey(secret, spaceId) {
  return crypto.scryptSync(secret, `content-helper-sync-v1:${spaceId}`, 32, {
    N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024,
  });
}

// ------------------------------------------------------------------ Verschlüsselung

/** Packt einen Wert: JSON → gzip → AES-256-GCM. Format: [Version][IV][Prüfwert][Daten]. */
function seal(key, value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([
    cipher.update(zlib.gzipSync(Buffer.from(JSON.stringify(value), 'utf8'))),
    cipher.final(),
  ]);
  return Buffer.concat([Buffer.from([1]), iv, cipher.getAuthTag(), body]);
}

/** Gegenstück zu seal(). Wirft, wenn Schlüssel falsch oder Datei unvollständig ist. */
function unseal(key, buffer) {
  if (!buffer || buffer.length < 30 || buffer[0] !== 1) throw new Error(t('Unbekanntes oder unvollständiges Dateiformat.'));
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, buffer.subarray(1, 13));
  decipher.setAuthTag(buffer.subarray(13, 29));
  const plain = Buffer.concat([decipher.update(buffer.subarray(29)), decipher.final()]);
  return JSON.parse(zlib.gunzipSync(plain).toString('utf8'));
}

// ------------------------------------------------------------------ Dateien

/**
 * Schreibt über eine Zwischendatei. Cloud-Programme laden sonst eine halb
 * geschriebene Datei hoch. Die Zwischendatei beginnt mit „~“ und wird von allen
 * PCs ignoriert.
 */
function writeAtomic(file, data) {
  const tmp = path.join(path.dirname(file), `~${path.basename(file)}.tmp`);
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
}

function readdir(dir) {
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
}

const now = () => new Date().toISOString();

/** Jüngere Fassung gewinnt; bei Gleichstand entscheidet der Inhalt – überall gleich. */
function isNewer(candidate, current) {
  const a = candidate?.updatedAt || '';
  const b = current?.updatedAt || '';
  if (a !== b) return a > b;
  return JSON.stringify(candidate) > JSON.stringify(current);
}

// ------------------------------------------------------------------ Abgleich

class CloudSync {
  /**
   * @param {import('../store').Store} store
   * @param {() => Electron.BrowserWindow|null} getWindow
   */
  constructor(store, getWindow = () => null) {
    this.store = store;
    this.getWindow = getWindow;
    this.key = null;
    this.keySpace = null;
    this.timers = {};
    this.seq = 0;
    this.busy = false;
    this.outboxFile = path.join(store.paths().root, 'sync-outbox.json');
    this.outbox = this.loadOutbox();
    this.unsubscribe = store.onChange((change) => this.onLocalChange(change));
  }

  // ---------------------------------------------------------------- Zustand

  config() {
    return this.store.settings().sync || {};
  }

  /** Eigene Buchführung – still gespeichert, damit sie nicht selbst als Änderung gilt. */
  saveConfig(patch) {
    return this.store.silently(() => this.store.saveSettings({ sync: { ...this.config(), ...patch } }));
  }

  isEnabled() {
    const config = this.config();
    return Boolean(config.enabled && config.folder && config.secret && config.spaceId);
  }

  spacePath() {
    const config = this.config();
    return path.join(config.folder, ROOT_NAME, config.spaceId);
  }

  /**
   * Ist der Raum da? Bewusst kein stilles Neuanlegen: Fehlt der Ordner – etwa
   * weil OneDrive nicht läuft oder das Laufwerk fehlt –, entstünde sonst ein
   * leerer Raum an der falschen Stelle, den kein anderer PC je sieht.
   */
  reachable() {
    return fs.existsSync(path.join(this.spacePath(), 'space.json'));
  }

  keyFor() {
    const config = this.config();
    if (!this.key || this.keySpace !== config.spaceId) {
      this.key = deriveKey(Buffer.from(config.secret, 'hex'), config.spaceId);
      this.keySpace = config.spaceId;
    }
    return this.key;
  }

  /**
   * Holt dieser PC YouTube und Twitch ab? Bei mehreren PCs nur einer – sonst
   * machten sich die Twitch-Anmeldungen gegenseitig ungültig, und jedes Video
   * käme von jedem PC einmal an.
   */
  shouldFetchConnections() {
    const config = this.config();
    return !(config.enabled && config.fetchHere === false);
  }

  // ---------------------------------------------------------------- Ordner finden

  /** Sucht die üblichen Cloud-Ordner dieses PCs. */
  detectFolders() {
    const found = [];
    const add = (provider, label, folder) => {
      if (!folder) return;
      try {
        if (fs.statSync(folder).isDirectory() && !found.some((entry) => entry.path === folder)) {
          found.push({ provider, label, path: folder });
        }
      } catch { /* gibt es nicht */ }
    };

    add('onedrive', 'OneDrive', process.env.OneDriveConsumer || process.env.OneDrive);
    add('onedrive', t('OneDrive (Arbeit/Schule)'), process.env.OneDriveCommercial);

    for (const base of [process.env.LOCALAPPDATA, process.env.APPDATA]) {
      if (!base) continue;
      try {
        const info = JSON.parse(fs.readFileSync(path.join(base, 'Dropbox', 'info.json'), 'utf8'));
        add('dropbox', 'Dropbox', info.personal?.path);
        add('dropbox', 'Dropbox (Business)', info.business?.path);
      } catch { /* kein Dropbox */ }
    }

    // Google Drive für den Desktop hängt sich als eigenes Laufwerk ein.
    for (const letter of 'DEFGHIJKLMNOPQRSTUVWXYZ') {
      add('gdrive', `Google Drive (${letter}:)`, `${letter}:\\Meine Ablage`);
      add('gdrive', `Google Drive (${letter}:)`, `${letter}:\\My Drive`);
    }
    if (os.homedir()) {
      add('gdrive', 'Google Drive', path.join(os.homedir(), 'Google Drive'));
      add('icloud', 'iCloud Drive', path.join(os.homedir(), 'iCloudDrive'));
    }

    return found;
  }

  // ---------------------------------------------------------------- Einrichten

  /** Erster PC: legt einen Raum an und liefert den Code für die anderen. */
  async create({ folder }) {
    if (this.isEnabled()) throw new Error(t('Dieser PC ist bereits mit einem Sync-Raum verbunden.'));
    this.assertFolder(folder);

    const secret = crypto.randomBytes(SECRET_BYTES);
    const spaceId = spaceIdFor(secret);
    const root = path.join(folder, ROOT_NAME, spaceId);
    for (const sub of ['changes', 'snapshots', 'devices']) fs.mkdirSync(path.join(root, sub), { recursive: true });

    const key = deriveKey(secret, spaceId);
    writeAtomic(path.join(root, 'space.json'), JSON.stringify({
      app: 'Content Helper',
      hint: 'Verschlüsselter Abgleich zwischen PCs. Nicht von Hand ändern.', // i18n-ignore – steht in der Datei im Cloud-Ordner
      v: 1,
      spaceId,
      createdAt: now(),
      check: seal(key, { check: 'content-helper' }).toString('base64'),
    }, null, 2));

    this.key = key;
    this.keySpace = spaceId;
    this.saveConfig({
      enabled: true,
      folder,
      spaceId,
      secret: secret.toString('hex'),
      deviceId: crypto.randomBytes(6).toString('hex'),
      deviceName: os.hostname(),
      fetchHere: true,
      role: 'creator',
      lastApplied: {},
      tombstones: {},
      createdAt: now(),
      lastError: null,
    });

    this.writeSnapshot();
    this.heartbeat();
    this.start();
    return { code: encodeCode(secret), spaceId, path: root };
  }

  /** Weiterer PC: tritt mit dem Code bei und holt sich den Stand der anderen. */
  async join({ folder, code }) {
    if (this.isEnabled()) throw new Error(t('Dieser PC ist bereits mit einem Sync-Raum verbunden.'));
    this.assertFolder(folder);

    const secret = decodeCode(code);
    const spaceId = spaceIdFor(secret);
    const root = path.join(folder, ROOT_NAME, spaceId);
    const metaFile = path.join(root, 'space.json');

    if (!fs.existsSync(metaFile)) {
      throw new Error(t('In diesem Ordner gibt es keinen Sync-Raum zu diesem Code. Prüfe den Code – und ob der Cloud-Ordner auf diesem PC schon fertig synchronisiert ist.'));
    }

    const key = deriveKey(secret, spaceId);
    try {
      unseal(key, Buffer.from(JSON.parse(fs.readFileSync(metaFile, 'utf8')).check, 'base64'));
    } catch {
      throw new Error(t('Der Code passt nicht zu diesem Sync-Raum.'));
    }

    this.key = key;
    this.keySpace = spaceId;
    this.saveConfig({
      enabled: true,
      folder,
      spaceId,
      secret: secret.toString('hex'),
      deviceId: crypto.randomBytes(6).toString('hex'),
      deviceName: os.hostname(),
      // Abgeholt wird weiter auf dem ersten PC – umstellbar in der Ansicht.
      fetchHere: false,
      role: 'member',
      lastApplied: {},
      tombstones: {},
      joinedAt: now(),
      lastError: null,
    });

    const applied = await this.pull();
    // Was dieser PC schon vorher hatte, sollen die anderen auch bekommen.
    this.writeSnapshot();
    this.heartbeat();
    this.start();
    return { spaceId, applied, devices: this.listDevices().length };
  }

  assertFolder(folder) {
    if (!folder) throw new Error(t('Bitte einen Cloud-Ordner wählen.'));
    try {
      if (!fs.statSync(folder).isDirectory()) throw new Error();
      fs.accessSync(folder, fs.constants.W_OK);
    } catch {
      throw new Error(t('In diesen Ordner kann nicht geschrieben werden.'));
    }
  }

  showCode() {
    if (!this.isEnabled()) throw new Error(t('Dieser PC ist mit keinem Sync-Raum verbunden.'));
    return encodeCode(Buffer.from(this.config().secret, 'hex'));
  }

  setFetchHere(value) {
    this.saveConfig({ fetchHere: Boolean(value) });
    this.heartbeat();
  }

  /** Verlässt den Raum. Die Daten bleiben auf diesem PC, der Schlüssel wird vergessen. */
  leave() {
    this.stop();
    if (this.isEnabled()) {
      try {
        fs.rmSync(path.join(this.spacePath(), 'devices', `${this.config().deviceId}.json`), { force: true });
      } catch { /* egal */ }
    }
    this.outbox = [];
    this.persistOutbox();
    this.key = null;
    this.store.silently(() => this.store.saveSettings({ sync: { enabled: false, leftAt: now() } }));
  }

  // ---------------------------------------------------------------- Lokale Änderungen

  onLocalChange(change) {
    if (!this.isEnabled()) return;

    if (change.type === 'put' && SYNCED.includes(change.collection)) {
      this.enqueue({ op: 'put', c: change.collection, r: JSON.parse(JSON.stringify(change.record)) });
    } else if (change.type === 'delete' && SYNCED.includes(change.collection)) {
      this.rememberTombstone(change.collection, change.id, change.at);
      this.enqueue({ op: 'del', c: change.collection, id: change.id, at: change.at });
    } else if (change.type === 'settings') {
      this.maybeShareSettings(change.patch);
    } else if (change.type === 'bulk') {
      // Nach dem Einlesen einer Sicherung alles weitergeben.
      for (const collection of SYNCED) {
        for (const record of this.store.list(collection)) {
          this.enqueue({ op: 'put', c: collection, r: JSON.parse(JSON.stringify(record)) }, { deferFlush: true });
        }
      }
      this.scheduleFlush();
    }
  }

  enqueue(item, { deferFlush = false } = {}) {
    this.outbox.push(item);
    this.persistOutbox();
    if (!deferFlush) this.scheduleFlush();
  }

  scheduleFlush() {
    clearTimeout(this.timers.flush);
    this.timers.flush = setTimeout(() => this.flush(), FLUSH_DELAY_MS);
  }

  sharedSnapshot() {
    const settings = this.store.settings();
    const shared = {};
    for (const key of SHARED_KEYS) if (settings[key] !== undefined) shared[key] = settings[key];
    // Die Kanalliste ist kein Geheimnis und gehört allen PCs.
    shared.youtubeChannels = settings.connections?.youtubeChannels || [];
    return shared;
  }

  maybeShareSettings(patch) {
    if (!patch) return;
    const keys = Object.keys(patch);
    if (!keys.some((key) => SHARED_KEYS.includes(key) || key === 'connections')) return;

    const shared = this.sharedSnapshot();
    const json = JSON.stringify(shared);
    if (json === this.config().sharedJson) return;

    const at = now();
    this.saveConfig({ sharedJson: json, sharedAt: at });
    this.enqueue({ op: 'settings', at, v: shared });
  }

  tombstones() {
    return this.config().tombstones || {};
  }

  rememberTombstone(collection, id, at) {
    const limit = new Date(Date.now() - TOMBSTONE_KEEP_MS).toISOString();
    const next = {};
    for (const [key, value] of Object.entries(this.tombstones())) if (value > limit) next[key] = value;
    const key = `${collection}:${id}`;
    if (!next[key] || next[key] < at) next[key] = at;
    this.saveConfig({ tombstones: next });
  }

  loadOutbox() {
    try {
      const data = JSON.parse(fs.readFileSync(this.outboxFile, 'utf8'));
      return Array.isArray(data) ? data : [];
    } catch {
      return [];
    }
  }

  /** Noch nicht übertragene Änderungen überleben einen Neustart. */
  persistOutbox() {
    try {
      fs.writeFileSync(this.outboxFile, JSON.stringify(this.outbox), 'utf8');
    } catch { /* beim nächsten Mal */ }
  }

  // ---------------------------------------------------------------- Senden

  /** Schreibt alle offenen Änderungen als eine verschlüsselte Datei. */
  flush() {
    clearTimeout(this.timers.flush);
    this.timers.flush = null;
    if (!this.isEnabled() || !this.outbox.length) return 0;

    const config = this.config();
    const dir = path.join(this.spacePath(), 'changes', config.deviceId);
    const batch = this.outbox.slice();
    const name = `${Date.now().toString(36).padStart(10, '0')}-${String(this.seq++).padStart(5, '0')}.chg`;

    if (!this.reachable()) {
      this.fail(new Error(t('Der Sync-Ordner ist gerade nicht erreichbar. Deine Änderungen bleiben gespeichert und gehen raus, sobald er wieder da ist.')));
      return 0;
    }

    try {
      fs.mkdirSync(dir, { recursive: true });
      writeAtomic(path.join(dir, name), seal(this.keyFor(), { device: config.deviceId, at: now(), changes: batch }));
    } catch (error) {
      this.fail(new Error(t('Änderungen konnten nicht in den Sync-Ordner geschrieben werden ({reason}). Sie bleiben gespeichert und gehen beim nächsten Versuch raus.', { reason: error.code || error.message })));
      return 0;
    }

    this.outbox.splice(0, batch.length);
    this.persistOutbox();
    this.saveConfig({ lastPush: now(), lastMarker: name, lastError: null });
    return batch.length;
  }

  // ---------------------------------------------------------------- Empfangen

  /** Liest, was die anderen PCs geschrieben haben, und übernimmt es. */
  async pull() {
    if (!this.isEnabled()) return 0;
    const root = this.spacePath();
    if (!this.reachable()) {
      this.fail(new Error(t('Der Sync-Ordner ist gerade nicht erreichbar. Läuft OneDrive, Dropbox oder Google Drive auf diesem PC?')));
      return 0;
    }

    const key = this.keyFor();
    const me = this.config().deviceId;
    const markers = { ...(this.config().lastApplied || {}) };
    let applied = 0;

    const devices = new Set(readdir(path.join(root, 'changes')).filter((entry) => entry !== me && !entry.startsWith('~')));
    for (const file of readdir(path.join(root, 'snapshots'))) {
      if (file.endsWith('.snap') && !file.startsWith('~') && file !== `${me}.snap`) devices.add(file.slice(0, -5));
    }

    for (const device of devices) {
      // Schnappschuss: für neue PCs der Einstieg, für lange abwesende der Wiedereinstieg.
      const snapFile = path.join(root, 'snapshots', `${device}.snap`);
      if (fs.existsSync(snapFile)) {
        let snap = null;
        try {
          snap = unseal(key, fs.readFileSync(snapFile));
        } catch {
          continue; // noch nicht fertig heruntergeladen – nächster Durchlauf
        }
        if (markers[device] === undefined || (snap.marker && snap.marker > (markers[device] || ''))) {
          applied += this.applySnapshot(snap);
          markers[device] = snap.marker || markers[device] || '';
        }
      }

      const dir = path.join(root, 'changes', device);
      const files = readdir(dir).filter((file) => file.endsWith('.chg') && !file.startsWith('~')).sort();
      for (const file of files) {
        if (markers[device] && file <= markers[device]) continue;
        let batch;
        try {
          batch = unseal(key, fs.readFileSync(path.join(dir, file)));
        } catch {
          // Unvollständig oder beschädigt: nicht überspringen, sonst ginge die
          // Änderung verloren – beim nächsten Durchlauf erneut versuchen.
          break;
        }
        applied += this.applyBatch(batch.changes || []);
        markers[device] = file;
      }
    }

    this.saveConfig({ lastApplied: markers, lastPull: now(), lastError: null });
    if (applied) this.notify(applied);
    return applied;
  }

  applyBatch(changes) {
    return this.store.silently(() => {
      let count = 0;
      for (const change of changes) {
        if (change.op === 'put') count += this.applyPut(change.c, change.r);
        else if (change.op === 'del') count += this.applyDelete(change.c, change.id, change.at);
        else if (change.op === 'settings') count += this.applyShared(change.at, change.v);
      }
      return count;
    });
  }

  applyPut(collection, record) {
    if (!SYNCED.includes(collection) || !record?.id) return 0;

    const tomb = this.tombstones()[`${collection}:${record.id}`];
    if (tomb && tomb >= (record.updatedAt || '')) return 0;

    const local = this.store.get(collection, record.id);
    if (local && !isNewer(record, local)) return 0;

    // Dieselbe Sache auf zwei PCs unabhängig angelegt (z. B. dasselbe Video,
    // bevor beide gekoppelt waren). Alle PCs behalten die kleinere Kennung –
    // so kommen sie ohne Absprache zum selben Ergebnis.
    if (!local && record.externalId) {
      const twin = this.store.list(collection).find((entry) => entry.externalId === record.externalId && entry.id !== record.id);
      if (twin) {
        if (twin.id < record.id) return 0;
        const at = now();
        this.store.deleteRaw(collection, twin.id);
        this.rememberTombstone(collection, twin.id, at);
        this.enqueue({ op: 'del', c: collection, id: twin.id, at });
      }
    }

    this.store.putRaw(collection, record);
    return 1;
  }

  applyDelete(collection, id, at) {
    if (!SYNCED.includes(collection)) return 0;
    this.rememberTombstone(collection, id, at);
    const local = this.store.get(collection, id);
    if (!local) return 0;
    // Nach dem Löschen woanders noch bearbeitet: die Bearbeitung gewinnt.
    if ((local.updatedAt || '') > at) return 0;
    this.store.deleteRaw(collection, id);
    return 1;
  }

  applyShared(at, value) {
    if (!value || (this.config().sharedAt && at <= this.config().sharedAt)) return 0;
    const patch = {};
    for (const key of SHARED_KEYS) if (value[key] !== undefined) patch[key] = value[key];
    if (Array.isArray(value.youtubeChannels)) {
      patch.connections = { ...(this.store.settings().connections || {}), youtubeChannels: value.youtubeChannels };
    }
    this.store.silently(() => this.store.saveSettings(patch));
    this.saveConfig({ sharedAt: at, sharedJson: JSON.stringify(this.sharedSnapshot()) });
    return 1;
  }

  applySnapshot(snap) {
    return this.store.silently(() => {
      let count = 0;
      for (const [collection, records] of Object.entries(snap.collections || {})) {
        for (const record of records || []) count += this.applyPut(collection, record);
      }
      for (const [key, at] of Object.entries(snap.tombstones || {})) {
        const index = key.indexOf(':');
        count += this.applyDelete(key.slice(0, index), key.slice(index + 1), at);
      }
      if (snap.shared && snap.sharedAt) count += this.applyShared(snap.sharedAt, snap.shared);
      return count;
    });
  }

  // ---------------------------------------------------------------- Pflege

  /** Vollständiger Stand dieses PCs – Einstieg für neue und lange abwesende PCs. */
  writeSnapshot() {
    if (!this.isEnabled() || !this.reachable()) return false;
    const config = this.config();
    const snap = {
      device: config.deviceId,
      at: now(),
      marker: config.lastMarker || null,
      collections: {},
      tombstones: this.tombstones(),
      shared: this.sharedSnapshot(),
      sharedAt: config.sharedAt || config.createdAt || config.joinedAt || now(),
    };
    for (const collection of SYNCED) snap.collections[collection] = this.store.list(collection);

    try {
      const dir = path.join(this.spacePath(), 'snapshots');
      fs.mkdirSync(dir, { recursive: true });
      writeAtomic(path.join(dir, `${config.deviceId}.snap`), seal(this.keyFor(), snap));
    } catch (error) {
      this.fail(error);
      return false;
    }
    this.saveConfig({ lastSnapshotAt: now() });
    this.prune();
    return true;
  }

  /**
   * Räumt alte eigene Änderungsdateien weg, die im Schnappschuss enthalten sind.
   * Sicher, weil ein PC, der sie noch nicht kannte, über den Schnappschuss einsteigt.
   */
  prune() {
    const config = this.config();
    if (!config.lastMarker) return;
    const dir = path.join(this.spacePath(), 'changes', config.deviceId);
    const limit = Date.now() - PRUNE_AFTER_MS;
    for (const file of readdir(dir)) {
      if (!file.endsWith('.chg') || file > config.lastMarker) continue;
      try {
        if (fs.statSync(path.join(dir, file)).mtimeMs < limit) fs.unlinkSync(path.join(dir, file));
      } catch { /* egal */ }
    }
  }

  /** Meldet diesen PC im Raum an, damit die anderen ihn in der Liste sehen. */
  heartbeat() {
    if (!this.isEnabled() || !this.reachable()) return;
    const config = this.config();
    try {
      const dir = path.join(this.spacePath(), 'devices');
      fs.mkdirSync(dir, { recursive: true });
      writeAtomic(path.join(dir, `${config.deviceId}.json`), seal(this.keyFor(), {
        deviceId: config.deviceId,
        name: config.deviceName,
        lastSeen: now(),
        fetchHere: config.fetchHere !== false,
      }));
    } catch { /* nicht kritisch */ }
  }

  listDevices() {
    if (!this.isEnabled()) return [];
    const me = this.config().deviceId;
    const key = this.keyFor();
    const devices = [];
    for (const file of readdir(path.join(this.spacePath(), 'devices'))) {
      if (!file.endsWith('.json') || file.startsWith('~')) continue;
      try {
        const info = unseal(key, fs.readFileSync(path.join(this.spacePath(), 'devices', file)));
        devices.push({ ...info, self: info.deviceId === me });
      } catch { /* halb synchronisiert */ }
    }
    return devices.sort((a, b) => Number(b.self) - Number(a.self) || String(a.name).localeCompare(String(b.name)));
  }

  // ---------------------------------------------------------------- Takt

  start() {
    if (!this.isEnabled() || this.timers.pull) return;
    this.timers.first = setTimeout(() => this.syncNow().catch(() => {}), 3_000);
    this.timers.pull = setInterval(() => this.syncNow().catch(() => {}), PULL_MS);
    this.timers.heartbeat = setInterval(() => this.heartbeat(), HEARTBEAT_MS);
    this.timers.snapshot = setInterval(() => this.writeSnapshot(), SNAPSHOT_MS);
  }

  stop() {
    for (const timer of Object.values(this.timers)) {
      clearTimeout(timer);
      clearInterval(timer);
    }
    this.timers = {};
    // Beim Beenden noch rausschreiben, was offen ist.
    if (this.isEnabled() && this.outbox.length) this.flush();
  }

  async syncNow() {
    if (this.busy || !this.isEnabled()) return { pushed: 0, pulled: 0 };
    this.busy = true;
    try {
      const pushed = this.flush();
      const pulled = await this.pull();
      const last = this.config().lastSnapshotAt;
      if (!last || Date.now() - new Date(last).getTime() > SNAPSHOT_MS) this.writeSnapshot();
      return { pushed, pulled };
    } finally {
      this.busy = false;
    }
  }

  fail(error) {
    this.saveConfig({ lastError: error.message || String(error) });
  }

  notify(applied) {
    const win = this.getWindow();
    if (win && !win.isDestroyed()) win.webContents.send('sync:changed', { applied });
  }

  status() {
    const config = this.config();
    const enabled = this.isEnabled();
    return {
      enabled,
      folder: enabled ? config.folder : null,
      spaceId: enabled ? config.spaceId : null,
      deviceId: config.deviceId || null,
      deviceName: config.deviceName || os.hostname(),
      role: config.role || null,
      fetchHere: config.fetchHere !== false,
      lastPush: config.lastPush || null,
      lastPull: config.lastPull || null,
      pending: this.outbox.length,
      lastError: config.lastError || null,
      devices: enabled ? this.listDevices() : [],
    };
  }
}

module.exports = { CloudSync, encodeCode, decodeCode, spaceIdFor, seal, unseal, deriveKey, SYNCED, SHARED_KEYS, ROOT_NAME };
