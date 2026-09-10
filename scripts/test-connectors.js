'use strict';

/**
 * Test der Verbindungen – ohne Netzzugriff.
 *
 * Geprüft wird das, was ohne Gegenstelle prüfbar ist und wo Fehler wehtun:
 * das Lesen des YouTube-Feeds, das Umrechnen der Twitch-Dauerangaben, das
 * Zusammenfassen einer Stream-Sitzung zu Durchschnitt und Spitze sowie der
 * Abgleich, der bei wiederholtem Lauf nichts verdoppeln und nichts von Hand
 * Eingetragenes überschreiben darf.
 *
 *     node scripts/test-connectors.js
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const { Store } = require('../src/main/store');
const {
  parseFeed, decode, extractChannelId, channelTitle,
  parseChannelVideos, parseViewCount, parseRelativeDate,
} = require('../src/main/connectors/youtube');
const { TwitchConnector, parseDuration } = require('../src/main/connectors/twitch');
const { upsertAnalytics, upsertPublishedPost, linkAnalyticsToPost } = require('../src/main/connectors/shared');

const results = [];
const check = (name, condition, detail = '') => {
  results.push({ name, ok: Boolean(condition) });
  process.stdout.write(`  ${condition ? 'ok  ' : 'FEHL'} ${name}${!condition && detail ? ` – ${detail}` : ''}\n`);
};

// ------------------------------------------------------------------ Beispiel-Feed

const FEED = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns:media="http://search.yahoo.com/mrss/" xmlns="http://www.w3.org/2005/Atom">
  <title>Mein Kanal</title>
  <entry>
    <id>yt:video:AAAAAAAAAAA</id>
    <yt:videoId>AAAAAAAAAAA</yt:videoId>
    <title>Fünf Fehler beim Streamen &amp; wie du sie vermeidest</title>
    <published>2026-09-01T17:00:00+00:00</published>
    <media:group>
      <media:description>Kurze Beschreibung mit &lt;Zeichen&gt; drin.</media:description>
      <media:community>
        <media:starRating count="640" average="4.95"/>
        <media:statistics views="14200"/>
      </media:community>
    </media:group>
  </entry>
  <entry>
    <id>yt:video:BBBBBBBBBBB</id>
    <yt:videoId>BBBBBBBBBBB</yt:videoId>
    <title>Setup-Tour 2026</title>
    <published>2026-08-24T10:30:00+00:00</published>
    <media:group>
      <media:description>Ohne Statistik-Block.</media:description>
    </media:group>
  </entry>
</feed>`;

const videos = parseFeed(FEED);

check('Feed liefert beide Videos', videos.length === 2, `${videos.length} gefunden`);
check('Video-Kennung gelesen', videos[0].id === 'AAAAAAAAAAA', videos[0].id);
check('Aufrufe gelesen', videos[0].views === 14200, String(videos[0].views));
check('Likes gelesen', videos[0].likes === 640, String(videos[0].likes));
check('Adresse gebaut', videos[0].url === 'https://www.youtube.com/watch?v=AAAAAAAAAAA');
check('Ersatzdarstellungen aufgelöst', videos[0].title.includes('Streamen & wie'), videos[0].title);
check('Beschreibung entschlüsselt', videos[0].description.includes('<Zeichen>'), videos[0].description);
check('Fehlende Statistik ergibt null', videos[1].views === null && videos[1].likes === null);
check('Zeitpunkt übernommen', videos[1].published.startsWith('2026-08-24'));
check('Reihenfolge des Feeds bleibt', videos[0].id === 'AAAAAAAAAAA' && videos[1].id === 'BBBBBBBBBBB');
check('Entschlüsselung einzeln', decode('a &amp;lt; b') === 'a &lt; b');

// ------------------------------------------------------------------ Kanal-Kennung

/*
 * Nachstellung einer echten YouTube-Kanalseite: dort steht vor der eigenen
 * Kennung ein empfohlener Fremdkanal. Genau daran ist die erste Fassung
 * gescheitert – sie hat den falschen Kanal verbunden.
 */
const CHANNEL_PAGE = `<!doctype html><html><head>
<meta property="og:site_name" content="YouTube">
<link rel="canonical" href="https://www.youtube.com/channel/UCrichtigrichtigrichtigr">
<meta property="og:url" content="https://www.youtube.com/channel/UCrichtigrichtigrichtigr">
</head><body>
<script>var data = {"channelId":"UCfremdfremdfremdfremdfr","title":"Empfohlener Kanal"};</script>
<script>var own = {"externalId":"UCrichtigrichtigrichtigr"};</script>
</body></html>`;

