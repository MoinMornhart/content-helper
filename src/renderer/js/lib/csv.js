/**
 * CSV-Einlesen für die Studio-Exporte der Plattformen.
 *
 * Die Exporte von YouTube Studio, TikTok Studio, Meta Business Suite und
 * Twitch Insights unterscheiden sich in Spaltennamen, Trennzeichen und
 * Zahlenformat. Diese Datei bringt sie auf einen gemeinsamen Nenner – ohne
 * API, ohne Konto, nur mit der Datei, die man ohnehin herunterladen kann.
 */

/** Erkennt das Trennzeichen anhand der Kopfzeile. */
function detectDelimiter(text) {
  const firstLine = text.split(/\r?\n/)[0] || '';
  const counts = [',', ';', '\t'].map((char) => ({ char, count: firstLine.split(char).length - 1 }));
  return counts.sort((a, b) => b.count - a.count)[0].count ? counts.sort((a, b) => b.count - a.count)[0].char : ',';
}

/**
 * Zerlegt CSV-Text in Zeilen und Felder. Beachtet Anführungszeichen,
 * verdoppelte Anführungszeichen und Zeilenumbrüche innerhalb von Feldern.
 */
export function parse(text, delimiter = null) {
  const sep = delimiter || detectDelimiter(text);
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];

    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 1; }
        else quoted = false;
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') { quoted = true; continue; }
    if (char === sep) { row.push(field); field = ''; continue; }
    if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      continue;
    }
    if (char === '\r') continue;
    field += char;
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }

  return rows.filter((entry) => entry.some((cell) => String(cell).trim() !== ''));
}

/** Wandelt Zeilen in Objekte um, die erste Zeile gilt als Kopfzeile. */
export function toObjects(rows) {
  if (!rows.length) return { headers: [], records: [] };
  const headers = rows[0].map((cell) => String(cell).trim());
  const records = rows.slice(1).map((row) => {
    const record = {};
    headers.forEach((header, index) => { record[header] = row[index] ?? ''; });
    return record;
  });
  return { headers, records };
}

// ------------------------------------------------------------------ Erkennung

/** Bekannte Spaltennamen der gängigen Exporte, klein geschrieben. */
const ALIASES = {
  date: ['datum', 'date', 'tag', 'video publish time', 'veröffentlichungszeit', 'veroeffentlichungszeit', 'zeitpunkt', 'day', 'stream date', 'streamdatum'],
  title: ['videotitel', 'video title', 'titel', 'title', 'content', 'inhalt', 'beitrag', 'post', 'stream title', 'streamtitel', 'name'],
  views: ['aufrufe', 'views', 'video views', 'wiedergaben', 'aufrufe insgesamt', 'total views', 'plays', 'videoaufrufe'],
  impressions: ['impressionen', 'impressions', 'einblendungen'],
  reach: ['reichweite', 'reach', 'erreichte konten', 'accounts reached', 'unique viewers', 'einzelne zuschauer'],
  ctr: ['klickrate der impressionen (%)', 'impressions click-through rate (%)', 'klickrate', 'ctr', 'click-through rate'],
  avgViewSec: ['durchschnittliche wiedergabedauer', 'average view duration', 'ø wiedergabedauer', 'avg watch time', 'durchschnittliche wiedergabezeit'],
  watchHours: ['wiedergabezeit (stunden)', 'watch time (hours)', 'wiedergabezeit', 'watch time'],
  completionRate: ['abschlussrate', 'completion rate', 'vollständig angesehen', 'watched full video', 'durchschnittlich angesehen (%)'],
  likes: ['likes', 'mag ich', '„gefällt mir“-angaben', 'gefällt mir', 'reactions', 'reaktionen'],
  comments: ['kommentare', 'comments'],
  shares: ['geteilt', 'shares', 'weitergeleitet', 'mal geteilt'],
  saves: ['gespeichert', 'saves', 'gemerkt', 'bookmarks'],
  subsGained: ['abonnenten', 'subscribers', 'neue abonnenten', 'subscribers gained'],
  followersGained: ['neue follower', 'followers gained', 'follower', 'followers', 'neue abonnenten'],
  profileVisits: ['profilaufrufe', 'profile views', 'profilbesuche'],
  linkClicks: ['linkklicks', 'link clicks', 'klicks auf links'],
  avgViewers: ['durchschnittliche zuschauer', 'average viewers', 'ø zuschauer', 'avg viewers'],
  peakViewers: ['maximale zuschauer', 'peak viewers', 'höchstzuschauerzahl', 'max viewers'],
  hoursWatched: ['gesehene stunden', 'hours watched', 'zuschauerstunden'],
  chatMessages: ['chatnachrichten', 'chat messages'],
  streamMinutes: ['streamdauer', 'stream duration', 'live-minuten', 'minutes streamed'],
  replies: ['antworten', 'replies'],
  reposts: ['reposts', 'retweets', 'geteilte beiträge'],
  bookmarks: ['lesezeichen', 'bookmarks'],
  upvotes: ['upvotes', 'punkte', 'score'],
  openRate: ['öffnungsrate', 'open rate'],
};

