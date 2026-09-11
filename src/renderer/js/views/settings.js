/**
 * Einstellungen, nach Themen getrennt.
 *
 * Vorher war das eine lange Rolle, in der Erscheinungsbild, Kanäle, Ziele und
 * Datenverwaltung untereinander standen. Jetzt liegt jedes Thema auf einem
 * eigenen Reiter – wer die Akzentfarbe ändern will, scrollt nicht mehr an der
 * Datensicherung vorbei.
 */

import { h, card, fill } from '../lib/dom.js';
import * as fmt from '../lib/format.js';
import * as store from '../lib/store.js';
import { PLATFORMS, glyph } from '../lib/platforms.js';
import { toast, confirm, toggle } from '../lib/ui.js';
import { applyTheme } from '../app.js';
import { t, mark } from '../lib/i18n.js';

export const title = mark('Einstellungen');
export const lead = mark('Deine Daten liegen auf deinen eigenen Geräten. Kein Konto bei uns, kein Abo.');

const TABS = [
  { id: 'look', label: mark('Erscheinungsbild') },
  { id: 'channels', label: mark('Kanäle') },
  { id: 'goals', label: mark('Ziele') },
  { id: 'reminders', label: mark('Erinnerungen') },
  { id: 'updates', label: mark('Aktualisierung') },
  { id: 'data', label: mark('Daten') },
  { id: 'about', label: mark('Über') },
];

const ACCENTS = [
  { id: 'violet', color: '#8b5cf6', label: mark('Violett') },
  { id: 'blue', color: '#3b82f6', label: mark('Blau') },
  { id: 'cyan', color: '#06b6d4', label: mark('Türkis') },
  { id: 'emerald', color: '#10b981', label: mark('Grün') },
  { id: 'lime', color: '#84cc16', label: mark('Limette') },
  { id: 'amber', color: '#f59e0b', label: mark('Bernstein') },
  { id: 'orange', color: '#f97316', label: mark('Orange') },
  { id: 'rose', color: '#f43f5e', label: mark('Rot') },
  { id: 'slate', color: '#94a3b8', label: mark('Grau') },
];

/** Vorgefertigte Hintergründe – reine Verläufe, also ohne Bilddateien. */
const BACKGROUNDS = [
  { id: 'none', label: mark('Ohne'), preview: 'linear-gradient(160deg,#14121c,#0b0912)' },
  { id: 'aurora', label: mark('Nordlicht'), preview: 'radial-gradient(60% 60% at 20% 20%,#7c3aed,transparent),radial-gradient(60% 60% at 80% 30%,#ec4899,transparent),linear-gradient(160deg,#14102a,#060410)' },
  { id: 'ocean', label: mark('Tiefsee'), preview: 'radial-gradient(70% 70% at 25% 80%,#0891b2,transparent),radial-gradient(60% 60% at 80% 15%,#1d4ed8,transparent),linear-gradient(180deg,#041225,#02060f)' },
  { id: 'forest', label: mark('Wald'), preview: 'radial-gradient(65% 65% at 25% 25%,#15803d,transparent),radial-gradient(65% 65% at 75% 80%,#065f46,transparent),linear-gradient(170deg,#06140d,#020806)' },
  { id: 'sunset', label: mark('Abendrot'), preview: 'radial-gradient(65% 65% at 20% 20%,#f97316,transparent),radial-gradient(65% 65% at 80% 80%,#be123c,transparent),linear-gradient(165deg,#1c0a10,#070305)' },
  { id: 'studio', label: mark('Studio'), preview: 'radial-gradient(90% 45% at 50% 0%,rgba(255,255,255,.16),transparent),linear-gradient(180deg,#14131a,#08070c)' },
  { id: 'grid', label: mark('Raster'), preview: 'linear-gradient(rgba(139,92,246,.35) 1px,transparent 1px),linear-gradient(90deg,rgba(139,92,246,.35) 1px,transparent 1px),linear-gradient(150deg,#0f0c1c,#06050c)' },
  { id: 'mesh', label: mark('Farbnebel'), preview: 'radial-gradient(45% 45% at 15% 25%,rgba(139,92,246,.85),transparent),radial-gradient(45% 45% at 75% 20%,rgba(236,72,153,.8),transparent),radial-gradient(50% 50% at 30% 85%,rgba(6,182,212,.75),transparent),linear-gradient(150deg,#0d0b16,#07060d)' },
];

let tab = 'look';

