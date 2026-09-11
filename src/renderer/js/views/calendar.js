/** Kalender: Monats- und Wochenansicht mit Umplanen per Ziehen. */

import { h, card } from '../lib/dom.js';
import * as fmt from '../lib/format.js';
import * as store from '../lib/store.js';
import * as posts from '../lib/posts.js';
import { platform } from '../lib/platforms.js';
import { toast, segmented, modal, copy } from '../lib/ui.js';
import { t, mark } from '../lib/i18n.js';

export const title = mark('Kalender');
export const lead = mark('Was wann wohin geht – auf einen Blick.');

let mode = 'month';
let cursor = new Date();

/** Setzt die Uhrzeit eines Termins auf einen anderen Tag um. */
async function moveTo(postId, day, hour = null) {
  const post = store.byId('posts', postId);
  if (!post) return;
  const old = post.scheduledAt ? new Date(post.scheduledAt) : new Date();
  const next = new Date(
    day.getFullYear(), day.getMonth(), day.getDate(),
    hour ?? old.getHours(), hour !== null ? 0 : old.getMinutes()
  );
  await store.patch('posts', postId, {
    scheduledAt: next.toISOString(),
    status: post.status === 'missed' || post.status === 'due' ? 'scheduled' : post.status,
    preNotifiedAt: null,
  });
  toast(t('Verschoben auf {when}.', { when: fmt.dateTime(next) }), 'ok');
}

/**
 * Kalender in Apple Kalender, Google oder Outlook bringen.
 *
 * Zwei Wege mit einem wichtigen Unterschied: Das Abonnement bleibt mit dem Plan
 * verbunden und frischt sich selbst auf, funktioniert aber nur, solange dieser
 * Rechner läuft. Die Datei ist überall dabei, kennt spätere Änderungen aber nicht.
 */
async function subscribeDialog() {
  const result = await window.ch.calendar.subscription();
  const info = result?.ok ? result.data : { running: false };

  const step = (number, title, body) => h('div.row.gap-sm', { style: { alignItems: 'flex-start' } },
    h('span.badge.badge--accent', { text: String(number) }),
    h('div', null,
      h('div.strong.text-sm', { text: title }),
      h('div.text-sm.muted', { text: body })));

  modal({
    title: t('Kalender verbinden'),
    body: h('div.col.gap-lg', null,
      // --- Abonnement
      h('div', null,
        h('div.row.between.mb-sm', null,
          h('h3', { text: t('Abonnieren – bleibt aktuell') }),
          h('span.badge', { class: info.running ? 'badge--ok' : 'badge--warn', text: info.running ? t('bereit') : t('Handy-Zugang aus') })),
        info.running
          ? h('div.col.gap-sm', null,
              h('p.text-sm.muted', { text: t('Dein Kalender holt sich diese Adresse regelmässig selbst. Änderungen am Plan erscheinen dadurch von allein – solange dieser Rechner läuft und im selben Netz erreichbar ist.') }),
              h('div.mono.text-xs.faint', { style: { wordBreak: 'break-all' }, text: info.url }),
              h('div.row.wrap.gap-sm', null,
                h('button.btn.btn--sm.btn--primary', { text: t('Adresse kopieren'), onClick: () => copy(info.url, t('Adresse kopiert – im Kalender einfügen.')) }),
                h('button.btn.btn--sm', { text: t('In Apple Kalender öffnen'), onClick: () => window.ch.system.openExternal(info.webcal) })),
              h('hr.divider'),
              h('div.col.gap-lg', null,
                step('A', t('Apple Kalender (Mac)'), t('Ablage → Neues Kalenderabonnement → Adresse einfügen. Aktualisierung auf „alle 15 Minuten“ stellen.')),
                step('I', t('iPhone und iPad'), t('Einstellungen → Apps → Kalender → Accounts → Account hinzufügen → Andere → Kalenderabo hinzufügen.')),
                step('G', t('Google Kalender'), t('Andere Kalender → + → Per URL. Achtung: Google erreicht deinen Rechner nur, wenn er aus dem Internet erreichbar ist – im Heimnetz klappt nur Apple und Outlook auf demselben Netz.')),
                step('O', 'Outlook', t('Kalender hinzufügen → Aus dem Internet abonnieren → Adresse einfügen.'))))
          : h('div.notice.notice--warn', null,
              h('span.notice__icon', { text: '!' }),
              h('div', null,
                h('div.strong.text-sm', { text: t('Dafür muss der Handy-Zugang laufen') }),
                h('div.text-sm.muted', { text: t('Er stellt die Kalenderadresse im Heimnetz bereit. Einschalten unter „Handy“ – der Kalender läuft dann über dieselbe Verbindung.') })))),

      h('hr.divider'),

      // --- Datei
      h('div', null,
        h('h3.mb-sm', { text: t('Als Datei – überall dabei') }),
        h('p.text-sm.muted.mb', { text: t('Eine .ics-Datei lässt sich in jede Kalender-App einlesen, auch ohne Netzwerk. Sie ist eine Momentaufnahme: spätere Änderungen am Plan stehen nicht darin.') }),
        h('button.btn', {
          text: t('Kalenderdatei speichern'),
          onClick: async () => {
            const saved = await window.ch.calendar.export(true);
            if (!saved?.ok) return toast(saved?.error || t('Speichern fehlgeschlagen.'), 'danger');
            if (saved.data.canceled) return;
            toast(saved.data.events === 1
              ? t('1 Termin gespeichert.')
              : t('{count} Termine gespeichert.', { count: fmt.num(saved.data.events) }), 'ok');
          },
        })),

      h('p.text-xs.faint', { text: t('Die Termine enthalten Titel, Kanäle, Text, Hashtags und Checkliste – und eine Erinnerung vor dem Termin.') })),
  });
}