check(
  'Eigene Kanal-Kennung statt empfohlener',
  extractChannelId(CHANNEL_PAGE) === 'UCrichtigrichtigrichtigr',
  String(extractChannelId(CHANNEL_PAGE))
);
check(
  'Ohne kanonische Adresse greift das Ersatzfeld',
  extractChannelId('<script>{"externalId":"UCrichtigrichtigrichtigr","channelId":"UCfremdfremdfremdfremdfr"}</script>') === 'UCrichtigrichtigrichtigr'
);
check('Ohne verlässliches Feld lieber nichts', extractChannelId('<html><body>nichts hier</body></html>') === null);
check('Fremde Kennung wird nicht geraten', extractChannelId('{"channelId":"UCfremdfremdfremdfremdfr"}') === null);

/*
 * Der Kanalname wird auch dann gebraucht, wenn YouTube den Feed gerade nicht
 * herausgibt – dann ist die Kanalseite die einzige Quelle dafuer.
 */
check(
  'Kanalname aus der Seite gelesen',
  channelTitle('<meta property="og:title" content="MoinMornhart">') === 'MoinMornhart',
  String(channelTitle('<meta property="og:title" content="MoinMornhart">'))
);
check(
  'Zusatz im Seitentitel wird abgeschnitten',
  channelTitle('<title>MoinMornhart - YouTube</title>') === 'MoinMornhart',
  String(channelTitle('<title>MoinMornhart - YouTube</title>'))
);
check('Ohne Titel bleibt es leer', channelTitle('<html></html>') === null);

// ------------------------------------------------------------------ Kanalseite als Rueckfallebene

check('Aufrufe mit Millionen-Abkuerzung', parseViewCount('1,2 Mio. Aufrufe') === 1200000, String(parseViewCount('1,2 Mio. Aufrufe')));
check('Aufrufe mit Tausenderpunkten', parseViewCount('123.456 Aufrufe') === 123456, String(parseViewCount('123.456 Aufrufe')));
check('Aufrufe auf Englisch', parseViewCount('4,500 views') === 4500, String(parseViewCount('4,500 views')));
check('Text ohne Aufrufe ergibt nichts', parseViewCount('vor 3 Tagen') === null);

const anchor = new Date('2026-09-10T12:00:00Z').getTime();
check(
  'Alter in Tagen umgerechnet',
  parseRelativeDate('vor 3 Tagen', anchor).slice(0, 10) === '2026-09-07',
  String(parseRelativeDate('vor 3 Tagen', anchor))
);
check(
  'Alter auf Englisch umgerechnet',
  parseRelativeDate('2 weeks ago', anchor).slice(0, 10) === '2026-08-27',
  String(parseRelativeDate('2 weeks ago', anchor))
);

/*
 * Nachbau der heutigen Struktur einer Kanalseite. Wichtig ist, dass je Block
 * ausgewertet wird: Beschriftungen der Bedienoberflaeche stehen im selben
 * Quelltext und duerfen nicht als Videotitel durchgehen.
 */
const VIDEO_PAGE = [
  '{"title":{"content":"Zu Playlist hinzufügen"}}',
  '"lockupViewModel":{"contentImage":{"thumb":1},"contentId":"aaaaaaaaaaa",',
  '"metadata":{"lockupMetadataViewModel":{"title":{"content":"Minecraft Basis nach 100 Tagen"},',
  '"metadata":{"rows":[{"parts":[{"text":{"content":"41.200 Aufrufe"}},{"text":{"content":"vor 5 Tagen"}}]}]}}}},',
  '"lockupViewModel":{"contentImage":{"thumb":2},"contentId":"bbbbbbbbbbb",',
  '"metadata":{"lockupMetadataViewModel":{"title":{"content":"Redstone einfach erklärt"},',
  '"metadata":{"rows":[{"parts":[{"text":{"content":"1,2 Mio. Aufrufe"}},{"text":{"content":"vor 2 Monaten"}}]}]}}}}',
].join('');

