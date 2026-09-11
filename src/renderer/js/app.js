/**
 * Einstiegspunkt der Oberflaeche: Navigation, Ansichtswechsel, globale Kuerzel.
 *
 * Ansichten liegen je Datei unter js/views/ und werden erst geladen, wenn sie
 * gebraucht werden. Jede Ansicht exportiert `title`, `lead` und `render(ctx)`.
 */

import { h, fill, qs } from './lib/dom.js';
import * as store from './lib/store.js';
import { toast } from './lib/ui.js';

/**
 * Navigation in vier Schritten des Arbeitsablaufs: sehen, machen, verstehen,
 * einrichten. Was zur Einrichtung gehoert, steht unten und nicht zwischen den
 * taeglich gebrauchten Ansichten.
 */
const NAV = [
  { group: 'Überblick', items: [
    { id: 'dashboard', label: 'Dashboard', icon: '◈' },
    { id: 'calendar', label: 'Kalender', icon: '▦' },
    { id: 'queue', label: 'Warteschlange', icon: '☰' },
  ] },
  { group: 'Produzieren', items: [
    { id: 'assistant', label: 'Assistent', icon: '✧' },
    { id: 'ideas', label: 'Ideen', icon: '✦' },
    { id: 'scripts', label: 'Skripte', icon: '§' },
    { id: 'composer', label: 'Composer', icon: '✎' },
    { id: 'media', label: 'Medien', icon: '▤' },
  ] },
  { group: 'Auswerten', items: [
    { id: 'analytics', label: 'Analytics', icon: '◫' },
    { id: 'coach', label: 'Coach', icon: '◎' },
  ] },
  { group: 'Einrichten', items: [
    { id: 'connections', label: 'Verbindungen', icon: '⇄' },
    { id: 'publishing', label: 'Veröffentlichen', icon: '➚' },
    { id: 'channels', label: 'Kanäle', icon: '⬡' },
    { id: 'mobile', label: 'Handy', icon: '▯' },
    { id: 'devices', label: 'PCs verbinden', icon: '⧉' },
    { id: 'settings', label: 'Einstellungen', icon: '⚙' },
  ] },
];

const state = {
  view: 'dashboard',
  params: {},
  search: '',
  loaded: new Map(),
};

const refs = {};

/** Version, die gerade geladen wird oder bereitliegt. */
let pendingVersion = null;

// ------------------------------------------------------------------ Aufbau

function buildShell() {
  const nav = h('nav.sidebar__nav');
  for (const group of NAV) {
    nav.append(h('div.nav-group', { text: group.group }));
    for (const item of group.items) {
      const badge = h('span.nav-item__badge.hidden');
      const button = h('button.nav-item', {
        dataset: { view: item.id },
        onClick: () => goto(item.id),
      },
        h('span.nav-item__icon', { text: item.icon }),
        h('span', { text: item.label }),
        badge);
      refs[`badge:${item.id}`] = badge;
      nav.append(button);
    }
  }

  // Steht in der Seitenleiste unten und bleibt beim Ansichtswechsel erhalten.
  refs.update = h('div.update-slot');

  const sidebar = h('aside.sidebar', null,
    h('div.sidebar__brand', null,
      h('div.sidebar__logo', { text: '▶' }),
      h('div', null,
        h('div.sidebar__title', { text: 'Content Helper' }),
        h('div.sidebar__subtitle', { text: 'lokal · ohne Konto' }))),
    nav,
    h('div.sidebar__footer', null,
      h('button.btn.btn--primary.btn--block', { text: '＋  Neuer Beitrag', onClick: () => goto('composer', { fresh: true }) }),
      // Der Stand der Aktualisierung gehoert zur Version – und damit hierher,
      // nicht in die Kopfzeile ueber den Inhalt.
      refs.update,
      h('div.text-xs.faint.row.between', null,
        h('span', { id: 'version-label', text: '' }),
        h('button.btn.btn--ghost.btn--sm', { text: 'Update prüfen', onClick: checkUpdateManually }))));

  refs.title = h('div.topbar__title', { text: 'Dashboard' });
  refs.hint = h('div.topbar__hint', { text: '' });
  refs.actions = h('div.row.gap-sm');
  refs.searchInput = h('input', {
    type: 'search',
    placeholder: 'Suchen … (Strg+K)',
    oninput: (event) => {
      state.search = event.target.value;
      store.emit('search', state.search);
    },
  });

  const topbar = h('header.topbar', null,
    h('div', null, refs.title, refs.hint),
    refs.actions,
    h('div.search', null, h('span.search__icon', { text: '⌕' }), refs.searchInput));

  refs.view = h('main.view');

  const app = qs('#app');
  fill(app, sidebar, h('div.main', null, topbar, refs.view));
}

