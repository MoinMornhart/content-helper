/**
 * Datenzugriff der Oberflaeche.
 *
 * Haelt alle Sammlungen im Speicher, damit Ansichten ohne Wartezeit rendern
 * koennen, und schreibt Aenderungen im Hintergrund in den Hauptprozess.
 * Wer sich auf "change" anmeldet, wird bei jeder Aenderung benachrichtigt.
 */

const COLLECTIONS = [
  'posts', 'ideas', 'media', 'channels', 'analytics',
  'series', 'tasks', 'hashtagSets', 'templates', 'notes', 'activity',
];

const cache = new Map();
const listeners = new Map();
let settingsCache = {};

/** Wirft bei Fehlern, damit Aufrufer sie als Hinweis anzeigen koennen. */
async function unwrap(promise) {
  const result = await promise;
  if (!result?.ok) throw new Error(result?.error || 'Unbekannter Fehler');
  return result.data;
}

export async function boot() {
  const loaded = await Promise.all(COLLECTIONS.map((name) => unwrap(window.ch.db.list(name))));
  COLLECTIONS.forEach((name, index) => cache.set(name, loaded[index] || []));
  settingsCache = await unwrap(window.ch.settings.get());
  return settingsCache;
}

/** Laedt eine Sammlung neu (z. B. nach einem Import). */
export async function reload(name) {
  if (name) {
    cache.set(name, await unwrap(window.ch.db.list(name)));
  } else {
    await boot();
  }
  emit('change', { collection: name || '*' });
}

export const all = (collection) => cache.get(collection) || [];

export const byId = (collection, id) => all(collection).find((entry) => entry.id === id) || null;

export function where(collection, predicate) {
  return all(collection).filter(predicate);
}

export async function add(collection, entry) {
  const created = await unwrap(window.ch.db.insert(collection, entry));
  cache.get(collection).unshift(created);
  emit('change', { collection, action: 'add', id: created.id });
  return created;
}

export async function patch(collection, id, changes) {
  const updated = await unwrap(window.ch.db.update(collection, id, changes));
  if (updated) {
    const items = cache.get(collection);
    const index = items.findIndex((entry) => entry.id === id);
    if (index !== -1) items[index] = updated;
  }
  emit('change', { collection, action: 'update', id });
  return updated;
}

export async function remove(collection, id) {
  await unwrap(window.ch.db.remove(collection, id));
  const items = cache.get(collection);
  const index = items.findIndex((entry) => entry.id === id);
  if (index !== -1) items.splice(index, 1);
  emit('change', { collection, action: 'remove', id });
  return true;
}

/** Ersetzt eine ganze Sammlung – fuer Sortierung, Import und Massenaktionen. */
export async function replace(collection, items) {
  await unwrap(window.ch.db.replace(collection, items));
  cache.set(collection, items);
  emit('change', { collection, action: 'replace' });
  return items;
}

// ------------------------------------------------------------------ Einstellungen

export const settings = () => settingsCache;

export async function saveSettings(changes) {
  settingsCache = await unwrap(window.ch.settings.save(changes));
  emit('settings', settingsCache);
  emit('change', { collection: 'settings' });
  return settingsCache;
}

// ------------------------------------------------------------------ Ereignisse

export function on(event, handler) {
  if (!listeners.has(event)) listeners.set(event, new Set());
  listeners.get(event).add(handler);
  return () => listeners.get(event)?.delete(handler);
}

export function emit(event, payload) {
  for (const handler of listeners.get(event) || []) {
    try {
      handler(payload);
    } catch (error) {
      console.error(`Fehler im Ereignis-Empfaenger fuer "${event}":`, error);
    }
  }
}