/** Eine Zeile mit Beschreibung links und Bedienelement rechts. */
function row(label, hint, control) {
  return h('div.setting-row', null,
    h('div.setting-row__text', null,
      h('div.setting-row__title', { text: label }),
      hint ? h('div.setting-row__hint', { text: hint }) : null),
    h('div.row.gap-sm', null, control));
}

async function save(patch) {
  const next = await store.saveSettings(patch);
  applyTheme(next);
  return next;
}

const look = () => store.settings().appearance || {};

// ------------------------------------------------------------------ Erscheinungsbild

function tabLook(refresh) {
  const settings = store.settings();

  // --- Sprache: fest zweisprachig beschriftet, damit man sie in jeder Sprache findet.
  const languageSelect = h('select.select', {
    style: { width: '220px' },
    onChange: async (event) => {
      await store.saveSettings({ language: event.target.value });
      // Die ganze Oberfläche neu zeichnen – in der neuen Sprache.
      location.reload();
    },
  },
    ...[['auto', t('Automatisch (wie Windows)')], ['de', 'Deutsch'], ['en', 'English']].map(([value, label]) =>
      h('option', { value, selected: (settings.language || 'auto') === value, text: label })));

  // --- Akzentfarbe
  const swatches = h('div.swatches');
  const customInput = h('input.input', {
    type: 'color',
    value: settings.accentColor || '#8b5cf6',
    style: { width: '54px', padding: '2px', height: '34px' },
    oninput: async (event) => {
      await save({ accent: 'custom', accentColor: event.target.value });
      renderSwatches();
    },
  });

  const renderSwatches = () => {
    const current = store.settings().accent;
    fill(swatches, ...ACCENTS.map((accent) =>
      h(`div.swatch${current === accent.id ? '.is-active' : ''}`, {
        style: { background: accent.color },
        title: t(accent.label),
        onClick: async () => {
          await save({ accent: accent.id });
          renderSwatches();
        },
      })),
      h(`div.swatch${current === 'custom' ? '.is-active' : ''}`, {
        style: { background: `conic-gradient(#f43f5e,#f59e0b,#84cc16,#06b6d4,#8b5cf6,#f43f5e)` },
        title: t('Eigene Farbe'),
        onClick: async () => {
          await save({ accent: 'custom', accentColor: customInput.value });
          renderSwatches();
        },
      }));
  };
  renderSwatches();

  // --- Hintergrund
  const grid = h('div.bg-grid');
  const renderBackgrounds = () => {
    const current = look().background || 'none';
    fill(grid, ...BACKGROUNDS.map((background) =>
      h(`div.bg-tile${current === background.id ? '.is-active' : ''}`, {
        title: t(background.label),
        onClick: async () => {
          await save({ appearance: { ...look(), background: background.id } });
          renderBackgrounds();
        },
      },
        h('div.bg-tile__preview', {
          style: {
            backgroundImage: background.preview,
            backgroundSize: background.id === 'grid' ? '14px 14px, 14px 14px, cover' : 'cover',
          },
        }),
        h('div.bg-tile__label', { text: t(background.label) }))),

      // Eigenes Bild als letzte Kachel
      h(`div.bg-tile${look().background === 'custom' ? '.is-active' : ''}`, {
        title: look().backgroundPath || t('Eigenes Bild wählen'),
        onClick: async () => {
          const result = await window.ch.media.pickImage();
          if (!result?.ok || result.data.canceled) return;
          await save({
            appearance: { ...look(), background: 'custom', backgroundPath: result.data.filePath },
          });
          toast(t('„{name}“ als Hintergrund gesetzt.', { name: result.data.name }), 'ok');
          renderBackgrounds();
        },
      },
        h('div.bg-tile__preview.bg-tile__preview--custom', {
          style: look().backgroundPath
            ? { backgroundImage: `url("${fileUrlFor(look().backgroundPath)}")` }
            : {},
        }, look().backgroundPath ? null : h('span', { text: '＋' })),
        h('div.bg-tile__label', { text: t('Eigenes Bild') })));
  };
  renderBackgrounds();

  // --- Schleier
  const dimValue = h('span.text-xs.faint', { text: fmt.percent(look().dim ?? 55, 0) });
  const dimSlider = h('input', {
    type: 'range',
    min: 0,
    max: 95,
    step: 5,
    value: look().dim ?? 55,
    style: { width: '220px', accentColor: 'var(--accent)' },
    // Sofort sichtbar machen, gespeichert wird erst beim Loslassen.
    oninput: (event) => {
      dimValue.textContent = fmt.percent(event.target.value, 0);
      document.documentElement.style.setProperty('--bg-dim', String(event.target.value / 100));
    },
    onchange: (event) => save({ appearance: { ...look(), dim: Number(event.target.value) } }),
  });

  return h('div.col.gap-lg', null,
    card(null, {},
      row('Sprache · Language', t('Die App lädt dafür kurz neu.'), languageSelect)),

    card(t('Farben'), {},
      row(t('Farbschema'), t('Dunkel schont die Augen bei langen Schnittsessions.'),
        h('div.btn-group', null,
          ...[['dark', t('Dunkel')], ['light', t('Hell')]].map(([value, label]) =>
            h(`button.btn${(settings.theme || 'dark') === value ? '.is-active' : ''}`, {
              text: label,
              onClick: async (event) => {
                await save({ theme: value });
                for (const button of event.target.parentElement.children) button.classList.remove('is-active');
                event.target.classList.add('is-active');
              },
            })))),
      row(t('Akzentfarbe'), t('Färbt Schaltflächen, Diagramme und Hervorhebungen.'),
        h('div.row.gap-sm', null, swatches, customInput)),
      row(t('Wochenbeginn'), t('Bestimmt die Spaltenreihenfolge im Kalender.'),
        h('select.select', {
          style: { width: '160px' },
          onChange: (event) => save({ startOfWeek: Number(event.target.value) }),
        },
          ...[[1, t('Montag')], [0, t('Sonntag')]].map(([value, label]) =>
            h('option', { value, selected: (settings.startOfWeek ?? 1) === value, text: label }))))),

    card(t('Hintergrund'), { hint: t('vorgefertigt oder eigenes Bild') },
      h('p.text-sm.muted.mb', { text: t('Die vorgefertigten Hintergründe sind Farbverläufe und bleiben auf jedem Bildschirm scharf. Ein eigenes Bild bleibt dort liegen, wo es ist – die App merkt sich nur den Pfad und lädt es beim Start.') }),
      grid,
      h('hr.divider'),
      row(t('Schleier über dem Hintergrund'), t('Je höher, desto ruhiger der Hintergrund. Bei hellen Bildern nötig, damit Text lesbar bleibt.'),
        h('div.row.gap-sm', null, dimSlider, dimValue)),
      look().background === 'custom' && look().backgroundPath
        ? row(t('Gewähltes Bild'), look().backgroundPath,
            h('button.btn.btn--sm.btn--danger', {
              text: t('Entfernen'),
              onClick: async () => {
                await save({ appearance: { ...look(), background: 'none', backgroundPath: null } });
                toast(t('Hintergrundbild entfernt.'), 'ok');
                refresh();
              },
            }))
        : null));
}

