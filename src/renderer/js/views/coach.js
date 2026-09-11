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
import { active } from '../lib/platforms.js';
import { toast } from '../lib/ui.js';
import { t, mark } from '../lib/i18n.js';

export const title = mark('Coach');
export const lead = mark('Konkrete Schritte, abgeleitet aus deinen eigenen Zahlen.');

const TONE_LABEL = { danger: mark('Dringend'), warn: mark('Sollte bald'), info: mark('Zum Nachdenken'), ok: mark('Läuft gut') };

function insightCard(item, goto, refresh) {
  return h(`div.insight.insight--${item.tone}`, null,
    h('div.insight__icon', { text: item.icon }),
    h('div.grow', null,
      h('div.row.between.gap-sm', null,
        h('div.insight__title', { text: item.title }),
        h('span.badge', { text: TONE_LABEL[item.tone] ? t(TONE_LABEL[item.tone]) : '' })),
      h('div.insight__body', { text: item.body }),
      item.evidence ? h('div.text-xs.faint.mt-sm', { text: t('Grundlage: {evidence}', { evidence: item.evidence }) }) : null,
      h('div.row.gap-sm.insight__action', null,
        item.action
          ? h('button.btn.btn--sm.btn--primary', { text: item.action.label, onClick: () => goto(item.action.view) })
          : null,
        h('button.btn.btn--sm.btn--ghost', {
          text: t('Nicht mehr zeigen'),
          onClick: async () => {
            const dismissed = [...(store.settings().dismissedInsights || []), item.id];
            await store.saveSettings({ dismissedInsights: [...new Set(dismissed)] });
            toast(t('Hinweis ausgeblendet.'), 'ok');
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
          text: t('{n} ausgeblendet zurückholen', { n: dismissed.length }),
          onClick: async () => {
            await store.saveSettings({ dismissedInsights: [] });
            toast(t('Alle Hinweise wieder sichtbar.'), 'ok');
            refresh();
          },
        })
      : null,
    h('button.btn.btn--sm.btn--primary', { text: t('Zahlen nachtragen'), onClick: () => goto('analytics') })
  );

  const groups = [
    { tone: 'danger', label: t('Dringend') },
    { tone: 'warn', label: t('Sollte bald passieren') },
    { tone: 'info', label: t('Zum Nachdenken') },
    { tone: 'ok', label: t('Das läuft gut') },
  ];

  const posts = store.all('posts');
  const published = posts.filter((post) => post.status === 'published');
  const withNumbers = new Set(store.all('analytics').map((entry) => entry.postId).filter(Boolean));
  const coverage = published.length ? withNumbers.size / published.length : 0;

  return h('div.col.gap-xl', null,
    h('div.hero', null,
      h('div', null,
        h('div.hero__greeting', { text: t('Betriebszustand {score} von 100', { score: health }) }),
        h('div.hero__meta', {
          text: health > 75
            ? t('Frequenz, Vorrat und Termine passen zusammen. Jetzt lohnt sich Arbeit an der Qualität.')
            : health > 45
              ? t('Die Grundlagen stehen, aber es gibt sichtbare Lücken. Die dringenden Hinweise zuerst.')
              : t('Es hakt an mehreren Stellen gleichzeitig. Fang oben an – eine Sache nach der anderen.'),
        })),
      h('div', { style: { width: '220px' } }, bar(health / 100, health > 75 ? 'ok' : health > 45 ? 'warn' : 'danger'))),

    h('div.grid.grid-4', null,
      card(null, {}, h('div.stat', null, h('div.stat__label', { text: t('Offene Hinweise') }), h('div.stat__value', { text: String(all.filter((item) => item.tone !== 'ok').length) }))),
      card(null, {}, h('div.stat', null, h('div.stat__label', { text: t('Veröffentlicht') }), h('div.stat__value', { text: String(published.length) }), h('div.stat__meta', { text: t('insgesamt') }))),
      card(null, {}, h('div.stat', null,
        h('div.stat__label', { text: t('Mit Zahlen belegt') }),
        h('div.stat__value', { text: fmt.percent(coverage * 100, 0) }),
        h('div.stat__meta', { text: coverage < 0.5 ? t('mehr Zahlen schärfen die Hinweise') : t('gute Datenlage') }))),
      card(null, {}, h('div.stat', null, h('div.stat__label', { text: t('Ausgeblendet') }), h('div.stat__value', { text: String(dismissed.length) })))),

    ...groups.map((group) => {
      const items = all.filter((item) => item.tone === group.tone);
      if (!items.length) return null;
      return h('section.section.mt-0', null,
        h('div.section__head', null,
          h('div.section__title', { text: group.label }),
          h('div.section__hint', { text: items.length === 1 ? t('1 Hinweis') : t('{n} Hinweise', { n: fmt.num(items.length) }) })),
        h('div.col.gap-sm', null, ...items.map((item) => insightCard(item, goto, refresh))));
    }),

    all.length
      ? null
      : card(null, {}, empty(t('Nichts zu beanstanden'), t('Sobald mehr Beiträge und Zahlen vorliegen, findet der Coach hier Ansatzpunkte.'))),

    card(t('Grundregeln deiner Kanäle'), { hint: t('unabhängig von den Tageszahlen') },
      h('div.col.gap-lg', null,
        ...active(store.settings()).slice(0, 6).map((p) =>
          h('div', null,
            h('div.row.gap-sm.mb-sm', null,
              h('span.strong', { text: p.name }),
              h('span.badge', { text: p.limits?.body ? t('{n} Zeichen', { n: p.limits.body }) : t('ohne Textlimit') })),
            h('ul.text-sm.muted', { style: { margin: 0, paddingLeft: '18px' } },
              ...(p.tips || []).map((tip) => h('li', { text: t(tip) }))))))));
}
