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
import { t, mark } from '../lib/i18n.js';

export const title = mark('Analytics');
export const lead = mark('Zahlen aus den Studios – ohne Schlüssel, ohne Konto.');

let range = 30;
let platformFilter = null;
let accountFilter = null;
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
    h('option', { value: '', text: t('– keinem Beitrag zuordnen –') }),
    ...published.map((post) => h('option', { value: post.id, text: fmt.truncate(post.title || post.body, 70) })));

  const titleInput = h('input.input', { placeholder: t('Bezeichnung, z. B. Videotitel'), value: preset.title || '' });
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
        placeholder: info.type === 'seconds' ? t('Sekunden') : '',
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
    title: t('Zahlen erfassen'),
    body: h('div.col.gap-lg', null,
      h('div.grid.grid-3', null,
        h('label.field', null, h('span.field__label', { text: t('Kanal') }), platformSelect),
        h('label.field', null, h('span.field__label', { text: t('Datum') }), dateInput),
        h('label.field', null, h('span.field__label', { text: t('Zu welchem Beitrag?') }), postSelect)),
      h('label.field', null, h('span.field__label', { text: t('Bezeichnung') }), titleInput),
      h('hr.divider'),
      fieldsHost,
      h('p.text-xs.faint', { text: t('Leere Felder werden übersprungen. Nur was du wirklich abliest, landet in der Auswertung.') })),
    actions: [
      {
        label: t('Speichern'),
        primary: true,
        action: async () => {
          const metrics = {};
          for (const [key, input] of inputs) {
            if (input.value.trim() === '') continue;
            metrics[key] = Number(input.value);
          }
          if (!Object.keys(metrics).length) return toast(t('Bitte mindestens einen Wert eintragen.'), 'warn');
          await store.add('analytics', {
            platformId: platformSelect.value,
            date: dateInput.value || fmt.dayKey(),
            postId: postSelect.value || null,
            title: titleInput.value.trim(),
            metrics,
            source: 'manual',
          });
          toast(t('Erfasst.'), 'ok');
          refresh();
        },
      },
    ],
  });
}

// ------------------------------------------------------------------ CSV

