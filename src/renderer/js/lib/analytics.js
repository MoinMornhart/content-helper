/**
 * Auswertung der erfassten Kennzahlen.
 *
 * Ein Messwert-Eintrag sieht so aus:
 * {
 *   id, platformId, postId?, date: "2026-09-09", title?,
 *   metrics: { views: 1240, ctr: 4.2, ... },
 *   source: "manual" | "csv"
 * }
 *
 * Alle Funktionen arbeiten auf dem Zwischenspeicher der Oberflaeche und sind
 * bewusst rein: gleiche Eingabe, gleiches Ergebnis, keine Nebenwirkungen.
 */

import * as store from './store.js';
import * as fmt from './format.js';
import { metric as metricInfo } from './platforms.js';

export const entries = () => store.all('analytics');

/** Eintraege eines Zeitraums, optional auf eine Plattform begrenzt. */
export function inRange({ days = 30, platformId = null, from = null, to = null } = {}) {
  const end = to ? new Date(to) : new Date();
  const start = from ? new Date(from) : fmt.addDays(end, -days);
  const startKey = fmt.dayKey(start);
  const endKey = fmt.dayKey(end);
  return entries().filter((entry) => {
    if (platformId && entry.platformId !== platformId) return false;
    return entry.date >= startKey && entry.date <= endKey;
  });
}

const value = (entry, key) => {
  const raw = entry?.metrics?.[key];
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
};

/** Summe einer Kennzahl. Anteilswerte (Prozent, Sekunden) werden gemittelt. */
export function aggregate(list, key) {
  const info = metricInfo(key);
  const values = list.map((entry) => value(entry, key)).filter((n) => n !== null);
  if (!values.length) return null;
  if (info.type === 'percent' || info.type === 'seconds' || info.type === 'number') {
    return values.reduce((sum, n) => sum + n, 0) / values.length;
  }
  return values.reduce((sum, n) => sum + n, 0);
}

export const average = (list, key) => {
  const values = list.map((entry) => value(entry, key)).filter((n) => n !== null);
  return values.length ? values.reduce((sum, n) => sum + n, 0) / values.length : null;
};

/**
 * Kennzahl im Zeitraum gegen den unmittelbar davorliegenden Zeitraum.
 * @returns {{current: number|null, previous: number|null, change: number|null}}
 *          change ist die relative Veraenderung (0.25 = plus 25 Prozent).
 */
export function compare(key, { days = 30, platformId = null } = {}) {
  const now = new Date();
  const current = aggregate(inRange({ days, platformId, to: now }), key);
  const previousEnd = fmt.addDays(now, -days);
  const previous = aggregate(
    inRange({ days, platformId, from: fmt.addDays(previousEnd, -days), to: previousEnd }),
    key
  );
  const change = current !== null && previous ? (current - previous) / Math.abs(previous) : null;
  return { current, previous, change };
}

/** Tagesreihe fuer ein Diagramm: lueckenlos, fehlende Tage mit 0. */
export function daily(key, { days = 30, platformId = null } = {}) {
  const list = inRange({ days, platformId });
  const buckets = new Map();
  for (const entry of list) {
    const n = value(entry, key);
    if (n === null) continue;
    if (!buckets.has(entry.date)) buckets.set(entry.date, []);
    buckets.get(entry.date).push(n);
  }
  const info = metricInfo(key);
  const out = [];
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const day = fmt.addDays(new Date(), -offset);
    const dayValues = buckets.get(fmt.dayKey(day)) || [];
    const sum = dayValues.reduce((total, n) => total + n, 0);
    out.push({
      date: fmt.dayKey(day),
      label: fmt.date(day, 'day'),
      value: dayValues.length
        ? (info.type === 'count' ? sum : sum / dayValues.length)
        : 0,
    });
  }
  return out;
}

