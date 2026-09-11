'use strict';

/**
 * Test des automatischen Veröffentlichens – ohne Netz.
 *
 * Die Plattformen werden durch Attrappen ersetzt, die Uhr durch eine Variable.
 * Geprüft wird, was für alle Plattformen gleich gelten muss: zur richtigen Zeit,
 * nie doppelt, nach Fehlern erneut, abgebrochene Uploads fortsetzen, bei
 * mehreren PCs nur einer.
 *
 *     node scripts/test-publish.js
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const { Store } = require('../src/main/store');
const { Publisher, PermanentError, RETRY_DELAYS_MS } = require('../src/main/publish/publisher');

const results = [];
const check = (name, condition, detail = '') => {
  results.push({ name, ok: Boolean(condition) });
  process.stdout.write(`  ${condition ? 'ok  ' : 'FEHL'} ${name}${!condition && detail ? ` – ${detail}` : ''}\n`);
};

const MIN = 60_000;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'content-helper-publish-'));
const video = path.join(dir, 'clip.mp4');
fs.writeFileSync(video, Buffer.alloc(4096, 1));

/** Attrappe einer Plattform: zählt Aufrufe, kann auf Befehl scheitern. */
function fakeProvider(id, platformIds, extra = {}) {
  return {
    id,
    name: id,
    platformIds,
    connected: true,
    calls: [],
    failWith: [],
    isConnected() { return this.connected; },
    async publish(job) {
      this.calls.push(job);
      job.onProgress(0.5);
      const failure = this.failWith.shift();
      if (failure) throw failure;
      return job.scheduledFor
        ? { state: 'scheduled', remoteId: `${id}-${this.calls.length}`, url: `https://${id}.example/${this.calls.length}` }
        : { state: 'published', remoteId: `${id}-${this.calls.length}`, url: `https://${id}.example/${this.calls.length}` };
    },
    ...extra,
  };
}

