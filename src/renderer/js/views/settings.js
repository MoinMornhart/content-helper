/** Einstellungen: Erscheinungsbild, Kanäle, Erinnerungen, Updates, Daten. */

import { h, card, fill } from '../lib/dom.js';
import * as fmt from '../lib/format.js';
import * as store from '../lib/store.js';
import { PLATFORMS, glyph } from '../lib/platforms.js';
import { toast, confirm, toggle } from '../lib/ui.js';
import { applyTheme } from '../app.js';

export const title = 'Einstellungen';
export const lead = 'Alles bleibt auf diesem Rechner. Kein Konto, keine Schlüssel, keine Übertragung.';

const ACCENTS = [
  { id: 'violet', color: '#8b5cf6', label: 'Violett' },
  { id: 'blue', color: '#3b82f6', label: 'Blau' },
  { id: 'emerald', color: '#10b981', label: 'Grün' },
  { id: 'amber', color: '#f59e0b', label: 'Bernstein' },
  { id: 'rose', color: '#f43f5e', label: 'Rot' },
];

/** Eine Zeile mit Beschreibung links und Bedienelement rechts. */
function row(title, hint, control) {
  return h('div.setting-row', null,
    h('div.setting-row__text', null,
      h('div.setting-row__title', { text: title }),
      hint ? h('div.setting-row__hint', { text: hint }) : null),
    h('div.row.gap-sm', null, control));
}

async function save(patch) {
  const next = await store.saveSettings(patch);
  applyTheme(next);
  return next;
}

