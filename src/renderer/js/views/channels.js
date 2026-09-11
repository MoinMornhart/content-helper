/**
 * Kanäle: was jede Plattform verlangt und was du dort tatsächlich tust.
 *
 * Die Verknüpfung geschieht ohne Anmeldung: die App kennt die Regeln der
 * Plattform und deine eigenen Zahlen und stellt beides nebeneinander.
 */

import { h, card } from '../lib/dom.js';
import * as fmt from '../lib/format.js';
import * as store from '../lib/store.js';
import * as an from '../lib/analytics.js';
import * as chart from '../lib/chart.js';
import { PLATFORMS, platform, glyph, metric, KIND_LABEL, suggestedSlots } from '../lib/platforms.js';
import { toast, modal } from '../lib/ui.js';
import { t, mark } from '../lib/i18n.js';

export const title = mark('Kanäle');
export const lead = mark('Regeln, Grenzen und dein Stand – Kanal für Kanal.');

/** Zahlenbild eines Kanals aus den erfassten Werten. */
function summaryFor(platformId) {
  const posts = store.all('posts').filter((post) => (post.platforms || []).includes(platformId));
  const published = posts.filter((post) => post.status === 'published' && post.publishedAt);
  const lastUse = published.length
    ? Math.max(...published.map((post) => new Date(post.publishedAt).getTime()))
    : null;
  const p = platform(platformId);
  const primaryMetric = p?.metrics?.[0];
  const { current, change } = primaryMetric
    ? an.compare(primaryMetric, { days: 30, platformId })
    : { current: null, change: null };

  return {
    posts: posts.length,
    published: published.length,
    scheduled: posts.filter((post) => post.status === 'scheduled').length,
    lastUse,
    primaryMetric,
    current,
    change,
    series: primaryMetric ? an.daily(primaryMetric, { days: 30, platformId }).map((point) => point.value) : [],
  };
}

/** Alle Regeln einer Plattform als Nachschlagewerk. */
function detailDialog(p) {
  const limits = p.limits || {};
  const rows = [
    [t('Titel'), limits.title ? t('{n} Zeichen', { n: limits.title }) : t('kein Titelfeld')],
    [t('Text'), limits.body ? t('{n} Zeichen', { n: limits.body }) : '–'],
    [t('Hashtags'), limits.hashtags ? t('bis {n}', { n: limits.hashtags }) : '–'],
    [t('Medien je Beitrag'), limits.mediaCount ? t('bis {n}', { n: limits.mediaCount }) : '–'],
    [t('Videolänge'), limits.videoSecMax ? t('{min} bis {max}', { min: fmt.duration(limits.videoSecMin || 0), max: fmt.duration(limits.videoSecMax) }) : '–'],
    [t('Seitenverhältnis'), limits.aspect || '–'],
    [t('Art'), t(KIND_LABEL[p.kind] || p.kind)],
  ];

  modal({
    title: p.name,
    body: h('div.col.gap-lg', null,
      h('table.table', null,
        h('tbody', null,
          ...rows.map(([label, value]) =>
            h('tr', null, h('td.muted', { text: label }), h('td.strong', { text: value }))))),

      h('div', null,
        h('div.field__label.mb-sm', { text: t('Typische Formate') }),
        h('div.chips', null, ...(p.formats || []).map((format) => h('span.badge', { text: t(format) })))),

      h('div', null,
        h('div.field__label.mb-sm', { text: t('Empfohlene Zeitfenster') }),
        h('div.chips', null,
          ...(p.bestSlots || []).map((slot) =>
            h('span.badge.badge--accent', {
              text: `${slot.days.map((day) => fmt.weekdayShort(day)).join(' ')} · ${slot.time}`,
            })))),

      h('div', null,
        h('div.field__label.mb-sm', { text: t('Worauf es ankommt') }),
        h('ul.text-sm.muted', { style: { margin: 0, paddingLeft: '18px' } },
          ...(p.tips || []).map((tip) => h('li', { text: t(tip) })))),

      p.csvHint
        ? h('div.notice.notice--accent', null,
            h('span.notice__icon', { text: '◫' }),
            h('div', null,
              h('div.strong.text-sm', { text: t('Zahlen ohne Zugangsschlüssel holen') }),
              h('div.text-sm.muted', { text: t(p.csvHint) })))
        : null),
    actions: [
      p.studioUrl
        ? { label: t('Studio öffnen'), action: () => window.ch.system.openExternal(p.studioUrl), closeAfter: false }
        : null,
      p.uploadUrl
        ? { label: t('Upload-Seite öffnen'), primary: true, action: () => window.ch.system.openExternal(p.uploadUrl) }
        : null,
    ].filter(Boolean),
  });
}

