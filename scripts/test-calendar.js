'use strict';

/**
 * Test der Kalender-Ausgabe.
 *
 * Kalender-Apps sind streng: eine zu lange Zeile, ein nicht maskiertes
 * Semikolon oder ein fehlender Wagenrücklauf, und Apple Kalender lehnt die
 * ganze Datei ab – oft ohne Fehlermeldung. Genau diese Fallstricke werden hier
 * geprüft, dazu die Frage, ob ein erneuter Abruf Termine aktualisiert statt sie
 * zu verdoppeln.
 *
 *     node scripts/test-calendar.js
 */

const { buildCalendar, escape, fold } = require('../src/main/calendar');

const results = [];
const check = (name, condition, detail = '') => {
  results.push({ name, ok: Boolean(condition) });
  process.stdout.write(`  ${condition ? 'ok  ' : 'FEHL'} ${name}${!condition && detail ? ` – ${detail}` : ''}\n`);
};

const platforms = new Map([
  ['youtube', { name: 'YouTube' }],
  ['twitch', { name: 'Twitch' }],
]);

const posts = [
  {
    id: 'post-1',
    title: 'Minecraft: Basis nach 100 Tagen',
    body: 'Zeile eins\nZeile zwei',
    hashtags: ['minecraft', 'survival'],
    platforms: ['youtube'],
    format: 'Case Study',
    status: 'scheduled',
    scheduledAt: '2026-09-15T17:00:00.000Z',
    updatedAt: '2026-09-10T08:00:00.000Z',
    checklist: [{ text: 'Thumbnail; fertig', done: true }, { text: 'Untertitel', done: false }],
  },
  {
    id: 'post-2',
    title: 'Streamrückblick, mit Komma und Semikolon; hier',
    platforms: ['twitch'],
    status: 'published',
    scheduledAt: '2026-09-01T19:00:00.000Z',
    publishedAt: '2026-09-01T19:00:00.000Z',
  },
  { id: 'post-3', title: 'Ohne Termin', platforms: ['youtube'], status: 'draft', scheduledAt: null },
];

const ics = buildCalendar(posts, { platforms, reminderMinutes: 20 });
const lines = ics.split('\r\n');

/**
 * Macht die Faltung rueckgaengig, so wie es eine Kalender-App beim Lesen tut.
 * Inhaltliche Pruefungen muessen auf dem entfalteten Text arbeiten – sonst
 * scheitern sie daran, dass ein Wort ueber zwei Zeilen verteilt steht.
 */
const flat = ics.replace(/\r\n /g, '');

// ------------------------------------------------------------------ Grundgeruest

check('Beginnt und endet als Kalender', ics.startsWith('BEGIN:VCALENDAR') && ics.trimEnd().endsWith('END:VCALENDAR'));
check('Version wird angegeben', ics.includes('VERSION:2.0'));
check('Zeilen enden mit Wagenrücklauf', ics.includes('\r\n') && !/[^\r]\n/.test(ics));
check('Nur Termine mit Zeitpunkt', (ics.match(/BEGIN:VEVENT/g) || []).length === 2, String((ics.match(/BEGIN:VEVENT/g) || []).length));
check('Beitrag ohne Termin fehlt', !ics.includes('Ohne Termin'));
check('Jeder Beginn hat ein Ende', (ics.match(/BEGIN:VEVENT/g) || []).length === (ics.match(/END:VEVENT/g) || []).length);

// ------------------------------------------------------------------ Kennungen

check('Stabile Kennung je Beitrag', ics.includes('UID:post-1@content-helper') && ics.includes('UID:post-2@content-helper'));
check('Zeitpunkt in UTC', ics.includes('DTSTART:20260915T170000Z'), lines.find((l) => l.startsWith('DTSTART')));
check('Dauer statt Endzeitpunkt', ics.includes('DURATION:PT30M'));
check('Änderungszeitpunkt übernommen', ics.includes('LAST-MODIFIED:20260910T080000Z'));

// ------------------------------------------------------------------ Maskierung

check('Semikolon maskiert', escape('a;b') === 'a\\;b');
check('Komma maskiert', escape('a,b') === 'a\\,b');
check('Gegenschrägstrich zuerst maskiert', escape('a\\;b') === 'a\\\\\\;b', escape('a\\;b'));
check('Zeilenumbruch wird zum Kürzel', escape('a\nb') === 'a\\nb');
check('Titel mit Semikolon maskiert ausgegeben', flat.includes('Semikolon\\; hier'), lines.find((l) => l.includes('Streamr')));
check('Checkliste steht in der Beschreibung', flat.includes('[x] Thumbnail\\; fertig'), 'im entfalteten Text nicht gefunden');

// ------------------------------------------------------------------ Zeilenlaenge

const tooLong = lines.filter((entry) => Buffer.from(entry, 'utf8').length > 75);
check('Keine Zeile über 75 Byte', tooLong.length === 0, `${tooLong.length} zu lang: ${tooLong[0] || ''}`);

const german = fold(`DESCRIPTION:${'Rückblick über Umlaute äöüß '.repeat(6)}`);
const germanLines = german.split('\r\n');
check('Auch mit Umlauten korrekt gefaltet', germanLines.every((entry) => Buffer.from(entry, 'utf8').length <= 75));
check('Folgezeilen beginnen mit Leerzeichen', germanLines.slice(1).every((entry) => entry.startsWith(' ')));
check(
  'Gefalteter Text bleibt lesbar',
  germanLines.map((entry, index) => (index ? entry.slice(1) : entry)).join('').includes('Rückblick über Umlaute äöüß'),
  germanLines[0]
);

// ------------------------------------------------------------------ Erinnerungen

check('Erinnerung für Anstehendes', ics.includes('TRIGGER:-PT20M'));
check('Genau eine Erinnerung', (ics.match(/BEGIN:VALARM/g) || []).length === 1, String((ics.match(/BEGIN:VALARM/g) || []).length));
check('Veröffentlichtes gilt als bestätigt', ics.includes('STATUS:CONFIRMED'));
check('Geplantes gilt als vorläufig', ics.includes('STATUS:TENTATIVE'));

const withoutPublished = buildCalendar(posts, { platforms, includePublished: false });
check('Veröffentlichtes lässt sich weglassen', (withoutPublished.match(/BEGIN:VEVENT/g) || []).length === 1);

// ------------------------------------------------------------------ Wiederholter Abruf

const again = buildCalendar(posts, { platforms, reminderMinutes: 20 });
const uidsOf = (text) => (text.match(/UID:[^\r\n]+/g) || []).sort().join('|');
check('Kennungen bleiben über Abrufe gleich', uidsOf(ics) === uidsOf(again));
check('Kanalname steht im Titel', ics.includes('YouTube'));

// ------------------------------------------------------------------ Abschluss

const failed = results.filter((result) => !result.ok);
if (failed.length) {
  process.stdout.write(`\nFEHLGESCHLAGEN – ${failed.length} von ${results.length} Prüfungen.\n`);
  process.exit(1);
}
process.stdout.write(`\nAlle ${results.length} Prüfungen bestanden.\n`);
