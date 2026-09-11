/**
 * Die Schreibwerkstatt.
 *
 * Erzeugt Titel, Hooks, Ideen und Skriptgeruste und prueft Texte auf die
 * Fehler, die in der Praxis am meisten Reichweite kosten. Alles laeuft lokal
 * nach festen Mustern – kein Modell, kein Schluessel, keine Wartezeit.
 *
 * Die Muster stammen aus dem, was auf Kurzvideo- und Videoplattformen
 * nachweislich traegt: Neugierluecke, konkrete Zahl, Widerspruch, Kosten,
 * Zeitersparnis, Fehlervermeidung.
 *
 * Die Muster sind deutsche Schluessel fuer die Uebersetzung (mark/t): auf
 * Englisch entstehen daraus englische Vorschlaege. Sortiert wird immer nach dem
 * deutschen Schluessel, damit beide Sprachen dieselbe Reihenfolge haben.
 */

import { platform } from './platforms.js';
import { wordCount, speakingSeconds, num } from './format.js';
import { t, mark } from './i18n.js';

// ------------------------------------------------------------------ Muster

/**
 * Titelmuster. {t} wird durch das Thema ersetzt, {n} durch eine Zahl.
 *
 * Jedes Muster mit Zahl bringt seine eigenen, glaubwürdigen Werte mit. Eine
 * gemeinsame Zahlenliste für alle ergab Titel wie „Das hätte ich vor 21 Jahren
 * wissen sollen“ oder „100 Werkzeuge, die …“ – und damit genau das Gegenteil
 * eines guten Titels.
 */
const TITLE_PATTERNS = [
  { text: mark('Wie {t} wirklich funktioniert'), kind: mark('Erklärung') },
  { text: mark('{n} Dinge über {t}, die kaum jemand weiß'), kind: mark('Liste'), n: [3, 5, 7, 10] },
  { text: mark('Ich habe {n} Tage {t} gemacht – das kam dabei heraus'), kind: mark('Selbstversuch'), n: [7, 14, 30, 100] },
  { text: mark('Der häufigste Fehler bei {t}'), kind: mark('Fehler') },
  { text: mark('{t}: Anfänger gegen Fortgeschrittene'), kind: mark('Vergleich') },
  { text: mark('Warum {t} bei dir nicht funktioniert'), kind: mark('Diagnose') },
  { text: mark('{t} in {n} Minuten erklärt'), kind: mark('Kompakt'), n: [3, 5, 10] },
  { text: mark('Das hätte ich vor {n} Jahren über {t} wissen sollen'), kind: mark('Rückblick'), n: [2, 3, 5] },
  { text: mark('{t} – lohnt sich das überhaupt?'), kind: mark('Bewertung') },
  { text: mark('So macht man {t} richtig (ohne {x})'), kind: mark('Anleitung') },
  { text: mark('Von null auf {n} Abonnenten: mein Weg mit {t}'), kind: mark('Werdegang'), n: [1000, 10000] },
  { text: mark('Was niemand über {t} sagt'), kind: mark('Offenlegung') },
  { text: mark('{t} kostet dich mehr, als du denkst'), kind: mark('Warnung') },
  { text: mark('Der schnellste Weg zu {t}'), kind: mark('Abkürzung') },
  { text: mark('{n} Werkzeuge, die {t} sofort einfacher machen'), kind: mark('Werkzeuge'), n: [3, 5, 7] },
  { text: mark('Ich habe {t} getestet, damit du es nicht musst'), kind: mark('Test') },
  { text: mark('{t}: der Unterschied zwischen gut und großartig'), kind: mark('Feinschliff') },
  { text: mark('Hör auf, {t} so zu machen'), kind: mark('Widerspruch') },
];

