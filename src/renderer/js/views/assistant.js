/**
 * Assistent: „Was lief – und was soll ich als Nächstes machen?“
 *
 * Die Ansicht zeigt nicht nur, welche Beiträge stark waren, sondern zieht daraus
 * wiederholbare Merkmale und schlägt konkrete nächste Inhalte vor – mit fertigen
 * Titeln, passendem Format und dem Zeitfenster, das bei dir bisher am besten
 * getragen hat. Jeder Vorschlag nennt, worauf er sich stützt.
 */

import { h, card, empty, fill } from '../lib/dom.js';
import * as fmt from '../lib/format.js';
import * as store from '../lib/store.js';
import * as advisor from '../lib/advisor.js';
import * as posts from '../lib/posts.js';
import { platform, platformName, glyph, metric, active } from '../lib/platforms.js';
import { toast, modal, segmented } from '../lib/ui.js';

export const title = 'Assistent';
export const lead = 'Aus deinen eigenen Zahlen: was funktioniert und was als Nächstes kommt.';

let platformFilter = null;
/** Gewähltes Konto; undefined heisst: noch keine Wahl getroffen. */
let accountFilter;
let range = 365;

const show = (value, key) => fmt.metricValue(value, metric(key).type);

// ------------------------------------------------------------------ Aktionen

/** Legt aus einem Vorschlag eine Idee an. */
async function takeAsIdea(suggestion, chosenTitle, refresh) {
  await store.add('ideas', {
    title: chosenTitle || suggestion.title,
    notes: `${suggestion.why}\n\n${suggestion.evidence.join('\n')}${suggestion.hook ? `\n\nEinstieg: ${suggestion.hook}` : ''}`,
    hook: suggestion.hook || '',
    status: 'inbox',
    score: 4,
    platforms: suggestion.platformId ? [suggestion.platformId] : [],
    source: 'Assistent',
  });
  toast('Als Idee im Eingang abgelegt.', 'ok');
  refresh();
}

/**
 * Legt aus einem Vorschlag direkt einen geplanten Beitrag an – im Zeitfenster,
 * das bei diesem Kanal bisher am besten getragen hat.
 */
async function scheduleFrom(suggestion, chosenTitle, goto) {
  const when = nextSlot(suggestion.when);
  const created = await store.add('posts', posts.blankPost({
    title: chosenTitle || suggestion.title,
    body: suggestion.hook ? `${suggestion.hook}\n\n` : '',
    platforms: suggestion.platformId ? [suggestion.platformId] : [],
    format: suggestion.format || null,
    status: when ? 'scheduled' : 'draft',
    scheduledAt: when ? when.toISOString() : null,
    notes: suggestion.why,
  }));
  toast(when ? `Eingeplant für ${fmt.dateTime(when)}.` : 'Als Entwurf angelegt.', 'ok');
  goto('composer', { id: created.id });
}

/** Nächster Termin an dem Wochentag und zu der Stunde, die am besten lief. */
function nextSlot(when) {
  if (!when || when.weekday === null || when.weekday === undefined) return null;
  const hour = when.hour ?? 18;
  for (let offset = 1; offset <= 14; offset += 1) {
    const day = fmt.addDays(new Date(), offset);
    if (day.getDay() !== when.weekday) continue;
    return new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour, 0);
  }
  return null;
}

// ------------------------------------------------------------------ Bausteine