function channelCard(p, { refresh, goto }) {
  const summary = summaryFor(p.id);
  const isActive = (store.settings().activePlatforms || []).includes(p.id);
  const info = summary.primaryMetric ? metric(summary.primaryMetric) : null;

  return h(`div.card${isActive ? '' : ''}`, { style: isActive ? { borderLeft: `3px solid ${p.color}` } : { opacity: '0.6' } },
    h('div.row.between.mb', null,
      h('div.row.gap-sm', null,
        glyph(p.id, 26),
        h('div', null,
          h('div.strong', { text: p.name }),
          h('div.text-xs.faint', { text: t(KIND_LABEL[p.kind] || p.kind) }))),
      h('button.btn.btn--sm', {
        text: isActive ? t('Aktiv') : t('Aktivieren'),
        class: isActive ? 'btn--primary' : '',
        onClick: async () => {
          const set = new Set(store.settings().activePlatforms || []);
          if (set.has(p.id)) set.delete(p.id);
          else set.add(p.id);
          await store.saveSettings({ activePlatforms: [...set] });
          toast(set.has(p.id) ? t('{name} aktiviert.', { name: p.name }) : t('{name} abgeschaltet.', { name: p.name }), 'ok');
          refresh();
        },
      })),

    h('div.row.gap-lg.mb', null,
      h('div.stat', null,
        h('div.stat__label', { text: t('Beiträge') }),
        h('div.text-lg.strong', { text: String(summary.posts) })),
      h('div.stat', null,
        h('div.stat__label', { text: t('Zuletzt') }),
        h('div.text-sm', { text: summary.lastUse ? fmt.relative(summary.lastUse) : t('noch nie') })),
      info
        ? h('div.stat', null,
            h('div.stat__label', { text: t('{metric} (30 T.)', { metric: t(info.short) }) }),
            h('div.text-lg.strong', { text: fmt.metricValue(summary.current, info.type) }))
        : null),

    summary.series.some((value) => value)
      ? chart.sparkline(summary.series)
      : h('div.text-xs.faint', { text: t('Noch keine Zahlen für diesen Kanal erfasst.') }),

    h('div.row.gap-sm.mt', null,
      h('button.btn.btn--sm', { text: t('Regeln ansehen'), onClick: () => detailDialog(p) }),
      h('button.btn.btn--sm.btn--ghost', { text: t('Beitrag anlegen'), onClick: () => goto('composer', { fresh: true, platform: p.id }) })));
}

export async function render({ goto, setActions, refresh }) {
  const settings = store.settings();
  const activeIds = new Set(settings.activePlatforms || []);
  const sortedPlatforms = [...PLATFORMS].sort((a, b) => {
    const diff = Number(activeIds.has(b.id)) - Number(activeIds.has(a.id));
    return diff || a.name.localeCompare(b.name, 'de');
  });

  setActions(
    h('button.btn.btn--sm', { text: t('Zeitfenster verwalten'), onClick: () => goto('queue') }),
    h('button.btn.btn--sm.btn--primary', { text: t('Zahlen erfassen'), onClick: () => goto('analytics') })
  );

  const nextSlots = [...activeIds]
    .flatMap((id) => suggestedSlots(id, 7).slice(0, 2).map((when) => ({ id, when })))
    .sort((a, b) => a.when - b.when)
    .slice(0, 6);

  return h('div.col.gap-lg', null,
    h('div.notice.notice--accent', null,
      h('span.notice__icon', { text: '⬡' }),
      h('div', null,
        h('div.strong', { text: t('Verknüpft ohne Anmeldung') }),
        h('div.text-sm.muted', { text: t('Die App kennt Limits, Formate und Empfehlungen jeder Plattform und stellt sie neben deine eigenen Zahlen. Dafür ist keine Anmeldung, kein Zugangsschlüssel und keine Developer-App nötig – die Werte kommen per CSV-Export oder Handeingabe herein.') }))),

    nextSlots.length
      ? card(t('Nächste empfohlene Zeitfenster'), { hint: t('aus den Standardwerten deiner aktiven Kanäle') },
          h('div.chips', null,
            ...nextSlots.map((slot) =>
              h('span.chip', {
                onClick: () => goto('composer', { fresh: true, at: slot.when.toISOString() }),
              }, glyph(slot.id, 14), h('span', { text: `${fmt.date(slot.when, 'day')} ${fmt.time(slot.when)}` })))))
      : null,

    h('div.grid.grid-3', null,
      ...sortedPlatforms.map((p) => channelCard(p, { refresh, goto }))));
}