/** Einstiegssaetze fuer die ersten Sekunden eines Videos – ebenfalls mit eigenen Zahlen. */
const HOOK_PATTERNS = [
  { text: mark('Die meisten machen bei {t} denselben Fehler – und merken es nie.') },
  { text: mark('Ich habe {n} Stunden in {t} gesteckt, damit du es in drei Minuten hast.'), n: [10, 20, 50, 100] },
  { text: mark('Wenn du bei {t} nur eine Sache änderst, dann diese.') },
  { text: mark('Das hier hat mein Ergebnis bei {t} verdoppelt.') },
  { text: mark('Vergiss alles, was du über {t} gehört hast.') },
  { text: mark('Es gibt zwei Arten von Leuten bei {t}. Eine davon verschwendet Zeit.') },
  { text: mark('Vor {n} Monaten konnte ich {t} überhaupt nicht. Heute so.'), n: [3, 6, 12] },
  { text: mark('Niemand redet darüber, aber {t} scheitert fast immer aus demselben Grund.') },
  { text: mark('Kurz bevor ich {t} aufgeben wollte, ist mir das aufgefallen.') },
  { text: mark('Das dauert 30 Sekunden und spart dir bei {t} Stunden.') },
  { text: mark('Schau dir das an – und dann sag mir, ob {t} für dich noch Sinn ergibt.') },
  // Muss unter 10 bleiben – vorher war hier „21 von 10“ möglich.
  { text: mark('{n} von 10 machen das bei {t} falsch. Ich war lange einer davon.'), n: [7, 8, 9] },
];

/** Ideengeber je nach Sorte Inhalt. */
const ANGLES = [
  { name: mark('Anfängerfehler'), prompt: mark('Was macht am Anfang fast jeder falsch bei {t}?') },
  { name: mark('Selbstversuch'), prompt: mark('{t} über einen festen Zeitraum ausprobieren und dokumentieren') },
  { name: mark('Vergleich'), prompt: mark('Zwei Wege zu {t} gegeneinander antreten lassen') },
  { name: mark('Werkzeugkasten'), prompt: mark('Die Ausrüstung oder Software, mit der du {t} machst') },
  { name: mark('Mythos'), prompt: mark('Eine verbreitete Behauptung über {t} überprüfen') },
  { name: mark('Kosten'), prompt: mark('Was {t} wirklich kostet – Geld, Zeit, Nerven') },
  { name: mark('Schnelldurchlauf'), prompt: mark('{t} von Anfang bis Ende in einem Durchgang zeigen') },
  { name: mark('Für Fortgeschrittene'), prompt: mark('Die Feinheiten, die erst nach Jahren bei {t} auffallen') },
  { name: mark('Hinter den Kulissen'), prompt: mark('Wie {t} bei dir tatsächlich abläuft, ungeschönt') },
  { name: mark('Fragen aus der Community'), prompt: mark('Die häufigsten Fragen zu {t} am Stück beantworten') },
  { name: mark('Gegenposition'), prompt: mark('Warum die verbreitete Meinung zu {t} falsch sein könnte') },
  { name: mark('Erstes Mal'), prompt: mark('Jemanden ohne Vorwissen {t} versuchen lassen') },
  { name: mark('Zahlen offengelegt'), prompt: mark('Die echten Zahlen hinter {t} zeigen') },
  { name: mark('Reparieren statt neu'), prompt: mark('Ein misslungenes {t} retten statt von vorn anzufangen') },
];

