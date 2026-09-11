/**
 * Gemeinsame Logik rund um Beitraege: Status, Sortierung, Darstellung.
 * Wird von Dashboard, Kalender, Warteschlange und Composer genutzt.
 */

import { h } from './dom.js';
import * as fmt from './format.js';
import { glyphRow, platform } from './platforms.js';
import * as store from './store.js';

/** Der Lebensweg eines Beitrags, in dieser Reihenfolge. */
export const STATUS = {
  idea:      { label: 'Idee',           tone: 'idea',      hint: 'Noch nicht ausgearbeitet' },
  draft:     { label: 'Entwurf',        tone: 'draft',     hint: 'In Arbeit' },
  ready:     { label: 'Fertig',         tone: 'ready',     hint: 'Bereit zum Einplanen' },
  scheduled: { label: 'Geplant',        tone: 'scheduled', hint: 'Termin steht' },
  publishing:{ label: 'Wird veröffentlicht', tone: 'publishing', hint: 'Geht gerade automatisch raus' },
  due:       { label: 'Jetzt fällig',   tone: 'due',       hint: 'Sollte jetzt raus' },
  published: { label: 'Veröffentlicht', tone: 'published', hint: 'Erledigt' },
  failed:    { label: 'Fehlgeschlagen', tone: 'failed',    hint: 'Automatisches Veröffentlichen hat nicht geklappt' },
  missed:    { label: 'Verpasst',       tone: 'missed',    hint: 'Termin verstrichen' },
};

export const statusLabel = (status) => STATUS[status]?.label || status;

export const OPEN_STATUSES = ['idea', 'draft', 'ready', 'scheduled', 'publishing', 'due', 'failed', 'missed'];

/** Ein leerer Beitrag mit sinnvollen Vorgaben. */
export function blankPost(overrides = {}) {
  return {
    title: '',
    body: '',
    hashtags: [],
    platforms: [],
    perPlatform: {},
    mediaIds: [],
    checklist: [],
    status: 'draft',
    scheduledAt: null,
    seriesId: null,
    notes: '',
    ...overrides,
  };
}

export const titleOf = (post) =>
  post.title?.trim() || fmt.truncate(post.body, 60) || 'Ohne Titel';

/** Nach Termin sortiert, Beitraege ohne Termin ans Ende. */
export function bySchedule(a, b) {
  if (!a.scheduledAt) return 1;
  if (!b.scheduledAt) return -1;
  return new Date(a.scheduledAt) - new Date(b.scheduledAt);
}

export function scheduledBetween(from, to) {
  const start = from.getTime();
  const end = to.getTime();
  return store
    .all('posts')
    .filter((post) => {
      if (!post.scheduledAt) return false;
      const at = new Date(post.scheduledAt).getTime();
      return at >= start && at <= end;
    })
    .sort(bySchedule);
}

export const forDay = (day) => {
  const key = fmt.dayKey(day);
  return store.all('posts').filter((post) => post.scheduledAt && fmt.dayKey(post.scheduledAt) === key).sort(bySchedule);
};

export const openPosts = () => store.all('posts').filter((post) => OPEN_STATUSES.includes(post.status));

/**
 * Der veroeffentlichungsfertige Text fuer eine Plattform:
 * plattformeigene Fassung, sonst die gemeinsame.
 */
export function renderFor(post, platformId) {
  const variant = post.perPlatform?.[platformId] || {};
  const p = platform(platformId);
  const parts = [];
  const title = variant.title ?? post.title;
  const body = variant.body ?? post.body;
  if (title && p?.limits?.title) parts.push(title);
  if (body) parts.push(body);
  const tags = variant.hashtags?.length ? variant.hashtags : post.hashtags;
  if (tags?.length) parts.push(tags.map((tag) => (tag.startsWith('#') ? tag : `#${tag}`)).join(' '));
  return parts.filter(Boolean).join('\n\n');
}

/** Fortschritt der Checkliste als Anteil zwischen 0 und 1. */
export function checklistProgress(post) {
  const items = post.checklist || [];
  if (!items.length) return null;
  return items.filter((item) => item.done).length / items.length;
}

// ------------------------------------------------------------------ Darstellung

export function statusDot(status) {
  return h(`span.status-dot.is-${STATUS[status]?.tone || 'draft'}`, { title: statusLabel(status) });
}

/**
 * Eine Zeile in Listen (Dashboard, Warteschlange, Suchergebnisse).
 * @param {object} post
 * @param {{onClick?: Function, showDate?: boolean, actions?: Node}} options
 */
export function postRow(post, { onClick, showDate = false, actions } = {}) {
  const when = post.scheduledAt ? new Date(post.scheduledAt) : null;
  const progress = checklistProgress(post);

  return h('div.post-row', { onClick: onClick ? () => onClick(post) : null },
    h('div.post-row__time', { text: when ? fmt.time(when) : '—' }),
    statusDot(post.status),
    h('div.grow', null,
      h('div.post-row__title.truncate', { text: titleOf(post) }),
      h('div.post-row__sub', {
        text: [
          showDate && when ? fmt.date(when, 'day') : null,
          statusLabel(post.status),
          progress !== null ? `Checkliste ${Math.round(progress * 100)} %` : null,
        ].filter(Boolean).join(' · '),
      })),
    glyphRow(post.platforms || []),
    actions || null);
}
