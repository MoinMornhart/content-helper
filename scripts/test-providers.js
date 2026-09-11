'use strict';

/**
 * Test der Plattform-Anbindungen fürs Veröffentlichen – ohne Netz.
 *
 * Statt YouTube, TikTok & Co. antwortet eine Attrappe, die jede Anfrage
 * mitschreibt. Geprüft wird die Reihenfolge der Schritte, die Blockaufteilung,
 * die Kopfzeilen und dass Fehler richtig eingeordnet werden (erneut versuchen
 * oder aufgeben). Ob die echten Plattformen so antworten, wie ihre Dokumentation
 * sagt, kann nur ein Test mit echten Konten zeigen.
 *
 *     node scripts/test-providers.js
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const { Store } = require('../src/main/store');
const { saveManual } = require('../src/main/publish/credentials');
const { probe } = require('../src/main/publish/media-info');
const { YouTubePublisher, rangeEnd } = require('../src/main/publish/providers/youtube');
const { TikTokPublisher, chunkPlan } = require('../src/main/publish/providers/tiktok');
const { MetaAuth, InstagramPublisher, FacebookPublisher, metaError } = require('../src/main/publish/providers/meta');
const { LinkedInPublisher, littleText } = require('../src/main/publish/providers/linkedin');
const { XPublisher, SEGMENT } = require('../src/main/publish/providers/x');
const { pkcePair } = require('../src/main/publish/oauth');
const { detectKeys } = require('../src/main/publish/key-detect');

const results = [];
const check = (name, condition, detail = '') => {
  results.push({ name, ok: Boolean(condition) });
  process.stdout.write(`  ${condition ? 'ok  ' : 'FEHL'} ${name}${!condition && detail ? ` – ${detail}` : ''}\n`);
};
const section = (title) => process.stdout.write(`\n${title}\n`);

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'content-helper-providers-'));
const MB = 1024 * 1024;

/** Attrappe des HTTP-Helfers: schreibt mit, antwortet per Funktion. */
function fakeHttp(handler) {
  const calls = [];
  const answer = async (call) => {
    calls.push(call);
    const reply = (await handler(call, calls)) || { status: 200 };
    return { status: reply.status || 200, headers: reply.headers || {}, text: typeof reply.json === 'undefined' ? (reply.text || '') : JSON.stringify(reply.json) };
  };
  return {
    calls,
    request: (url, options = {}) => answer({ kind: 'request', url, method: options.method || 'GET', headers: options.headers || {}, body: options.body || null }),
    uploadFile: async (url, options) => {
      const size = fs.statSync(options.filePath).size;
      const start = options.start ?? 0;
      const end = options.end ?? size;
      options.onProgress?.(end - start);
      return answer({ kind: 'upload', url, method: options.method, headers: options.headers || {}, start, end, prefix: options.prefix || '', suffix: options.suffix || '' });
    },
  };
}

const noSleep = async () => {};
const store = new Store(dir);
saveManual(store, 'google', { clientId: 'g-id', clientSecret: 'g-secret' });
saveManual(store, 'tiktok', { clientKey: 't-key', clientSecret: 't-secret' });
saveManual(store, 'meta', { appId: 'm-id', appSecret: 'm-secret' });
saveManual(store, 'linkedin', { clientId: 'l-id', clientSecret: 'l-secret' });
saveManual(store, 'x', { clientId: 'x-id' });

function file(name, bytes) {
  const target = path.join(dir, name);
  const handle = fs.openSync(target, 'w');
  fs.ftruncateSync(handle, bytes);
  fs.closeSync(handle);
  return target;
}