function chip(post, goto) {
  const color = platform(post.platforms?.[0])?.color || 'var(--accent)';
  return h(`div.cal__chip.is-${post.status}`, {
    draggable: true,
    style: {
      borderLeftColor: color,
      background: `color-mix(in srgb, ${color} 14%, var(--surface-2))`,
    },
    title: `${posts.titleOf(post)} · ${fmt.time(post.scheduledAt)}`,
    onDragStart: (event) => {
      event.dataTransfer.setData('text/plain', post.id);
      event.currentTarget.classList.add('is-dragging');
    },
    onDragEnd: (event) => event.currentTarget.classList.remove('is-dragging'),
    onClick: () => goto('composer', { id: post.id }),
  },
    h('span', { text: fmt.time(post.scheduledAt) }),
    h('span.truncate', { text: posts.titleOf(post) }));
}

/** Gemeinsames Ablegen-Verhalten für Tagesfelder. */
function dropTarget(node, day, hour, refresh) {
  node.addEventListener('dragover', (event) => {
    event.preventDefault();
    node.classList.add('is-drop');
  });
  node.addEventListener('dragleave', () => node.classList.remove('is-drop'));
  node.addEventListener('drop', async (event) => {
    event.preventDefault();
    node.classList.remove('is-drop');
    const id = event.dataTransfer.getData('text/plain');
    if (!id) return;
    await moveTo(id, day, hour);
    refresh();
  });
  return node;
}

function monthGrid(goto, refresh) {
  const settings = store.settings();
  const firstDay = settings.startOfWeek ?? 1;
  const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const start = fmt.startOfWeek(first, firstDay);
  const grid = h('div.cal');

  for (let i = 0; i < 7; i += 1) {
    grid.append(h('div.cal__head', { text: fmt.weekdayShort((firstDay + i) % 7) }));
  }

  for (let index = 0; index < 42; index += 1) {
    const day = fmt.addDays(start, index);
    const outside = day.getMonth() !== cursor.getMonth();
    const dayPosts = posts.forDay(day);

    const cell = h(`div.cal__day${outside ? '.is-outside' : ''}${fmt.isToday(day) ? '.is-today' : ''}`, null,
      h('div.cal__date', null,
        h(`span.cal__num${fmt.isToday(day) ? '.is-today' : ''}`, { text: String(day.getDate()) }),
        dayPosts.length > 1 ? h('span.cal__count', { text: String(dayPosts.length) }) : null,
        h('span.add', {
          text: '＋',
          title: t('Beitrag für diesen Tag'),
          onClick: (event) => {
            event.stopPropagation();
            goto('composer', { fresh: true, day: fmt.dayKey(day) });
          },
        })),
      ...dayPosts.slice(0, 4).map((post) => chip(post, goto)),
      dayPosts.length > 4 ? h('div.text-xs.faint', { text: t('+{count} weitere', { count: dayPosts.length - 4 }) }) : null);

    grid.append(dropTarget(cell, day, null, refresh));
  }
  return grid;
}

function weekGrid(goto, refresh) {
  const settings = store.settings();
  const start = fmt.startOfWeek(cursor, settings.startOfWeek ?? 1);
  const grid = h('div.week');

  grid.append(h('div.cal__head', { text: t('KW {week}', { week: fmt.isoWeek(start) }) }));
  for (let i = 0; i < 7; i += 1) {
    const day = fmt.addDays(start, i);
    grid.append(h(`div.cal__head${fmt.isToday(day) ? '.is-today' : ''}`, {
      text: t('{weekday} {day}.', { weekday: fmt.weekdayShort(day.getDay()), day: day.getDate() }),
    }));
  }

  for (let hour = 6; hour < 24; hour += 1) {
    grid.append(h('div.week__hour', { text: `${String(hour).padStart(2, '0')}:00` }));
    for (let i = 0; i < 7; i += 1) {
      const day = fmt.addDays(start, i);
      const inHour = posts.forDay(day).filter((post) => new Date(post.scheduledAt).getHours() === hour);
      // Die laufende Stunde bekommt eine Marke, damit „jetzt“ sofort auffällt.
      const isNow = fmt.isToday(day) && new Date().getHours() === hour;
      const cell = h(`div.week__cell${isNow ? '.is-now' : ''}`, null, ...inHour.map((post) => chip(post, goto)));
      cell.addEventListener('dblclick', () => goto('composer', { fresh: true, day: fmt.dayKey(day), hour }));
      grid.append(dropTarget(cell, day, hour, refresh));
    }
  }
  return grid;
}

