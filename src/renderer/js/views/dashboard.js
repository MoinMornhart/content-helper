/** Dashboard: der Tagesüberblick beim Öffnen der App. */

import { h, card, empty, stat, bar } from '../lib/dom.js';
import * as fmt from '../lib/format.js';
import * as store from '../lib/store.js';
import * as posts from '../lib/posts.js';
import { insights, healthScore } from '../lib/coach.js';
import { toast } from '../lib/ui.js';

export const title = 'Dashboard';
export const lead = () => fmt.date(new Date(), 'full');

function greeting() {
  const hour = new Date().getHours();
  if (hour < 5) return 'Noch wach';
  if (hour < 11) return 'Guten Morgen';
  if (hour < 14) return 'Moin';
  if (hour < 18) return 'Guten Tag';
  if (hour < 22) return 'Guten Abend';
  return 'Späte Schicht';
}

/** Balkenreihe der letzten 21 Tage: wie viel ging tatsächlich raus. */
function streak() {
  const days = 21;
  const counts = [];
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const day = fmt.addDays(new Date(), -offset);
    const key = fmt.dayKey(day);
    const count = store.all('posts').filter(
      (post) => post.status === 'published' && post.publishedAt && fmt.dayKey(post.publishedAt) === key
    ).length;
    counts.push({ key, count, isToday: offset === 0 });
  }
  const max = Math.max(1, ...counts.map((entry) => entry.count));
  return h('div.streak', { title: 'Veröffentlichungen der letzten drei Wochen' },
    ...counts.map((entry) =>
      h(`div.streak__day${entry.count ? '.is-filled' : ''}${entry.isToday ? '.is-today' : ''}`, {
        style: { height: `${entry.count ? 10 + (entry.count / max) * 24 : 6}px` },
        title: `${fmt.date(entry.key, 'short')}: ${fmt.plural(entry.count, 'Beitrag', 'Beiträge')}`,
      })));
}

function insightCard(item, goto) {
  return h(`div.insight.insight--${item.tone}`, null,
    h('div.insight__icon', { text: item.icon }),
    h('div.grow', null,
      h('div.insight__title', { text: item.title }),
      h('div.insight__body', { text: item.body }),
      item.evidence ? h('div.text-xs.faint.mt-sm', { text: item.evidence }) : null,
      item.action
        ? h('div.insight__action', null,
            h('button.btn.btn--sm', { text: item.action.label, onClick: () => goto(item.action.view) }))
        : null));
}

