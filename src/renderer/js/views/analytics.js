/**
 * Analytics: die eigenen Zahlen verstehen.
 *
 * Erfasst wird von Hand oder per CSV aus den offiziellen Studios – bewusst
 * ohne Plattform-API, damit kein Zugangsschlüssel und keine Developer-App
 * nötig ist. Ausgewertet wird nach Zeit, Wochentag, Uhrzeit, Kanal und Format.
 */

import { h, card, empty, fill } from '../lib/dom.js';
import * as fmt from '../lib/format.js';
import * as store from '../lib/store.js';
import * as an from '../lib/analytics.js';
import * as chart from '../lib/chart.js';
import * as csv from '../lib/csv.js';
import { active, platform, platformName, glyph, metric, METRICS } from '../lib/platforms.js';
import { toast, confirm, modal, segmented } from '../lib/ui.js';

export const title = 'Analytics';
export const lead = 'Zahlen aus den Studios – ohne Schlüssel, ohne Konto.';

let range = 30;
let platformFilter = null;
let metricKey = 'views';

// ------------------------------------------------------------------ Erfassen

/** Formular für einen einzelnen Messwert-Eintrag. */
function captureDialog(refresh, preset = {}) {
  const settings = store.settings();
  const platformSelect = h('select.select', null,
    ...active(settings).map((p) => h('option', { value: p.id, text: p.name, selected: preset.platformId === p.id })));

  const dateInput = h('input.input', { type: 'date', value: preset.date || fmt.dayKey() });

  const published = store.all('posts')
    .filter((post) => post.status === 'published')
    .sort((a, b) => new Date(b.publishedAt || 0) - new Date(a.publishedAt || 0));

  const postSelect = h('select.select', null,
    h('option', { value: '', text: '– keinem Beitrag zuordnen –' }),
    ...published.map((post) => h('option', { value: post.id, text: fmt.truncate(post.title || post.body, 70) })));

  const titleInput = h('input.input', { placeholder: 'Bezeichnung, z. B. Videotitel', value: preset.title || '' });
  const fieldsHost = h('div.grid.grid-3');
  const inputs = new Map();

  const renderFields = () => {
    inputs.clear();
    const p = platform(platformSelect.value);
    fill(fieldsHost, ...(p?.metrics || []).map((key) => {
      const info = metric(key);
      const input = h('input.input', {
        type: 'number',
        step: info.type === 'percent' || info.type === 'number' ? '0.1' : '1',
        placeholder: info.type === 'seconds' ? 'Sekunden' : '',
      });
      inputs.set(key, input);
      return h('label.field', null, h('span.field__label', { text: info.label }), input);
    }));
  };
  platformSelect.addEventListener('change', renderFields);
  renderFields();

  // Beitragsauswahl füllt Titel und Datum automatisch.
  postSelect.addEventListener('change', () => {
    const post = store.byId('posts', postSelect.value);
    if (!post) return;
    titleInput.value = post.title || '';
    if (post.publishedAt) dateInput.value = fmt.dayKey(post.publishedAt);
    if (post.platforms?.length) {
      platformSelect.value = post.platforms[0];
      renderFields();
    }
  });

  modal({
    title: 'Zahlen erfassen',
    body: h('div.col.gap-lg', null,
      h('div.grid.grid-3', null,
        h('label.field', null, h('span.field__label', { text: 'Kanal' }), platformSelect),
        h('label.field', null, h('span.field__label', { text: 'Datum' }), dateInput),
        h('label.field', null, h('span.field__label', { text: 'Zu welchem Beitrag?' }), postSelect)),
      h('label.field', null, h('span.field__label', { text: 'Bezeichnung' }), titleInput),
      h('hr.divider'),
      fieldsHost,
      h('p.text-xs.faint', { text: 'Leere Felder werden übersprungen. Nur was du wirklich abliest, landet in der Auswertung.' })),
    actions: [
      {
        label: 'Speichern',
        primary: true,
        action: async () => {
          const metrics = {};
          for (const [key, input] of inputs) {
            if (input.value.trim() === '') continue;
            metrics[key] = Number(input.value);
          }
          if (!Object.keys(metrics).length) return toast('Bitte mindestens einen Wert eintragen.', 'warn');
          await store.add('analytics', {
            platformId: platformSelect.value,
            date: dateInput.value || fmt.dayKey(),
            postId: postSelect.value || null,
            title: titleInput.value.trim(),
            metrics,
            source: 'manual',
          });
          toast('Erfasst.', 'ok');
          refresh();
        },
      },
    ],
  });
}

