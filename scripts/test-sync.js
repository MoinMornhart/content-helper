'use strict';

/**
 * Test des Abgleichs zwischen mehreren PCs.
 *
 * Simuliert mehrere PCs mit je einem eigenen Datenordner, die sich einen
 * gemeinsamen „Cloud-Ordner“ teilen – so, wie es OneDrive oder Dropbox tun
 * würden, nur ohne Verzögerung. Geprüft wird, dass Änderungen in beide
 * Richtungen ankommen, dass die jüngere Änderung gewinnt, dass Löschungen nicht
 * wieder auftauchen, dass im Cloud-Ordner nichts im Klartext steht und dass
 * unvollständig übertragene Dateien nichts kaputtmachen.
 *
 *     node scripts/test-sync.js
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const { Store } = require('../src/main/store');
const { CloudSync, encodeCode, decodeCode, spaceIdFor, ROOT_NAME } = require('../src/main/sync/cloud-sync');
const { Connectors } = require('../src/main/connectors');

const results = [];
const check = (name, condition, detail = '') => {
  results.push({ name, ok: Boolean(condition) });
  process.stdout.write(`  ${condition ? 'ok  ' : 'FEHL'} ${name}${!condition && detail ? ` – ${detail}` : ''}\n`);
};

const temp = (label) => fs.mkdtempSync(path.join(os.tmpdir(), `content-helper-sync-${label}-`));
const cleanup = [];

/** Ein simulierter PC: eigener Datenordner, gemeinsamer Cloud-Ordner. */
function makePc(label) {
  const dir = temp(label);
  cleanup.push(dir);
  const store = new Store(dir);
  const sync = new CloudSync(store);
  return { store, sync, label };
}

/** Ein Abgleich-Durchlauf wie im Takt: senden, dann empfangen. */
async function exchange(...pcs) {
  for (const pc of pcs) pc.sync.flush();
  for (const pc of pcs) await pc.sync.pull();
}