// ------------------------------------------------------------------ Navigation

export async function goto(viewId, params = {}) {
  state.view = viewId;
  state.params = params;

  for (const button of document.querySelectorAll('.nav-item')) {
    button.classList.toggle('is-active', button.dataset.view === viewId);
  }

  fill(refs.actions);
  fill(refs.view, h('div.col.gap-lg', null,
    h('div.skeleton', { style: { height: '92px' } }),
    h('div.skeleton', { style: { height: '220px' } })));

  try {
    const module = state.loaded.get(viewId) || (await import(`./views/${viewId}.js`));
    state.loaded.set(viewId, module);

    refs.title.textContent = module.title || viewId;
    refs.hint.textContent = typeof module.lead === 'function' ? module.lead() : module.lead || '';

    const context = {
      params,
      goto,
      /** Blendet Schaltflaechen in der Kopfzeile ein. */
      setActions: (...nodes) => fill(refs.actions, ...nodes),
      /** Zeichnet die aktuelle Ansicht neu. */
      refresh: () => goto(viewId, params),
      search: () => state.search,
    };

    const content = await module.render(context);
    fill(refs.view, content);
    refs.view.scrollTop = 0;
  } catch (error) {
    console.error(error);
    fill(refs.view, h('div.card', null,
      h('h2', { text: 'Diese Ansicht konnte nicht geladen werden' }),
      h('p.muted.mt-sm', { text: error.message }),
      h('pre.mono.text-xs.muted', { text: error.stack || '' })));
  }
}

/** Zahl an einem Navigationspunkt, z. B. faellige Beitraege. */
function setBadge(viewId, count, tone = '') {
  const badge = refs[`badge:${viewId}`];
  if (!badge) return;
  badge.textContent = count > 99 ? '99+' : String(count);
  badge.classList.toggle('hidden', !count);
  badge.classList.toggle('is-danger', tone === 'danger');
}

async function refreshBadges() {
  const summary = await window.ch.scheduler.summary();
  if (!summary?.ok) return;
  const { dueCount, missedCount, scheduledCount } = summary.data;
  setBadge('queue', dueCount + missedCount, missedCount ? 'danger' : '');
  setBadge('calendar', scheduledCount);
  const openIdeas = store.all('ideas').filter((idea) => idea.status !== 'done' && idea.status !== 'archived').length;
  setBadge('ideas', openIdeas);
}

// ------------------------------------------------------------------ Erscheinungsbild

/** Wandelt einen Windows-Pfad in eine Adresse, die das Fenster laden darf. */
export function fileUrl(filePath) {
  const normalized = String(filePath).replace(/\\/g, '/');
  return `file:///${encodeURI(normalized).replace(/^file:\/\/\//, '').replace(/#/g, '%23')}`;
}

/**
 * Erscheinungsbild anwenden: Farbschema, Akzentfarbe und Hintergrund.
 *
 * Der Hintergrund liegt als eigene Ebene hinter der Oberflaeche, darueber ein
 * einstellbarer Schleier. Ohne ihn wird Text auf hellen Bildern unlesbar –
 * deshalb ist er nicht abschaltbar, sondern nur regelbar.
 */
export function applyTheme(settings) {
  const root = document.documentElement;
  root.dataset.theme = settings.theme || 'dark';
  root.dataset.accent = settings.accent || 'violet';

  if (settings.accentColor) root.style.setProperty('--accent-base', settings.accentColor);
  else root.style.removeProperty('--accent-base');

  const look = settings.appearance || {};
  const background = look.background || 'none';

  if (background === 'custom' && look.backgroundPath) {
    root.dataset.bg = 'on';
    delete root.dataset.bgPreset;
    root.style.setProperty('--bg-image', `url("${fileUrl(look.backgroundPath)}")`);
  } else if (background !== 'none') {
    root.dataset.bg = 'on';
    root.dataset.bgPreset = background;
    root.style.removeProperty('--bg-image');
  } else {
    delete root.dataset.bg;
    delete root.dataset.bgPreset;
    root.style.removeProperty('--bg-image');
  }

  root.style.setProperty('--bg-dim', String(Math.min(95, Math.max(0, look.dim ?? 55)) / 100));
}