export async function render({ refresh }) {
  const settings = store.settings();
  const version = (await window.ch.system.version())?.data || {};
  const paths = (await window.ch.system.paths())?.data || {};
  const stats = (await window.ch.db.stats())?.data || { counts: {}, bytes: 0 };

  // ---------------------------------------------------------------- Kanäle
  const platformGrid = h('div.platform-grid');
  const renderPlatforms = () => {
    const active = new Set(store.settings().activePlatforms || []);
    fill(platformGrid, ...PLATFORMS.map((platform) =>
      h(`div.platform-toggle${active.has(platform.id) ? '.is-on' : ''}`, {
        onClick: async () => {
          const next = new Set(store.settings().activePlatforms || []);
          if (next.has(platform.id)) next.delete(platform.id);
          else next.add(platform.id);
          await save({ activePlatforms: [...next] });
          renderPlatforms();
        },
      },
        glyph(platform.id, 18),
        h('span.truncate', { text: platform.name }))));
  };
  renderPlatforms();

  // ---------------------------------------------------------------- Updates
  const updateStatus = h('div.setting-row__hint', {
    text: settings.lastUpdateCheck
      ? `Zuletzt geprüft ${fmt.relative(settings.lastUpdateCheck)}${settings.lastKnownVersion ? ` · neueste bekannte Version ${settings.lastKnownVersion}` : ''}`
      : 'Noch nicht geprüft',
  });

  const checkNow = h('button.btn.btn--sm', {
    text: 'Jetzt prüfen',
    onClick: async () => {
      checkNow.disabled = true;
      checkNow.textContent = 'Prüfe …';
      const result = await window.ch.update.check(true);
      checkNow.disabled = false;
      checkNow.textContent = 'Jetzt prüfen';
      const info = result?.data;
      if (!result?.ok) return toast(`Prüfung fehlgeschlagen: ${result?.error}`, 'danger');
      if (info.available) {
        updateStatus.textContent = `Version ${info.latest} ist verfügbar (installiert: ${info.current}).`;
        toast(`Version ${info.latest} ist verfügbar.`, 'ok', 6000);
      } else if (info.offline) {
        updateStatus.textContent = 'Keine Verbindung zur Release-Seite.';
        toast('Keine Verbindung – später erneut versuchen.', 'warn');
      } else if (info.noReleases) {
        updateStatus.textContent = 'Für dieses Projekt ist noch keine Version veröffentlicht.';
        toast('Noch keine Veröffentlichung vorhanden.', 'info');
      } else {
        updateStatus.textContent = `Du hast die neueste Version (${info.current}). Zuletzt geprüft: gerade eben.`;
        toast('Alles aktuell.', 'ok');
      }
    },
  });

  return h('div.col.gap-xl', null,
    // ---------------------------------------------------------------- Erscheinung
    card('Erscheinungsbild', {},
      row('Farbschema', 'Dunkel schont die Augen bei langen Schnittsessions.',
        h('div.btn-group', null,
          ...[['dark', 'Dunkel'], ['light', 'Hell']].map(([value, label]) =>
            h(`button.btn${(settings.theme || 'dark') === value ? '.is-active' : ''}`, {
              text: label,
              onClick: async (event) => {
                await save({ theme: value });
                for (const button of event.target.parentElement.children) button.classList.remove('is-active');
                event.target.classList.add('is-active');
              },
            })))),
      row('Akzentfarbe', 'Färbt Schaltflächen, Diagramme und Hervorhebungen.',
        h('div.swatches', null,
          ...ACCENTS.map((accent) =>
            h(`div.swatch${settings.accent === accent.id ? '.is-active' : ''}`, {
              style: { background: accent.color },
              title: accent.label,
              onClick: async (event) => {
                await save({ accent: accent.id });
                for (const swatch of event.target.parentElement.children) swatch.classList.remove('is-active');
                event.target.classList.add('is-active');
              },
            })))),
      row('Wochenbeginn', 'Bestimmt die Spaltenreihenfolge im Kalender.',
        h('select.select', {
          style: { width: '160px' },
          onChange: (event) => save({ startOfWeek: Number(event.target.value) }),
        },
          ...[[1, 'Montag'], [0, 'Sonntag']].map(([value, label]) =>
            h('option', { value, selected: (settings.startOfWeek ?? 1) === value, text: label }))))),

    // ---------------------------------------------------------------- Kanäle
    card('Aktive Kanäle', { hint: `${(settings.activePlatforms || []).length} von ${PLATFORMS.length} ausgewählt` },
      h('p.muted.text-sm.mb', { text: 'Nur ausgewählte Kanäle erscheinen im Composer, im Kalender und in der Auswertung. Was du nicht bespielst, gehört hier abgewählt – sonst verzerrt es jede Empfehlung.' }),
      platformGrid),

    // ---------------------------------------------------------------- Ziele
    card('Wochenziele', { hint: 'Grundlage für Fortschritt und Coach-Hinweise' },
      h('div.grid.grid-3', null,
        ...[
          ['posts', 'Beiträge pro Woche'],
          ['ideas', 'Neue Ideen pro Woche'],
          ['streams', 'Streams pro Woche'],
        ].map(([key, label]) =>
          h('label.field', null,
            h('span.field__label', { text: label }),
            h('input.input', {
              type: 'number',
              min: 0,
              max: 99,
              value: settings.weeklyGoal?.[key] ?? 0,
              onChange: (event) =>
                save({ weeklyGoal: { ...store.settings().weeklyGoal, [key]: Number(event.target.value) || 0 } }),
            }))))),

    // ---------------------------------------------------------------- Erinnerungen
    card('Termine und Erinnerungen', {},
      row('Desktop-Benachrichtigungen', 'Meldet sich, wenn ein Beitrag fällig wird.',
        toggle('', settings.notifications !== false, (value) => save({ notifications: value }))),
      row('Vorwarnzeit', 'So viele Minuten vor dem Termin kommt der erste Hinweis.',
        h('input.input', {
          type: 'number', min: 0, max: 240, style: { width: '92px' },
          value: settings.leadTimeMinutes ?? 15,
          onChange: (event) => save({ leadTimeMinutes: Number(event.target.value) || 0 }),
        })),
      row('Text automatisch kopieren', 'Legt den fertigen Beitrag zum Termin in die Zwischenablage – dann ist es nur noch Einfügen.',
        toggle('', settings.copyToClipboardOnDue !== false, (value) => save({ copyToClipboardOnDue: value }))),
      row('Upload-Seite öffnen', 'Öffnet zum Termin zusätzlich die passende Seite der Plattform im Browser.',
        toggle('', Boolean(settings.autoOpenUploadPage), (value) => save({ autoOpenUploadPage: value }))),
      row('Im Infobereich weiterlaufen', 'Beim Schliessen läuft die App im Tray weiter, damit Termine nicht verpasst werden.',
        toggle('', settings.minimizeToTray !== false, (value) => save({ minimizeToTray: value }))),
      row('Mit Windows starten', 'Startet die App unsichtbar mit dem System.',
        toggle('', Boolean(settings.launchOnStartup), async (value) => {
          const result = await window.ch.system.setStartup(value);
          await save({ launchOnStartup: Boolean(result?.data) });
          toast(value ? 'Startet künftig mit Windows.' : 'Startet nicht mehr automatisch.', 'ok');
        }))),

    // ---------------------------------------------------------------- Updates
    card('Aktualisierung', { hint: `installiert: Version ${version.app || '–'}` },
      h('p.muted.text-sm.mb', { text: 'Beim Öffnen der App wird geprüft, ob auf der Projektseite eine neuere Version veröffentlicht wurde. Dafür ist kein Konto und kein Schlüssel nötig, und heruntergeladen wird nichts von allein – du entscheidest.' }),
      row('Beim Start nach Updates suchen', 'Zusätzlich alle sechs Stunden, solange die App läuft.',
        toggle('', settings.autoUpdateCheck !== false, (value) => save({ autoUpdateCheck: value }))),
      h('div.row.between.mt', null,
        updateStatus,
        h('div.row.gap-sm', null,
          checkNow,
          h('button.btn.btn--sm', { text: 'Release-Seite öffnen', onClick: () => window.ch.update.openReleasePage() })))),

    // ---------------------------------------------------------------- Daten
    card('Daten und Sicherung', { hint: `${fmt.bytes(stats.bytes)} auf der Festplatte` },
      h('div.grid.grid-4.mb', null,
        ...Object.entries(stats.counts)
          .filter(([, count]) => count > 0)
          .map(([name, count]) =>
            h('div.stat', null,
              h('div.stat__label', { text: name }),
              h('div.text-lg.strong', { text: fmt.num(count) })))),
      h('p.mono.text-xs.faint.mb', { text: paths.data || '' }),
      h('div.row.wrap.gap-sm', null,
        h('button.btn', {
          text: 'Sicherung exportieren',
          onClick: async () => {
            const result = await window.ch.backup.export();
            if (result?.ok && !result.data.canceled) toast('Sicherung gespeichert.', 'ok');
          },
        }),
        h('button.btn', {
          text: 'Sicherung einlesen (ersetzen)',
          onClick: async () => {
            if (!(await confirm({
              title: 'Daten ersetzen?',
              message: 'Der aktuelle Bestand wird vollständig durch die Sicherung ersetzt. Ein Tagesabbild der jetzigen Daten liegt im Sicherungsordner.',
              confirmLabel: 'Ersetzen',
              tone: 'danger',
            }))) return;
            const result = await window.ch.backup.import(false);
            if (result?.ok && !result.data.canceled) {
              await store.reload();
              toast('Sicherung eingelesen.', 'ok');
              refresh();
            }
          },
        }),
        h('button.btn', {
          text: 'Sicherung zusammenführen',
          onClick: async () => {
            const result = await window.ch.backup.import(true);
            if (result?.ok && !result.data.canceled) {
              await store.reload();
              toast('Einträge ergänzt.', 'ok');
              refresh();
            }
          },
        }),
        h('button.btn.btn--ghost', { text: 'Sicherungsordner öffnen', onClick: () => window.ch.backup.openFolder() }))),

    // ---------------------------------------------------------------- Über
    card('Über Content Helper', {},
      h('p.text-sm.muted', { text: 'Ein Werkzeugkasten für Creator: planen, veröffentlichen, verstehen, verbessern. Ohne Abo, ohne Cloud, ohne Datenweitergabe.' }),
      h('div.row.wrap.gap-lg.mt', null,
        ...[
          ['App', version.app],
          ['Electron', version.electron],
          ['Chromium', version.chrome],
          ['Node', version.node],
        ].map(([label, value]) =>
          h('div', null,
            h('div.text-xs.faint', { text: label }),
            h('div.mono.text-sm', { text: value || '–' })))),
      h('div.row.gap-sm.mt', null,
        h('button.btn.btn--sm', {
          text: 'Projekt auf GitHub',
          onClick: () => window.ch.system.openExternal('https://github.com/MoinMornhart/content-helper'),
        }),
        !settings.onboardingDone
          ? h('button.btn.btn--sm.btn--primary', {
              text: 'Einrichtung abschliessen',
              onClick: async () => {
                await save({ onboardingDone: true });
                toast('Fertig – die App startet künftig im Dashboard.', 'ok');
              },
            })
          : null)));
}