/** Windows-Pfad in eine Adresse wandeln, die das Fenster laden darf. */
function fileUrlFor(filePath) {
  return `file:///${encodeURI(String(filePath).replace(/\\/g, '/')).replace(/#/g, '%23')}`;
}

// ------------------------------------------------------------------ Kanäle

function tabChannels() {
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

  return card(t('Aktive Kanäle'), { hint: t('{count} von {total} ausgewählt', { count: (store.settings().activePlatforms || []).length, total: PLATFORMS.length }) },
    h('p.text-sm.muted.mb', { text: t('Nur ausgewählte Kanäle erscheinen im Composer, im Kalender und in der Auswertung. Was du nicht bespielst, gehört hier abgewählt – sonst verzerrt es jede Empfehlung.') }),
    platformGrid);
}

// ------------------------------------------------------------------ Ziele

function tabGoals() {
  const settings = store.settings();
  return card(t('Wochenziele'), { hint: t('Grundlage für Fortschritt und Coach-Hinweise') },
    h('div.grid.grid-3', null,
      ...[
        ['posts', t('Beiträge pro Woche')],
        ['ideas', t('Neue Ideen pro Woche')],
        ['streams', t('Streams pro Woche')],
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
          })))));
}

// ------------------------------------------------------------------ Erinnerungen