/** Ein minimales MP4 mit Dauer und Bildgröße, wie Schnittprogramme es schreiben. */
function mp4(name, { seconds, width, height }) {
  const box = (type, ...parts) => {
    const body = Buffer.concat(parts);
    const head = Buffer.alloc(8);
    head.writeUInt32BE(body.length + 8, 0);
    head.write(type, 4, 'latin1');
    return Buffer.concat([head, body]);
  };
  const mvhd = Buffer.alloc(100);
  mvhd.writeUInt32BE(1000, 12);
  mvhd.writeUInt32BE(Math.round(seconds * 1000), 16);
  const tkhd = Buffer.alloc(84);
  tkhd.writeUInt32BE(width * 65536, 76);
  tkhd.writeUInt32BE(height * 65536, 80);
  const data = Buffer.concat([
    box('ftyp', Buffer.from('isom0000', 'latin1')),
    box('mdat', Buffer.alloc(2048, 7)),
    box('moov', box('mvhd', mvhd), box('trak', box('tkhd', tkhd))),
  ]);
  const target = path.join(dir, name);
  fs.writeFileSync(target, data);
  return target;
}

const job = (overrides = {}) => {
  const sessions = [];
  const progress = [];
  return {
    title: 'Minecraft Redstone einfach erklärt',
    body: 'Alles über Redstone.',
    text: 'Alles über Redstone.\n\n#minecraft #redstone',
    hashtags: ['minecraft', 'redstone'],
    options: {},
    scheduledFor: null,
    session: null,
    saveSession: (session) => sessions.push(session),
    onProgress: (share, state) => progress.push([share, state]),
    sessions,
    progress,
    ...overrides,
  };
};