/** Datei einlesen, Spalten zuordnen, Vorschau zeigen, übernehmen. */
async function importCsv(refresh) {
  const result = await window.ch.files.readText([{ name: t('Tabellen'), extensions: ['csv', 'tsv', 'txt'] }]);
  if (!result?.ok || result.data.canceled) return;

  const rows = csv.parse(result.data.text);
  const { headers, records } = csv.toObjects(rows);
  if (!records.length) return toast(t('Die Datei enthält keine auswertbaren Zeilen.'), 'warn');

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
      const label = field === 'date' ? t('Datum') : field === 'title' ? t('Bezeichnung') : metric(field).label;
      const select = h('select.select', null,
        h('option', { value: '', text: t('– nicht übernehmen –') }),
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
    title: t('CSV einlesen · {name}', { name: result.data.name }),
    size: 'wide',
    body: h('div.col.gap-lg', null,
      h('div.notice.notice--accent', null,
        h('span.notice__icon', { text: 'ℹ' }),
        h('div', null,
          h('div.strong.text-sm', { text: t('{rows} gefunden, {columns} Spalten', { rows: fmt.plural(records.length, 'Zeile', 'Zeilen'), columns: headers.length }) }),
          h('div.text-sm.muted', { text: t('Die Zuordnung wurde anhand der Spaltennamen vorgeschlagen. Prüfe sie kurz – Spalten, die du nicht brauchst, lässt du auf „nicht übernehmen“.') }))),
      h('label.field', null, h('span.field__label', { text: t('Für welchen Kanal?') }), platformSelect),
      h('hr.divider'),
      mappingHost),
    actions: [
      {
        label: t('Übernehmen'),
        primary: true,
        action: async () => {
          const chosen = {};
          for (const [field, select] of selects) {
            if (select.value) chosen[field] = select.value;
          }
          const { entries, skipped } = csv.toEntries(records, chosen, platformSelect.value);
          if (!entries.length) return toast(t('Aus dieser Zuordnung ergeben sich keine Werte.'), 'warn');

          for (const entry of entries) await store.add('analytics', entry);
          const count = fmt.plural(entries.length, 'Eintrag', 'Einträge'); // i18n-ignore
          toast(skipped
            ? t('{entries} übernommen, {skipped} ohne Werte übersprungen.', { entries: count, skipped })
            : t('{entries} übernommen.', { entries: count }), 'ok');
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
  // Mehrere Konten derselben Plattform getrennt halten.
  const accountMap = new Map();
  for (const entry of entries) {
    if (entry.accountId) accountMap.set(entry.accountId, entry.accountName || entry.accountId);
  }
  if (accountMap.size <= 1 || (accountFilter && !accountMap.has(accountFilter))) accountFilter = null;
  const accountRow = accountMap.size > 1
    ? h('div.chips', null,
        h(`span.chip${accountFilter === null ? '.is-active' : ''}`, {
          text: t('Alle Konten'),
          onClick: () => { accountFilter = null; refresh(); },
        }),
        ...[...accountMap].map(([id, name]) =>
          h(`span.chip${accountFilter === id ? '.is-active' : ''}`, {
            onClick: () => { accountFilter = accountFilter === id ? null : id; refresh(); },
          }, glyph('youtube', 14), h('span', { text: name }))))
    : null;

  const availableKeys = an.availableMetrics(platformFilter);
  if (!availableKeys.includes(metricKey)) metricKey = availableKeys[0] || 'views';

  setActions(
    h('button.btn.btn--sm', { text: t('CSV einlesen'), onClick: () => importCsv(refresh) }),
    h('button.btn.btn--sm.btn--primary', { text: t('＋ Zahlen erfassen'), onClick: () => captureDialog(refresh) })
  );

  if (!entries.length) {
    return card(null, {},
      empty(t('Noch keine Zahlen erfasst'),
        t('Zwei Wege, beide ohne Zugangsschlüssel: den CSV-Export aus dem jeweiligen Studio einlesen – oder die wichtigsten Werte von Hand eintragen.'),
        h('div.col.gap-sm.mt', null,
          h('div.row.gap-sm', null,
            h('button.btn.btn--primary', { text: t('CSV einlesen'), onClick: () => importCsv(refresh) }),
            h('button.btn', { text: t('Von Hand erfassen'), onClick: () => captureDialog(refresh) })),
          h('div.col.gap-xs.mt', null,
            h('div.text-xs.faint.strong', { text: t('Wo du die Exporte findest') }),
            ...active(store.settings())
              .filter((p) => p.csvHint)
              .map((p) => h('div.text-xs.faint', { text: `${p.name}: ${p.csvHint}` }))))));
  }

  const info = metric(metricKey);
  const format = (value) => fmt.metricValue(value, info.type);
  const series = an.daily(metricKey, { days: range, platformId: platformFilter, accountId: accountFilter });
  const { current, previous, change } = an.compare(metricKey, { days: range, platformId: platformFilter, accountId: accountFilter });

  const platformRow = h('div.chips', null,
    h(`span.chip${platformFilter === null ? '.is-active' : ''}`, {
      text: t('Alle Plattformen'),
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

  const weekday = an.byWeekday(metricKey, { days: Math.max(range, 90), platformId: platformFilter, accountId: accountFilter })
    .filter((row) => row.count);
  const hours = an.byHour(metricKey, { days: Math.max(range, 90), platformId: platformFilter, accountId: accountFilter });
  const formats = an.byFormat(metricKey, { days: Math.max(range, 90), platformId: platformFilter, accountId: accountFilter });
  const platforms = an.byPlatform(metricKey, { days: range });
  const top = an.topEntries(metricKey, { days: range, platformId: platformFilter, accountId: accountFilter, limit: 8 });

  const trendClass = change === null ? 'flat' : change > 0.02 ? 'up' : change < -0.02 ? 'down' : 'flat';
  const trendText = change === null
    ? t('kein Vergleichszeitraum')
    : t('{change} % gegenüber den {days} Tagen davor', { change: `${change > 0 ? '+' : ''}${Math.round(change * 100)}`, days: range });

  return h('div.col.gap-lg', null,
    h('div.row.wrap.between.gap-sm', null,
      metricRow,
      segmented(
        [
          { value: 7, label: t('{days} Tage', { days: 7 }) },
          { value: 30, label: t('{days} Tage', { days: 30 }) },
          { value: 90, label: t('{days} Tage', { days: 90 }) },
          { value: 365, label: t('Jahr') },
        ],
        range,
        (value) => { range = value; refresh(); }
      )),
    platformRow,
    accountRow,

    h('div.grid.grid-4', null,
      card(null, {}, h('div.stat', null,
        h('div.stat__label', { text: info.label }),
        h('div.stat__value', { text: format(current) }),
        h('div', { class: `trend ${trendClass}`, text: trendText }))),
      card(null, {}, h('div.stat', null,
        h('div.stat__label', { text: t('Vorzeitraum') }),
        h('div.stat__value', { text: format(previous) }),
        h('div.stat__meta', { text: t('die {days} Tage davor', { days: range }) }))),
      card(null, {}, h('div.stat', null,
        h('div.stat__label', { text: t('Erfasste Einträge') }),
        h('div.stat__value', { text: String(an.inRange({ days: range, platformId: platformFilter, accountId: accountFilter }).length) }),
        h('div.stat__meta', { text: t('{count} insgesamt', { count: entries.length }) }))),
      card(null, {}, h('div.stat', null,
        h('div.stat__label', { text: t('Bester Tag') }),
        h('div.stat__value', { text: format(Math.max(...series.map((point) => point.value), 0)) }),
        h('div.stat__meta', { text: series.reduce((best, point) => (point.value > best.value ? point : best), series[0] || {}).label || '–' })))),

    card(t('{metric} im Verlauf', { metric: info.label }), { hint: t('{days} Tage', { days: range }) + (platformFilter ? ` · ${platformName(platformFilter)}` : '') },
      chart.line(series, { format })),

    h('div.grid.grid-2', null,
      card(t('Nach Wochentag'), { hint: t('Durchschnitt je veröffentlichtem Beitrag') },
        weekday.length
          ? chart.bars(weekday.map((row) => ({ label: row.label, value: row.value })), { format })
          : h('p.text-sm.muted', { text: t('Dafür müssen Messwerte einem veröffentlichten Beitrag zugeordnet sein.') })),
      card(t('Nach Uhrzeit'), { hint: t('Durchschnitt je Veröffentlichungsstunde') },
        hours.length
          ? chart.bars(hours.map((row) => ({ label: `${String(row.hour).padStart(2, '0')}`, value: row.value })), { format })
          : h('p.text-sm.muted', { text: t('Noch zu wenige zugeordnete Beiträge.') }))),

    h('div.grid.grid-2', null,
      card(t('Nach Kanal'), { hint: t('{days} Tage', { days: range }) },
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
          : h('p.text-sm.muted', { text: t('Keine Daten im Zeitraum.') })),
      card(t('Nach Format'), { hint: t('was wirklich trägt') },
        formats.length
          ? h('div.col.gap-sm', null,
              ...formats.map((row) => {
                const max = formats[0].value || 1;
                return h('div.meter', null,
                  h('div.meter__head', null,
                    h('span', { text: row.format }),
                    h('span.strong', { text: `${format(row.value)} · ${fmt.plural(row.count, 'Beitrag', 'Beiträge')}` })), // i18n-ignore
                  h('div.bar', null, h('div.bar__fill', { style: { width: `${(row.value / max) * 100}%` } })));
              }))
          : h('p.text-sm.muted', { text: t('Trage bei deinen Beiträgen ein Format ein, dann erscheint hier der Vergleich.') }))),

    card(t('Stärkste Einträge'), { hint: t('nach {metric}', { metric: info.label }) },
      h('table.table', null,
        h('thead', null, h('tr', null,
          h('th', { text: t('Bezeichnung') }),
          h('th', { text: t('Kanal') }),
          h('th', { text: t('Datum') }),
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
                title: t('Eintrag löschen'),
                onClick: async () => {
                  if (!(await confirm({ title: t('Eintrag löschen?'), message: t('Der Messwert verschwindet aus der Auswertung.'), confirmLabel: t('Löschen'), tone: 'danger' }))) return;
                  await store.remove('analytics', entry.id);
                  refresh();
                },
              }))))))),

    h('div.row.between', null,
      h('p.text-xs.faint', { text: t('Alle Werte liegen ausschließlich auf diesem Rechner.') }),
      h('button.btn.btn--ghost.btn--sm', { text: t('Zum Coach'), onClick: () => goto('coach') })));
}