// ------------------------------------------------------------------ CSV

/** Datei einlesen, Spalten zuordnen, Vorschau zeigen, übernehmen. */
async function importCsv(refresh) {
  const result = await window.ch.files.readText([{ name: 'Tabellen', extensions: ['csv', 'tsv', 'txt'] }]);
  if (!result?.ok || result.data.canceled) return;

  const rows = csv.parse(result.data.text);
  const { headers, records } = csv.toObjects(rows);
  if (!records.length) return toast('Die Datei enthält keine auswertbaren Zeilen.', 'warn');

  const mapping = csv.guessMapping(headers);
  const settings = store.settings();

  const platformSelect = h('select.select', null,
    ...active(settings).map((p) => h('option', { value: p.id, text: p.name })));

  const mappingHost = h('div.col.gap-sm');
  const selects = new Map();

  const fields = ['date', 'title', ...Object.keys(METRICS)];
  const renderMapping = () => {
    selects.clear();
    const p = platform(platformSelect.value);
    const relevant = ['date', 'title', ...(p?.metrics || [])];
    const extra = Object.keys(mapping).filter((field) => !relevant.includes(field) && fields.includes(field));

    fill(mappingHost, ...[...relevant, ...extra].map((field) => {
      const label = field === 'date' ? 'Datum' : field === 'title' ? 'Bezeichnung' : metric(field).label;
      const select = h('select.select', null,
        h('option', { value: '', text: '– nicht übernehmen –' }),
        ...headers.map((header) => h('option', { value: header, text: header, selected: mapping[field] === header })));
      selects.set(field, select);
      return h('div.row.gap-sm', null,
        h('span.field__label', { style: { width: '190px', flex: 'none' }, text: label }),
        select);
    }));
  };
  platformSelect.addEventListener('change', renderMapping);
  renderMapping();

  modal({
    title: `CSV einlesen · ${result.data.name}`,
    size: 'wide',
    body: h('div.col.gap-lg', null,
      h('div.notice.notice--accent', null,
        h('span.notice__icon', { text: 'ℹ' }),
        h('div', null,
          h('div.strong.text-sm', { text: `${fmt.plural(records.length, 'Zeile', 'Zeilen')} gefunden, ${headers.length} Spalten` }),
          h('div.text-sm.muted', { text: 'Die Zuordnung wurde anhand der Spaltennamen vorgeschlagen. Prüfe sie kurz – Spalten, die du nicht brauchst, lässt du auf „nicht übernehmen“.' }))),
      h('label.field', null, h('span.field__label', { text: 'Für welchen Kanal?' }), platformSelect),
      h('hr.divider'),
      mappingHost),
    actions: [
      {
        label: 'Übernehmen',
        primary: true,
        action: async () => {
          const chosen = {};
          for (const [field, select] of selects) {
            if (select.value) chosen[field] = select.value;
          }
          const { entries, skipped } = csv.toEntries(records, chosen, platformSelect.value);
          if (!entries.length) return toast('Aus dieser Zuordnung ergeben sich keine Werte.', 'warn');

          for (const entry of entries) await store.add('analytics', entry);
          toast(`${fmt.plural(entries.length, 'Eintrag', 'Einträge')} übernommen${skipped ? `, ${skipped} ohne Werte übersprungen` : ''}.`, 'ok');
          refresh();
        },
      },
    ],
  });
}

// ------------------------------------------------------------------ Ansicht