function suggestionCard(suggestion, { refresh, goto }) {
  const titleOptions = suggestion.titles || [];
  let chosen = titleOptions[0]?.text || suggestion.title;

  const titleList = h('div.col.gap-xs');
  const renderTitles = () => {
    fill(titleList, ...titleOptions.map((option) =>
      h(`div.post-row${option.text === chosen ? '' : ''}`, {
        style: option.text === chosen ? { borderColor: 'var(--accent)' } : {},
        onClick: () => { chosen = option.text; renderTitles(); },
      },
        h('span.badge', { text: option.kind }),
        h('span.grow', { text: option.text }),
        option.text === chosen ? h('span', { style: { color: 'var(--accent)' }, text: '✓' }) : null)));
  };
  renderTitles();

  return h('div.card.card--accent', null,
    h('div.row.between.mb-sm', null,
      h('div.row.gap-sm', null,
        suggestion.platformId ? glyph(suggestion.platformId, 20) : null,
        h('span.badge.badge--accent', { text: suggestion.kind })),
      suggestion.when
        ? h('span.text-xs.faint', { text: `am besten ${fmt.weekdayName(suggestion.when.weekday)}${suggestion.when.hour !== null ? ` gegen ${String(suggestion.when.hour).padStart(2, '0')} Uhr` : ''}` })
        : null),

    h('h3.mb-sm', { text: suggestion.title }),
    h('p.text-sm.muted', { text: suggestion.why }),

    suggestion.evidence?.length
      ? h('ul.text-xs.faint', { style: { margin: '10px 0 0', paddingLeft: '18px' } },
          ...suggestion.evidence.map((line) => h('li', { text: line })))
      : null,

    titleOptions.length
      ? h('div.mt', null,
          h('div.field__label.mb-sm', { text: 'Titelvorschläge – einen auswählen' }),
          titleList)
      : null,

    h('div.row.wrap.gap-sm.mt', null,
      h('button.btn.btn--sm.btn--primary', {
        text: 'Einplanen',
        onClick: () => scheduleFrom(suggestion, chosen, goto),
      }),
      h('button.btn.btn--sm', {
        text: 'Als Idee sichern',
        onClick: () => takeAsIdea(suggestion, chosen, refresh),
      })));
}

function winnersCard(data) {
  if (!data.winners.length) {
    return card('Deine stärksten Beiträge', { hint: 'noch kein klarer Ausreisser' },
      h('p.text-sm.muted', {
        text: data.total
          ? `Bisher liegt kein Beitrag deutlich über deinem Mittelwert von ${fmt.num(data.baseline || 0, { compact: true })}. Das ist kein schlechtes Zeichen – es heisst nur, dass die Streuung gering ist und sich daraus noch kein Muster ableiten lässt.`
          : 'Es sind noch keine Zahlen erfasst.',
      }));
  }

  return card('Deine stärksten Beiträge', { hint: `Mittelwert: ${fmt.num(data.baseline, { compact: true })}` },
    h('table.table', null,
      h('thead', null, h('tr', null,
        h('th', { text: 'Beitrag' }),
        h('th', { text: 'Kanal' }),
        h('th', { text: 'Datum' }),
        h('th.num', { text: 'Ergebnis' }),
        h('th.num', { text: 'Vorsprung' }))),
      h('tbody', null,
        ...data.winners.slice(0, 8).map((row) =>
          h('tr', null,
            h('td.truncate', { title: row.title, text: fmt.truncate(row.title, 60) }),
            h('td', null, h('span.row.gap-sm', null, glyph(row.platformId, 15), h('span.text-sm', { text: platformName(row.platformId) }))),
            h('td.text-sm.muted.nowrap', { text: fmt.date(row.at, 'short') }),
            h('td.num.strong', { text: show(row.value, row.metricKey) }),
            h('td.num', { style: { color: 'var(--ok)' }, text: `${fmt.num(row.lift, { decimals: 1 })}×` }))))));
}

function topicsCard(list) {
  if (!list.length) {
    return card('Themen, die tragen', {},
      h('p.text-sm.muted', { text: 'Noch kein Thema kommt in genug Beiträgen vor, um einen Vorsprung sicher zu belegen. Ab etwa zwei Beiträgen zum selben Thema erscheint hier eine Auswertung.' }));
  }

  return card('Themen, die tragen', { hint: 'Vergleich mit deinen übrigen Beiträgen' },
    h('div.col.gap-lg', null,
      ...list.slice(0, 6).map((topic) => {
        const max = list[0].lift;
        return h('div.meter', null,
          h('div.meter__head', null,
            h('span.row.gap-sm', null,
              h('span.strong', { text: topic.label || topic.word }),
              h('span.text-xs.faint', { text: `${fmt.plural(topic.count, 'Beitrag', 'Beiträge')}` })),
            h('span', null,
              h('span.strong', { text: show(topic.withMedian, topic.metricKey) }),
              h('span.text-xs.faint', { text: ` statt ${show(topic.withoutMedian, topic.metricKey)}` }),
              h('span', { style: { color: 'var(--ok)', marginLeft: '8px', fontWeight: '700' }, text: `${fmt.num(topic.lift, { decimals: 1 })}×` }))),
          h('div.bar', null, h('div.bar__fill', { style: { width: `${Math.min(100, (topic.lift / max) * 100)}%` } })));
      })));
}