(async () => {
  // ---------------------------------------------------------------- Code

  const secret = Buffer.from('0123456789abcdef01234567', 'hex');
  const code = encodeCode(secret);
  check('Code hat die erwartete Form', /^CH-[0-9A-Z]{5}-[0-9A-Z]{5}-[0-9A-Z]{5}-[0-9A-Z]{5}$/.test(code), code);
  check('Code lässt sich zurücklesen', decodeCode(code).equals(secret));
  check('Tippen ist nachsichtig', decodeCode(code.toLowerCase().replace(/-/g, ' ')).equals(secret));
  check('Verwechselbare Zeichen werden korrigiert', decodeCode(code.replace(/1/g, 'I').replace(/0/g, 'O')).equals(secret));
  let rejected = false;
  try { decodeCode('CH-KAPUTT'); } catch { rejected = true; }
  check('Unsinn wird abgelehnt', rejected);
  check('Raum-Kennung ist fest', spaceIdFor(secret) === spaceIdFor(Buffer.from(secret)));
  check('Anderer Code, anderer Raum', spaceIdFor(secret) !== spaceIdFor(Buffer.from('ff23456789abcdef01234567', 'hex')));

  // ---------------------------------------------------------------- Einrichten

  const cloud = temp('cloud');
  cleanup.push(cloud);

  const a = makePc('a');
  const b = makePc('b');

  a.store.insert('posts', { title: 'Vor dem Koppeln auf A', body: 'geheimer Entwurfstext', status: 'draft' });
  b.store.insert('ideas', { title: 'Idee, die B schon vorher hatte', status: 'inbox', score: 3 });

  const created = await a.sync.create({ folder: cloud });
  a.sync.stop();
  const root = path.join(cloud, ROOT_NAME, created.spaceId);

  check('Raum wird angelegt', fs.existsSync(path.join(root, 'space.json')));
  check('Schnappschuss des ersten PCs liegt bereit', fs.existsSync(path.join(root, 'snapshots', `${a.store.settings().sync.deviceId}.snap`)));
  check('Erster PC holt die Verbindungen ab', a.sync.shouldFetchConnections() === true);

  let wrongCode = null;
  try {
    await b.sync.join({ folder: cloud, code: encodeCode(Buffer.alloc(12, 7)) });
  } catch (error) {
    wrongCode = error.message;
  }
  check('Falscher Code wird abgelehnt', /keinen Sync-Raum/.test(wrongCode || ''), wrongCode);
  check('Nach Ablehnung nicht verbunden', b.sync.isEnabled() === false);

  const joined = await b.sync.join({ folder: cloud, code: created.code.toLowerCase() });
  b.sync.stop();
  check('Beitritt mit dem richtigen Code', b.sync.isEnabled() && joined.applied >= 1, JSON.stringify(joined));
  check('Beigetretener PC hat die Daten des ersten', b.store.list('posts').some((post) => post.title === 'Vor dem Koppeln auf A'));
  check('Weiterer PC holt nicht selbst ab', b.sync.shouldFetchConnections() === false);

  await exchange(a, b);
  check('Was B vorher hatte, kommt bei A an', a.store.list('ideas').some((idea) => idea.title === 'Idee, die B schon vorher hatte'));

  // ---------------------------------------------------------------- Hin und her

  const post = a.store.insert('posts', { title: 'Neuer Beitrag auf A', status: 'scheduled' });
  await exchange(a, b);
  check('Neuer Eintrag kommt an', b.store.get('posts', post.id)?.title === 'Neuer Beitrag auf A');
  check('Mit derselben Kennung', b.store.list('posts').filter((entry) => entry.title === 'Neuer Beitrag auf A').length === 1);

  b.store.update('posts', post.id, { title: 'Auf B überarbeitet' });
  await exchange(b, a);
  check('Änderung läuft zurück', a.store.get('posts', post.id)?.title === 'Auf B überarbeitet');

  // Gleichzeitige Bearbeitung: die spätere gewinnt – auf beiden PCs.
  a.store.update('posts', post.id, { title: 'Fassung A' });
  await new Promise((resolve) => setTimeout(resolve, 5));
  b.store.update('posts', post.id, { title: 'Fassung B, später' });
  await exchange(a, b);
  await exchange(a, b);
  check('Spätere Bearbeitung gewinnt auf A', a.store.get('posts', post.id)?.title === 'Fassung B, später', a.store.get('posts', post.id)?.title);
  check('… und auf B', b.store.get('posts', post.id)?.title === 'Fassung B, später');

  // Löschen
  const doomed = a.store.insert('ideas', { title: 'Wird gelöscht', status: 'inbox' });
  await exchange(a, b);
  b.store.remove('ideas', doomed.id);
  await exchange(b, a);
  check('Löschen kommt an', !a.store.get('ideas', doomed.id));

  // Der alte Stand im Schnappschuss darf Gelöschtes nicht zurückbringen.
  a.sync.writeSnapshot();
  await exchange(a, b);
  check('Gelöschtes kehrt nicht zurück', !b.store.get('ideas', doomed.id));

  // Nach dem Löschen woanders noch bearbeitet: die Bearbeitung gewinnt.
  const disputed = a.store.insert('ideas', { title: 'Umstritten', status: 'inbox' });
  await exchange(a, b);
  a.store.remove('ideas', disputed.id);
  await new Promise((resolve) => setTimeout(resolve, 5));
  b.store.update('ideas', disputed.id, { title: 'Umstritten, aber weiter bearbeitet' });
  await exchange(a, b);
  check('Spätere Bearbeitung schlägt früheres Löschen', b.store.get('ideas', disputed.id)?.title === 'Umstritten, aber weiter bearbeitet');

  // ---------------------------------------------------------------- Einstellungen

  a.store.saveSettings({ weeklyGoal: { posts: 9, ideas: 4, streams: 2 } });
  a.store.saveSettings({ theme: 'light', appearance: { background: 'forest', dim: 30 } });
  await exchange(a, b);
  check('Gemeinsame Einstellungen kommen an', b.store.settings().weeklyGoal?.posts === 9, JSON.stringify(b.store.settings().weeklyGoal));
  check('Aussehen bleibt je PC', b.store.settings().theme !== 'light' && b.store.settings().appearance?.background !== 'forest');

  a.store.saveSettings({ connections: { ...(a.store.settings().connections || {}), youtubeChannels: [{ channelId: 'UCgemeinsamgemeinsamgeme', name: 'Gemeinsamer Kanal' }] } });
  await exchange(a, b);
  check('YouTube-Kanalliste kommt an', b.store.settings().connections?.youtubeChannels?.[0]?.name === 'Gemeinsamer Kanal');

  // ---------------------------------------------------------------- Verbindungen

  const connectorsB = new Connectors(b.store, () => null);
  const skipped = await connectorsB.syncAll();
  check('Nicht abholender PC gleicht nicht selbst ab', skipped.skipped === true, JSON.stringify(skipped));
  let blocked = null;
  try { connectorsB.assertFetchesHere(); } catch (error) { blocked = error.message; }
  check('Manueller Abgleich wird dort erklärt statt ausgeführt', /anderen deiner PCs/.test(blocked || ''), blocked);
  check('Abholender PC darf abgleichen', new Connectors(a.store, () => null).fetchesHere() === true);

  // Dasselbe Video auf beiden PCs unabhängig angelegt: am Ende genau eins.
  a.store.insert('analytics', { externalId: 'youtube:video:doppelt0001', platformId: 'youtube', date: '2026-09-01', title: 'Doppelt', metrics: { views: 10 } });
  b.store.insert('analytics', { externalId: 'youtube:video:doppelt0001', platformId: 'youtube', date: '2026-09-01', title: 'Doppelt', metrics: { views: 12 } });
  await exchange(a, b);
  await exchange(a, b);
  const twinsA = a.store.list('analytics').filter((entry) => entry.externalId === 'youtube:video:doppelt0001');
  const twinsB = b.store.list('analytics').filter((entry) => entry.externalId === 'youtube:video:doppelt0001');
  check('Doppelt Angelegtes wird zu einem', twinsA.length === 1 && twinsB.length === 1, `${twinsA.length}/${twinsB.length}`);
  check('Beide behalten denselben', twinsA[0]?.id === twinsB[0]?.id);

  // ---------------------------------------------------------------- Sicherheit und Robustheit

  const everything = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else everything.push(full);
    }
  };
  walk(root);
  const leaked = everything.filter((file) => {
    const text = fs.readFileSync(file).toString('latin1');
    return text.includes('geheimer Entwurfstext') || text.includes('Auf B überarbeitet') || text.includes('Gemeinsamer Kanal');
  });
  check('Im Cloud-Ordner steht nichts im Klartext', leaked.length === 0, leaked.join(', '));
  check('Der Code steht nirgends im Cloud-Ordner', !everything.some((file) => fs.readFileSync(file).toString('latin1').includes(created.code)));

  // Eine halb heruntergeladene Datei darf nichts kaputtmachen und nicht übersprungen werden.
  const deviceA = a.store.settings().sync.deviceId;
  const brokenName = `${Date.now().toString(36).padStart(10, '0')}-99999.chg`;
  const brokenFile = path.join(root, 'changes', deviceA, brokenName);
  fs.writeFileSync(brokenFile, Buffer.from([1, 2, 3, 4, 5]));
  const beforeMarker = b.store.settings().sync.lastApplied[deviceA];
  let crashed = false;
  try { await b.sync.pull(); } catch { crashed = true; }
  check('Unvollständige Datei bringt nichts zum Absturz', !crashed);
  check('… und wird nicht übersprungen', b.store.settings().sync.lastApplied[deviceA] === beforeMarker);
  fs.unlinkSync(brokenFile);

  // Nicht erreichbarer Ordner: Änderungen bleiben und gehen später raus.
  const realFolder = a.store.settings().sync.folder;
  a.store.silently(() => a.store.saveSettings({ sync: { ...a.store.settings().sync, folder: path.join(cloud, 'gibt-es-nicht') } }));
  a.store.insert('ideas', { title: 'Geschrieben ohne Verbindung', status: 'inbox' });
  const sentOffline = a.sync.flush();
  check('Ohne Ordner wird nichts verloren', sentOffline === 0 && a.sync.outbox.length > 0);
  check('… und der Grund wird gemeldet', Boolean(a.store.settings().sync.lastError));
  a.store.silently(() => a.store.saveSettings({ sync: { ...a.store.settings().sync, folder: realFolder } }));
  await exchange(a, b);
  check('Sobald er wieder da ist, geht es raus', b.store.list('ideas').some((idea) => idea.title === 'Geschrieben ohne Verbindung'));

  // ---------------------------------------------------------------- Dritter PC, später

  const c = makePc('c');
  await c.sync.join({ folder: cloud, code: created.code });
  c.sync.stop();
  check('Später dazukommender PC bekommt alles', c.store.get('posts', post.id)?.title === 'Fassung B, später');
  check('… auch das von B', c.store.list('ideas').some((idea) => idea.title === 'Idee, die B schon vorher hatte'));
  check('… aber nichts Gelöschtes', !c.store.get('ideas', doomed.id));
  check('Alle drei PCs sind gelistet', c.sync.listDevices().length === 3, String(c.sync.listDevices().length));

  // ---------------------------------------------------------------- Trennen

  b.sync.leave();
  check('Trennen beendet den Abgleich', b.sync.isEnabled() === false);
  check('Der Schlüssel wird vergessen', !b.store.settings().sync?.secret);
  check('Die Daten bleiben', b.store.get('posts', post.id) !== null);

  // ---------------------------------------------------------------- Abschluss

  for (const pc of [a, b, c]) {
    pc.sync.stop();
    pc.store.flush();
  }
  for (const dir of cleanup) {
    try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 }); } catch { /* egal */ }
  }

  const failed = results.filter((result) => !result.ok);
  if (failed.length) {
    process.stdout.write(`\nFEHLGESCHLAGEN – ${failed.length} von ${results.length} Prüfungen.\n`);
    process.exit(1);
  }
  process.stdout.write(`\nAlle ${results.length} Prüfungen bestanden.\n`);
  process.exit(0);
})().catch((error) => {
  process.stdout.write(`\nAbbruch: ${error.stack}\n`);
  process.exit(1);
});