/** Aufbau eines Videos oder Beitrags, je nach Laenge. */
const TEMPLATE_SOURCE = {
  short: {
    label: mark('Kurzvideo (unter 60 Sekunden)'),
    beats: [
      { name: mark('Haken'), seconds: 3, hint: mark('Behauptung, Frage oder überraschendes Bild. Kein Gruß, kein Logo.') },
      { name: mark('Einordnung'), seconds: 7, hint: mark('Worum geht es genau, und warum betrifft es die Zuschauer?') },
      { name: mark('Kern'), seconds: 30, hint: mark('Die eigentliche Aussage in zwei bis drei Schritten. Ein Gedanke pro Satz.') },
      { name: mark('Auflösung'), seconds: 10, hint: mark('Das Versprechen aus dem Haken einlösen.') },
      { name: mark('Abbinder'), seconds: 5, hint: mark('Eine einzige Handlungsaufforderung – oder ein sauberer Loop zum Anfang.') },
    ],
  },
  medium: {
    label: mark('Mittleres Video (3 bis 8 Minuten)'),
    beats: [
      { name: mark('Haken'), seconds: 15, hint: mark('Das Ergebnis oder der Konflikt zuerst, nicht die Vorgeschichte.') },
      { name: mark('Versprechen'), seconds: 20, hint: mark('Was die Zuschauer am Ende können oder wissen werden.') },
      { name: mark('Kontext'), seconds: 45, hint: mark('Nur so viel Hintergrund wie nötig, um den Kern zu verstehen.') },
      { name: mark('Hauptteil 1'), seconds: 90, hint: mark('Erster Schritt oder erstes Argument, mit Beleg.') },
      { name: mark('Hauptteil 2'), seconds: 90, hint: mark('Zweiter Schritt. Hier gehört der stärkste Moment hin.') },
      { name: mark('Einwand'), seconds: 45, hint: mark('Den naheliegenden Gegeneinwand vorwegnehmen.') },
      { name: mark('Fazit'), seconds: 30, hint: mark('Eine Erkenntnis, die man weitererzählen kann.') },
      { name: mark('Abbinder'), seconds: 15, hint: mark('Nächstes Video empfehlen statt allgemein um Abos zu bitten.') },
    ],
  },
  long: {
    label: mark('Langes Video (über 10 Minuten)'),
    beats: [
      { name: mark('Kaltstart'), seconds: 20, hint: mark('Der spannendste Moment vorweg, aus der Mitte geschnitten.') },
      { name: mark('Rahmen'), seconds: 40, hint: mark('Wer, was, warum – und warum ausgerechnet jetzt.') },
      { name: mark('Kapitel 1'), seconds: 180, hint: mark('Aufbau. Kapitelmarke setzen.') },
      { name: mark('Wendepunkt'), seconds: 60, hint: mark('Etwas geht schief oder anders als geplant.') },
      { name: mark('Kapitel 2'), seconds: 180, hint: mark('Der Umgang damit – das ist meist der beste Teil.') },
      { name: mark('Kapitel 3'), seconds: 180, hint: mark('Ergebnis und Auswertung.') },
      { name: mark('Rückblick'), seconds: 60, hint: mark('Was du anders machen würdest.') },
      { name: mark('Ausblick'), seconds: 30, hint: mark('Brücke zum nächsten Inhalt.') },
    ],
  },
  text: {
    label: mark('Textbeitrag'),
    beats: [
      { name: mark('Erste Zeile'), seconds: 0, hint: mark('Steht allein im Feed und entscheidet über alles Weitere.') },
      { name: mark('Aufhänger'), seconds: 0, hint: mark('Konkrete Situation statt allgemeiner Einleitung.') },
      { name: mark('Kern'), seconds: 0, hint: mark('Zwei bis vier kurze Absätze, ein Gedanke je Absatz.') },
      { name: mark('Beleg'), seconds: 0, hint: mark('Zahl, Beispiel oder Erfahrung – das trennt Meinung von Substanz.') },
      { name: mark('Schluss'), seconds: 0, hint: mark('Eine Frage, die zum Antworten einlädt.') },
    ],
  },
  stream: {
    label: mark('Stream'),
    beats: [
      { name: mark('Vorlauf'), seconds: 300, hint: mark('Technik prüfen, Titel und Kategorie setzen, Ankündigung raus.') },
      { name: mark('Einstieg'), seconds: 600, hint: mark('Ohne Pause starten. Sagen, was heute passiert und wie lange.') },
      { name: mark('Hauptblock'), seconds: 3600, hint: mark('Der angekündigte Inhalt. Alle 20 Minuten kurz neu einordnen.') },
      { name: mark('Community-Block'), seconds: 900, hint: mark('Fragen, Wünsche, Gemeinsames – hier entstehen Stammzuschauer.') },
      { name: mark('Ausklang'), seconds: 300, hint: mark('Nächsten Termin nennen und weiterleiten.') },
      { name: mark('Nachbereitung'), seconds: 0, hint: mark('Zwei Clips ziehen und für die Woche einplanen.') },
    ],
  },
};