export async function render({ goto, setActions, refresh }) {
  const label = mode === 'month'
    ? `${fmt.monthName(cursor.getMonth())} ${cursor.getFullYear()}`
    : `${t('KW {week}', { week: fmt.isoWeek(cursor) })} · ${fmt.date(fmt.startOfWeek(cursor, store.settings().startOfWeek ?? 1), 'short')}`;

  const step = (direction) => {
    cursor = mode === 'month'
      ? new Date(cursor.getFullYear(), cursor.getMonth() + direction, 1)
      : fmt.addDays(cursor, direction * 7);
    refresh();
  };

  setActions(
    segmented(
      [{ value: 'month', label: t('Monat') }, { value: 'week', label: t('Woche') }],
      mode,
      (value) => { mode = value; refresh(); }
    ),
    h('button.btn.btn--sm.btn--icon', { text: '‹', title: t('Zurück'), onClick: () => step(-1) }),
    h('button.btn.btn--sm', { text: t('Heute'), onClick: () => { cursor = new Date(); refresh(); } }),
    h('button.btn.btn--sm.btn--icon', { text: '›', title: t('Weiter'), onClick: () => step(1) }),
    h('button.btn.btn--sm', { text: t('⇱ Kalender verbinden'), title: t('In Apple Kalender, Google oder Outlook übernehmen'), onClick: subscribeDialog }),
    h('button.btn.btn--sm.btn--primary', { text: t('＋ Beitrag'), onClick: () => goto('composer', { fresh: true }) })
  );

  const monthStart = mode === 'month'
    ? new Date(cursor.getFullYear(), cursor.getMonth(), 1)
    : fmt.startOfWeek(cursor, store.settings().startOfWeek ?? 1);
  const monthEnd = mode === 'month'
    ? new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0, 23, 59)
    : fmt.addDays(monthStart, 6);
  const inRange = posts.scheduledBetween(monthStart, monthEnd);
  const published = inRange.filter((post) => post.status === 'published').length;

  const unscheduled = store.all('posts').filter(
    (post) => !post.scheduledAt && ['draft', 'ready'].includes(post.status)
  );

  const legend = h('div.cal-legend', null,
    ...[
      ['scheduled', t('Geplant')],
      ['due', t('Jetzt fällig')],
      ['published', t('Veröffentlicht')],
      ['missed', t('Verpasst')],
    ].map(([key, text]) =>
      h('span.cal-legend__item', null, h(`span.status-dot.is-${key}`), h('span', { text }))));

  return h('div.col.gap-lg', null,
    h('div.cal-head', null,
      h('div', null,
        h('h2.cal-head__title', { text: label }),
        h('div.text-sm.muted', {
          text: t('{posts} im Zeitraum · {published} bereits veröffentlicht', { posts: fmt.plural(inRange.length, 'Beitrag', 'Beiträge'), published }), // i18n-ignore
        })),
      legend),

    mode === 'month' ? monthGrid(goto, refresh) : weekGrid(goto, refresh),

    h('p.text-xs.faint', { text: t('Beiträge lassen sich mit der Maus auf einen anderen Tag ziehen. In der Wochenansicht legt ein Doppelklick auf eine Zelle direkt einen Beitrag für diese Stunde an.') }),

    unscheduled.length
      ? card(t('Wartet auf einen Termin'), { hint: fmt.plural(unscheduled.length, 'Beitrag', 'Beiträge') }, // i18n-ignore
          h('div.col.gap-sm', null,
            ...unscheduled.slice(0, 8).map((post) =>
              posts.postRow(post, {
                onClick: (item) => goto('composer', { id: item.id }),
                actions: h('button.btn.btn--sm', {
                  text: t('Nächstes Zeitfenster'),
                  onClick: async (event) => {
                    event.stopPropagation();
                    const slot = nextFreeSlot();
                    await store.patch('posts', post.id, { scheduledAt: slot.toISOString(), status: 'scheduled' });
                    toast(t('Eingeplant für {when}.', { when: fmt.dateTime(slot) }), 'ok');
                    refresh();
                  },
                }),
              }))))
      : null);
}

/** Erstes freies Zeitfenster aus den Einstellungen, sonst morgen 18 Uhr. */
function nextFreeSlot() {
  const slots = store.settings().queueSlots || [];
  const taken = new Set(
    store.all('posts').filter((post) => post.scheduledAt).map((post) => new Date(post.scheduledAt).toISOString().slice(0, 16))
  );
  for (let offset = 0; offset < 30; offset += 1) {
    const day = fmt.addDays(new Date(), offset);
    for (const slot of slots.filter((entry) => entry.days.includes(day.getDay()))) {
      const [hour, minute] = slot.time.split(':').map(Number);
      const when = new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour, minute);
      if (when > new Date() && !taken.has(when.toISOString().slice(0, 16))) return when;
    }
  }
  const fallback = fmt.addDays(new Date(), 1);
  fallback.setHours(18, 0, 0, 0);
  return fallback;
}
