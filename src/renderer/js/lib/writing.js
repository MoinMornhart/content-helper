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
 */

import { platform } from './platforms.js';
import { wordCount, speakingSeconds } from './format.js';

// ------------------------------------------------------------------ Muster

/** Titelmuster. {t} wird durch das Thema ersetzt, {n} durch eine Zahl. */
const TITLE_PATTERNS = [
  { text: 'Wie {t} wirklich funktioniert', kind: 'Erklärung' },
  { text: '{n} Dinge über {t}, die kaum jemand weiß', kind: 'Liste' },
  { text: 'Ich habe {n} Tage {t} gemacht – das kam dabei heraus', kind: 'Selbstversuch' },
  { text: 'Der häufigste Fehler bei {t}', kind: 'Fehler' },
  { text: '{t}: Anfänger gegen Fortgeschrittene', kind: 'Vergleich' },
  { text: 'Warum dein {t} nicht funktioniert', kind: 'Diagnose' },
  { text: '{t} in {n} Minuten erklärt', kind: 'Kompakt' },
  { text: 'Das hätte ich vor {n} Jahren über {t} wissen sollen', kind: 'Rückblick' },
  { text: '{t} – lohnt sich das überhaupt?', kind: 'Bewertung' },
  { text: 'So macht man {t} richtig (ohne {x})', kind: 'Anleitung' },
  { text: 'Von null auf {n}: mein Weg mit {t}', kind: 'Werdegang' },
  { text: 'Was niemand über {t} sagt', kind: 'Offenlegung' },
  { text: '{t} kostet dich mehr, als du denkst', kind: 'Warnung' },
  { text: 'Der schnellste Weg zu {t}', kind: 'Abkürzung' },
  { text: '{n} Werkzeuge, die {t} sofort einfacher machen', kind: 'Werkzeuge' },
  { text: 'Ich habe {t} getestet, damit du es nicht musst', kind: 'Test' },
  { text: '{t}: der Unterschied zwischen gut und großartig', kind: 'Feinschliff' },
  { text: 'Hör auf, {t} so zu machen', kind: 'Widerspruch' },
];

/** Einstiegssaetze fuer die ersten Sekunden eines Videos. */
const HOOK_PATTERNS = [
  'Die meisten machen bei {t} denselben Fehler – und merken es nie.',
  'Ich habe {n} Stunden in {t} gesteckt, damit du es in drei Minuten hast.',
  'Wenn du bei {t} nur eine Sache änderst, dann diese.',
  'Das hier hat mein Ergebnis bei {t} verdoppelt.',
  'Vergiss alles, was du über {t} gehört hast.',
  'Es gibt zwei Arten von Leuten bei {t}. Eine davon verschwendet Zeit.',
  'Vor {n} Monaten konnte ich {t} überhaupt nicht. Heute so.',
  'Niemand redet darüber, aber {t} scheitert fast immer aus demselben Grund.',
  'Kurz bevor ich {t} aufgeben wollte, ist mir das aufgefallen.',
  'Das dauert 30 Sekunden und spart dir bei {t} Stunden.',
  'Schau dir das an – und dann sag mir, ob {t} für dich noch Sinn ergibt.',
  '{n} von 10 machen das bei {t} falsch. Ich war lange einer davon.',
];

/** Ideengeber je nach Sorte Inhalt. */
const ANGLES = [
  { name: 'Anfängerfehler', prompt: 'Was macht am Anfang fast jeder falsch bei {t}?' },
  { name: 'Selbstversuch', prompt: '{t} über einen festen Zeitraum ausprobieren und dokumentieren' },
  { name: 'Vergleich', prompt: 'Zwei Wege zu {t} gegeneinander antreten lassen' },
  { name: 'Werkzeugkasten', prompt: 'Die Ausrüstung oder Software, mit der du {t} machst' },
  { name: 'Mythos', prompt: 'Eine verbreitete Behauptung über {t} überprüfen' },
  { name: 'Kosten', prompt: 'Was {t} wirklich kostet – Geld, Zeit, Nerven' },
  { name: 'Schnelldurchlauf', prompt: '{t} von Anfang bis Ende in einem Durchgang zeigen' },
  { name: 'Für Fortgeschrittene', prompt: 'Die Feinheiten, die erst nach Jahren bei {t} auffallen' },
  { name: 'Hinter den Kulissen', prompt: 'Wie {t} bei dir tatsächlich abläuft, ungeschönt' },
  { name: 'Fragen aus der Community', prompt: 'Die häufigsten Fragen zu {t} am Stück beantworten' },
  { name: 'Gegenposition', prompt: 'Warum die verbreitete Meinung zu {t} falsch sein könnte' },
  { name: 'Erstes Mal', prompt: 'Jemanden ohne Vorwissen {t} versuchen lassen' },
  { name: 'Zahlen offengelegt', prompt: 'Die echten Zahlen hinter {t} zeigen' },
  { name: 'Reparieren statt neu', prompt: 'Ein misslungenes {t} retten statt von vorn anzufangen' },
];