/** Ein Skriptgeruest in der aktuellen Sprache. */
const translateTemplate = (template) => ({
  label: t(template.label),
  beats: template.beats.map((beat) => ({ ...beat, name: t(beat.name), hint: t(beat.hint) })),
});

/**
 * Skriptgerueste je Laenge. Die Eintraege sind Getter: Beschriftungen und
 * Hinweise werden erst beim Lesen uebersetzt, weil die Sprache beim Laden
 * dieses Moduls noch nicht feststeht.
 */
export const SCRIPT_TEMPLATES = {};
for (const [key, template] of Object.entries(TEMPLATE_SOURCE)) {
  Object.defineProperty(SCRIPT_TEMPLATES, key, { enumerable: true, get: () => translateTemplate(template) });
}

/** Rückfall für Muster ohne eigene Zahlenliste. */
const NUMBERS = [3, 5, 7];
const pick = (list, seed) => list[Math.abs(seed) % list.length];

/** Wiederholbare Zufallsfolge: gleiche Eingabe, gleiche Vorschlaege. */
function seedFrom(text) {
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) hash = (hash * 31 + text.charCodeAt(i)) | 0;
  return hash;
}

/** Setzt Thema und die zum Muster passende Zahl ein – in der aktuellen Sprache. */
function fillPattern(pattern, topic, seed) {
  const number = pick(pattern.n || NUMBERS, seed);
  return t(pattern.text, {
    t: topic,
    // Grosse Zahlen mit Tausendertrennzeichen: 1.000 bzw. 1,000.
    n: number >= 1000 ? num(number) : String(number),
    x: t('teure Ausrüstung'),
  });
}

// ------------------------------------------------------------------ Erzeugen

/**
 * Titelvorschlaege zu einem Thema.
 * @param {string} topic
 * @param {number} count
 */
export function titles(topic, count = 8, offset = 0) {
  const clean = String(topic || '').trim();
  if (!clean) return [];
  const seed = seedFrom(clean) + offset;
  const shuffled = [...TITLE_PATTERNS].sort(
    (a, b) => ((seedFrom(a.text) + seed) % 97) - ((seedFrom(b.text) + seed) % 97)
  );
  return shuffled.slice(0, count).map((pattern, index) => ({
    kind: t(pattern.kind),
    text: fillPattern(pattern, clean, seed + index),
  }));
}

/** Einstiegssaetze fuer die ersten Sekunden. */
export function hooks(topic, count = 6, offset = 0) {
  const clean = String(topic || '').trim();
  if (!clean) return [];
  const seed = seedFrom(clean) + offset * 13;
  const shuffled = [...HOOK_PATTERNS].sort(
    (a, b) => ((seedFrom(a.text) + seed) % 89) - ((seedFrom(b.text) + seed) % 89)
  );
  return shuffled.slice(0, count).map((pattern, index) => fillPattern(pattern, clean, seed + index));
}

/**
 * Ideen zu einem Thema, jeweils mit Blickwinkel, Titelvorschlag und
 * empfohlenem Format.
 */
export function ideas(topic, count = 8, offset = 0) {
  const clean = String(topic || '').trim();
  if (!clean) return [];
  const seed = seedFrom(clean) + offset * 7;
  const angles = [...ANGLES].sort(
    (a, b) => ((seedFrom(a.name) + seed) % 83) - ((seedFrom(b.name) + seed) % 83)
  );
  return angles.slice(0, count).map((angle, index) => {
    const [title] = titles(clean, 1, seed + index * 3);
    return {
      angle: t(angle.name),
      prompt: t(angle.prompt, { t: clean }),
      title: title?.text || clean,
      hook: hooks(clean, 1, seed + index)[0],
    };
  });
}