const fromPage = parseChannelVideos(VIDEO_PAGE);
check('Seite liefert beide Videos', fromPage.length === 2, `${fromPage.length} gefunden`);
check('Kennung je Video gelesen', fromPage[0].id === 'aaaaaaaaaaa' && fromPage[1].id === 'bbbbbbbbbbb');
check('Titel je Video gelesen', fromPage[0].title === 'Minecraft Basis nach 100 Tagen', fromPage[0].title);
check('Bedienoberflaeche nicht als Titel verwechselt', !fromPage.some((video) => video.title.includes('Playlist')));
check('Aufrufe je Video gelesen', fromPage[0].views === 41200 && fromPage[1].views === 1200000, `${fromPage[0].views}/${fromPage[1].views}`);
check('Als ungefaehr gekennzeichnet', fromPage.every((video) => video.approximate === true));
check('Leere Seite ergibt nichts', parseChannelVideos('<html></html>').length === 0);

// ------------------------------------------------------------------ Twitch-Dauer

check('Dauer mit Stunden', parseDuration('3h21m5s') === 3 * 3600 + 21 * 60 + 5);
check('Dauer ohne Stunden', parseDuration('47m12s') === 47 * 60 + 12);
check('Dauer nur Sekunden', parseDuration('58s') === 58);
check('Unsinnige Dauer ergibt 0', parseDuration('kaputt') === 0);

// ------------------------------------------------------------------ Abgleich

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'content-helper-connectors-'));
const store = new Store(tmp);

const entry = {
  externalId: 'youtube:video:AAAAAAAAAAA',
  platformId: 'youtube',
  date: '2026-09-01',
  title: 'Fünf Fehler beim Streamen',
  metrics: { views: 14200, likes: 640 },
  source: 'youtube',
};

check('Erster Abgleich legt an', upsertAnalytics(store, entry) === 'added');
check('Zweiter Abgleich aktualisiert', upsertAnalytics(store, { ...entry, metrics: { views: 15100, likes: 660 } }) === 'updated');
check('Kein doppelter Eintrag', store.list('analytics').length === 1, `${store.list('analytics').length} Einträge`);
check('Neue Aufrufe übernommen', store.list('analytics')[0].metrics.views === 15100);

// Von Hand ergaenzte Werte muessen einen Abgleich ueberleben.
store.update('analytics', store.list('analytics')[0].id, {
  metrics: { ...store.list('analytics')[0].metrics, ctr: 5.4, avgViewSec: 214 },
});
upsertAnalytics(store, { ...entry, metrics: { views: 16000, likes: 700 } });
const merged = store.list('analytics')[0].metrics;
check('Handeingabe bleibt erhalten', merged.ctr === 5.4 && merged.avgViewSec === 214, JSON.stringify(merged));
check('Automatische Werte werden aufgefrischt', merged.views === 16000 && merged.likes === 700);

const postId = upsertPublishedPost(store, {
  externalId: 'youtube:video:AAAAAAAAAAA',
  title: 'Fünf Fehler beim Streamen',
  platforms: ['youtube'],
  publishedAt: '2026-09-01T17:00:00Z',
});
check('Beitrag wird angelegt', Boolean(postId));
check('Beitrag gilt als veröffentlicht', store.get('posts', postId).status === 'published');
check('Beitrag wird nicht verdoppelt', upsertPublishedPost(store, {
  externalId: 'youtube:video:AAAAAAAAAAA',
  title: 'Anderer Titel',
  platforms: ['youtube'],
  publishedAt: '2026-09-01T17:00:00Z',
}) === null);
check('Titel bestehender Beiträge bleibt unangetastet', store.get('posts', postId).title === 'Fünf Fehler beim Streamen');
check('Messwert wird verknüpft', linkAnalyticsToPost(store, 'youtube:video:AAAAAAAAAAA', postId) === true);
check('Verknüpfung sitzt', store.list('analytics')[0].postId === postId);

// ------------------------------------------------------------------ Stream-Sitzung

const twitch = new TwitchConnector(store);
const startedAt = new Date(Date.now() - 90 * 60000).toISOString();
twitch.session = {
  streamId: '4711',
  title: 'Werkstatt-Abend',
  game: 'Just Chatting',
  startedAt,
  samples: [
    { at: Date.now() - 80 * 60000, viewers: 20 },
    { at: Date.now() - 40 * 60000, viewers: 48 },
    { at: Date.now() - 10 * 60000, viewers: 34 },
  ],
};

const finished = twitch.finishSession();
const session = store.list('analytics').find((item) => item.externalId === 'twitch:session:4711');