function tabReminders() {
  const settings = store.settings();
  return card(t('Termine und Erinnerungen'), {},
    row(t('Desktop-Benachrichtigungen'), t('Meldet sich, wenn ein Beitrag fällig wird.'),
      toggle('', settings.notifications !== false, (value) => save({ notifications: value }))),
    row(t('Vorwarnzeit'), t('So viele Minuten vor dem Termin kommt der erste Hinweis.'),
      h('input.input', {
        type: 'number', min: 0, max: 240, style: { width: '92px' },
        value: settings.leadTimeMinutes ?? 15,
        onChange: (event) => save({ leadTimeMinutes: Number(event.target.value) || 0 }),
      })),
    row(t('Text automatisch kopieren'), t('Legt den fertigen Beitrag zum Termin in die Zwischenablage.'),
      toggle('', settings.copyToClipboardOnDue !== false, (value) => save({ copyToClipboardOnDue: value }))),
    row(t('Upload-Seite öffnen'), t('Öffnet zum Termin zusätzlich die passende Seite der Plattform im Browser.'),
      toggle('', Boolean(settings.autoOpenUploadPage), (value) => save({ autoOpenUploadPage: value }))),
    row(t('Im Infobereich weiterlaufen'), t('Beim Schliessen läuft die App im Tray weiter, damit Termine nicht verpasst werden.'),
      toggle('', settings.minimizeToTray !== false, (value) => save({ minimizeToTray: value }))),
    row(t('Mit Windows starten'), t('Startet die App unsichtbar mit dem System.'),
      toggle('', Boolean(settings.launchOnStartup), async (value) => {
        const result = await window.ch.system.setStartup(value);
        await save({ launchOnStartup: Boolean(result?.data) });
        toast(value ? t('Startet künftig mit Windows.') : t('Startet nicht mehr automatisch.'), 'ok');
      })));
}

// ------------------------------------------------------------------ Aktualisierung

function tabUpdates(version, updateStatus) {
  const settings = store.settings();

  const status = h('div.setting-row__hint', {
    text: settings.lastUpdateCheck
      ? t('Zuletzt geprüft {when}', { when: fmt.relative(settings.lastUpdateCheck) })
        + (settings.lastKnownVersion ? ` · ${t('neueste bekannte Version {version}', { version: settings.lastKnownVersion })}` : '')
      : t('Noch nicht geprüft'),
  });

  const checkNow = h('button.btn.btn--sm', {
    text: t('Jetzt prüfen'),
    onClick: async () => {
      checkNow.disabled = true;
      checkNow.textContent = t('Prüfe …');
      const result = await window.ch.update.check(true);
      checkNow.disabled = false;
      checkNow.textContent = t('Jetzt prüfen');
      if (!result?.ok) return toast(t('Prüfung fehlgeschlagen: {error}', { error: result?.error }), 'danger');

      const info = result.data;
      if (info.downloaded) status.textContent = t('Version {version} liegt bereit und wird beim Neustart eingespielt.', { version: info.latest });
      else if (info.available) status.textContent = t('Version {version} gefunden (installiert: {current}).', { version: info.latest, current: info.current });
      else if (info.offline) status.textContent = t('Keine Verbindung zur Veröffentlichungsseite.');
      else if (info.noReleases) status.textContent = t('Dort ist derzeit keine Veröffentlichung sichtbar.');
      else status.textContent = t('Alles aktuell ({version}).', { version: info.current });
    },
  });

  return card(t('Aktualisierung'), { hint: t('installiert: Version {version}', { version: version.app || '–' }) },
    updateStatus.canSelfUpdate
      ? h('div.notice.notice--ok.mb', null,
          h('span.notice__icon', { text: '✓' }),
          h('div', null,
            h('div.strong.text-sm', { text: t('Diese Fassung aktualisiert sich selbst') }),
            h('div.text-sm.muted', { text: t('Neue Versionen werden im Hintergrund geladen und beim nächsten Beenden eingespielt – oder sofort, wenn du in der Seitenleiste auf „Neu starten und einspielen“ klickst. Es gibt nichts von Hand herunterzuladen.') })))
      : h('div.notice.notice--warn.mb', null,
          h('span.notice__icon', { text: '!' }),
          h('div', null,
            h('div.strong.text-sm', { text: t('Diese Fassung läuft aus dem Quellordner') }),
            h('div.text-sm.muted', { text: t('Sie kann sich nicht selbst ersetzen. Geprüft wird trotzdem – gefundene Versionen musst du selbst installieren. In der installierten Fassung läuft das von allein.') }))),

    row(t('Beim Start nach Updates suchen'), t('Zusätzlich alle sechs Stunden, solange die App läuft.'),
      toggle('', settings.autoUpdateCheck !== false, (value) => save({ autoUpdateCheck: value }))),

    updateStatus.ready
      ? row(t('Version {version} liegt bereit', { version: updateStatus.ready.version }), t('Wird sonst beim nächsten Beenden eingespielt.'),
          h('button.btn.btn--sm.btn--primary', {
            text: t('Jetzt neu starten'),
            onClick: () => window.ch.update.install(),
          }))
      : null,

    h('div.row.between.mt', null,
      status,
      h('div.row.gap-sm', null,
        checkNow,
        h('button.btn.btn--sm.btn--ghost', { text: t('Veröffentlichungen ansehen'), onClick: () => window.ch.update.openReleasePage() }))));
}

