'use strict';

/**
 * Gemeinsame Schreibhilfen der Verbindungen.
 *
 * Abgeglichen wird über eine Fremdkennung (`externalId`). Damit landet dieselbe
 * Übertragung oder dasselbe Video auch bei wiederholtem Abgleich nur einmal im
 * Bestand – Aufrufe werden aktualisiert, von Hand ergänzte Werte bleiben
 * erhalten. Alles, was du selbst eingetragen hast, bleibt unangetastet.
 */

/**
 * Legt einen Messwert an oder frischt einen bestehenden auf.
 * @returns {'added'|'updated'}
 */
function upsertAnalytics(store, {
  externalId, platformId, date, title, url, metrics, source, note, accountId = null, accountName = null,
}) {
  const known = store.list('analytics').find((entry) => entry.externalId === externalId);

  if (known) {
    store.update('analytics', known.id, {
      title: title ?? known.title,
      url: url ?? known.url,
      // Eigene Eintragungen haben Vorrang und werden nicht ueberschrieben.
      metrics: { ...metrics, ...stripAuto(known.metrics, metrics) },
      // Die Kanalzuordnung wird nachgetragen, aber nie umgehaengt.
      accountId: known.accountId || accountId,
      accountName: accountName || known.accountName || null,
    });
    return 'updated';
  }

  store.insert('analytics', { externalId, platformId, date, title, url, metrics, source, note, accountId, accountName });
  return 'added';
}

/**
 * Behaelt Werte, die der Nutzer selbst ergaenzt hat: alles, was die Verbindung
 * gar nicht liefert.
 */
function stripAuto(existing = {}, incoming = {}) {
  const kept = {};
  for (const [key, value] of Object.entries(existing)) {
    if (!(key in incoming)) kept[key] = value;
  }
  return kept;
}

/**
 * Legt einen bereits veroeffentlichten Beitrag an, damit Kalender, Verlauf und
 * Coach den tatsaechlichen Rhythmus kennen. Bestehende Beitraege werden nicht
 * angefasst.
 * @returns {string|null} Kennung des Beitrags, null wenn bereits vorhanden
 */
function upsertPublishedPost(store, {
  externalId, title, body, platforms, publishedAt, format, url, accountId = null, accountName = null,
}) {
  const known = store.list('posts').find((post) => post.externalId === externalId);
  if (known) {
    // Aeltere Beitraege ohne Kanalzuordnung bekommen sie nachgetragen.
    if (accountId && !known.accountId) store.update('posts', known.id, { accountId, accountName });
    return null;
  }

  const created = store.insert('posts', {
    externalId,
    title,
    body: body || '',
    platforms,
    format: format || null,
    status: 'published',
    publishedAt,
    scheduledAt: publishedAt,
    url: url || null,
    accountId,
    accountName,
    hashtags: [],
    perPlatform: {},
    mediaIds: [],
    checklist: [],
    source: 'Verbindung',
  });
  return created.id;
}

/** Verbindet Messwerte mit dem passenden Beitrag, sofern beide dieselbe Quelle haben. */
function linkAnalyticsToPost(store, analyticsExternalId, postId) {
  const entry = store.list('analytics').find((item) => item.externalId === analyticsExternalId);
  if (!entry || entry.postId) return false;
  store.update('analytics', entry.id, { postId });
  return true;
}

module.exports = { upsertAnalytics, upsertPublishedPost, linkAnalyticsToPost };