function shapesCard(list) {
  if (!list.length) return null;
  return card('Titel, die bei dir besser laufen', { hint: 'Bauweise statt Thema' },
    h('div.col.gap-sm', null,
      ...list.map((shape) =>
        h('div.row.between', null,
          h('div', null,
            h('div.strong.text-sm', { text: shape.label }),
            h('div.text-xs.faint', { text: shape.hint })),
          h('div.nowrap', null,
            h('span.strong', { text: show(shape.yesMedian, shape.metricKey) }),
            h('span', { style: { color: 'var(--ok)', marginLeft: '8px', fontWeight: '700' }, text: `${fmt.num(shape.lift, { decimals: 1 })}×` }))))));
}

/**
 * Konten, zu denen Zahlen vorliegen – etwa mehrere YouTube-Kanäle.
 * Sortiert nach Datenmenge, das umfangreichste zuerst.
 */
function accountList() {
  const map = new Map();
  for (const entry of store.all('analytics')) {
    if (!entry.accountId) continue;
    const known = map.get(entry.accountId) || { id: entry.accountId, name: entry.accountName || entry.accountId, count: 0 };
    known.count += 1;
    map.set(entry.accountId, known);
  }
  return [...map.values()].sort((a, b) => b.count - a.count);
}

/**
 * Auswahl des Kontos. Nur sichtbar, wenn es mehr als eines gibt – dann aber
 * wichtig: Ein kleiner und ein grosser Kanal im selben Topf verfälschen jede
 * Empfehlung, weil der Mittelwert des grossen den kleinen erdrückt.
 */
function accountChips(accounts, refresh) {
  if (accounts.length <= 1) return null;
  return h('div.col.gap-xs', null,
    h('div.chips', null,
      ...accounts.map((account) =>
        h(`span.chip${accountFilter === account.id ? '.is-active' : ''}`, {
          onClick: () => { accountFilter = account.id; refresh(); },
        }, glyph('youtube', 14), h('span', { text: account.name }), h('span.text-xs.faint', { text: String(account.count) }))),
      h(`span.chip${accountFilter === null ? '.is-active' : ''}`, {
        text: 'Alle gemischt',
        onClick: () => { accountFilter = null; refresh(); },
      })),
    accountFilter === null
      ? h('div.text-xs', { style: { color: 'var(--warn)' }, text: 'Mehrere Kanäle gemischt – die Empfehlungen sind dadurch weniger treffsicher.' })
      : null);
}

// ------------------------------------------------------------------ Ansicht