(async () => {
  // ---------------------------------------------------------------- Grundlagen
  section('Grundlagen');

  const short = mp4('short.mp4', { seconds: 42.5, width: 1080, height: 1920 });
  const info = probe(short);
  check('Dauer aus dem MP4 gelesen', info.durationSec === 42.5, JSON.stringify(info));
  check('Bildgröße aus dem MP4 gelesen', info.width === 1080 && info.height === 1920);
  check('Kein MP4: keine Angaben, kein Absturz', probe(file('kaputt.mp4', 100)).durationSec === null);

  const plain = pkcePair();
  const hex = pkcePair({ hex: true });
  check('PKCE nach Standard (base64url)', /^[A-Za-z0-9_-]{43}$/.test(plain.challenge));
  check('PKCE für TikTok (hex)', /^[0-9a-f]{64}$/.test(hex.challenge));

  // ---------------------------------------------------------------- YouTube
  section('YouTube');

  const ytVideo = { path: file('yt.mp4', 600 * 1024), size: 600 * 1024, ext: 'mp4' };
  let http = fakeHttp((call) => {
    if (call.url.includes('oauth2.googleapis.com/token')) return { json: { access_token: 'yt-access', expires_in: 3600 } };
    if (call.url.includes('uploadType=resumable')) return { status: 200, headers: { location: 'https://upload.example/yt-session' } };
    if (call.kind === 'upload' && call.url === 'https://upload.example/yt-session') {
      return call.start === 0 ? { status: 308, headers: { range: 'bytes=0-262143' } } : { status: 201, json: { id: 'VIDEO123' } };
    }
    if (call.url.includes('thumbnails/set')) return { status: 403, json: { error: { message: 'Kanal nicht bestätigt' } } };
    return { status: 404 };
  });
  const youtube = new YouTubePublisher(store, { http, sleep: noSleep });
  youtube.tokens.save({ refreshToken: 'yt-refresh' });
  check('Mit Anmeldung verbunden', youtube.isConnected());

  let yt = job({ video: ytVideo, thumbnail: { path: file('thumb.jpg', 1000), ext: 'jpg' }, scheduledFor: '2026-09-20T16:00:00.000Z' });
  let result = await youtube.publish(yt);
  const init = http.calls.find((call) => call.url.includes('uploadType=resumable'));
  const initBody = JSON.parse(init.body);
  check('Merkmal wird vorher erneuert', http.calls[0].url.includes('oauth2.googleapis.com/token') && /refresh_token=yt-refresh/.test(http.calls[0].body));
  check('Upload-Sitzung mit Größe und Typ', init.headers['X-Upload-Content-Length'] === String(600 * 1024) && init.headers['X-Upload-Content-Type'] === 'video/mp4');
  check('Geplant: privat mit Veröffentlichungszeit', initBody.status.privacyStatus === 'private' && initBody.status.publishAt === '2026-09-20T16:00:00.000Z');
  check('Titel, Beschreibung und Schlagwörter', initBody.snippet.title === yt.title && initBody.snippet.description.includes('#minecraft') && initBody.snippet.tags.join() === 'minecraft,redstone');
  check('„Nicht für Kinder“ ausdrücklich gesetzt', initBody.status.selfDeclaredMadeForKids === false);
  const uploads = http.calls.filter((call) => call.kind === 'upload' && call.url.includes('yt-session'));
  check('Nach Teilannahme dort weiter, wo YouTube steht', uploads.length === 2 && uploads[1].start === 262144, uploads.map((u) => u.start).join());
  check('Richtige Content-Range', uploads[1].headers['Content-Range'] === `bytes 262144-${600 * 1024 - 1}/${600 * 1024}`);
  check('Sitzung für den Neustart gemerkt', yt.sessions[0]?.uploadUrl === 'https://upload.example/yt-session');
  check('Ergebnis: geplant, mit Link', result.state === 'scheduled' && result.url === 'https://youtu.be/VIDEO123');
  check('Thumbnail-Fehler bricht nichts ab, wird aber gesagt', /Thumbnail nicht/.test(result.message || ''), result.message);
  check('Range-Kopfzeile gelesen', rangeEnd('bytes=0-999') === 1000 && rangeEnd(undefined) === 0);

  // Fortsetzen nach Neustart
  http = fakeHttp((call) => {
    if (call.url.includes('oauth2.googleapis.com/token')) return { json: { access_token: 'a', expires_in: 3600 } };
    if (call.kind === 'request' && call.url === 'https://upload.example/old') return { status: 308, headers: { range: 'bytes=0-524287' } };
    if (call.kind === 'upload') return { status: 200, json: { id: 'RESUMED' } };
    return { status: 500 };
  });
  const youtube2 = new YouTubePublisher(store, { http, sleep: noSleep });
  result = await youtube2.publish(job({ video: ytVideo, session: { uploadUrl: 'https://upload.example/old' } }));
  check('Nach Neustart: erst nachfragen, keine neue Sitzung', !http.calls.some((call) => call.url.includes('uploadType=resumable')));
  check('… dann ab der gemeldeten Stelle', http.calls.find((call) => call.kind === 'upload')?.start === 524288);
  check('Ohne Termin: sofort öffentlich', result.state === 'published' && result.remoteId === 'RESUMED');

  http = fakeHttp((call) => {
    if (call.url.includes('oauth2.googleapis.com/token')) return { json: { access_token: 'a', expires_in: 3600 } };
    return { status: 403, json: { error: { message: 'quota', errors: [{ reason: 'quotaExceeded' }] } } };
  });
  let error = await new YouTubePublisher(store, { http }).publish(job({ video: ytVideo })).catch((e) => e);
  check('Kontingent erschöpft: warten statt aufgeben', error.retryable && !error.permanent && Boolean(error.retryAt), error.message);

  http = fakeHttp(() => ({ status: 400, json: { error: 'invalid_grant' } }));
  const revoked = new YouTubePublisher(store, { http });
  error = await revoked.token().catch((e) => e);
  check('Zurückgezogene Anmeldung: aufgeben mit Hinweis', error.permanent && /neu anmelden/.test(error.message), error.message);

  check('Ohne Video: klare Meldung', youtube.check({ title: 'x', video: null }).some((line) => /fehlt das Video/.test(line)));
  check('Zu langer Titel wird erkannt', youtube.check({ title: 'x'.repeat(101), video: ytVideo }).some((line) => /100/.test(line)));

  // ---------------------------------------------------------------- TikTok
  section('TikTok');

  check('Unter 5 MB am Stück', chunkPlan(3 * MB).count === 1 && chunkPlan(3 * MB).chunkSize === 3 * MB);
  check('Sonst 10-MB-Blöcke, Rest im letzten', chunkPlan(25 * MB).count === 2 && chunkPlan(25 * MB).chunkSize === 10 * MB);

  const ttVideo = { path: file('tt.mp4', 25 * MB), size: 25 * MB, ext: 'mp4' };
  let statusRounds = 0;
  http = fakeHttp((call) => {
    if (call.url.includes('/oauth/token/')) return { json: { access_token: 'tt-access', expires_in: 86400, refresh_token: 'tt-refresh-2', open_id: 'o1' } };
    if (call.url.includes('creator_info')) return { json: { data: { creator_nickname: 'Moin', privacy_level_options: ['PUBLIC_TO_EVERYONE', 'SELF_ONLY'], max_video_post_duration_sec: 600, comment_disabled: false, duet_disabled: true, stitch_disabled: false }, error: { code: 'ok' } } };
    if (call.url.includes('/video/init/')) return { json: { data: { publish_id: 'pub1', upload_url: 'https://upload.tiktok.example/u1' }, error: { code: 'ok' } } };
    if (call.kind === 'upload') return { status: call.end >= 25 * MB ? 201 : 206 };
    if (call.url.includes('status/fetch')) {
      statusRounds += 1;
      return { json: { data: statusRounds < 2 ? { status: 'PROCESSING_UPLOAD' } : { status: 'PUBLISH_COMPLETE', publicaly_available_post_id: [7123] }, error: { code: 'ok' } } };
    }
    return { status: 404 };
  });
  const tiktok = new TikTokPublisher(store, { http, sleep: noSleep });
  tiktok.tokens.save({ refreshToken: 'tt-refresh', username: 'moinmornhart' });

  let tt = job({ video: ttVideo, options: { privacy: 'PUBLIC_TO_EVERYONE', allowComments: true, allowDuet: true } });
  result = await tiktok.publish(tt);
  const ttInit = JSON.parse(http.calls.find((call) => call.url.includes('/video/init/')).body);
  check('Erneuertes Merkmal gespeichert (TikTok tauscht es aus)', tiktok.tokens.get().refreshToken === 'tt-refresh-2');
  check('Sichtbarkeit wie gewählt', ttInit.post_info.privacy_level === 'PUBLIC_TO_EVERYONE');
  check('Kommentare an, Stitch aus (nicht gewählt)', ttInit.post_info.disable_comment === false && ttInit.post_info.disable_stitch === true);
  check('Duett aus, weil das Konto es sperrt', ttInit.post_info.disable_duet === true);
  check('Blockangaben passen zur Datei', ttInit.source_info.video_size === 25 * MB && ttInit.source_info.total_chunk_count === 2 && ttInit.source_info.chunk_size === 10 * MB);
  const ttUploads = http.calls.filter((call) => call.kind === 'upload');
  check('Zwei Blöcke mit richtigen Bereichen', ttUploads.length === 2
    && ttUploads[0].headers['Content-Range'] === `bytes 0-${10 * MB - 1}/${25 * MB}`
    && ttUploads[1].headers['Content-Range'] === `bytes ${10 * MB}-${25 * MB - 1}/${25 * MB}`,
    ttUploads.map((u) => u.headers['Content-Range']).join(' | '));
  check('Fortschritt nach jedem Block gemerkt', tt.sessions.at(-1)?.next === 2);
  check('Wartet, bis TikTok fertig ist', statusRounds === 2);
  check('Link zum Video', result.url === 'https://www.tiktok.com/@moinmornhart/video/7123', result.url);

  const resumeCalls = fakeHttp((call) => {
    if (call.url.includes('creator_info')) return { json: { data: { privacy_level_options: ['SELF_ONLY'] }, error: { code: 'ok' } } };
    if (call.kind === 'upload') return { status: 201 };
    if (call.url.includes('status/fetch')) return { json: { data: { status: 'PUBLISH_COMPLETE' }, error: { code: 'ok' } } };
    return { status: 404 };
  });
  const tiktok2 = new TikTokPublisher(store, { http: resumeCalls, sleep: noSleep });
  tiktok2.tokens.save({ accessToken: 'still-valid', accessExpires: Date.now() + 3600_000 });
  await tiktok2.publish(job({ video: ttVideo, options: { privacy: 'SELF_ONLY' }, session: { publishId: 'p', uploadUrl: 'https://upload.tiktok.example/u2', chunkSize: 10 * MB, count: 2, next: 1, createdAt: Date.now() } }));
  const resumed = resumeCalls.calls.filter((call) => call.kind === 'upload');
  check('Abgebrochen nach Block 1: nur Block 2 erneut', resumed.length === 1 && resumed[0].start === 10 * MB && !resumeCalls.calls.some((call) => call.url.includes('/video/init/')));

  error = await tiktok.publish(job({ video: ttVideo, options: { privacy: 'FRIENDS' } })).catch((e) => e);
  check('Nicht angebotene Sichtbarkeit: aufgeben', error.permanent && /Sichtbarkeit/.test(error.message));

  const unaudited = fakeHttp((call) => {
    if (call.url.includes('creator_info')) return { json: { data: { privacy_level_options: ['PUBLIC_TO_EVERYONE'] }, error: { code: 'ok' } } };
    return { status: 403, json: { error: { code: 'unaudited_client_can_only_post_to_private_accounts', message: '...' } } };
  });
  const tiktok3 = new TikTokPublisher(store, { http: unaudited });
  tiktok3.tokens.save({ accessToken: 'x', accessExpires: Date.now() + 3600_000 });
  error = await tiktok3.publish(job({ video: ttVideo, options: { privacy: 'PUBLIC_TO_EVERYONE' } })).catch((e) => e);
  check('Ungeprüfte Anwendung: verständlich erklärt', error.permanent && /noch nicht geprüft/.test(error.message), error.message);

  check('Ohne Sichtbarkeit: TikTok verlangt eine Wahl', tiktok.check({ video: ttVideo, options: {} }).some((line) => /Sichtbarkeit/.test(line)));
  check('Bezahlte Partnerschaft darf nicht privat sein', tiktok.check({ video: ttVideo, options: { privacy: 'SELF_ONLY', commercial: true, brandedContent: true } }).some((line) => /privat/.test(line)));
  check('Werbung ohne Angabe, für wen', tiktok.check({ video: ttVideo, options: { privacy: 'SELF_ONLY', commercial: true } }).some((line) => /Eigene Marke/.test(line)));

  // ---------------------------------------------------------------- Instagram und Facebook
  section('Instagram und Facebook');

  const reel = mp4('reel.mp4', { seconds: 30, width: 1080, height: 1920 });
  const reelVideo = { path: reel, size: fs.statSync(reel).size, ext: 'mp4' };
  let igPolls = 0;
  http = fakeHttp((call) => {
    if (call.url.endsWith('/ig1/media')) return { json: { id: 'container9' } };
    if (call.url.includes('rupload.facebook.com/ig-api-upload')) return { json: { success: true } };
    if (call.url.includes('/container9?')) {
      igPolls += 1;
      return { json: { status_code: igPolls < 2 ? 'IN_PROGRESS' : 'FINISHED' } };
    }
    if (call.url.endsWith('/ig1/media_publish')) return { json: { id: 'media77' } };
    if (call.url.includes('/media77?')) return { json: { permalink: 'https://www.instagram.com/reel/abc/' } };
    if (call.url.endsWith('/page1/video_reels')) {
      return /upload_phase=start/.test(call.body) ? { json: { video_id: 'fbvid5' } } : { json: { success: true } };
    }
    if (call.url.includes('rupload.facebook.com/video-upload')) return { json: { success: true } };
    if (call.url.endsWith('/page1/feed')) return { json: { id: 'page1_post3' } };
    return { status: 404, json: { error: { message: 'unbekannt', code: 100 } } };
  });
  const meta = new MetaAuth(store, { http });
  meta.tokens.save({ pages: [{ id: 'page1', name: 'Moin Seite', token: 'page-token', instagram: { id: 'ig1', username: 'moin' } }], pageId: 'page1' });
  const instagram = new InstagramPublisher(meta, { sleep: noSleep });
  const facebook = new FacebookPublisher(meta);
  check('Instagram verbunden über die Seite', instagram.isConnected() && facebook.isConnected());

  let ig = job({ video: reelVideo, options: { shareToFeed: true } });
  result = await instagram.publish(ig);
  const stepAt = (test) => http.calls.findIndex(test);
  const order = [
    stepAt((call) => call.url.endsWith('/ig1/media')),
    stepAt((call) => call.url.includes('ig-api-upload')),
    stepAt((call) => call.url.includes('/container9?')),
    stepAt((call) => call.url.endsWith('/ig1/media_publish')),
  ];
  check('Reihenfolge: Container → Upload → Prüfen → Veröffentlichen', order.every((index, i) => index >= 0 && (i === 0 || index > order[i - 1])), order.join(','));
  const rupload = http.calls.find((call) => call.url.includes('ig-api-upload'));
  check('Upload mit Seiten-Merkmal und Dateigröße', rupload.headers.Authorization === 'OAuth page-token' && rupload.headers.file_size === String(reelVideo.size) && rupload.headers.offset === '0');
  check('Als Reel mit Text', /media_type=REELS/.test(http.calls[0].body) && /upload_type=resumable/.test(http.calls[0].body) && /caption=Alles/.test(http.calls[0].body));
  check('Wartet auf „fertig“', igPolls === 2);
  check('Link zum Reel', result.url === 'https://www.instagram.com/reel/abc/');
  check('Container gemerkt (gilt 24 Stunden)', ig.sessions[0]?.containerId === 'container9');

  http.calls.length = 0;
  const fb = job({ video: reelVideo, scheduledFor: '2026-09-20T16:00:00.000Z' });
  result = await facebook.publish(fb);
  const finish = http.calls.find((call) => /upload_phase=finish/.test(call.body || ''));
  check('Facebook plant selbst: SCHEDULED mit Zeitpunkt', /video_state=SCHEDULED/.test(finish.body) && /scheduled_publish_time=1789920000/.test(finish.body), finish.body);
  check('Ergebnis: geplant', result.state === 'scheduled' && result.remoteId === 'fbvid5');

  http.calls.length = 0;
  result = await facebook.publish(job({ video: null, text: 'Nur Text' }));
  check('Facebook ohne Video: Textbeitrag', http.calls[0].url.endsWith('/page1/feed') && result.url === 'https://www.facebook.com/page1_post3');

  const longClip = mp4('long.mp4', { seconds: 240, width: 1920, height: 1080 });
  check('Facebook-Reel über 90 Sekunden wird vorher abgefangen', facebook.check({ video: { path: longClip, ext: 'mp4' }, text: 'x' }).some((line) => /90 Sekunden/.test(line)));
  check('Abgelaufene Anmeldung (Code 190): aufgeben', metaError({ code: 190 }).permanent);
  check('Ratenlimit (Code 4): später erneut', metaError({ code: 4 }).retryable);
  check('Tageslimit Instagram: klare Meldung', /100 Posts/.test(metaError({ code: 9, error_subcode: 2207042 }).message));

  // ---------------------------------------------------------------- LinkedIn
  section('LinkedIn');

  check('Sonderzeichen werden maskiert', littleText('Tipps (neu) & mehr_') === 'Tipps \\(neu\\) & mehr\\_');
  check('Hashtags werden echte Hashtags', littleText('Hallo #minecraft') === 'Hallo {hashtag|\\#|minecraft}');

  const liVideo = { path: file('li.mp4', 6 * MB), size: 6 * MB, ext: 'mp4' };
  let liPolls = 0;
  http = fakeHttp((call) => {
    if (call.url.includes('action=initializeUpload')) {
      return { json: { value: { video: 'urn:li:video:V1', uploadToken: 'tok', uploadInstructions: [
        { uploadUrl: 'https://li.example/p1', firstByte: 0, lastByte: 4 * MB - 1 },
        { uploadUrl: 'https://li.example/p2', firstByte: 4 * MB, lastByte: 6 * MB - 1 },
      ] } } };
    }
    if (call.kind === 'upload') return { status: 200, headers: { etag: call.url.endsWith('p1') ? 'etag-1' : 'etag-2' } };
    if (call.url.includes('action=finalizeUpload')) return { status: 200 };
    if (call.url.includes('/rest/videos/')) {
      liPolls += 1;
      return { json: { status: liPolls < 2 ? 'PROCESSING' : 'AVAILABLE' } };
    }
    if (call.url.endsWith('/rest/posts')) return { status: 201, headers: { 'x-restli-id': 'urn:li:share:99' } };
    return { status: 404 };
  });
  const linkedin = new LinkedInPublisher(store, { http, sleep: noSleep });
  linkedin.tokens.save({ accessToken: 'li-token', expiresAt: new Date(Date.now() + 30 * 86400_000).toISOString(), personUrn: 'urn:li:person:abc' });
  result = await linkedin.publish(job({ video: liVideo }));
  const liUploads = http.calls.filter((call) => call.kind === 'upload');
  check('Teile genau wie von LinkedIn vorgegeben', liUploads.length === 2 && liUploads[1].start === 4 * MB && liUploads[1].end === 6 * MB);
  const finalize = JSON.parse(http.calls.find((call) => call.url.includes('finalizeUpload')).body);
  check('Zusammensetzen mit den ETags in Reihenfolge', finalize.finalizeUploadRequest.uploadedPartIds.join() === 'etag-1,etag-2');
  const liPost = JSON.parse(http.calls.find((call) => call.url.endsWith('/rest/posts')).body);
  check('Beitrag mit Video, öffentlich, im eigenen Profil', liPost.author === 'urn:li:person:abc' && liPost.content.media.id === 'urn:li:video:V1' && liPost.visibility === 'PUBLIC');
  check('Pflicht-Kopfzeilen gesetzt', http.calls[0].headers['LinkedIn-Version'] && http.calls[0].headers['X-Restli-Protocol-Version'] === '2.0.0');
  check('Link zum Beitrag', result.url === 'https://www.linkedin.com/feed/update/urn:li:share:99');

  linkedin.tokens.save({ expiresAt: new Date(Date.now() - 1000).toISOString(), refreshToken: null });
  error = await linkedin.token().catch((e) => e);
  check('Nach 60 Tagen: neu anmelden', error.permanent && /60 Tagen/.test(error.message));
  linkedin.tokens.save({ expiresAt: new Date(Date.now() + 3 * 86400_000).toISOString() });
  check('Eine Woche vorher wird gewarnt', linkedin.status().expiringSoon === true);

  // ---------------------------------------------------------------- X
  section('X');

  const xVideo = { path: file('x.mp4', SEGMENT + 1000), size: SEGMENT + 1000, ext: 'mp4' };
  http = fakeHttp((call) => {
    if (call.url.endsWith('/2/media/upload/initialize')) return { json: { data: { id: 'm1' } } };
    if (call.url.includes('/append')) return { status: 204 };
    if (call.url.endsWith('/finalize')) return { json: { data: { id: 'm1', processing_info: { state: 'pending' } } } };
    if (call.url.includes('command=STATUS')) return { json: { data: { processing_info: { state: 'succeeded' } } } };
    if (call.url.endsWith('/2/tweets')) return { status: 201, json: { data: { id: '1799' } } };
    return { status: 404 };
  });
  const xp = new XPublisher(store, { http, sleep: noSleep });
  xp.tokens.save({ accessToken: 'x-token', accessExpires: Date.now() + 3600_000, refreshToken: 'x-refresh', username: 'moin' });
  result = await xp.publish(job({ video: xVideo, text: 'Neues Video!' }));
  const appends = http.calls.filter((call) => call.url.includes('/append'));
  check('Video in Segmenten', appends.length === 2 && appends[1].start === SEGMENT);
  check('Als Formular mit Segmentnummer', /name="segment_index"\r\n\r\n1\r\n/.test(appends[1].prefix) && appends[1].suffix.endsWith('--\r\n'));
  check('Boundary im Kopf passt zum Körper', appends[0].prefix.includes(appends[0].headers['Content-Type'].split('boundary=')[1]));
  const tweet = JSON.parse(http.calls.find((call) => call.url.endsWith('/2/tweets')).body);
  check('Post mit Video', tweet.media.media_ids[0] === 'm1' && tweet.text === 'Neues Video!');
  check('Link zum Post', result.url === 'https://x.com/moin/status/1799');

  http = fakeHttp(() => ({ status: 429, headers: { 'x-rate-limit-reset': String(Math.floor(Date.now() / 1000) + 900) }, json: { title: 'Too Many Requests' } }));
  const xLimited = new XPublisher(store, { http });
  xLimited.tokens.save({ accessToken: 'x', accessExpires: Date.now() + 3600_000, refreshToken: 'r' });
  error = await xLimited.publish(job({ text: 'Hallo' })).catch((e) => e);
  check('Ratenlimit: warten bis X wieder zulässt', error.retryable && Boolean(error.retryAt));
  check('Über 280 Zeichen wird vorher erkannt', xp.check({ text: 'x'.repeat(281) }).some((line) => /280/.test(line)));

  // ---------------------------------------------------------------- Einrichten
  section('Kennungen beim Einrichten erkennen');

  const googleId = '123456789012-abcdefghijklmnopqrstuvwxyz012345.apps.googleusercontent.com';
  const googleSecret = 'GOCSPX-abcdefghijklmnopqrstuvwx12';
  let keys = detectKeys('google', `Client-ID ${googleId}\nClientschlüssel ${googleSecret}`);
  check('Google: ID und Secret aus kopiertem Text', keys.clientId === googleId && keys.clientSecret === googleSecret, JSON.stringify(keys));
  keys = detectKeys('google', JSON.stringify({ installed: { client_id: googleId, client_secret: googleSecret, redirect_uris: ['http://localhost'] } }));
  check('Google: heruntergeladene JSON-Datei', keys.clientId === googleId && keys.clientSecret === googleSecret);
  check('TikTok: Client Key an der Form erkannt', detectKeys('tiktok', 'awabcdef1234567890').clientKey === 'awabcdef1234567890');
  check('TikTok: Secret als alleiniger Wert', detectKeys('tiktok', 'AbCdEfGhIjKlMnOpQrStUvWxYz123456').clientSecret === 'AbCdEfGhIjKlMnOpQrStUvWxYz123456');
  check('Mehrdeutiges nicht aus längerem Text', !detectKeys('tiktok', 'Hallo AbCdEfGhIjKlMnOpQrStUvWxYz123456 Welt').clientSecret);
  check('Meta: App-ID als alleiniger Wert', detectKeys('meta', '1234567890123456').appId === '1234567890123456');
  check('Meta: Geheimcode als alleiniger Wert', detectKeys('meta', '0123456789abcdef0123456789abcdef').appSecret === '0123456789abcdef0123456789abcdef');
  check('Meta: Telefonnummer im Text wird nicht übernommen', !detectKeys('meta', 'Ruf an: 0123456789012345 bitte').appId);
  check('LinkedIn: neues Secret-Format', detectKeys('linkedin', 'WPL_AP1.abcDEF123.xyz==').clientSecret === 'WPL_AP1.abcDEF123.xyz==');
  check('LinkedIn: Client ID', detectKeys('linkedin', '77abcd1234efgh').clientId === '77abcd1234efgh');
  check('LinkedIn: gewöhnliches Wort ist keine ID', !detectKeys('linkedin', 'contenthelpers').clientId);
  check('X: Client ID an der Endung erkannt', detectKeys('x', 'aBcDeFgHiJkLmNoPqRsT1234MTpjaQ').clientId === 'aBcDeFgHiJkLmNoPqRsT1234MTpjaQ');
  check('Twitch: Client ID', detectKeys('twitch', 'gp762nuuoqcoxypju8c569th9wz7q5').clientId === 'gp762nuuoqcoxypju8c569th9wz7q5');
  check('Kennung einer anderen Plattform wird nicht übernommen', !Object.keys(detectKeys('meta', googleSecret)).length);
  check('Leere Zwischenablage: nichts', !Object.keys(detectKeys('google', '')).length && !Object.keys(detectKeys('unbekannt', googleId)).length);

  // ---------------------------------------------------------------- Abschluss

  store.flush();
  try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 }); } catch { /* egal */ }

  const failed = results.filter((entry) => !entry.ok);
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
