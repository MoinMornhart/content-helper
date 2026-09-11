/**
 * Warteschlange nach Buffer-Art.
 *
 * Statt für jeden Beitrag einzeln einen Termin zu suchen, legst du feste
 * Zeitfenster fest. Fertige Beiträge rutschen der Reihe nach hinein – die
 * Entscheidung "wann" fällt damit einmal statt jedes Mal neu.
 */

import { h, card, empty, fill } from '../lib/dom.js';
import * as fmt from '../lib/format.js';
import * as store from '../lib/store.js';
import * as posts from '../lib/posts.js';
import { active, glyph, platform } from '../lib/platforms.js';
import { toast, confirm, modal } from '../lib/ui.js';
import { t, mark } from '../lib/i18n.js';

export const title = mark('Warteschlange');
export const lead = mark('Feste Zeitfenster füllen sich der Reihe nach.');

const WEEKDAYS = [1, 2, 3, 4, 5, 6, 0];

/** Alle Zeitfenster der kommenden Tage, chronologisch. */
function upcomingSlots(days = 14) {
  const slots = store.settings().queueSlots || [];
  const out = [];
  const now = new Date();
  for (let offset = 0; offset < days; offset += 1) {
    const day = fmt.addDays(now, offset);
    for (const slot of slots) {
      if (!slot.days.includes(day.getDay())) continue;
      const [hour, minute] = slot.time.split(':').map(Number);
      const when = new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour, minute);
      if (when > now) out.push({ when, slot });
    }
  }
  return out.sort((a, b) => a.when - b.when);
}

/** Ordnet jedem Zeitfenster den Beitrag zu, der dort bereits geplant ist. */
function slotsWithPosts(days = 14) {
  const scheduled = store.all('posts').filter((post) => post.scheduledAt && ['scheduled', 'due'].includes(post.status));
  return upcomingSlots(days).map((entry) => {
    const key = entry.when.toISOString().slice(0, 16);
    return {
      ...entry,
      post: scheduled.find((post) => new Date(post.scheduledAt).toISOString().slice(0, 16) === key) || null,
    };
  });
}

// ------------------------------------------------------------------ Zeitfenster verwalten

function slotEditor(refresh, existing = null, index = null) {
  const selectedDays = new Set(existing?.days || [1, 3, 5]);
  const timeInput = h('input.input', { type: 'time', value: existing?.time || '18:00' });
  const platformSelect = h('select.select', null,
    h('option', { value: '', text: t('Alle Kanäle'), selected: !existing?.platformId }),
    ...active(store.settings()).map((p) =>
      h('option', { value: p.id, text: p.name, selected: existing?.platformId === p.id })));

  const dayChips = h('div.chips');
  const renderDays = () => {
    fill(dayChips, ...WEEKDAYS.map((day) =>
      h(`span.chip${selectedDays.has(day) ? '.is-active' : ''}`, {
        text: fmt.weekdayShort(day),
        onClick: () => {
          if (selectedDays.has(day)) selectedDays.delete(day);
          else selectedDays.add(day);
          renderDays();
        },
      })));
  };
  renderDays();

  modal({
    title: existing ? t('Zeitfenster ändern') : t('Neues Zeitfenster'),
    size: 'narrow',
    body: h('div.col.gap-lg', null,
      h('div.field', null, h('span.field__label', { text: t('Wochentage') }), dayChips),
      h('label.field', null, h('span.field__label', { text: t('Uhrzeit') }), timeInput),
      h('label.field', null,
        h('span.field__label', { text: t('Nur für einen Kanal (optional)') }),
        platformSelect,
        h('span.field__hint', { text: t('Leer lassen, wenn das Fenster für alles gilt.') }))),
    actions: [
      existing
        ? {
            label: t('Löschen'),
            tone: 'danger',
            action: async () => {
              const slots = [...(store.settings().queueSlots || [])];
              slots.splice(index, 1);
              await store.saveSettings({ queueSlots: slots });
              toast(t('Zeitfenster entfernt.'), 'ok');
              refresh();
            },
          }
        : null,
      {
        label: t('Speichern'),
        primary: true,
        action: async () => {
          if (!selectedDays.size) return toast(t('Bitte mindestens einen Wochentag wählen.'), 'warn');
          const slots = [...(store.settings().queueSlots || [])];
          const entry = {
            days: [...selectedDays].sort(),
            time: timeInput.value || '18:00',
            platformId: platformSelect.value || null,
          };
          if (index === null) slots.push(entry);
          else slots[index] = entry;
          slots.sort((a, b) => a.time.localeCompare(b.time));
          await store.saveSettings({ queueSlots: slots });
          toast(t('Zeitfenster gespeichert.'), 'ok');
          refresh();
        },
      },
    ].filter(Boolean),
  });
}