export async function render({ setActions, refresh, goto }) {
  // Bei mehreren Konten ungefragt das umfangreichste wählen, statt alles zu mischen.
  const accounts = accountList();
  if (accounts.length <= 1) accountFilter = null;
  else if (accountFilter === undefined || (accountFilter && !accounts.some((a) => a.id === accountFilter))) accountFilter = accounts[0].id;
  const accountRow = accountChips(accounts, refresh);

  // Vorher stand hier { platformFilter } statt { platformId } – dadurch wurde
  // der Plattformfilter bei der Prüfung der Datenlage still ignoriert.
  const options = { platformId: platformFilter, accountId: accountFilter, days: range };
  const state = advisor.readiness(options);

  setActions(
    segmented(
      [{ value: 90, label: '90 Tage' }, { value: 365, label: 'Jahr' }, { value: 3650, label: 'Alles' }],
      range,
      (value) => { range = value; refresh(); }
    ),
    h('button.btn.btn--sm', { text: 'Verbindungen', onClick: () => goto('connections') })
  );

  // ---------------------------------------------------------------- Zu wenig Daten
  if (!state.enough) {
    return h('div.col.gap-lg', null,
      accountRow,
      card(null, {},
        empty(
          'Noch zu wenig Material für eine Aussage',
          `Der Assistent braucht mindestens ${state.minPosts} gemessene Beiträge, um Muster von Zufall zu unterscheiden. Vorhanden: ${state.measured}. Aus weniger etwas abzuleiten wäre Kaffeesatzleserei.`,
          h('div.row.gap-sm.mt', null,
            h('button.btn.btn--primary', { text: 'Kanäle verbinden', onClick: () => goto('connections') }),
            h('button.btn', { text: 'Zahlen erfassen', onClick: () => goto('analytics') })))),

      card('Der schnellste Weg dorthin', {},
        h('div.col.gap-lg', null,
          h('div.row.gap-sm', null,
            h('span.badge.badge--accent', { text: '1' }),
            h('div', null,
              h('div.strong.text-sm', { text: 'YouTube verbinden – ohne Zugangsschlüssel' }),
              h('div.text-sm.muted', { text: 'Kanalname genügt. Die App holt sofort die letzten 15 Videos mit Aufrufen und Likes; damit ist die Schwelle in der Regel auf einen Schlag erreicht.' }))),
          h('div.row.gap-sm', null,
            h('span.badge.badge--accent', { text: '2' }),
            h('div', null,
              h('div.strong.text-sm', { text: 'Twitch verbinden' }),
              h('div.text-sm.muted', { text: 'Bringt vergangene Übertragungen und, während du live bist, die Zuschauerzahlen mit.' }))),
          h('div.row.gap-sm', null,
            h('span.badge.badge--accent', { text: '3' }),
            h('div', null,
              h('div.strong.text-sm', { text: 'Alternativ: CSV aus dem Studio' }),
              h('div.text-sm.muted', { text: 'Für Kanäle ohne Verbindung – der Export enthält alles, was der Assistent braucht.' }))))));
  }

  // ---------------------------------------------------------------- Auswertung
  const data = advisor.winners(options);
  const strongTopics = advisor.topics(options);
  const shapes = advisor.titleShapes(options);
  const clock = advisor.timing(options);
  const list = advisor.suggestions({ ...options, limit: 6 });

  const used = [...new Set(store.all('analytics').map((entry) => entry.platformId))];

  return h('div.col.gap-lg', null,
    h('div.chips', null,
      h(`span.chip${platformFilter === null ? '.is-active' : ''}`, {
        text: 'Alle Plattformen',
        onClick: () => { platformFilter = null; refresh(); },
      }),
      ...used.map((id) =>
        h(`span.chip${platformFilter === id ? '.is-active' : ''}`, {
          onClick: () => { platformFilter = platformFilter === id ? null : id; refresh(); },
        }, glyph(id, 14), h('span', { text: platformName(id) })))),
    accountRow,

    h('div.grid.grid-4', null,
      card(null, {}, h('div.stat', null,
        h('div.stat__label', { text: 'Ausgewertet' }),
        h('div.stat__value', { text: String(state.measured) }),
        h('div.stat__meta', { text: `${state.linked} mit Beitrag verknüpft` }))),
      card(null, {}, h('div.stat', null,
        h('div.stat__label', { text: 'Dein Mittelwert' }),
        h('div.stat__value', { text: fmt.num(data.baseline || 0, { compact: true }) }),
        h('div.stat__meta', { text: 'Median, nicht Durchschnitt' }))),
      card(null, {}, h('div.stat', null,
        h('div.stat__label', { text: 'Ausreisser nach oben' }),
        h('div.stat__value', { text: String(data.winners.length) }),
        h('div.stat__meta', { text: 'mindestens das 1,5-fache' }))),
      card(null, {}, h('div.stat', null,
        h('div.stat__label', { text: 'Bestes Fenster' }),
        h('div.stat__value', {
          text: clock?.weekday ? fmt.weekdayShort(clock.weekday.key) : '–',
          style: { fontSize: '23px' },
        }),
        h('div.stat__meta', {
          text: clock?.hour ? `gegen ${String(clock.hour.key).padStart(2, '0')}:00 Uhr` : 'zu wenige zugeordnete Beiträge',
        })))),

    h('section.section.mt-0', null,
      h('div.section__head', null,
        h('div.section__title', { text: 'Das solltest du als Nächstes machen' }),
        h('div.section__hint', { text: 'jeder Vorschlag mit Begründung aus deinen Zahlen' })),
      list.length
        ? h('div.col.gap-lg', null, ...list.map((suggestion) => suggestionCard(suggestion, { refresh, goto })))
        : card(null, { class: 'card--quiet' },
            h('p.text-sm.muted', { text: 'Deine Beiträge liegen bisher zu dicht beieinander, als dass sich ein tragendes Muster abheben würde. Mehr Bandbreite beim Ausprobieren erzeugt genau die Unterschiede, aus denen sich lernen lässt.' }))),

    h('div.split', null,
      winnersCard(data),
      h('div.col.gap-lg', null,
        topicsCard(strongTopics),
        shapesCard(shapes))));
}
