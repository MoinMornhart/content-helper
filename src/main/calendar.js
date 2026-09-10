'use strict';

/**
 * Kalender-Ausgabe im iCalendar-Format (RFC 5545).
 *
 * Damit lässt sich der Plan in Apple Kalender, Google Kalender, Outlook oder
 * jede andere Kalender-App bringen – auf zwei Wegen:
 *
 * 1. Als Datei zum Einlesen. Einmalig, danach getrennt vom Plan.
 * 2. Als Abonnement über den Handy-Begleiter. Der Kalender holt sich die
 *    Adresse regelmässig selbst, Änderungen erscheinen also von allein. Das
 *    funktioniert, solange der Rechner läuft und im selben Netz erreichbar ist.
 *
 * Bewusst ohne Zusatzpaket: Das Format ist zeilenbasiert und überschaubar, die
 * Fallstricke liegen woanders – im Falten langer Zeilen, im Maskieren von
 * Sonderzeichen und in stabilen Kennungen, damit ein erneuter Abruf bestehende
 * Termine aktualisiert statt sie zu verdoppeln.
 */

const PRODID = '-//Content Helper//Creator-Plan//DE';

/** Zeitangabe in UTC, wie sie im Format erwartet wird: 20260910T170000Z */
function stamp(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return `${date.toISOString().replace(/[-:]/g, '').split('.')[0]}Z`;
}

/**
 * Maskiert Sonderzeichen. Reihenfolge ist wichtig: der Gegenschrägstrich
 * zuerst, sonst würden die eben eingefügten Maskierungen erneut maskiert.
 */
function escape(text) {
  return String(text ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

/**
 * Faltet Zeilen auf 75 Zeichen.
 *
 * Gezählt wird in Bytes, nicht in Zeichen – ein Umlaut belegt zwei. Wer hier
 * nach Zeichen zählt, erzeugt bei deutschen Texten zu lange Zeilen, die
 * manche Kalender-Apps stillschweigend abschneiden.
 */
function fold(line) {
  const bytes = Buffer.from(line, 'utf8');
  if (bytes.length <= 75) return line;

  const parts = [];
  let start = 0;
  let limit = 75;

  while (start < bytes.length) {
    let end = Math.min(start + limit, bytes.length);
    // Nicht mitten in ein mehrteiliges Zeichen schneiden.
    while (end < bytes.length && (bytes[end] & 0xc0) === 0x80) end -= 1;
    parts.push(bytes.subarray(start, end).toString('utf8'));
    start = end;
    limit = 74; // Folgezeilen beginnen mit einem Leerzeichen
  }

  return parts.join('\r\n ');
}

const line = (key, value) => fold(`${key}:${value}`);

/**
 * Baut den Kalender aus den geplanten und veröffentlichten Beiträgen.
 *
 * @param {object[]} posts
 * @param {{name?: string, platforms?: Map<string,object>, reminderMinutes?: number, includePublished?: boolean}} options
 * @returns {string} vollständiger iCalendar-Text
 */
function buildCalendar(posts, {
  name = 'Content Helper',
  platforms = new Map(),
  reminderMinutes = 15,
  includePublished = true,
  defaultDurationMinutes = 30,
} = {}) {
  const now = stamp(new Date());

  const out = [
    'BEGIN:VCALENDAR',
    line('PRODID', PRODID),
    'VERSION:2.0',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    line('X-WR-CALNAME', escape(name)),
    line('NAME', escape(name)),
    line('X-WR-CALDESC', escape('Geplante Veröffentlichungen aus dem Content Helper')),
    'X-PUBLISHED-TTL:PT30M',
    'REFRESH-INTERVAL;VALUE=DURATION:PT30M',
  ];

  for (const post of posts) {
    if (!post.scheduledAt) continue;
    if (!includePublished && post.status === 'published') continue;

    const start = stamp(post.scheduledAt);
    if (!start) continue;

    const names = (post.platforms || [])
      .map((id) => platforms.get(id)?.name || id)
      .join(', ');

    const title = post.title?.trim() || (post.body || '').slice(0, 60).trim() || 'Beitrag ohne Titel';
    const statusLabel = {
      idea: 'Idee', draft: 'Entwurf', ready: 'Fertig', scheduled: 'Geplant',
      due: 'Jetzt fällig', published: 'Veröffentlicht', missed: 'Verpasst',
    }[post.status] || post.status;

    // Die Beschreibung soll auch auf dem Handy allein tragen.
    const description = [
      names ? `Kanäle: ${names}` : null,
      `Status: ${statusLabel}`,
      post.format ? `Format: ${post.format}` : null,
      post.body ? `\n${post.body}` : null,
      (post.hashtags || []).length ? `\n${post.hashtags.map((tag) => `#${tag}`).join(' ')}` : null,
      (post.checklist || []).length
        ? `\nCheckliste:\n${post.checklist.map((item) => `${item.done ? '[x]' : '[ ]'} ${item.text}`).join('\n')}`
        : null,
    ].filter(Boolean).join('\n');

    const duration = Math.max(5, post.durationMinutes || defaultDurationMinutes);

    out.push(
      'BEGIN:VEVENT',
      // Stabile Kennung: ein erneuter Abruf aktualisiert den Termin, statt ihn
      // ein zweites Mal anzulegen.
      line('UID', `${post.id}@content-helper`),
      line('DTSTAMP', now),
      line('DTSTART', start),
      line('DURATION', `PT${duration}M`),
      line('SUMMARY', escape(names ? `${title} · ${names}` : title)),
      line('DESCRIPTION', escape(description)),
      line('CATEGORIES', escape(names || 'Content')),
      line('STATUS', post.status === 'published' ? 'CONFIRMED' : 'TENTATIVE'),
      line('TRANSP', 'TRANSPARENT'),
      post.url ? line('URL', escape(post.url)) : null,
      // Der letzte Änderungszeitpunkt hilft Kalendern beim Auffrischen.
      post.updatedAt && stamp(post.updatedAt) ? line('LAST-MODIFIED', stamp(post.updatedAt)) : null,
    );

    // Erinnerung nur für das, was noch aussteht.
    if (reminderMinutes > 0 && post.status !== 'published') {
      out.push(
        'BEGIN:VALARM',
        'ACTION:DISPLAY',
        line('DESCRIPTION', escape(`Gleich fällig: ${title}`)),
        line('TRIGGER', `-PT${reminderMinutes}M`),
        'END:VALARM'
      );
    }

    out.push('END:VEVENT');
  }

  out.push('END:VCALENDAR');
  // Das Format schreibt Wagenrücklauf und Zeilenvorschub vor.
  return `${out.filter(Boolean).join('\r\n')}\r\n`;
}

module.exports = { buildCalendar, escape, fold, stamp };
