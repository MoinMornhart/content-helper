/**
 * Der Assistent.
 *
 * Beantwortet die Frage, die am meisten wert ist: „Was von dem, was ich gemacht
 * habe, hat funktioniert – und was soll ich als Nächstes machen?“
 *
 * Vorgehen: Ein Beitrag gilt als Treffer, wenn er deutlich über deinem eigenen
 * Mittelwert liegt. Aus den Treffern werden wiederholbare Merkmale gezogen –
 * Themenwörter im Titel, Format, Wochentag, Uhrzeit – und daraus konkrete
 * Vorschläge gebaut.
 *
 * Zwei Grundsätze halten das ehrlich:
 *
 * 1. Verglichen wird immer mit dem Median, nicht mit dem Durchschnitt. Ein
 *    einzelner Ausreisser nach oben würde den Durchschnitt so verschieben, dass
 *    danach alles andere „unterdurchschnittlich“ aussieht.
 * 2. Eine Aussage entsteht erst ab einer Mindestzahl an Beiträgen. Aus zwei
 *    Videos lässt sich kein Muster ableiten, und ein Werkzeug, das so tut, ist
 *    schlimmer als keines.
 */

import * as store from './store.js';
import * as fmt from './format.js';
import { platform, metric } from './platforms.js';
import { titles as titleSuggestions, hooks as hookSuggestions } from './writing.js';

/** Ab so vielen gemessenen Beiträgen traut sich der Assistent eine Aussage zu. */
const MIN_POSTS = 5;

/** Ein Treffer liegt mindestens um diesen Faktor über dem Median. */
const WINNER_FACTOR = 1.5;

/** Ein Merkmal gilt als tragend, wenn es mindestens so viel Vorsprung bringt. */
const LIFT_THRESHOLD = 1.4;

const STOPWORDS = new Set([
  'und', 'oder', 'aber', 'dass', 'weil', 'wenn', 'dann', 'noch', 'auch', 'schon', 'mehr', 'sehr',
  'eine', 'einen', 'einem', 'eines', 'der', 'die', 'das', 'den', 'dem', 'des', 'ich', 'wir', 'ihr',
  'sie', 'man', 'mit', 'ohne', 'für', 'fuer', 'vom', 'zum', 'zur', 'ist', 'sind', 'war', 'wird',
  'hat', 'habe', 'haben', 'kann', 'muss', 'soll', 'nicht', 'nur', 'hier', 'dort', 'was', 'wie',
  'warum', 'wer', 'alle', 'jede', 'jeder', 'sich', 'sein', 'ihre', 'euer', 'diese', 'dieser',
  'mein', 'meine', 'dein', 'deine', 'euch', 'uns', 'von', 'auf', 'aus', 'bei', 'nach', 'über',
  'unter', 'vor', 'durch', 'gegen', 'ohne', 'um', 'als', 'wie', 'so', 'sehr', 'ganz', 'immer',
  'the', 'and', 'for', 'you', 'your', 'with', 'this', 'that', 'from', 'have', 'was', 'are', 'but',
  'new', 'how', 'why', 'what', 'best', 'top', 'video', 'stream', 'part', 'folge', 'teil',
]);

// ------------------------------------------------------------------ Werkzeuge

