/**
 * Coach: alle Hinweise auf einen Blick.
 *
 * Der Unterschied zu allgemeinen Ratgebern ist, dass jeder Hinweis hier aus
 * den eigenen Zahlen stammt und seine Grundlage nennt. Was nicht passt, lässt
 * sich dauerhaft ausblenden.
 */

import { h, card, empty, bar } from '../lib/dom.js';
import * as fmt from '../lib/format.js';
import * as store from '../lib/store.js';
import { insights, healthScore } from '../lib/coach.js';
import { active, platform } from '../lib/platforms.js';
import { toast } from '../lib/ui.js';

export const title = 'Coach';
export const lead = 'Konkrete Schritte, abgeleitet aus deinen eigenen Zahlen.';

const TONE_LABEL = { danger: 'Dringend', warn: 'Sollte bald', info: 'Zum Nachdenken', ok: 'Läuft gut' };

function insightCard(item, goto, refresh) {
  return h(`div.insight.insight--${item.tone}`, null,
    h('div.insight__icon', { text: item.icon }),
    h('div.grow', null,
      h('div.row.between.gap-sm', null,
        h('div.insight__title', { text: item.title }),
        h('span.badge', { text: TONE_LABEL[item.tone] || '' })),
      h('div.insight__body', { text: item.body }),
      item.evidence ? h('div.text-xs.faint.mt-sm', { text: `Grundlage: ${item.evidence}` }) : null,
      h('div.row.gap-sm.insight__action', null,
        item.action
          ? h('button.btn.btn--sm.btn--primary', { text: item.action.label, onClick: () => goto(item.action.view) })
          : null,
        h('button.btn.btn--sm.btn--ghost', {
          text: 'Nicht mehr zeigen',
          onClick: async () => {
            const dismissed = [...(store.settings().dismissedInsights || []), item.id];
            await store.saveSettings({ dismissedInsights: [...new Set(dismissed)] });
            toast('Hinweis ausgeblendet.', 'ok');
            refresh();
          },
        }))));
}

export async function render({ goto, setActions, refresh }) {
  const all = insights();
  const health = healthScore();
  const dismissed = store.settings().dismissedInsights || [];

  setActions(
    dismissed.length
      ? h('button.btn.btn--sm', {
          text: `${dismissed.length} ausgeblendet zurückholen`,
          onClick: async () => {
            await store.saveSettings({ dismissedInsights: [] });
            toast('Alle Hinweise wieder sichtbar.', 'ok');
            refresh();
          },
        })
      : null,
    h('button.btn.btn--sm.btn--primary', { text: 'Zahlen nachtragen', onClick: () => goto('analytics') })
  );

  const groups = [
    { tone: 'danger', label: 'Dringend' },
    { tone: 'warn', label: 'Sollte bald passieren' },
    { tone: 'info', label: 'Zum Nachdenken' },
    { tone: 'ok', label: 'Das läuft gut' },
  ];

  const posts = store.all('posts');
  const published = posts.filter((post) => post.status === 'published');
  const withNumbers = new Set(store.all('analytics').map((entry) => entry.postId).filter(Boolean));
  const coverage = published.length ? withNumbers.size / published.length : 0;

  return h('div.col.gap-xl', null,
    h('div.hero', null,
      h('div', null,
        h('div.hero__greeting', { text: `Betriebszustand ${health} von 100` }),
        h('div.hero__meta', {
          text: health > 75
            ? 'Frequenz, Vorrat und Termine passen zusammen. Jetzt lohnt sich Arbeit an der Qualität.'
            : health > 45
              ? 'Die Grundlagen stehen, aber es gibt sichtbare Lücken. Die dringenden Hinweise zuerst.'
              : 'Es hakt an mehreren Stellen gleichzeitig. Fang oben an – eine Sache nach der anderen.',
        })),
      h('div', { style: { width: '220px' } }, bar(health / 100, health > 75 ? 'ok' : health > 45 ? 'warn' : 'danger'))),

    h('div.grid.grid-4', null,
      card(null, {}, h('div.stat', null, h('div.stat__label', { text: 'Offene Hinweise' }), h('div.stat__value', { text: String(all.filter((item) => item.tone !== 'ok').length) }))),
      card(null, {}, h('div.stat', null, h('div.stat__label', { text: 'Veröffentlicht' }), h('div.stat__value', { text: String(published.length) }), h('div.stat__meta', { text: 'insgesamt' }))),
      card(null, {}, h('div.stat', null,
        h('div.stat__label', { text: 'Mit Zahlen belegt' }),
        h('div.stat__value', { text: fmt.percent(coverage * 100, 0) }),
        h('div.stat__meta', { text: coverage < 0.5 ? 'mehr Zahlen schärfen die Hinweise' : 'gute Datenlage' }))),
      card(null, {}, h('div.stat', null, h('div.stat__label', { text: 'Ausgeblendet' }), h('div.stat__value', { text: String(dismissed.length) })))),

    ...groups.map((group) => {
      const items = all.filter((item) => item.tone === group.tone);
      if (!items.length) return null;
      return h('section.section.mt-0', null,
        h('div.section__head', null,
          h('div.section__title', { text: group.label }),
          h('div.section__hint', { text: fmt.plural(items.length, 'Hinweis', 'Hinweise') })),
        h('div.col.gap-sm', null, ...items.map((item) => insightCard(item, goto, refresh))));
    }),

    all.length
      ? null
      : card(null, {}, empty('Nichts zu beanstanden', 'Sobald mehr Beiträge und Zahlen vorliegen, findet der Coach hier Ansatzpunkte.')),

    card('Grundregeln deiner Kanäle', { hint: 'unabhängig von den Tageszahlen' },
      h('div.col.gap-lg', null,
        ...active(store.settings()).slice(0, 6).map((p) =>
          h('div', null,
            h('div.row.gap-sm.mb-sm', null,
              h('span.strong', { text: p.name }),
              h('span.badge', { text: p.limits?.body ? `${p.limits.body} Zeichen` : 'ohne Textlimit' })),
            h('ul.text-sm.muted', { style: { margin: 0, paddingLeft: '18px' } },
              ...(p.tips || []).map((tip) => h('li', { text: tip }))))))));
}