export async function render({ goto, setActions }) {
  setActions(
    h('button.btn.btn--sm', { text: 'Zahlen erfassen', onClick: () => goto('analytics') }),
    h('button.btn.btn--primary.btn--sm', { text: '＋ Beitrag', onClick: () => goto('composer', { fresh: true }) })
  );

  const all = store.all('posts');
  const settings = store.settings();
  const now = new Date();
  const weekStart = fmt.startOfWeek(now, settings.startOfWeek ?? 1);

  const today = posts.forDay(now);
  const dueNow = all.filter((post) => post.status === 'due').sort(posts.bySchedule);
  const missed = all.filter((post) => post.status === 'missed');
  const upcoming = posts
    .scheduledBetween(now, fmt.addDays(now, 7))
    .filter((post) => !fmt.isSameDay(post.scheduledAt, now));
  const publishedThisWeek = all.filter(
    (post) => post.status === 'published' && post.publishedAt && new Date(post.publishedAt) >= weekStart
  ).length;
  const plannedThisWeek = all.filter(
    (post) => post.status === 'scheduled' && new Date(post.scheduledAt) >= weekStart && new Date(post.scheduledAt) < fmt.addDays(weekStart, 7)
  ).length;
  const openIdeas = store.all('ideas').filter((idea) => !['done', 'archived'].includes(idea.status));
  const goal = settings.weeklyGoal?.posts || 5;
  const health = healthScore();
  const tips = insights({ limit: 4 });

  /** Beitrag als veröffentlicht abhaken. */
  const markPublished = async (post) => {
    await store.patch('posts', post.id, { status: 'published', publishedAt: new Date().toISOString() });
    toast('Als veröffentlicht markiert.', 'ok');
    goto('dashboard');
  };

  const dueActions = (post) => h('div.row.gap-xs', null,
    h('button.btn.btn--sm', {
      text: 'Text kopieren',
      onClick: async (event) => {
        event.stopPropagation();
        await window.ch.system.copy(posts.renderFor(post, post.platforms?.[0]));
        toast('Text liegt in der Zwischenablage.', 'ok');
      },
    }),
    h('button.btn.btn--sm.btn--primary', {
      text: 'Erledigt',
      onClick: (event) => {
        event.stopPropagation();
        markPublished(post);
      },
    }));

  return h('div.col.gap-xl', null,
    // ---------------------------------------------------------------- Kopf
    h('div.hero', null,
      h('div', null,
        h('div.hero__greeting', { text: `${greeting()}!` }),
        h('div.hero__meta', {
          text: dueNow.length
            ? `${fmt.plural(dueNow.length, 'Beitrag ist', 'Beiträge sind')} jetzt fällig.`
            : today.length
              ? `Heute stehen ${fmt.plural(today.length, 'Beitrag', 'Beiträge')} an.`
              : 'Heute steht nichts an – guter Moment, um vorzuarbeiten.',
        })),
      h('div.col.gap-xs', { style: { alignItems: 'flex-end' } },
        streak(),
        h('div.text-xs.faint', { text: 'Veröffentlichungen der letzten 21 Tage' }))),

    // ---------------------------------------------------------------- Kennzahlen
    h('div.grid.grid-4', null,
      card(null, {}, stat('Diese Woche', `${publishedThisWeek} / ${goal}`,
        h('div.col.gap-xs', null,
          bar(publishedThisWeek / goal, publishedThisWeek >= goal ? 'ok' : ''),
          h('div.stat__meta', { text: `${plannedThisWeek} weitere eingeplant` })))),
      card(null, {}, stat('Jetzt fällig', String(dueNow.length),
        missed.length ? h('div.stat__meta', { text: `${missed.length} verpasst` }) : 'Alles im Zeitplan')),
      card(null, {}, stat('Offene Ideen', String(openIdeas.length),
        openIdeas.length < 5 ? 'Vorrat wird dünn' : 'Solider Vorrat')),
      card(null, {}, stat('Betriebszustand', `${health}`,
        h('div.col.gap-xs', null,
          bar(health / 100, health > 75 ? 'ok' : health > 45 ? 'warn' : 'danger'),
          h('div.stat__meta', {
            text: health > 75 ? 'Läuft rund' : health > 45 ? 'Ausbaufähig' : 'Braucht Aufmerksamkeit',
          }))))),

    // ---------------------------------------------------------------- Fällig
    dueNow.length
      ? h('section.section', null,
          h('div.section__head', null,
            h('div.section__title', { text: 'Jetzt fällig' }),
            h('div.section__hint', { text: 'Text kopieren, veröffentlichen, abhaken' })),
          h('div.col.gap-sm', null,
            ...dueNow.map((post) =>
              posts.postRow(post, { onClick: (p) => goto('composer', { id: p.id }), actions: dueActions(post) }))))
      : null,

    // ---------------------------------------------------------------- Zwei Spalten
    h('div.split', null,
      h('div.col.gap-xl', null,
        h('section.section.mt-0', null,
          h('div.section__head', null,
            h('div.section__title', { text: 'Heute' }),
            h('button.btn.btn--ghost.btn--sm', { text: 'Kalender', onClick: () => goto('calendar') })),
          today.length
            ? h('div.col.gap-sm', null,
                ...today.map((post) => posts.postRow(post, { onClick: (p) => goto('composer', { id: p.id }) })))
            : card(null, { class: 'card--quiet' },
                empty('Heute nichts geplant', 'Ein freier Tag ist der beste Moment, um Vorrat aufzubauen.',
                  h('button.btn.btn--sm.mt-sm', { text: 'Beitrag anlegen', onClick: () => goto('composer', { fresh: true }) })))),

        h('section.section', null,
          h('div.section__head', null,
            h('div.section__title', { text: 'Die nächsten sieben Tage' }),
            h('div.section__hint', { text: fmt.plural(upcoming.length, 'Beitrag', 'Beiträge') })),
          upcoming.length
            ? h('div.col.gap-sm', null,
                ...upcoming.slice(0, 8).map((post) =>
                  posts.postRow(post, { showDate: true, onClick: (p) => goto('composer', { id: p.id }) })))
            : card(null, { class: 'card--quiet' },
                empty('Die Woche ist noch leer', 'Feste Zeitfenster in der Warteschlange nehmen dir diese Entscheidung dauerhaft ab.',
                  h('button.btn.btn--sm.mt-sm', { text: 'Zeitfenster anlegen', onClick: () => goto('queue') }))))),

      // -------------------------------------------------------------- Coach
      h('div.col.gap-lg', null,
        h('section.section.mt-0', null,
          h('div.section__head', null,
            h('div.section__title', { text: 'Was du verbessern kannst' }),
            h('button.btn.btn--ghost.btn--sm', { text: 'Alle', onClick: () => goto('coach') })),
          tips.length
            ? h('div.col.gap-sm', null, ...tips.map((item) => insightCard(item, goto)))
            : card(null, { class: 'card--quiet' }, empty('Keine Hinweise', 'Sobald Beiträge und Zahlen da sind, findet der Coach hier Ansatzpunkte.'))),

        card('Schnell erledigt', { hint: 'Ein Klick' },
          h('div.col.gap-sm', null,
            h('button.btn.btn--block', { text: '✎  Beitrag schreiben', onClick: () => goto('composer', { fresh: true }) }),
            h('button.btn.btn--block', { text: '✦  Ideen erzeugen lassen', onClick: () => goto('ideas', { generate: true }) }),
            h('button.btn.btn--block', { text: '◫  Zahlen eintragen', onClick: () => goto('analytics', { capture: true }) }),
            h('button.btn.btn--block', { text: '▤  Medien hinzufügen', onClick: () => goto('media', { pick: true }) }))),

        store.all('activity').length
          ? card('Zuletzt passiert', {},
              h('div.col.gap-xs', null,
                ...store.all('activity').slice(0, 6).map((event) =>
                  h('div.row.gap-sm.text-sm', null,
                    h('span.faint.nowrap', { text: fmt.relative(event.at) }),
                    h('span.truncate', { text: event.title || event.type })))))
          : null)));
}