/** Vorschlag fuer ein Skriptgeruest, passend zur laengsten gewaehlten Plattform. */
export function templateFor(platformIds = []) {
  const kinds = platformIds.map((id) => platform(id)?.kind);
  if (kinds.includes('live')) return SCRIPT_TEMPLATES.stream;
  if (kinds.includes('video')) return SCRIPT_TEMPLATES.long;
  if (kinds.includes('short') || kinds.includes('story')) return SCRIPT_TEMPLATES.short;
  if (kinds.includes('text') || kinds.includes('community') || kinds.includes('image')) return SCRIPT_TEMPLATES.text;
  return SCRIPT_TEMPLATES.medium;
}

// ------------------------------------------------------------------ Pruefen

// Deutsche und englische Wortlisten zugleich: Die Sprache des Textes muss nicht
// die Sprache der Oberflaeche sein.
const FILLER_WORDS = [
  'eigentlich', 'quasi', 'irgendwie', 'sozusagen', 'halt', 'einfach mal', 'im Prinzip', 'gewissermaßen', // i18n-ignore
  'basically', 'actually', 'literally', 'kind of', 'sort of', 'you know', 'i mean', // i18n-ignore
];
const WEAK_OPENERS = [
  'hallo', 'hi', 'hey leute', 'willkommen', 'in diesem video', 'heute zeige ich euch', 'moin zusammen', // i18n-ignore
  'hello', 'hey guys', 'hey everyone', 'welcome', 'in this video', 'today i', // i18n-ignore
];

/**
 * Prueft einen Text auf die haeufigsten Reichweitenbremsen.
 * @param {string} text
 * @param {{platformId?: string, field?: 'title'|'body', isVideoScript?: boolean}} options
 * @returns {Array<{tone: 'ok'|'warn'|'danger'|'info', message: string}>}
 */
export function check(text, { platformId = null, field = 'body', isVideoScript = false } = {}) {
  const value = String(text || '').trim();
  const notes = [];
  if (!value) return notes;

  const p = platformId ? platform(platformId) : null;
  const limit = p?.limits?.[field] || 0;
  const length = [...value].length;

  if (limit && length > limit) {
    notes.push({ tone: 'danger', message: t('{over} Zeichen über dem Limit von {platform} ({limit}).', { over: length - limit, platform: p.name, limit }) });
  } else if (limit && length > limit * 0.92) {
    notes.push({ tone: 'warn', message: t('Nur noch {left} Zeichen bis zum Limit von {platform}.', { left: limit - length, platform: p.name }) });
  }

  const firstLine = value.split('\n')[0].toLowerCase();
  if (WEAK_OPENERS.some((opener) => firstLine.startsWith(opener))) {
    notes.push({
      tone: 'warn',
      message: t('Der Einstieg beginnt mit einer Begrüßung. Die ersten Worte entscheiden über das Weiterschauen – setze die Aussage nach vorn.'),
    });
  }

  const foundFillers = FILLER_WORDS.filter((word) => value.toLowerCase().includes(word));
  if (foundFillers.length >= 2) {
    notes.push({ tone: 'info', message: t('Füllwörter gefunden: {words}. Ohne sie wirkt der Text bestimmter.', { words: foundFillers.join(', ') }) });
  }

  if (field === 'title') {
    if (length > 60 && (!limit || limit > 60)) {
      notes.push({ tone: 'info', message: t('Über 60 Zeichen wird der Titel auf dem Handy oft abgeschnitten.') });
    }
    if (!/\d/.test(value) && !/[?]/.test(value)) {
      notes.push({ tone: 'info', message: t('Eine konkrete Zahl oder eine Frage macht Titel messbar klickstärker.') });
    }
    if (value === value.toUpperCase() && length > 12) {
      notes.push({ tone: 'warn', message: t('Durchgehende Großschreibung wirkt schreierisch und wird schlechter geklickt.') });
    }
  }

  if (field === 'body') {
    const sentences = value.split(/[.!?]+/).filter((part) => part.trim().length > 3);
    const longSentences = sentences.filter((sentence) => wordCount(sentence) > 28).length;
    if (longSentences) {
      notes.push({
        tone: 'info',
        message: longSentences === 1
          ? t('{count} sehr lange Satz. Kürzere Sätze werden beim Sprechen und beim Überfliegen besser aufgenommen.', { count: longSentences })
          : t('{count} sehr lange Sätze. Kürzere Sätze werden beim Sprechen und beim Überfliegen besser aufgenommen.', { count: longSentences }),
      });
    }
    if (!/[?]/.test(value) && p?.kind !== 'video') {
      notes.push({ tone: 'info', message: t('Ohne Frage im Text gibt es wenig Anlass zu kommentieren.') });
    }
    const paragraphs = value.split(/\n\s*\n/).length;
    if (length > 600 && paragraphs < 3) {
      notes.push({ tone: 'warn', message: t('Langer Text ohne Absätze – auf dem Handy eine Wand. Alle zwei bis drei Sätze eine Leerzeile.') });
    }
  }

  if (isVideoScript) {
    const seconds = speakingSeconds(value);
    const max = p?.limits?.videoSecMax;
    if (max && seconds > max) {
      notes.push({ tone: 'danger', message: t('Gesprochen rund {seconds} Sekunden – {platform} erlaubt höchstens {max}.', { seconds: Math.round(seconds), platform: p.name, max }) });
    } else {
      notes.push({ tone: 'ok', message: t('Gesprochen etwa {seconds} Sekunden bei {words} Wörtern.', { seconds: Math.round(seconds), words: wordCount(value) }) });
    }
  }

  return notes;
}