/** Median: unempfindlich gegen einzelne Ausreisser. */
export function median(values) {
  const sorted = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/** Wörter eines Titels, die als Thema taugen. */
export function keywords(text) {
  const found = String(text || '')
    .toLowerCase()
    .match(/[a-zäöüß][a-zäöüß0-9-]{2,}/g) || [];
  return [...new Set(found.filter((word) => word.length >= 4 && !STOPWORDS.has(word)))];
}

/** Welche Kennzahl trägt die Aussage auf dieser Plattform? */
export function leadMetric(platformId) {
  const known = platform(platformId);
  if (!known) return 'views';
  if (known.metrics.includes('views')) return 'views';
  if (known.metrics.includes('reach')) return 'reach';
  if (known.metrics.includes('impressions')) return 'impressions';
  return known.metrics[0];
}

/**
 * Alle gemessenen Beiträge einer Plattform, zusammengeführt aus Messwert und
 * zugehörigem Beitrag.
 *
 * @returns {Array<{entry, post, title, value, at, format}>}
 */
export function measured({ platformId = null, days = 365 } = {}) {
  const posts = new Map(store.all('posts').map((post) => [post.id, post]));
  const since = fmt.addDays(new Date(), -days);

  return store.all('analytics')
    .filter((entry) => !platformId || entry.platformId === platformId)
    .map((entry) => {
      const post = entry.postId ? posts.get(entry.postId) : null;
      const key = leadMetric(entry.platformId);
      const value = Number(entry.metrics?.[key]);
      const at = post?.publishedAt || post?.scheduledAt || entry.date;
      return {
        entry,
        post,
        title: entry.title || post?.title || '',
        value: Number.isFinite(value) ? value : null,
        at,
        format: post?.format || null,
        platformId: entry.platformId,
        metricKey: key,
      };
    })
    .filter((row) => row.value !== null && row.title && new Date(row.at) >= since);
}

// ------------------------------------------------------------------ Treffer

/**
 * Die Beiträge, die deutlich über dem eigenen Mittelmass liegen.
 * @returns {{winners: Array, baseline: number|null, total: number}}
 */
export function winners({ platformId = null, days = 365 } = {}) {
  const rows = measured({ platformId, days });
  const base = median(rows.map((row) => row.value));

  if (!base || rows.length < MIN_POSTS) return { winners: [], baseline: base, total: rows.length };

  const found = rows
    .filter((row) => row.value >= base * WINNER_FACTOR)
    .map((row) => ({ ...row, lift: row.value / base }))
    .sort((a, b) => b.value - a.value);

  return { winners: found, baseline: base, total: rows.length };
}

/**
 * Themenwörter, die messbar mehr bringen als der Rest.
 *
 * Verglichen wird der Median der Beiträge mit dem Wort gegen den Median der
 * Beiträge ohne das Wort – nicht gegen den Gesamtdurchschnitt, weil sonst jedes
 * Wort eines starken Beitrags automatisch gut aussähe.
 */
export function topics({ platformId = null, days = 365, minPosts = 2 } = {}) {
  const rows = measured({ platformId, days });
  if (rows.length < MIN_POSTS) return [];

  const counts = new Map();
  for (const row of rows) {
    for (const word of keywords(row.title)) {
      if (!counts.has(word)) counts.set(word, []);
      counts.get(word).push(row);
    }
  }

  const results = [];
  for (const [word, withWord] of counts) {
    if (withWord.length < minPosts) continue;
    const withoutWord = rows.filter((row) => !withWord.includes(row));
    if (withoutWord.length < 2) continue;

    const withMedian = median(withWord.map((row) => row.value));
    const withoutMedian = median(withoutWord.map((row) => row.value));
    if (!withoutMedian) continue;

    const lift = withMedian / withoutMedian;
    if (lift < LIFT_THRESHOLD) continue;

    results.push({
      word,
      count: withWord.length,
      withMedian,
      withoutMedian,
      lift,
      metricKey: withWord[0].metricKey,
      platformId: withWord[0].platformId,
      examples: [...withWord].sort((a, b) => b.value - a.value).slice(0, 3),
    });
  }

  // Häufigkeit und Vorsprung gemeinsam gewichten: ein Wort aus acht Beiträgen
  // mit gutem Vorsprung wiegt schwerer als eines aus zweien mit grossem.
  return results.sort((a, b) => (b.lift * Math.log2(b.count + 1)) - (a.lift * Math.log2(a.count + 1)));
}

/** Titelbauweisen, die bei dir messbar besser laufen. */
export function titleShapes({ platformId = null, days = 365 } = {}) {
  const rows = measured({ platformId, days });
  if (rows.length < MIN_POSTS) return [];

  const shapes = [
    { id: 'number', label: 'Zahl im Titel', test: (title) => /\d/.test(title), hint: 'Eine konkrete Zahl macht das Versprechen greifbar.' },
    { id: 'question', label: 'Frage im Titel', test: (title) => title.includes('?'), hint: 'Eine Frage öffnet eine Lücke, die man schliessen will.' },
    { id: 'howto', label: 'Anleitung („wie“, „so“)', test: (title) => /\b(wie|so)\b/i.test(title), hint: 'Anleitungen versprechen ein Ergebnis.' },
    { id: 'versus', label: 'Vergleich („gegen“, „vs“)', test: (title) => /\b(gegen|vs\.?)\b/i.test(title), hint: 'Ein Vergleich erzeugt Spannung ohne Aufwand.' },
    { id: 'personal', label: 'Ich-Form („ich habe“)', test: (title) => /\bich\b/i.test(title), hint: 'Selbsterlebtes wirkt glaubwürdiger als Allgemeinplätze.' },
    { id: 'short', label: 'Kurzer Titel (unter 40 Zeichen)', test: (title) => title.length < 40, hint: 'Kurze Titel werden auf dem Handy vollständig gelesen.' },
  ];

  const results = [];
  for (const shape of shapes) {
    const yes = rows.filter((row) => shape.test(row.title));
    const no = rows.filter((row) => !shape.test(row.title));
    if (yes.length < 2 || no.length < 2) continue;

    const yesMedian = median(yes.map((row) => row.value));
    const noMedian = median(no.map((row) => row.value));
    if (!noMedian) continue;

    const lift = yesMedian / noMedian;
    if (lift < LIFT_THRESHOLD) continue;

    results.push({ ...shape, count: yes.length, yesMedian, noMedian, lift, metricKey: yes[0].metricKey });
  }
  return results.sort((a, b) => b.lift - a.lift);
}

/** Bester Wochentag und beste Stunde, sofern genug Beiträge zugeordnet sind. */
export function timing({ platformId = null, days = 365 } = {}) {
  const rows = measured({ platformId, days }).filter((row) => row.post);
  if (rows.length < MIN_POSTS) return null;

  const group = (keyOf) => {
    const buckets = new Map();
    for (const row of rows) {
      const key = keyOf(new Date(row.at));
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(row.value);
    }
    return [...buckets.entries()]
      .filter(([, values]) => values.length >= 2)
      .map(([key, values]) => ({ key, count: values.length, value: median(values) }))
      .sort((a, b) => b.value - a.value);
  };

  const weekdays = group((date) => date.getDay());
  const hours = group((date) => date.getHours());

  return {
    weekday: weekdays[0] || null,
    weekdayField: weekdays,
    hour: hours[0] || null,
    hourField: hours,
  };
}

// ------------------------------------------------------------------ Vorschläge

/**
 * Die eigentliche Antwort: konkrete nächste Inhalte, jeder mit Begründung aus
 * den eigenen Zahlen und mit fertigen Titelvorschlägen.
 *
 * @returns {Array<{id, kind, topic, title, why, evidence, titles, hook, platformId, format, when}>}
 */
export function suggestions({ platformId = null, days = 365, limit = 6 } = {}) {
  const strongTopics = topics({ platformId, days });
  const shapes = titleShapes({ platformId, days });
  const clock = timing({ platformId, days });
  const { winners: best, baseline } = winners({ platformId, days });

  const out = [];
  const info = (key) => metric(key);
  const show = (value, key) => fmt.metricValue(value, info(key).type);

  // --- Aus starken Themen: mehr davon, in neuen Blickwinkeln
  for (const topic of strongTopics.slice(0, 4)) {
    const example = topic.examples[0];
    out.push({
      id: `topic:${topic.word}`,
      kind: 'Thema wiederholen',
      topic: topic.word,
      platformId: topic.platformId,
      title: `Mehr zum Thema „${topic.word}“`,
      why: `Beiträge mit „${topic.word}“ im Titel erreichen bei dir im Mittel ${show(topic.withMedian, topic.metricKey)} – das ist das ${topic.lift.toFixed(1)}-fache deiner übrigen Beiträge (${show(topic.withoutMedian, topic.metricKey)}). Das ist kein Zufallstreffer, sondern zieht sich durch ${fmt.plural(topic.count, 'Beitrag', 'Beiträge')}.`,
      evidence: topic.examples.map((row) => `${fmt.truncate(row.title, 60)} – ${show(row.value, row.metricKey)}`),
      titles: titleSuggestions(topic.word, 4),
      hook: hookSuggestions(topic.word, 1)[0],
      format: example?.format || null,
      when: clock?.weekday ? { weekday: clock.weekday.key, hour: clock.hour?.key ?? null } : null,
    });
  }

  // --- Aus dem stärksten Einzelbeitrag: die Nachfolge
  if (best.length) {
    const top = best[0];
    const topic = keywords(top.title)[0] || top.title.split(/\s+/)[0];
    out.push({
      id: `winner:${top.entry.id}`,
      kind: 'Erfolg fortsetzen',
      topic,
      platformId: top.platformId,
      title: `Nachfolger für „${fmt.truncate(top.title, 50)}“`,
      why: `Dieser Beitrag liegt mit ${show(top.value, top.metricKey)} beim ${top.lift.toFixed(1)}-fachen deines Mittelwerts (${show(baseline, top.metricKey)}). Ein Publikum, das einmal zugegriffen hat, greift beim selben Thema wieder zu – der zweite Teil ist fast immer günstiger als ein neues Thema.`,
      evidence: [`Veröffentlicht ${fmt.date(top.at, 'medium')}${top.format ? ` · Format: ${top.format}` : ''}`],
      titles: titleSuggestions(topic, 4),
      hook: hookSuggestions(topic, 1)[0],
      format: top.format,
      when: clock?.weekday ? { weekday: clock.weekday.key, hour: clock.hour?.key ?? null } : null,
    });
  }

  // --- Aus Titelbauweisen: dieselben Themen, besser verpackt
  for (const shape of shapes.slice(0, 2)) {
    out.push({
      id: `shape:${shape.id}`,
      kind: 'Verpackung ändern',
      topic: null,
      platformId,
      title: `Häufiger: ${shape.label}`,
      why: `Titel dieser Bauart erreichen bei dir ${show(shape.yesMedian, shape.metricKey)} gegenüber ${show(shape.noMedian, shape.metricKey)} bei den übrigen – das ${shape.lift.toFixed(1)}-fache. ${shape.hint}`,
      evidence: [`Grundlage: ${fmt.plural(shape.count, 'Beitrag', 'Beiträge')} mit diesem Merkmal`],
      titles: [],
      hook: null,
      format: null,
      when: null,
    });
  }

  return out.slice(0, limit);
}

/**
 * Kurzfassung für Dashboard und Kopfzeilen: reicht die Datenlage überhaupt?
 */
export function readiness({ platformId = null, days = 365 } = {}) {
  const rows = measured({ platformId, days });
  const linked = rows.filter((row) => row.post).length;
  return {
    measured: rows.length,
    linked,
    enough: rows.length >= MIN_POSTS,
    missing: Math.max(0, MIN_POSTS - rows.length),
    minPosts: MIN_POSTS,
  };
}