check('Sitzung wird gespeichert', finished.saved === true);
check('Durchschnitt berechnet', session?.metrics.avgViewers === 34, String(session?.metrics.avgViewers));
check('Spitzenwert erkannt', session?.metrics.peakViewers === 48, String(session?.metrics.peakViewers));
check('Dauer plausibel', session?.metrics.streamMinutes >= 89 && session.metrics.streamMinutes <= 91, String(session?.metrics.streamMinutes));
check('Gesehene Stunden abgeleitet', session?.metrics.hoursWatched > 45 && session.metrics.hoursWatched < 55, String(session?.metrics.hoursWatched));
check('Sitzung ist danach beendet', twitch.session === null);

// Dieselbe Sitzung darf kein zweites Mal geschrieben werden.
twitch.session = { streamId: '4711', title: 'Werkstatt-Abend', startedAt, samples: [{ at: Date.now(), viewers: 10 }] };
check('Sitzung wird nicht verdoppelt', twitch.finishSession().saved === false);

// ------------------------------------------------------------------ Twitch-Anmeldung
//
// Ab hier wird auf Zusagen gewartet, deshalb laeuft der Rest in einer
// asynchronen Klammer.

(async () => {
const auth = twitch.auth;

check('Ohne Client-ID ist die Anmeldung nicht startbar', auth.needsClientId() === true);
auth.saveConfig({ clientId: 'abcdef123456' });
check('Hinterlegte Client-ID wird erkannt', auth.needsClientId() === false && auth.clientId() === 'abcdef123456');
check('Noch nicht angemeldet', auth.isSignedIn() === false);
check('Ohne Anmeldung gilt der Anwendungsweg', twitch.mode === 'app');

auth.saveConfig({ refreshToken: 'geheimes-erneuerungsmerkmal', login: 'moinmornhart', userId: '4711', displayName: 'MoinMornhart' });
check('Nach der Anmeldung erkannt', auth.isSignedIn() === true);
check('Angemeldet gilt der Anmeldeweg', twitch.mode === 'login');
check('Anmeldung allein genügt als Einrichtung', twitch.isConfigured() === true);
check('Merkmal steht nicht im Status', JSON.stringify(auth.status()).includes('geheimes-erneuerungsmerkmal') === false);
check('Status nennt den angemeldeten Kanal', auth.status().displayName === 'MoinMornhart');

// Der Kanalstand muss Gesamtzahl und Zuwachs sauber trennen.
const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
store.insert('analytics', {
  externalId: `twitch:channel:${yesterday}`,
  platformId: 'twitch',
  date: yesterday,
  title: 'Kanalstand',
  metrics: { followersTotal: 1200, subsTotal: 40 },
  source: 'twitch',
});
auth.followerCount = async () => 1247;
auth.subscriberCount = async () => 43;

await twitch.snapshotChannel();
const today = new Date().toISOString().slice(0, 10);
const snapshot = store.list('analytics').find((entry) => entry.externalId === `twitch:channel:${today}`);
check('Kanalstand wird festgehalten', snapshot?.metrics.followersTotal === 1247, JSON.stringify(snapshot?.metrics));
check('Zuwachs wird berechnet statt geraten', snapshot?.metrics.followersGained === 47, String(snapshot?.metrics.followersGained));
check('Abonnenten getrennt gefuehrt', snapshot?.metrics.subsTotal === 43 && snapshot?.metrics.subsGained === 3);

await auth.signOut();
check('Abmelden entfernt das Merkmal', auth.isSignedIn() === false);
check('Client-ID bleibt nach dem Abmelden erhalten', auth.clientId() === 'abcdef123456');

// ------------------------------------------------------------------ Zugangsdaten

twitch.saveConfig({ clientId: 'abc123', clientSecret: 'geheim', login: 'moinmornhart' });
check('Verbindung gilt als eingerichtet', twitch.isConfigured() === true);
check('Geheimnis steht nicht im Status', JSON.stringify(twitch.status()).includes('geheim') === false);
twitch.disconnect();
check('Trennen entfernt die Zugangsdaten', twitch.isConfigured() === false);
check('Zahlen bleiben nach dem Trennen erhalten', store.list('analytics').length >= 2);

// ------------------------------------------------------------------ Abschluss

store.flush();
try {
  fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 3 });
} catch { /* Reste raeumt das System auf */ }

const failed = results.filter((result) => !result.ok);
if (failed.length) {
  process.stdout.write(`\nFEHLGESCHLAGEN – ${failed.length} von ${results.length} Prüfungen.\n`);
  process.exit(1);
}
process.stdout.write(`\nAlle ${results.length} Prüfungen bestanden.\n`);
})().catch((error) => {
  process.stdout.write(`\nAbbruch: ${error.stack}\n`);
  process.exit(1);
});
