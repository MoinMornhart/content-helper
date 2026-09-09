/** Kalender: Monats- und Wochenansicht mit Umplanen per Ziehen. */

import { h, card } from '../lib/dom.js';
import * as fmt from '../lib/format.js';
import * as store from '../lib/store.js';
import * as posts from '../lib/posts.js';
import { platform } from '../lib/platforms.js';
import { toast, segmented } from '../lib/ui.js';

export const title = 'Kalender';
export const lead = 'Was wann wohin geht – auf einen Blick.';

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
  toast(`Verschoben auf ${fmt.dateTime(next)}.`, 'ok');
}

function chip(post, goto) {
  const color = platform(post.platforms?.[0])?.color || 'var(--accent)';
  return h('div.cal__chip', {
    draggable: true,
    style: { borderLeftColor: color },
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
        h('span', { text: String(day.getDate()) }),
        h('span.add', {
          text: '＋',
          title: 'Beitrag für diesen Tag',
          onClick: (event) => {
            event.stopPropagation();
            goto('composer', { fresh: true, day: fmt.dayKey(day) });
          },
        })),
      ...dayPosts.slice(0, 4).map((post) => chip(post, goto)),
      dayPosts.length > 4 ? h('div.text-xs.faint', { text: `+${dayPosts.length - 4} weitere` }) : null);

    grid.append(dropTarget(cell, day, null, refresh));
  }
  return grid;
}

function weekGrid(goto, refresh) {
  const settings = store.settings();
  const start = fmt.startOfWeek(cursor, settings.startOfWeek ?? 1);
  const grid = h('div.week');

  grid.append(h('div.cal__head', { text: `KW ${fmt.isoWeek(start)}` }));
  for (let i = 0; i < 7; i += 1) {
    const day = fmt.addDays(start, i);
    grid.append(h(`div.cal__head${fmt.isToday(day) ? '.is-today' : ''}`, {
      text: `${fmt.weekdayShort(day.getDay())} ${day.getDate()}.`,
    }));
  }

  for (let hour = 6; hour < 24; hour += 1) {
    grid.append(h('div.week__hour', { text: `${String(hour).padStart(2, '0')}:00` }));
    for (let i = 0; i < 7; i += 1) {
      const day = fmt.addDays(start, i);
      const inHour = posts.forDay(day).filter((post) => new Date(post.scheduledAt).getHours() === hour);
      const cell = h('div.week__cell', null, ...inHour.map((post) => chip(post, goto)));
      cell.addEventListener('dblclick', () => goto('composer', { fresh: true, day: fmt.dayKey(day), hour }));
      grid.append(dropTarget(cell, day, hour, refresh));
    }
  }
  return grid;
}

export async function render({ goto, setActions, refresh }) {
  const label = mode === 'month'
    ? `${fmt.monthName(cursor.getMonth())} ${cursor.getFullYear()}`
    : `KW ${fmt.isoWeek(cursor)} · ${fmt.date(fmt.startOfWeek(cursor, store.settings().startOfWeek ?? 1), 'short')}`;

  const step = (direction) => {
    cursor = mode === 'month'
      ? new Date(cursor.getFullYear(), cursor.getMonth() + direction, 1)
      : fmt.addDays(cursor, direction * 7);
    refresh();
  };

  setActions(
    segmented(
      [{ value: 'month', label: 'Monat' }, { value: 'week', label: 'Woche' }],
      mode,
      (value) => { mode = value; refresh(); }
    ),
    h('button.btn.btn--sm.btn--icon', { text: '‹', title: 'Zurück', onClick: () => step(-1) }),
    h('button.btn.btn--sm', { text: 'Heute', onClick: () => { cursor = new Date(); refresh(); } }),
    h('button.btn.btn--sm.btn--icon', { text: '›', title: 'Weiter', onClick: () => step(1) }),
    h('button.btn.btn--sm.btn--primary', { text: '＋ Beitrag', onClick: () => goto('composer', { fresh: true }) })
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

  return h('div.col.gap-lg', null,
    h('div.row.between', null,
      h('h2', { text: label }),
      h('div.row.gap-lg.text-sm.muted', null,
        h('span', { text: `${fmt.plural(inRange.length, 'Beitrag', 'Beiträge')} im Zeitraum` }),
        h('span', { text: `${published} bereits veröffentlicht` }))),

    mode === 'month' ? monthGrid(goto, refresh) : weekGrid(goto, refresh),

    h('p.text-xs.faint', { text: 'Beiträge lassen sich mit der Maus auf einen anderen Tag ziehen. In der Wochenansicht legt ein Doppelklick auf eine Zelle direkt einen Beitrag für diese Stunde an.' }),

    unscheduled.length
      ? card('Wartet auf einen Termin', { hint: fmt.plural(unscheduled.length, 'Beitrag', 'Beiträge') },
          h('div.col.gap-sm', null,
            ...unscheduled.slice(0, 8).map((post) =>
              posts.postRow(post, {
                onClick: (item) => goto('composer', { id: item.id }),
                actions: h('button.btn.btn--sm', {
                  text: 'Nächstes Zeitfenster',
                  onClick: async (event) => {
                    event.stopPropagation();
                    const slot = nextFreeSlot();
                    await store.patch('posts', post.id, { scheduledAt: slot.toISOString(), status: 'scheduled' });
                    toast(`Eingeplant für ${fmt.dateTime(slot)}.`, 'ok');
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