// ------------------------------------------------------------------ Aktualisierung

/**
 * Meldet ausdruecklich, wenn die Pruefung gar nicht stattfinden konnte.
 * Ein "alles aktuell" darf nur stehen, wenn wirklich nachgesehen wurde –
 * eine falsche Beruhigung ist schlimmer als eine offene Fehlermeldung.
 */
async function checkUpdateManually() {
  toast('Suche nach einer neueren Version …', 'info', 2000);
  const result = await window.ch.update.check(true);
  if (!result?.ok) return toast(`Update-Prüfung fehlgeschlagen: ${result?.error || 'unbekannt'}`, 'danger', 7000);

  const info = result.data;
  if (info.downloaded) {
    toast(`Version ${info.latest} liegt bereit – ein Neustart spielt sie ein.`, 'ok', 8000);
  } else if (info.available && info.selfUpdate) {
    toast(`Version ${info.latest} wird im Hintergrund geladen.`, 'ok', 7000);
    setUpdateState({ state: 'downloading', latest: info.latest, percent: 0 });
  } else if (info.available) {
    toast(`Version ${info.latest} ist verfügbar – du hast ${info.current}.`, 'ok', 8000);
    setUpdateState({ state: 'manual', latest: info.latest });
  } else if (info.offline) {
    toast(`Prüfung nicht möglich: ${info.error || 'keine Verbindung'}.`, 'warn', 7000);
  } else if (info.noReleases) {
    toast('Prüfung nicht möglich: Auf der Projektseite ist keine Veröffentlichung sichtbar.', 'warn', 7000);
  } else {
    toast(`Alles aktuell – Version ${info.current} ist die neueste.`, 'ok');
  }
}

/**
 * Anzeige zum Stand der Aktualisierung in der Kopfzeile.
 *
 * Die installierte Fassung laedt neue Versionen von allein herunter; hier ist
 * nur zu sehen, wie weit das ist und wann ein Neustart sie einspielt. Aus dem
 * Quellordner heraus gibt es nichts zu ersetzen – dann fuehrt der Hinweis zur
 * Veroeffentlichung.
 */
function setUpdateState({ state, latest, percent = 0 }) {
  if (!refs.update) return;

  if (state === 'downloading') {
    fill(refs.update,
      h('div.update-slot__box', null,
        h('div.row.between', null,
          h('span.text-xs.strong', { text: `Version ${latest || ''} wird geladen` }),
          h('span.text-xs.faint', { text: `${percent} %` })),
        h('div.bar.mt-sm', null, h('div.bar__fill', { style: { width: `${percent}%` } }))));
    return;
  }

  if (state === 'ready') {
    fill(refs.update,
      h('div.update-slot__box.is-ready', null,
        h('div.text-xs.strong.mb-sm', { text: `Version ${latest} liegt bereit` }),
        h('button.btn.btn--primary.btn--sm.btn--block', {
          text: 'Neu starten und einspielen',
          title: 'Wird sonst automatisch beim nächsten Beenden eingespielt.',
          onClick: async () => {
            toast('Starte neu …', 'info', 4000);
            await window.ch.update.install();
          },
        })));
    return;
  }

  if (state === 'manual') {
    fill(refs.update,
      h('div.update-slot__box', null,
        h('div.text-xs.strong.mb-sm', { text: `Version ${latest} verfügbar` }),
        h('div.text-xs.faint.mb-sm', { text: 'Diese Fassung läuft aus dem Quellordner und kann sich nicht selbst ersetzen.' }),
        h('button.btn.btn--sm.btn--block', {
          text: 'Veröffentlichung öffnen',
          onClick: () => window.ch.update.openReleasePage(),
        })));
    return;
  }

  fill(refs.update);
}

// ------------------------------------------------------------------ Start