/**
 * Hashtag-Vorschlaege aus dem Text: die haeufigsten aussagekraeftigen Woerter,
 * ergaenzt um gespeicherte Sets.
 */
export function suggestHashtags(text, { limit = 8 } = {}) {
  const stop = new Set([
    'und', 'oder', 'aber', 'dass', 'weil', 'wenn', 'dann', 'noch', 'auch', 'schon', 'mehr', 'sehr', // i18n-ignore
    'eine', 'einen', 'einem', 'eines', 'der', 'die', 'das', 'den', 'dem', 'des', 'ich', 'wir', 'ihr', // i18n-ignore
    'sie', 'man', 'mit', 'ohne', 'fuer', 'für', 'vom', 'zum', 'zur', 'ist', 'sind', 'war', 'wird', // i18n-ignore
    'hat', 'habe', 'haben', 'kann', 'muss', 'soll', 'nicht', 'nur', 'hier', 'dort', 'was', 'wie', // i18n-ignore
    'warum', 'wer', 'wo', 'alle', 'jede', 'jeder', 'sich', 'sein', 'ihre', 'euer', 'diese', 'dieser', // i18n-ignore
    // Englische Fuellwoerter, damit englische Texte brauchbare Vorschlaege liefern.
    'that', 'this', 'with', 'from', 'have', 'your', 'they', 'them', 'then', 'than', 'what', 'when', // i18n-ignore
    'where', 'which', 'will', 'would', 'could', 'should', 'there', 'their', 'about', 'into', 'just', // i18n-ignore
    'like', 'more', 'some', 'very', 'been', 'were', 'also', 'only', 'over', 'here', 'because', 'these', // i18n-ignore
    'those', 'does', 'really', 'every', 'much', 'most', 'want', 'make', // i18n-ignore
  ]);
  const counts = new Map();
  for (const raw of String(text || '').toLowerCase().match(/[a-zäöüß][a-zäöüß0-9-]{3,}/g) || []) {
    if (stop.has(raw)) continue;
    counts.set(raw, (counts.get(raw) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)
    .slice(0, limit)
    .map(([word]) => word.replace(/-/g, ''));
}