export async function render({ params, setActions, refresh, goto }) {
  if (params.capture) captureDialog(refresh);

  const entries = store.all('analytics');
  const availableKeys = an.availableMetrics(platformFilter);
  if (!availableKeys.includes(metricKey)) metricKey = availableKeys[0] || 'views';

  setActions(
    h('button.btn.btn--sm', { text: 'CSV einlesen', onClick: () => importCsv(refresh) }),
    h('button.btn.btn--sm.btn--primary', { text: '＋ Zahlen erfassen', onClick: () => captureDialog(refresh) })
  );

  if (!entries.length) {
    return card(null, {},
      empty('Noch keine Zahlen erfasst',
        'Zwei Wege, beide ohne Zugangsschlüssel: den CSV-Export aus dem jeweiligen Studio einlesen – oder die wichtigsten Werte von Hand eintragen.',
        h('div.col.gap-sm.mt', null,
          h('div.row.gap-sm', null,
            h('button.btn.btn--primary', { text: 'CSV einlesen', onClick: () => importCsv(refresh) }),
            h('button.btn', { text: 'Von Hand erfassen', onClick: () => captureDialog(refresh) })),
          h('div.col.gap-xs.mt', null,
            h('div.text-xs.faint.strong', { text: 'Wo du die Exporte findest' }),
            ...active(store.settings())
              .filter((p) => p.csvHint)
              .map((p) => h('div.text-xs.faint', { text: `${p.name}: ${p.csvHint}` }))))));
  }

  const info = metric(metricKey);
  const format = (value) => fmt.metricValue(value, info.type);
  const series = an.daily(metricKey, { days: range, platformId: platformFilter });
  const { current, previous, change } = an.compare(metricKey, { days: range, platformId: platformFilter });

  const platformRow = h('div.chips', null,
    h(`span.chip${platformFilter === null ? '.is-active' : ''}`, {
      text: 'Alle Kanäle',
      onClick: () => { platformFilter = null; refresh(); },
    }),
    ...[...new Set(entries.map((entry) => entry.platformId))].map((id) =>
      h(`span.chip${platformFilter === id ? '.is-active' : ''}`, {
        onClick: () => { platformFilter = platformFilter === id ? null : id; refresh(); },
      }, glyph(id, 14), h('span', { text: platformName(id) }))));

  const metricRow = h('div.chips', null,
    ...availableKeys.map((key) =>
      h(`span.chip${metricKey === key ? '.is-active' : ''}`, {
        text: metric(key).label,
        onClick: () => { metricKey = key; refresh(); },
      })));

  const weekday = an.byWeekday(metricKey, { days: Math.max(range, 90), platformId: platformFilter })
    .filter((row) => row.count);
  const hours = an.byHour(metricKey, { days: Math.max(range, 90), platformId: platformFilter });
  const formats = an.byFormat(metricKey, { days: Math.max(range, 90), platformId: platformFilter });
  const platforms = an.byPlatform(metricKey, { days: range });
  const top = an.topEntries(metricKey, { days: range, platformId: platformFilter, limit: 8 });

  const trendClass = change === null ? 'flat' : change > 0.02 ? 'up' : change < -0.02 ? 'down' : 'flat';
  const trendText = change === null
    ? 'kein Vergleichszeitraum'
    : `${change > 0 ? '+' : ''}${Math.round(change * 100)} % gegenüber den ${range} Tagen davor`;

  return h('div.col.gap-lg', null,
    h('div.row.wrap.between.gap-sm', null,
      metricRow,
      segmented(
        [
          { value: 7, label: '7 Tage' },
          { value: 30, label: '30 Tage' },
          { value: 90, label: '90 Tage' },
          { value: 365, label: 'Jahr' },
        ],
        range,
        (value) => { range = value; refresh(); }
      )),
    platformRow,

    h('div.grid.grid-4', null,
      card(null, {}, h('div.stat', null,
        h('div.stat__label', { text: info.label }),
        h('div.stat__value', { text: format(current) }),
        h('div', { class: `trend ${trendClass}`, text: trendText }))),
      card(null, {}, h('div.stat', null,
        h('div.stat__label', { text: 'Vorzeitraum' }),
        h('div.stat__value', { text: format(previous) }),
        h('div.stat__meta', { text: `die ${range} Tage davor` }))),
      card(null, {}, h('div.stat', null,
        h('div.stat__label', { text: 'Erfasste Einträge' }),
        h('div.stat__value', { text: String(an.inRange({ days: range, platformId: platformFilter }).length) }),
        h('div.stat__meta', { text: `${entries.length} insgesamt` }))),
      card(null, {}, h('div.stat', null,
        h('div.stat__label', { text: 'Bester Tag' }),
        h('div.stat__value', { text: format(Math.max(...series.map((point) => point.value), 0)) }),
        h('div.stat__meta', { text: series.reduce((best, point) => (point.value > best.value ? point : best), series[0] || {}).label || '–' })))),

    card(`${info.label} im Verlauf`, { hint: `${range} Tage${platformFilter ? ` · ${platformName(platformFilter)}` : ''}` },
      chart.line(series, { format })),

    h('div.grid.grid-2', null,
      card('Nach Wochentag', { hint: 'Durchschnitt je veröffentlichtem Beitrag' },
        weekday.length
          ? chart.bars(weekday.map((row) => ({ label: row.label, value: row.value })), { format })
          : h('p.text-sm.muted', { text: 'Dafür müssen Messwerte einem veröffentlichten Beitrag zugeordnet sein.' })),
      card('Nach Uhrzeit', { hint: 'Durchschnitt je Veröffentlichungsstunde' },
        hours.length
          ? chart.bars(hours.map((row) => ({ label: `${String(row.hour).padStart(2, '0')}`, value: row.value })), { format })
          : h('p.text-sm.muted', { text: 'Noch zu wenige zugeordnete Beiträge.' }))),

    h('div.grid.grid-2', null,
      card('Nach Kanal', { hint: `${range} Tage` },
        platforms.length
          ? h('div.col.gap-sm', null,
              ...platforms.map((row) => {
                const max = platforms[0].value || 1;
                return h('div.meter', null,
                  h('div.meter__head', null,
                    h('span.row.gap-sm', null, glyph(row.platformId, 15), h('span', { text: platformName(row.platformId) })),
                    h('span.strong', { text: format(row.value) })),
                  h('div.bar', null, h('div.bar__fill', {
                    style: { width: `${(row.value / max) * 100}%`, background: platform(row.platformId)?.color },
                  })));
              }))
          : h('p.text-sm.muted', { text: 'Keine Daten im Zeitraum.' })),
      card('Nach Format', { hint: 'was wirklich trägt' },
        formats.length
          ? h('div.col.gap-sm', null,
              ...formats.map((row) => {
                const max = formats[0].value || 1;
                return h('div.meter', null,
                  h('div.meter__head', null,
                    h('span', { text: row.format }),
                    h('span.strong', { text: `${format(row.value)} · ${fmt.plural(row.count, 'Beitrag', 'Beiträge')}` })),
                  h('div.bar', null, h('div.bar__fill', { style: { width: `${(row.value / max) * 100}%` } })));
              }))
          : h('p.text-sm.muted', { text: 'Trage bei deinen Beiträgen ein Format ein, dann erscheint hier der Vergleich.' }))),

    card('Stärkste Einträge', { hint: `nach ${info.label}` },
      h('table.table', null,
        h('thead', null, h('tr', null,
          h('th', { text: 'Bezeichnung' }),
          h('th', { text: 'Kanal' }),
          h('th', { text: 'Datum' }),
          h('th.num', { text: info.label }),
          h('th', { text: '' }))),
        h('tbody', null,
          ...top.map(({ entry, value }) =>
            h('tr', null,
              h('td', { text: entry.title || '–' }),
              h('td', null, h('span.row.gap-sm', null, glyph(entry.platformId, 15), h('span.text-sm', { text: platformName(entry.platformId) }))),
              h('td.text-sm.muted', { text: fmt.date(entry.date, 'short') }),
              h('td.num.strong', { text: format(value) }),
              h('td', null, h('button.btn.btn--ghost.btn--sm', {
                text: '✕',
                title: 'Eintrag löschen',
                onClick: async () => {
                  if (!(await confirm({ title: 'Eintrag löschen?', message: 'Der Messwert verschwindet aus der Auswertung.', confirmLabel: 'Löschen', tone: 'danger' }))) return;
                  await store.remove('analytics', entry.id);
                  refresh();
                },
              }))))))),

    h('div.row.between', null,
      h('p.text-xs.faint', { text: 'Alle Werte liegen ausschließlich auf diesem Rechner.' }),
      h('button.btn.btn--ghost.btn--sm', { text: 'Zum Coach', onClick: () => goto('coach') })));
}