/** Übernimmt die Empfehlungen der aktiven Kanäle als Startbelegung. */
async function adoptRecommended(refresh) {
  const seen = new Set();
  const slots = [];
  for (const p of active(store.settings())) {
    for (const slot of p.bestSlots || []) {
      const key = `${slot.days.join(',')}-${slot.time}`;
      if (seen.has(key)) continue;
      seen.add(key);
      slots.push({ days: slot.days, time: slot.time, platformId: null });
    }
  }
  if (!slots.length) return toast(t('Für die aktiven Kanäle gibt es keine Empfehlungen.'), 'warn');
  await store.saveSettings({ queueSlots: slots.sort((a, b) => a.time.localeCompare(b.time)) });
  toast(t('{count} Zeitfenster übernommen.', { count: slots.length }), 'ok');
  refresh();
}

/** Füllt freie Fenster der Reihe nach mit fertigen Beiträgen. */
async function fillQueue(refresh) {
  const ready = store.all('posts')
    .filter((post) => !post.scheduledAt && ['ready', 'draft'].includes(post.status))
    .reverse();
  if (!ready.length) return toast(t('Es liegen keine fertigen Beiträge bereit.'), 'warn');

  const free = slotsWithPosts(30).filter((entry) => !entry.post);
  if (!free.length) return toast(t('Alle Zeitfenster der nächsten 30 Tage sind belegt.'), 'warn');

  let count = 0;
  for (const entry of free) {
    const next = ready.find((post) =>
      !entry.slot.platformId || (post.platforms || []).includes(entry.slot.platformId));
    if (!next) break;
    ready.splice(ready.indexOf(next), 1);
    await store.patch('posts', next.id, {
      scheduledAt: entry.when.toISOString(),
      status: 'scheduled',
      preNotifiedAt: null,
    });
    count += 1;
  }
  toast(count ? t('{posts} eingeplant.', { posts: fmt.plural(count, 'Beitrag', 'Beiträge') }) : t('Nichts Passendes gefunden.'), count ? 'ok' : 'warn'); // i18n-ignore
  refresh();
}

// ------------------------------------------------------------------ Ansicht