/** Welche Plattformen wie stark beitragen. */
export function byPlatform(key, { days = 30 } = {}) {
  const grouped = new Map();
  for (const entry of inRange({ days })) {
    if (!grouped.has(entry.platformId)) grouped.set(entry.platformId, []);
    grouped.get(entry.platformId).push(entry);
  }
  return [...grouped.entries()]
    .map(([platformId, list]) => ({ platformId, count: list.length, value: aggregate(list, key) }))
    .filter((row) => row.value !== null)
    .sort((a, b) => b.value - a.value);
}

/**
 * Verbindet Messwerte mit den zugehoerigen Beitraegen.
 * Nur damit lassen sich Aussagen ueber Zeitfenster und Formate treffen.
 */
export function joined({ days = 90, platformId = null } = {}) {
  const posts = new Map(store.all('posts').map((post) => [post.id, post]));
  return inRange({ days, platformId })
    .map((entry) => ({ entry, post: entry.postId ? posts.get(entry.postId) : null }))
    .filter((row) => row.post);
}

/** Durchschnitt je Veroeffentlichungsstunde – zeigt das beste Zeitfenster. */
export function byHour(key = 'views', options = {}) {
  const buckets = new Map();
  for (const { entry, post } of joined(options)) {
    const at = post.publishedAt || post.scheduledAt;
    const n = value(entry, key);
    if (!at || n === null) continue;
    const hour = new Date(at).getHours();
    if (!buckets.has(hour)) buckets.set(hour, []);
    buckets.get(hour).push(n);
  }
  return [...buckets.entries()]
    .map(([hour, values]) => ({
      hour,
      count: values.length,
      value: values.reduce((sum, n) => sum + n, 0) / values.length,
    }))
    .sort((a, b) => a.hour - b.hour);
}

/** Durchschnitt je Wochentag. */
export function byWeekday(key = 'views', options = {}) {
  const buckets = new Map();
  for (const { entry, post } of joined(options)) {
    const at = post.publishedAt || post.scheduledAt;
    const n = value(entry, key);
    if (!at || n === null) continue;
    const day = new Date(at).getDay();
    if (!buckets.has(day)) buckets.set(day, []);
    buckets.get(day).push(n);
  }
  return Array.from({ length: 7 }, (_, day) => {
    const values = buckets.get(day) || [];
    return {
      day,
      label: fmt.weekdayShort(day),
      count: values.length,
      value: values.length ? values.reduce((sum, n) => sum + n, 0) / values.length : 0,
    };
  });
}

/** Durchschnitt je Format – welche Sorte Inhalt traegt wirklich. */
export function byFormat(key = 'views', options = {}) {
  const buckets = new Map();
  for (const { entry, post } of joined(options)) {
    const format = post.format || 'Ohne Format';
    const n = value(entry, key);
    if (n === null) continue;
    if (!buckets.has(format)) buckets.set(format, []);
    buckets.get(format).push(n);
  }
  return [...buckets.entries()]
    .map(([format, values]) => ({
      format,
      count: values.length,
      value: values.reduce((sum, n) => sum + n, 0) / values.length,
    }))
    .sort((a, b) => b.value - a.value);
}

/** Die staerksten Einzelbeitraege eines Zeitraums. */
export function topEntries(key = 'views', { days = 90, platformId = null, limit = 5 } = {}) {
  return inRange({ days, platformId })
    .map((entry) => ({ entry, value: value(entry, key) }))
    .filter((row) => row.value !== null)
    .sort((a, b) => b.value - a.value)
    .slice(0, limit);
}

/** Welche Kennzahlen bei den erfassten Daten ueberhaupt vorkommen. */
export function availableMetrics(platformId = null) {
  const keys = new Set();
  for (const entry of platformId ? entries().filter((e) => e.platformId === platformId) : entries()) {
    for (const [key, raw] of Object.entries(entry.metrics || {})) {
      if (raw !== null && raw !== '' && Number.isFinite(Number(raw))) keys.add(key);
    }
  }
  return [...keys];
}
