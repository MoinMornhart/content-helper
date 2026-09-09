/**
 * Einstiegspunkt der Oberflaeche: Navigation, Ansichtswechsel, globale Kuerzel.
 *
 * Ansichten liegen je Datei unter js/views/ und werden erst geladen, wenn sie
 * gebraucht werden. Jede Ansicht exportiert `title`, `lead` und `render(ctx)`.
 */

import { h, fill, qs } from './lib/dom.js';
import * as store from './lib/store.js';
import { toast } from './lib/ui.js';

const NAV = [
  { group: 'Überblick', items: [
    { id: 'dashboard', label: 'Dashboard', icon: '◈' },
    { id: 'calendar', label: 'Kalender', icon: '▦' },
    { id: 'queue', label: 'Warteschlange', icon: '☰' },
  ] },
  { group: 'Erstellen', items: [
    { id: 'composer', label: 'Composer', icon: '✎' },
    { id: 'ideas', label: 'Ideen', icon: '✦' },
    { id: 'scripts', label: 'Skripte', icon: '§' },
    { id: 'media', label: 'Medien', icon: '▤' },
  ] },
  { group: 'Verstehen', items: [
    { id: 'analytics', label: 'Analytics', icon: '◫' },
    { id: 'coach', label: 'Coach', icon: '◎' },
    { id: 'channels', label: 'Kanäle', icon: '⬡' },
    { id: 'connections', label: 'Verbindungen', icon: '⇄' },
  ] },
  { group: 'System', items: [
    { id: 'mobile', label: 'Handy', icon: '▯' },
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

  const sidebar = h('aside.sidebar', null,
    h('div.sidebar__brand', null,
      h('div.sidebar__logo', { text: '▶' }),
      h('div', null,
        h('div.sidebar__title', { text: 'Content Helper' }),
        h('div.sidebar__subtitle', { text: 'lokal · ohne Konto' }))),
    nav,
    h('div.sidebar__footer', null,
      h('button.btn.btn--primary.btn--block', { text: '＋  Neuer Beitrag', onClick: () => goto('composer', { fresh: true }) }),
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

export function applyTheme(settings) {
  document.documentElement.dataset.theme = settings.theme || 'dark';
  document.documentElement.dataset.accent = settings.accent || 'violet';
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
  if (info.available) {
    toast(`Version ${info.latest} ist verfügbar – du hast ${info.current}.`, 'ok', 8000);
    showUpdateBanner(info);
  } else if (info.offline) {
    toast(`Prüfung nicht möglich: ${info.error || 'keine Verbindung'}.`, 'warn', 7000);
  } else if (info.noReleases) {
    toast('Prüfung nicht möglich: Auf der Projektseite ist keine Veröffentlichung sichtbar.', 'warn', 7000);
  } else {
    toast(`Alles aktuell – Version ${info.current} ist die neueste.`, 'ok');
  }
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
  window.ch.update.onAvailable((info) => showUpdateBanner(info));

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

/** Dauerhafter Hinweis in der Kopfzeile, wenn eine neue Version bereitliegt. */
function showUpdateBanner(info) {
  if (qs('#update-banner')) return;
  const banner = h('button.btn.btn--primary.btn--sm#update-banner', {
    text: `Version ${info.latest} verfügbar`,
    title: 'Zur Download-Seite',
    onClick: () => window.ch.update.openReleasePage(),
  });
  refs.actions.prepend(banner);
  toast(`Neue Version ${info.latest} verfügbar.`, 'ok', 8000);
}

main();