export async function render({ goto, setActions, refresh }) {
  const settings = store.settings();
  const slots = settings.queueSlots || [];
  const all = store.all('posts');
  const due = all.filter((post) => post.status === 'due').sort(posts.bySchedule);
  const missed = all.filter((post) => post.status === 'missed').sort(posts.bySchedule);
  const waiting = all.filter((post) => !post.scheduledAt && ['draft', 'ready'].includes(post.status));

  setActions(
    h('button.btn.btn--sm', { text: t('Warteschlange füllen'), onClick: () => fillQueue(refresh) }),
    h('button.btn.btn--sm.btn--primary', { text: t('＋ Zeitfenster'), onClick: () => slotEditor(refresh) })
  );

  const publish = async (post) => {
    await store.patch('posts', post.id, { status: 'published', publishedAt: new Date().toISOString() });
    toast(t('Als veröffentlicht markiert.'), 'ok');
    refresh();
  };

  const handoff = (post) => h('div.row.gap-xs', null,
    h('button.btn.btn--sm', {
      text: t('Kopieren'),
      onClick: async (event) => {
        event.stopPropagation();
        await window.ch.system.copy(posts.renderFor(post, post.platforms?.[0]));
        toast(t('Text liegt in der Zwischenablage.'), 'ok');
      },
    }),
    platform(post.platforms?.[0])?.uploadUrl
      ? h('button.btn.btn--sm', {
          text: t('Upload öffnen'),
          onClick: (event) => {
            event.stopPropagation();
            window.ch.system.openExternal(platform(post.platforms[0]).uploadUrl);
          },
        })
      : null,
    h('button.btn.btn--sm.btn--primary', {
      text: t('Erledigt'),
      onClick: (event) => { event.stopPropagation(); publish(post); },
    }));

  return h('div.col.gap-xl', null,
    // ---------------------------------------------------------------- Fällig
    due.length || missed.length
      ? h('section.section.mt-0', null,
          h('div.section__head', null,
            h('div.section__title', { text: t('Braucht jetzt deine Hand') }),
            h('div.section__hint', { text: t('kopieren, hochladen, abhaken') })),
          h('div.col.gap-sm', null,
            ...due.map((post) => posts.postRow(post, { showDate: true, onClick: (p) => goto('composer', { id: p.id }), actions: handoff(post) })),
            ...missed.map((post) =>
              posts.postRow(post, {
                showDate: true,
                onClick: (p) => goto('composer', { id: p.id }),
                actions: h('div.row.gap-xs', null,
                  h('button.btn.btn--sm', {
                    text: t('Neu einplanen'),
                    onClick: async (event) => {
                      event.stopPropagation();
                      const free = slotsWithPosts(30).find((entry) => !entry.post);
                      const when = free?.when || fmt.addDays(new Date(), 1);
                      await store.patch('posts', post.id, { scheduledAt: when.toISOString(), status: 'scheduled', preNotifiedAt: null });
                      toast(t('Neuer Termin: {when}.', { when: fmt.dateTime(when) }), 'ok');
                      refresh();
                    },
                  }),
                  h('button.btn.btn--sm.btn--ghost', {
                    text: t('Verwerfen'),
                    onClick: async (event) => {
                      event.stopPropagation();
                      if (!(await confirm({ title: t('Beitrag verwerfen?'), message: t('Der Beitrag bleibt als Entwurf erhalten, verliert aber seinen Termin.'), confirmLabel: t('Verwerfen') }))) return;
                      await store.patch('posts', post.id, { status: 'draft', scheduledAt: null });
                      refresh();
                    },
                  })),
              }))))
      : null,

    // ---------------------------------------------------------------- Zeitfenster
    h('div.split', null,
      h('section.section.mt-0', null,
        h('div.section__head', null,
          h('div.section__title', { text: t('Die nächsten Zeitfenster') }),
          h('div.section__hint', { text: t('{count} Fenster pro Woche', { count: slots.length }) })),
        slots.length
          ? h('div.col.gap-sm', null,
              ...slotsWithPosts(14).slice(0, 14).map((entry) =>
                entry.post
                  ? h('div.queue-slot.is-filled', null,
                      h('span.mono.text-sm.nowrap', { text: `${fmt.date(entry.when, 'day')} ${fmt.time(entry.when)}` }),
                      posts.statusDot(entry.post.status),
                      h('span.grow.truncate', { text: posts.titleOf(entry.post) }),
                      entry.slot.platformId ? glyph(entry.slot.platformId, 16) : null,
                      h('button.btn.btn--sm.btn--ghost', { text: t('Öffnen'), onClick: () => goto('composer', { id: entry.post.id }) }))
                  : h('div.queue-slot', null,
                      h('span.mono.text-sm.nowrap', { text: `${fmt.date(entry.when, 'day')} ${fmt.time(entry.when)}` }),
                      h('span.grow', { text: entry.slot.platformId ? t('frei · nur {channel}', { channel: platform(entry.slot.platformId)?.name }) : t('frei') }),
                      h('button.btn.btn--sm', {
                        text: t('Beitrag anlegen'),
                        onClick: () => goto('composer', { fresh: true, at: entry.when.toISOString() }),
                      }))))
          : card(null, { class: 'card--quiet' },
              empty(t('Noch keine Zeitfenster'),
                t('Feste Termine nehmen dir die Frage „wann poste ich das?“ dauerhaft ab.'),
                h('div.row.gap-sm.mt-sm', null,
                  h('button.btn.btn--primary.btn--sm', { text: t('Empfehlungen übernehmen'), onClick: () => adoptRecommended(refresh) }),
                  h('button.btn.btn--sm', { text: t('Eigenes anlegen'), onClick: () => slotEditor(refresh) }))))),

      h('div.col.gap-lg', null,
        card(t('Wochenplan'), { hint: t('deine festen Fenster') },
          slots.length
            ? h('div.col.gap-sm', null,
                ...slots.map((slot, index) =>
                  h('div.row.between', null,
                    h('div.row.gap-sm', null,
                      h('span.mono.strong', { text: slot.time }),
                      h('span.text-sm.muted', { text: slot.days.map((day) => fmt.weekdayShort(day)).join(' ') }),
                      slot.platformId ? glyph(slot.platformId, 15) : null),
                    h('button.btn.btn--ghost.btn--sm', { text: t('Ändern'), onClick: () => slotEditor(refresh, slot, index) }))),
                h('button.btn.btn--sm.btn--ghost.mt-sm', { text: t('Empfehlungen der Kanäle übernehmen'), onClick: () => adoptRecommended(refresh) }))
            : h('p.text-sm.muted', { text: t('Keine Zeitfenster angelegt.') })),

        card(t('Wartet auf einen Platz'), { hint: fmt.plural(waiting.length, 'Beitrag', 'Beiträge') }, // i18n-ignore
          waiting.length
            ? h('div.col.gap-sm', null,
                ...waiting.slice(0, 10).map((post) =>
                  h('div.row.gap-sm', null,
                    posts.statusDot(post.status),
                    h('span.grow.truncate.text-sm', { text: posts.titleOf(post) }),
                    h('button.btn.btn--sm.btn--ghost', { text: t('Öffnen'), onClick: () => goto('composer', { id: post.id }) }))))
            : h('p.text-sm.muted', { text: t('Alles eingeplant. Guter Zustand.') })))));
}