/** Aufbau eines Videos oder Beitrags, je nach Laenge. */
export const SCRIPT_TEMPLATES = {
  short: {
    label: 'Kurzvideo (unter 60 Sekunden)',
    beats: [
      { name: 'Haken', seconds: 3, hint: 'Behauptung, Frage oder überraschendes Bild. Kein Gruß, kein Logo.' },
      { name: 'Einordnung', seconds: 7, hint: 'Worum geht es genau, und warum betrifft es die Zuschauer?' },
      { name: 'Kern', seconds: 30, hint: 'Die eigentliche Aussage in zwei bis drei Schritten. Ein Gedanke pro Satz.' },
      { name: 'Auflösung', seconds: 10, hint: 'Das Versprechen aus dem Haken einlösen.' },
      { name: 'Abbinder', seconds: 5, hint: 'Eine einzige Handlungsaufforderung – oder ein sauberer Loop zum Anfang.' },
    ],
  },
  medium: {
    label: 'Mittleres Video (3 bis 8 Minuten)',
    beats: [
      { name: 'Haken', seconds: 15, hint: 'Das Ergebnis oder der Konflikt zuerst, nicht die Vorgeschichte.' },
      { name: 'Versprechen', seconds: 20, hint: 'Was die Zuschauer am Ende können oder wissen werden.' },
      { name: 'Kontext', seconds: 45, hint: 'Nur so viel Hintergrund wie nötig, um den Kern zu verstehen.' },
      { name: 'Hauptteil 1', seconds: 90, hint: 'Erster Schritt oder erstes Argument, mit Beleg.' },
      { name: 'Hauptteil 2', seconds: 90, hint: 'Zweiter Schritt. Hier gehört der stärkste Moment hin.' },
      { name: 'Einwand', seconds: 45, hint: 'Den naheliegenden Gegeneinwand vorwegnehmen.' },
      { name: 'Fazit', seconds: 30, hint: 'Eine Erkenntnis, die man weitererzählen kann.' },
      { name: 'Abbinder', seconds: 15, hint: 'Nächstes Video empfehlen statt allgemein um Abos zu bitten.' },
    ],
  },
  long: {
    label: 'Langes Video (über 10 Minuten)',
    beats: [
      { name: 'Kaltstart', seconds: 20, hint: 'Der spannendste Moment vorweg, aus der Mitte geschnitten.' },
      { name: 'Rahmen', seconds: 40, hint: 'Wer, was, warum – und warum ausgerechnet jetzt.' },
      { name: 'Kapitel 1', seconds: 180, hint: 'Aufbau. Kapitelmarke setzen.' },
      { name: 'Wendepunkt', seconds: 60, hint: 'Etwas geht schief oder anders als geplant.' },
      { name: 'Kapitel 2', seconds: 180, hint: 'Der Umgang damit – das ist meist der beste Teil.' },
      { name: 'Kapitel 3', seconds: 180, hint: 'Ergebnis und Auswertung.' },
      { name: 'Rückblick', seconds: 60, hint: 'Was du anders machen würdest.' },
      { name: 'Ausblick', seconds: 30, hint: 'Brücke zum nächsten Inhalt.' },
    ],
  },
  text: {
    label: 'Textbeitrag',
    beats: [
      { name: 'Erste Zeile', seconds: 0, hint: 'Steht allein im Feed und entscheidet über alles Weitere.' },
      { name: 'Aufhänger', seconds: 0, hint: 'Konkrete Situation statt allgemeiner Einleitung.' },
      { name: 'Kern', seconds: 0, hint: 'Zwei bis vier kurze Absätze, ein Gedanke je Absatz.' },
      { name: 'Beleg', seconds: 0, hint: 'Zahl, Beispiel oder Erfahrung – das trennt Meinung von Substanz.' },
      { name: 'Schluss', seconds: 0, hint: 'Eine Frage, die zum Antworten einlädt.' },
    ],
  },
  stream: {
    label: 'Stream',
    beats: [
      { name: 'Vorlauf', seconds: 300, hint: 'Technik prüfen, Titel und Kategorie setzen, Ankündigung raus.' },
      { name: 'Einstieg', seconds: 600, hint: 'Ohne Pause starten. Sagen, was heute passiert und wie lange.' },
      { name: 'Hauptblock', seconds: 3600, hint: 'Der angekündigte Inhalt. Alle 20 Minuten kurz neu einordnen.' },
      { name: 'Community-Block', seconds: 900, hint: 'Fragen, Wünsche, Gemeinsames – hier entstehen Stammzuschauer.' },
      { name: 'Ausklang', seconds: 300, hint: 'Nächsten Termin nennen und weiterleiten.' },
      { name: 'Nachbereitung', seconds: 0, hint: 'Zwei Clips ziehen und für die Woche einplanen.' },
    ],
  },
};

const NUMBERS = [3, 5, 7, 10, 12, 21, 30, 100];
const pick = (list, seed) => list[Math.abs(seed) % list.length];

/** Wiederholbare Zufallsfolge: gleiche Eingabe, gleiche Vorschlaege. */
function seedFrom(text) {
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) hash = (hash * 31 + text.charCodeAt(i)) | 0;
  return hash;
}