// ------------------------------------------------------------------ Daten

function tabData(paths, stats, refresh) {
  return card(t('Daten und Sicherung'), { hint: t('{size} auf der Festplatte', { size: fmt.bytes(stats.bytes) }) },
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
        text: t('Sicherung exportieren'),
        onClick: async () => {
          const result = await window.ch.backup.export();
          if (result?.ok && !result.data.canceled) toast(t('Sicherung gespeichert.'), 'ok');
        },
      }),
      h('button.btn', {
        text: t('Sicherung einlesen (ersetzen)'),
        onClick: async () => {
          if (!(await confirm({
            title: t('Daten ersetzen?'),
            message: t('Der aktuelle Bestand wird vollständig durch die Sicherung ersetzt. Ein Tagesabbild der jetzigen Daten liegt im Sicherungsordner.'),
            confirmLabel: t('Ersetzen'),
            tone: 'danger',
          }))) return;
          const result = await window.ch.backup.import(false);
          if (result?.ok && !result.data.canceled) {
            await store.reload();
            toast(t('Sicherung eingelesen.'), 'ok');
            refresh();
          }
        },
      }),
      h('button.btn', {
        text: t('Sicherung zusammenführen'),
        onClick: async () => {
          const result = await window.ch.backup.import(true);
          if (result?.ok && !result.data.canceled) {
            await store.reload();
            toast(t('Einträge ergänzt.'), 'ok');
            refresh();
          }
        },
      }),
      h('button.btn.btn--ghost', { text: t('Sicherungsordner öffnen'), onClick: () => window.ch.backup.openFolder() })));
}

// ------------------------------------------------------------------ Über

function tabAbout(version) {
  const settings = store.settings();
  return card(t('Über Content Helper'), {},
    h('p.text-sm.muted', { text: t('Ein Werkzeugkasten für Creator: planen, veröffentlichen, verstehen, verbessern. Ohne Abo, ohne Cloud, ohne Datenweitergabe.') }),
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
        text: t('Projekt auf GitHub'),
        onClick: () => window.ch.system.openExternal('https://github.com/MoinMornhart/content-helper'),
      }),
      !settings.onboardingDone
        ? h('button.btn.btn--sm.btn--primary', {
            text: t('Einrichtung abschliessen'),
            onClick: async () => {
              await save({ onboardingDone: true });
              toast(t('Fertig – die App startet künftig im Dashboard.'), 'ok');
            },
          })
        : null));
}

// ------------------------------------------------------------------ Ansicht

export async function render({ refresh, setActions }) {
  const version = (await window.ch.system.version())?.data || {};
  const paths = (await window.ch.system.paths())?.data || {};
  const stats = (await window.ch.db.stats())?.data || { counts: {}, bytes: 0 };
  const updateStatus = (await window.ch.update.status())?.data || { canSelfUpdate: false };

  setActions();

  const content = h('div');
  const renderTab = () => {
    fill(content,
      tab === 'look' ? tabLook(refresh)
        : tab === 'channels' ? tabChannels()
        : tab === 'goals' ? tabGoals()
        : tab === 'reminders' ? tabReminders()
        : tab === 'updates' ? tabUpdates(version, updateStatus)
        : tab === 'data' ? tabData(paths, stats, refresh)
        : tabAbout(version));
  };

  const bar = h('div.tabs', null,
    ...TABS.map((entry) =>
      h(`button.tab${tab === entry.id ? '.is-active' : ''}`, {
        text: t(entry.label),
        onClick: (event) => {
          tab = entry.id;
          for (const button of event.target.parentElement.children) button.classList.remove('is-active');
          event.target.classList.add('is-active');
          renderTab();
        },
      })));

  renderTab();
  return h('div.col', null, bar, content);
}