(async () => {
  const store = new Store(dir);
  let now = Date.parse('2026-09-12T10:00:00.000Z');
  let primary = true;
  const notices = [];

  const youtube = fakeProvider('youtube', ['youtube', 'youtube_shorts'], {
    nativeSchedule: true,
    minLeadMs: 15 * MIN,
    rescheduled: [],
    cancelled: [],
    async reschedule(args) { this.rescheduled.push(args); },
    async cancel(args) { this.cancelled.push(args); },
  });
  const tiktok = fakeProvider('tiktok', ['tiktok']);

  const publisher = new Publisher(store, () => null, {
    isPrimary: () => primary,
    now: () => now,
    notify: (title, body) => notices.push(`${title}: ${body}`),
  });
  publisher.register(youtube).register(tiktok);

  const media = store.insert('media', { name: 'clip.mp4', filePath: video, ext: 'mp4', size: 4096 });
  const at = (minutes) => new Date(now + minutes * MIN).toISOString();
  const plan = (patch) => store.insert('posts', {
    title: 'Testvideo',
    body: 'Beschreibung',
    hashtags: ['minecraft', '#gaming'],
    platforms: ['tiktok'],
    mediaIds: [media.id],
    status: 'scheduled',
    ...patch,
  });

  // ---------------------------------------------------------------- Ziele

  const mixed = plan({ platforms: ['youtube', 'tiktok', 'discord'], scheduledAt: at(600) });
  check('Kanäle mit Anmeldung gehen automatisch', publisher.automaticTargets(mixed).join() === 'youtube,tiktok');
  check('Der Rest bleibt Handarbeit', publisher.manualTargets(mixed).join() === 'discord');
  store.remove('posts', mixed.id);

  // ---------------------------------------------------------------- Zur richtigen Zeit

  const post = plan({ scheduledAt: at(30) });
  await publisher.tick();
  check('Vor dem Termin passiert nichts', tiktok.calls.length === 0);

  now += 31 * MIN;
  await publisher.tick();
  check('Zum Termin wird veröffentlicht', tiktok.calls.length === 1);
  check('Mit Titel, Text und Hashtags', tiktok.calls[0].title === 'Testvideo' && tiktok.calls[0].text === 'Beschreibung\n\n#minecraft #gaming', JSON.stringify(tiktok.calls[0].text));
  check('Mit der Videodatei', tiktok.calls[0].video?.path === video && tiktok.calls[0].video.size === 4096);
  let saved = store.get('posts', post.id);
  check('Zustand je Plattform festgehalten', saved.delivery.tiktok.state === 'published' && saved.delivery.tiktok.url === 'https://tiktok.example/1');
  check('Beitrag gilt als veröffentlicht', saved.status === 'published' && Boolean(saved.publishedAt));
  check('Meldung an den Nutzer', notices.some((line) => line.startsWith('Veröffentlicht: Testvideo')));
  check('Im Verlauf vermerkt', store.list('activity').some((entry) => entry.type === 'published' && entry.postId === post.id));

  await publisher.tick();
  now += 60 * MIN;
  await publisher.tick();
  check('Nie doppelt', tiktok.calls.length === 1, String(tiktok.calls.length));

  // ---------------------------------------------------------------- Plattform plant selbst

  const early = plan({ platforms: ['youtube'], scheduledAt: at(180) });
  await publisher.tick();
  check('YouTube lädt sofort hoch', youtube.calls.length === 1);
  check('… mit dem Termin für die Freischaltung', youtube.calls[0].scheduledFor === early.scheduledAt);
  saved = store.get('posts', early.id);
  check('Zustand „hochgeladen, geht zum Termin live“', saved.delivery.youtube.state === 'scheduled' && saved.status === 'scheduled');

  const moved = at(240);
  store.update('posts', early.id, { scheduledAt: moved });
  await publisher.tick();
  check('Verschobener Termin wird übertragen', youtube.rescheduled.length === 1 && youtube.rescheduled[0].scheduledFor === moved);
  check('Kein zweiter Upload beim Verschieben', youtube.calls.length === 1);

  now += 241 * MIN;
  await publisher.tick();
  saved = store.get('posts', early.id);
  check('Nach dem Termin als veröffentlicht vermerkt', saved.delivery.youtube.state === 'published' && saved.status === 'published');

  const withdrawn = plan({ platforms: ['youtube'], scheduledAt: at(120) });
  await publisher.tick();
  store.update('posts', withdrawn.id, { scheduledAt: null, status: 'ready' });
  await publisher.tick();
  await new Promise((resolve) => setTimeout(resolve, 20));
  check('Zurückgenommener Termin wird bei der Plattform zurückgezogen', youtube.cancelled.length === 1);
  check('… und so vermerkt', store.get('posts', withdrawn.id).delivery.youtube.state === 'cancelled');

  const tooSoon = plan({ platforms: ['youtube'], scheduledAt: at(5) });
  const before = youtube.calls.length;
  await publisher.tick();
  check('Zu knapp für die Plattform-Planung: warten bis zum Termin', youtube.calls.length === before);
  now += 6 * MIN;
  await publisher.tick();
  check('… dann direkt öffentlich', youtube.calls.length === before + 1 && youtube.calls.at(-1).scheduledFor === null);
  check('… und veröffentlicht', store.get('posts', tooSoon.id).status === 'published');

  // ---------------------------------------------------------------- Fehler

  const flaky = plan({ scheduledAt: at(1) });
  tiktok.failWith.push(new Error('Keine Verbindung zum Internet.'));
  now += 2 * MIN;
  await publisher.tick();
  saved = store.get('posts', flaky.id);
  check('Netzfehler: neuer Versuch geplant', saved.delivery.tiktok.state === 'retry' && Boolean(saved.delivery.tiktok.nextTryAt));
  check('… mit Begründung', saved.delivery.tiktok.message === 'Keine Verbindung zum Internet.');

  const callsAfterFail = tiktok.calls.length;
  await publisher.tick();
  check('Nicht sofort erneut', tiktok.calls.length === callsAfterFail);

  now += RETRY_DELAYS_MS[0] + 1000;
  await publisher.tick();
  check('Nach der Wartezeit erneut – und geklappt', store.get('posts', flaky.id).delivery.tiktok.state === 'published');

  // Fortsetzen: Der Anbieter merkt sich die Upload-Sitzung, der nächste Versuch bekommt sie.
  const resumable = plan({ scheduledAt: at(1) });
  const resumeProvider = tiktok.publish;
  let sessionSeen = null;
  let round = 0;
  tiktok.publish = async function publish(job) {
    round += 1;
    if (round === 1) {
      job.saveSession({ uploadUrl: 'https://upload.example/abc', offset: 2048 });
      throw new Error('Die Verbindung ist beim Hochladen stehen geblieben.');
    }
    sessionSeen = job.session;
    return resumeProvider.call(this, job);
  };
  now += 2 * MIN;
  await publisher.tick();
  now += RETRY_DELAYS_MS[0] + 1000;
  await publisher.tick();
  check('Abgebrochener Upload wird an derselben Stelle fortgesetzt', sessionSeen?.offset === 2048, JSON.stringify(sessionSeen));
  check('Sitzung danach aufgeräumt', store.get('posts', resumable.id).delivery.tiktok.session === null);
  tiktok.publish = resumeProvider;

  const broken = plan({ scheduledAt: at(1) });
  tiktok.failWith.push(new PermanentError('Die Anmeldung bei TikTok wurde zurückgezogen.'));
  now += 2 * MIN;
  await publisher.tick();
  saved = store.get('posts', broken.id);
  check('Dauerhafter Fehler: kein weiterer Versuch', saved.delivery.tiktok.state === 'failed');
  check('Beitrag steht auf „Fehlgeschlagen“', saved.status === 'failed');
  check('Der Nutzer erfährt es', notices.some((line) => line.includes('zurückgezogen')));

  publisher.retry(broken.id);
  saved = store.get('posts', broken.id);
  check('„Erneut versuchen“ setzt zurück', saved.delivery.tiktok.state === 'waiting' && saved.status === 'scheduled');
  await publisher.tick();
  check('… und veröffentlicht dann', store.get('posts', broken.id).status === 'published');

  const stubborn = plan({ scheduledAt: at(1) });
  for (let i = 0; i <= RETRY_DELAYS_MS.length; i += 1) tiktok.failWith.push(new Error('Server überlastet'));
  now += 2 * MIN;
  for (let i = 0; i <= RETRY_DELAYS_MS.length + 1; i += 1) {
    await publisher.tick();
    now += 61 * MIN;
  }
  check('Nach allen Versuchen wird aufgegeben', store.get('posts', stubborn.id).delivery.tiktok.state === 'failed');
  tiktok.failWith.length = 0;

  const missingFile = path.join(dir, 'weg.mp4');
  fs.writeFileSync(missingFile, 'x');
  const gone = store.insert('media', { name: 'weg.mp4', filePath: missingFile, ext: 'mp4' });
  fs.unlinkSync(missingFile);
  const orphan = plan({ mediaIds: [gone.id], scheduledAt: at(1) });
  now += 2 * MIN;
  await publisher.tick();
  saved = store.get('posts', orphan.id);
  check('Fehlende Videodatei: sofort klare Meldung', saved.delivery.tiktok.state === 'failed' && /nicht mehr da/.test(saved.delivery.tiktok.message));

  // ---------------------------------------------------------------- Sonderfälle

  const stale = plan({ scheduledAt: at(-26 * 60) });
  await publisher.tick();
  saved = store.get('posts', stale.id);
  check('Über einen Tag verpasst: nicht stillschweigend nachholen', saved.delivery.tiktok.state === 'failed' && /über einen Tag/.test(saved.delivery.tiktok.message));

  const half = plan({ platforms: ['tiktok', 'discord'], scheduledAt: at(1) });
  now += 2 * MIN;
  await publisher.tick();
  saved = store.get('posts', half.id);
  check('Gemischt: automatischer Teil geht raus', saved.delivery.tiktok.state === 'published');
  check('… Beitrag bleibt offen, bis der Rest erledigt ist', saved.status !== 'published');

  primary = false;
  const elsewhere = plan({ scheduledAt: at(1) });
  now += 2 * MIN;
  const callsBefore = tiktok.calls.length;
  await publisher.tick();
  check('Nicht der veröffentlichende PC: nichts passiert', tiktok.calls.length === callsBefore && !store.get('posts', elsewhere.id).delivery);
  primary = true;
  await publisher.tick();
  check('Der veröffentlichende PC übernimmt', store.get('posts', elsewhere.id).delivery?.tiktok?.state === 'published');

  tiktok.connected = false;
  const offline = plan({ scheduledAt: at(1) });
  check('Ohne Anmeldung zählt der Kanal als Handarbeit', publisher.manualTargets(offline).includes('tiktok'));
  now += 2 * MIN;
  await publisher.tick();
  check('… und es wird nichts versucht', !store.get('posts', offline.id).delivery);
  tiktok.connected = true;

  const draft = store.insert('posts', { title: 'Sofort', platforms: ['tiktok'], mediaIds: [media.id], status: 'draft' });
  publisher.publishNow(draft.id);
  await new Promise((resolve) => setTimeout(resolve, 400));
  await publisher.tick();
  check('„Jetzt veröffentlichen“ ohne Termin', store.get('posts', draft.id).status === 'published');

  let refused = null;
  try { publisher.publishNow(store.insert('posts', { title: 'x', platforms: ['discord'], status: 'draft' }).id); } catch (error) { refused = error.message; }
  check('„Jetzt veröffentlichen“ ohne passende Anmeldung wird erklärt', /keinen der gewählten Kanäle/.test(refused || ''), refused);

  // ---------------------------------------------------------------- Abschluss

  store.flush();
  try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 }); } catch { /* egal */ }

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
