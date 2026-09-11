/** Einheitliche Darstellung von Zahlen, Zeiten und Datumsangaben – deutsch oder englisch. */

import { language, locale, t } from './i18n.js';

const NAMES = {
  de: {
    weekdays: ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'],
    weekdaysShort: ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'],
    months: ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'], // i18n-ignore
  },
  en: {
    weekdays: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
    weekdaysShort: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
    months: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
  },
};

const names = () => NAMES[language()] || NAMES.de;

export const weekdayName = (index) => names().weekdays[((index % 7) + 7) % 7];
export const weekdayShort = (index) => names().weekdaysShort[((index % 7) + 7) % 7];
export const monthName = (index) => names().months[((index % 12) + 12) % 12];

/** 12.400 statt 12400, ab 10.000 gekuerzt auf 12,4 Tsd. */
export function num(value, { compact = false, decimals = 0 } = {}) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '–';
  if (compact && Math.abs(n) >= 10000) {
    return new Intl.NumberFormat(locale(), { notation: 'compact', maximumFractionDigits: 1 }).format(n);
  }
  return new Intl.NumberFormat(locale(), { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(n);
}

export function percent(value, decimals = 1) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '–';
  return language() === 'en' ? `${num(n, { decimals })}%` : `${num(n, { decimals })} %`;
}

/** Sekunden als 1:23 bzw. 1:02:03. */
export function duration(seconds) {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (value) => String(value).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

export function bytes(value) {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let n = Number(value) || 0;
  let unit = 0;
  while (n >= 1024 && unit < units.length - 1) {
    n /= 1024;
    unit += 1;
  }
  return `${num(n, { decimals: n < 10 && unit > 0 ? 1 : 0 })} ${units[unit]}`;
}

/** Formatiert eine Kennzahl gemaess ihrem Typ aus dem Metrik-Woerterbuch. */
export function metricValue(value, type) {
  if (value === null || value === undefined || value === '') return '–';
  switch (type) {
    case 'percent': return percent(value);
    case 'seconds': return duration(value);
    case 'number': return num(value, { decimals: 1 });
    default: return num(value, { compact: true });
  }
}

// ------------------------------------------------------------------ Datum

export const toDate = (value) => (value instanceof Date ? value : new Date(value));

export function date(value, style = 'medium') {
  const d = toDate(value);
  if (Number.isNaN(d.getTime())) return '–';
  if (style === 'day') {
    const month = monthName(d.getMonth()).slice(0, 3);
    return language() === 'en'
      ? `${weekdayShort(d.getDay())}, ${month} ${d.getDate()}`
      : `${weekdayShort(d.getDay())}, ${d.getDate()}. ${month}`;
  }
  return new Intl.DateTimeFormat(locale(), { dateStyle: style }).format(d);
}

export function time(value) {
  const d = toDate(value);
  if (Number.isNaN(d.getTime())) return '–';
  return new Intl.DateTimeFormat(locale(), { hour: '2-digit', minute: '2-digit' }).format(d);
}

export function dateTime(value) {
  const d = toDate(value);
  if (Number.isNaN(d.getTime())) return '–';
  return language() === 'en'
    ? `${date(d, 'medium')}, ${time(d)}`
    : `${date(d, 'short')}, ${time(d)} Uhr`;
}

/** „in 3 Std.“, „vor 2 Tagen“, „gerade eben“. */
export function relative(value) {
  const d = toDate(value);
  if (Number.isNaN(d.getTime())) return '–';
  const diff = d.getTime() - Date.now();
  const abs = Math.abs(diff);
  const minute = 60000;
  const hour = 3600000;
  const day = 86400000;

  if (abs < minute) return t('gerade eben');
  const rtf = new Intl.RelativeTimeFormat(locale(), { numeric: 'auto' });
  if (abs < hour) return rtf.format(Math.round(diff / minute), 'minute');
  if (abs < day) return rtf.format(Math.round(diff / hour), 'hour');
  if (abs < day * 30) return rtf.format(Math.round(diff / day), 'day');
  if (abs < day * 365) return rtf.format(Math.round(diff / (day * 30)), 'month');
  return rtf.format(Math.round(diff / (day * 365)), 'year');
}

/** Datum ohne Uhrzeit als Schluessel, z. B. "2026-09-09". */
export function dayKey(value = new Date()) {
  const d = toDate(value);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Wert fuer ein <input type="datetime-local">. */
export function inputDateTime(value) {
  const d = toDate(value);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export const startOfDay = (value = new Date()) => {
  const d = toDate(value);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
};

export const addDays = (value, days) => {
  const d = toDate(value);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + days, d.getHours(), d.getMinutes());
};

/** Wochenbeginn, standardmaessig Montag. */
export function startOfWeek(value = new Date(), firstDay = 1) {
  const d = startOfDay(value);
  const shift = (d.getDay() - firstDay + 7) % 7;
  return addDays(d, -shift);
}

export const isSameDay = (a, b) => dayKey(a) === dayKey(b);
export const isToday = (value) => isSameDay(value, new Date());

/** Kalenderwoche nach ISO 8601. */
export function isoWeek(value = new Date()) {
  const d = new Date(Date.UTC(toDate(value).getFullYear(), toDate(value).getMonth(), toDate(value).getDate()));
  const dayNumber = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNumber);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
}

// ------------------------------------------------------------------ Text

export function truncate(text, length = 80) {
  const value = String(text ?? '').trim();
  return value.length > length ? `${value.slice(0, length - 1)}…` : value;
}

/**
 * „3 Beiträge“. Die Wortformen sind deutsche Schlüssel und werden übersetzt –
 * sie müssen deshalb wie jeder andere Text im Wörterbuch stehen.
 */
export function plural(count, one, many) {
  let word = t(count === 1 ? one : many);
  // Deutsche Hauptwörter sind groß, im englischen Satz nicht: „3 channels“.
  // Abkürzungen (CSV, PC) und Eigennamen mit zweitem Großbuchstaben bleiben.
  if (language() === 'en' && /^[A-Z][a-z]/.test(word)) word = word[0].toLowerCase() + word.slice(1);
  return `${num(count)} ${word}`;
}

/** Grobe Lesezeit in Sekunden – Grundlage fuer Skript-Laengen. */
export function speakingSeconds(text, wordsPerMinute = 145) {
  const words = String(text ?? '').trim().split(/\s+/).filter(Boolean).length;
  return Math.round((words / wordsPerMinute) * 60);
}

export const wordCount = (text) => String(text ?? '').trim().split(/\s+/).filter(Boolean).length;
