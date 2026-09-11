'use strict';

/**
 * Kennungen der Content-Helper-Anwendungen bei den Plattformen.
 *
 * Jede Plattform gibt Uploads nur an eine bei ihr registrierte Anwendung frei.
 * Diese Anwendung legt der Herausgeber des Content Helpers einmal an – danach
 * meldet sich jeder Nutzer nur noch mit seinem eigenen Konto an und sieht
 * davon nichts. Anleitung: docs/VEROEFFENTLICHEN.md.
 *
 * Woher die Werte kommen, in dieser Reihenfolge:
 *  1. credentials.local.json neben dieser Datei. Die schreibt die
 *     Veröffentlichung auf GitHub aus den Repository-Geheimnissen in das
 *     Installationspaket. Im öffentlichen Quelltext steht sie nicht.
 *  2. Von Hand in der App hinterlegte Werte (Einrichten → Veröffentlichen),
 *     etwa beim Entwickeln.
 *
 * Ehrlich gesagt: Was in einer Desktop-App steckt, lässt sich auslesen. Google
 * sagt darum ausdrücklich, dass das „Secret“ einer Desktop-Anwendung kein
 * Geheimnis ist. Es gehört trotzdem nicht offen ins Repository.
 */

const path = require('path');

const FIELDS = {
  google: ['clientId', 'clientSecret'],
  tiktok: ['clientKey', 'clientSecret'],
  meta: ['appId', 'appSecret', 'configId'],
  linkedin: ['clientId', 'clientSecret'],
  x: ['clientId'],
};

/** Welche Werte zwingend nötig sind. */
const REQUIRED = {
  google: ['clientId', 'clientSecret'],
  tiktok: ['clientKey', 'clientSecret'],
  meta: ['appId', 'appSecret'],
  linkedin: ['clientId', 'clientSecret'],
  x: ['clientId'],
};

let bundled = null;
function loadBundled() {
  if (bundled) return bundled;
  try {
    bundled = require(path.join(__dirname, 'credentials.local.json'));
  } catch {
    bundled = {};
  }
  return bundled;
}

/**
 * @param {import('../store').Store} store
 * @param {'google'|'tiktok'|'meta'|'linkedin'|'x'} provider
 */
function credentialsFor(store, provider) {
  const built = loadBundled()[provider] || {};
  const manual = store.settings().connections?.publishCredentials?.[provider] || {};
  const result = {};
  for (const field of FIELDS[provider]) result[field] = built[field] || manual[field] || '';
  result.builtIn = REQUIRED[provider].every((field) => built[field]);
  result.complete = REQUIRED[provider].every((field) => result[field]);
  return result;
}

function saveManual(store, provider, values) {
  const connections = { ...(store.settings().connections || {}) };
  const all = { ...(connections.publishCredentials || {}) };
  all[provider] = Object.fromEntries(FIELDS[provider].map((field) => [field, String(values[field] || '').trim()]));
  connections.publishCredentials = all;
  store.saveSettings({ connections });
}

module.exports = { credentialsFor, saveManual, FIELDS, REQUIRED };