/**
 * Ordnet den Spalten der Datei die Kennzahlen der App zu.
 * @returns {Record<string, string>} Kennzahl -> Spaltenname
 */
export function guessMapping(headers) {
  const mapping = {};
  const normalized = headers.map((header) => ({ header, key: header.toLowerCase().trim() }));

  for (const [field, names] of Object.entries(ALIASES)) {
    const exact = normalized.find((entry) => names.includes(entry.key));
    if (exact) { mapping[field] = exact.header; continue; }
    const partial = normalized.find((entry) => names.some((name) => entry.key.includes(name)));
    if (partial) mapping[field] = partial.header;
  }
  return mapping;
}

// ------------------------------------------------------------------ Werte

/** Liest deutsche und englische Zahlenformate, Prozentzeichen und Einheiten. */
export function toNumber(raw) {
  if (raw === null || raw === undefined) return null;
  let value = String(raw).trim().replace(/[%\s]/g, '').replace(/[^\d.,\-]/g, '');
  if (!value) return null;

  const lastComma = value.lastIndexOf(',');
  const lastDot = value.lastIndexOf('.');
  if (lastComma > lastDot) {
    value = value.replace(/\./g, '').replace(',', '.');   // 1.234,5
  } else if (lastDot > lastComma) {
    value = value.replace(/,/g, '');                       // 1,234.5
  } else {
    value = value.replace(',', '.');
  }

  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

/** Wandelt "0:31" oder "1:02:03" in Sekunden; einfache Zahlen bleiben Zahlen. */
export function toSeconds(raw) {
  const text = String(raw ?? '').trim();
  if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(text)) {
    const parts = text.split(':').map(Number);
    return parts.length === 3 ? parts[0] * 3600 + parts[1] * 60 + parts[2] : parts[0] * 60 + parts[1];
  }
  return toNumber(text);
}

/** Erkennt die gängigen Datumsformate der Exporte. */
export function toDateKey(raw) {
  const text = String(raw ?? '').trim();
  if (!text) return null;

  let match = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
  if (match) return `${match[1]}-${match[2]}-${match[3]}`;

  match = /^(\d{1,2})\.(\d{1,2})\.(\d{4})/.exec(text);            // 09.09.2026
  if (match) return `${match[3]}-${String(match[2]).padStart(2, '0')}-${String(match[1]).padStart(2, '0')}`;

  match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(text);            // 09/09/2026
  if (match) return `${match[3]}-${String(match[1]).padStart(2, '0')}-${String(match[2]).padStart(2, '0')}`;

  const parsed = new Date(text);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  return null;
}

/**
 * Baut aus Datensätzen und Zuordnung fertige Messwert-Einträge.
 * @returns {{entries: Array, skipped: number}}
 */
export function toEntries(records, mapping, platformId) {
  const entries = [];
  let skipped = 0;
  const today = new Date().toISOString().slice(0, 10);

  for (const record of records) {
    const metrics = {};
    for (const [field, column] of Object.entries(mapping)) {
      if (field === 'date' || field === 'title' || !column) continue;
      const raw = record[column];
      if (raw === undefined || String(raw).trim() === '') continue;
      metrics[field] = field === 'avgViewSec' ? toSeconds(raw) : toNumber(raw);
    }

    const hasValues = Object.values(metrics).some((value) => value !== null && value !== undefined);
    if (!hasValues) { skipped += 1; continue; }

    entries.push({
      platformId,
      date: (mapping.date && toDateKey(record[mapping.date])) || today,
      title: (mapping.title && String(record[mapping.title]).trim()) || '',
      metrics,
      source: 'csv',
    });
  }

  return { entries, skipped };
}