async function main() {
  buildShell();

  const settings = await store.boot();
  applyTheme(settings);

  const version = await window.ch.system.version();
  if (version?.ok) qs('#version-label').textContent = `v${version.data.app}`;

  store.on('settings', applyTheme);
  store.on('change', () => refreshBadges());

  window.ch.scheduler.onChanged(() => {
    refreshBadges();
    if (['dashboard', 'queue', 'calendar'].includes(state.view)) goto(state.view, state.params);
  });

  // Was ein anderer PC geändert hat, soll hier sofort sichtbar werden.
  // Editoren bleiben stehen, sonst ginge halb Getipptes verloren.
  window.ch.sync.onChanged(async () => {
    await store.reload();
    if (!['composer', 'scripts'].includes(state.view)) goto(state.view, state.params);
  });

  // Automatisches Veröffentlichen: Zustandswechsel neu zeichnen, Fortschritt nur
  // an die offene Ansicht weiterreichen (sonst flackerte alles bei jedem Prozent).
  window.ch.publish.onChanged(async (payload) => {
    await store.reload('posts');
    window.dispatchEvent(new CustomEvent('ch:publish-changed', { detail: payload }));
    if (payload?.delivery?.state !== 'uploading' && ['dashboard', 'queue', 'calendar', 'publishing'].includes(state.view)) {
      goto(state.view, state.params);
    }
  });
  window.ch.publish.onProgress((payload) => {
    window.dispatchEvent(new CustomEvent('ch:publish-progress', { detail: payload }));
  });

  // Neue Zahlen aus einer Verbindung sollen sofort erscheinen.
  window.ch.connectors.onChanged(async () => {
    await store.reload();
    goto(state.view, state.params);
  });

  // Was am Handy passiert, soll hier sofort sichtbar werden.
  window.ch.companion.onChanged(async () => {
    await store.reload();
    goto(state.view, state.params);
  });

  window.ch.nav.onGoto(({ view }) => goto(view));
  window.ch.nav.onAction(({ action }) => handleAction(action));
  // Die installierte Fassung laedt von allein; hier wird nur der Stand gezeigt.
  window.ch.update.onAvailable((info) => {
    if (info.autoDownload) {
      setUpdateState({ state: 'downloading', latest: info.latest, percent: 0 });
      toast(`Version ${info.latest} wird im Hintergrund geladen.`, 'ok', 6000);
    } else {
      setUpdateState({ state: 'manual', latest: info.latest });
      toast(`Version ${info.latest} ist verfügbar.`, 'ok', 8000);
    }
  });

  window.ch.update.onProgress(({ percent }) => {
    setUpdateState({ state: 'downloading', latest: pendingVersion, percent });
  });

  window.ch.update.onReady(({ version }) => {
    pendingVersion = version;
    setUpdateState({ state: 'ready', latest: version });
    toast(`Version ${version} ist fertig geladen – ein Neustart spielt sie ein.`, 'ok', 9000);
  });

  window.ch.update.onState(({ state, message }) => {
    if (state === 'error') console.warn('Aktualisierung:', message);
  });

  // Beim Start nachsehen, ob aus einer frueheren Sitzung schon etwas bereitliegt.
  const updateStatus = await window.ch.update.status();
  if (updateStatus?.ok) {
    const info = updateStatus.data;
    if (info.ready) {
      pendingVersion = info.ready.version;
      setUpdateState({ state: 'ready', latest: info.ready.version });
    } else if (info.downloading) {
      setUpdateState({ state: 'downloading', latest: info.lastResult?.latest, percent: 0 });
    }
  }

  document.addEventListener('keydown', (event) => {
    const inField = /^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName);
    if (event.ctrlKey && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      refs.searchInput.focus();
      refs.searchInput.select();
    } else if (event.key === 'Escape' && document.activeElement === refs.searchInput) {
      refs.searchInput.value = '';
      state.search = '';
      store.emit('search', '');
      refs.searchInput.blur();
    } else if (!inField && event.key === '/') {
      event.preventDefault();
      refs.searchInput.focus();
    }
  });

  // Zugriff fuer den Rauchtest und die Entwicklerwerkzeuge.
  window.__app = { goto, state, store };

  await goto(settings.onboardingDone ? 'dashboard' : 'settings');
  refreshBadges();
  setInterval(refreshBadges, 60_000);
}

function handleAction(action) {
  switch (action) {
    case 'new-post': return goto('composer', { fresh: true });
    case 'new-idea': return goto('ideas', { fresh: true });
    case 'export-backup': return window.ch.backup.export().then((result) => {
      if (result?.ok && !result.data.canceled) toast('Sicherung gespeichert.', 'ok');
    });
    case 'import-backup': return window.ch.backup.import(false).then(async (result) => {
      if (result?.ok && !result.data.canceled) {
        await store.reload();
        toast('Sicherung eingelesen.', 'ok');
        goto(state.view, state.params);
      }
    });
    default: return undefined;
  }
}

main();