function fillPattern(pattern, topic, seed) {
  return pattern
    .replaceAll('{t}', topic)
    .replaceAll('{n}', String(pick(NUMBERS, seed)))
    .replaceAll('{x}', 'teure Ausrüstung');
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
    kind: pattern.kind,
    text: fillPattern(pattern.text, clean, seed + index),
  }));
}

/** Einstiegssaetze fuer die ersten Sekunden. */
export function hooks(topic, count = 6, offset = 0) {
  const clean = String(topic || '').trim();
  if (!clean) return [];
  const seed = seedFrom(clean) + offset * 13;
  const shuffled = [...HOOK_PATTERNS].sort(
    (a, b) => ((seedFrom(a) + seed) % 89) - ((seedFrom(b) + seed) % 89)
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
      angle: angle.name,
      prompt: angle.prompt.replaceAll('{t}', clean),
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

const FILLER_WORDS = ['eigentlich', 'quasi', 'irgendwie', 'sozusagen', 'halt', 'einfach mal', 'im Prinzip', 'gewissermaßen'];
const WEAK_OPENERS = ['hallo', 'hi', 'hey leute', 'willkommen', 'in diesem video', 'heute zeige ich euch', 'moin zusammen'];

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
    notes.push({ tone: 'danger', message: `${length - limit} Zeichen über dem Limit von ${p.name} (${limit}).` });
  } else if (limit && length > limit * 0.92) {
    notes.push({ tone: 'warn', message: `Nur noch ${limit - length} Zeichen bis zum Limit von ${p.name}.` });
  }

  const firstLine = value.split('\n')[0].toLowerCase();
  if (WEAK_OPENERS.some((opener) => firstLine.startsWith(opener))) {
    notes.push({
      tone: 'warn',
      message: 'Der Einstieg beginnt mit einer Begrüßung. Die ersten Worte entscheiden über das Weiterschauen – setze die Aussage nach vorn.',
    });
  }

  const foundFillers = FILLER_WORDS.filter((word) => value.toLowerCase().includes(word));
  if (foundFillers.length >= 2) {
    notes.push({ tone: 'info', message: `Füllwörter gefunden: ${foundFillers.join(', ')}. Ohne sie wirkt der Text bestimmter.` });
  }

  if (field === 'title') {
    if (length > 60 && (!limit || limit > 60)) {
      notes.push({ tone: 'info', message: 'Über 60 Zeichen wird der Titel auf dem Handy oft abgeschnitten.' });
    }
    if (!/\d/.test(value) && !/[?]/.test(value)) {
      notes.push({ tone: 'info', message: 'Eine konkrete Zahl oder eine Frage macht Titel messbar klickstärker.' });
    }
    if (value === value.toUpperCase() && length > 12) {
      notes.push({ tone: 'warn', message: 'Durchgehende Großschreibung wirkt schreierisch und wird schlechter geklickt.' });
    }
  }

  if (field === 'body') {
    const sentences = value.split(/[.!?]+/).filter((part) => part.trim().length > 3);
    const longSentences = sentences.filter((sentence) => wordCount(sentence) > 28).length;
    if (longSentences) {
      notes.push({ tone: 'info', message: `${longSentences} sehr lange ${longSentences === 1 ? 'Satz' : 'Sätze'}. Kürzere Sätze werden beim Sprechen und beim Überfliegen besser aufgenommen.` });
    }
    if (!/[?]/.test(value) && p?.kind !== 'video') {
      notes.push({ tone: 'info', message: 'Ohne Frage im Text gibt es wenig Anlass zu kommentieren.' });
    }
    const paragraphs = value.split(/\n\s*\n/).length;
    if (length > 600 && paragraphs < 3) {
      notes.push({ tone: 'warn', message: 'Langer Text ohne Absätze – auf dem Handy eine Wand. Alle zwei bis drei Sätze eine Leerzeile.' });
    }
  }

  if (isVideoScript) {
    const seconds = speakingSeconds(value);
    const max = p?.limits?.videoSecMax;
    if (max && seconds > max) {
      notes.push({ tone: 'danger', message: `Gesprochen rund ${Math.round(seconds)} Sekunden – ${p.name} erlaubt höchstens ${max}.` });
    } else {
      notes.push({ tone: 'ok', message: `Gesprochen etwa ${Math.round(seconds)} Sekunden bei ${wordCount(value)} Wörtern.` });
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
    'und', 'oder', 'aber', 'dass', 'weil', 'wenn', 'dann', 'noch', 'auch', 'schon', 'mehr', 'sehr',
    'eine', 'einen', 'einem', 'eines', 'der', 'die', 'das', 'den', 'dem', 'des', 'ich', 'wir', 'ihr',
    'sie', 'man', 'mit', 'ohne', 'fuer', 'für', 'vom', 'zum', 'zur', 'ist', 'sind', 'war', 'wird',
    'hat', 'habe', 'haben', 'kann', 'muss', 'soll', 'nicht', 'nur', 'hier', 'dort', 'was', 'wie',
    'warum', 'wer', 'wo', 'alle', 'jede', 'jeder', 'sich', 'sein', 'ihre', 'euer', 'diese', 'dieser',
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
