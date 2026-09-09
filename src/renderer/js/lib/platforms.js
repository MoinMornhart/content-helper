/**
 * Zugriff auf den Plattform-Katalog und das Kennzahlen-Woerterbuch.
 * Die Daten kommen ueber die Preload-Bruecke und sind sofort verfuegbar.
 */

import { h } from './dom.js';

export const PLATFORMS = window.ch.catalog.platforms;
export const METRICS = window.ch.catalog.metrics;

const byIdMap = new Map(PLATFORMS.map((platform) => [platform.id, platform]));

export const platform = (id) => byIdMap.get(id) || null;
export const platformName = (id) => byIdMap.get(id)?.name || id;
export const metric = (id) => METRICS[id] || { label: id, type: 'count', higherIsBetter: true };

/** Alle Plattformen, sortiert nach Anzeigename. */
export const sorted = () => [...PLATFORMS].sort((a, b) => a.name.localeCompare(b.name, 'de'));

/** Nur die Kanaele, die der Nutzer in den Einstellungen aktiviert hat. */
export function active(settings) {
  const ids = settings?.activePlatforms?.length ? settings.activePlatforms : PLATFORMS.map((p) => p.id);
  return ids.map((id) => byIdMap.get(id)).filter(Boolean);
}

export const KIND_LABEL = {
  video: 'Langvideo',
  short: 'Kurzvideo',
  text: 'Text',
  image: 'Bild',
  story: 'Story',
  live: 'Live',
  community: 'Community',
};

/**
 * Das Textlimit einer Plattform fuer ein bestimmtes Feld.
 * 0 bedeutet: das Feld gibt es dort nicht.
 */
export function limitFor(platformId, fieldName) {
  const limits = byIdMap.get(platformId)?.limits || {};
  return limits[fieldName] ?? 0;
}

/**
 * Bewertet eine Textlaenge gegen das Limit.
 * @returns {{used: number, limit: number, ratio: number, state: 'ok'|'warn'|'over'}}
 */
export function limitState(text, limit) {
  const used = [...String(text ?? '')].length;
  if (!limit) return { used, limit: 0, ratio: 0, state: 'ok' };
  const ratio = used / limit;
  return { used, limit, ratio, state: ratio > 1 ? 'over' : ratio > 0.9 ? 'warn' : 'ok' };
}

// ------------------------------------------------------------------ Darstellung

/** Farbiges Rundsymbol einer Plattform. */
export function glyph(platformId, size = 18) {
  const p = byIdMap.get(platformId);
  return h('span.pill__glyph', {
    text: p?.glyph || '?',
    title: p?.name || platformId,
    style: {
      background: p?.color || 'var(--surface-3)',
      width: `${size}px`,
      height: `${size}px`,
      fontSize: `${Math.round(size * 0.55)}px`,
    },
  });
}

/** Plattform-Marke mit Symbol und Namen. */
export function pill(platformId, { short = false } = {}) {
  const p = byIdMap.get(platformId);
  return h('span.pill', { title: p?.name || platformId },
    glyph(platformId, 17),
    h('span', { text: short ? p?.short || platformId : p?.name || platformId }));
}

/** Reihe von Plattform-Symbolen, ab `max` als "+n" zusammengefasst. */
export function glyphRow(platformIds = [], max = 5) {
  const shown = platformIds.slice(0, max);
  const rest = platformIds.length - shown.length;
  return h('span.row.gap-xs', null,
    ...shown.map((id) => glyph(id, 17)),
    rest > 0 ? h('span.text-xs.faint', { text: `+${rest}` }) : null);
}

/**
 * Vorgeschlagene Veroeffentlichungszeitpunkte einer Plattform fuer die
 * naechsten Tage – Grundlage fuer die Warteschlange im Kalender.
 */
export function suggestedSlots(platformId, days = 14, from = new Date()) {
  const p = byIdMap.get(platformId);
  if (!p?.bestSlots?.length) return [];
  const result = [];
  for (let offset = 0; offset < days; offset += 1) {
    const day = new Date(from.getFullYear(), from.getMonth(), from.getDate() + offset);
    for (const slot of p.bestSlots) {
      if (!slot.days.includes(day.getDay())) continue;
      const [hour, minute] = slot.time.split(':').map(Number);
      const when = new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour, minute);
      if (when > from) result.push(when);
    }
  }
  return result.sort((a, b) => a - b);
}
