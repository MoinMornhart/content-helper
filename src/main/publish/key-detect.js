'use strict';

/**
 * Erkennt Kennungen der Plattform-Anwendungen an ihrer Form.
 *
 * Beim Einrichten soll niemand Felder zuordnen müssen: Wer auf der Seite der
 * Plattform die Client-ID oder das Secret kopiert, bekommt es in der App
 * automatisch ins richtige Feld. Die Formen sind je Plattform ziemlich
 * eindeutig – Google-Client-IDs enden auf „.apps.googleusercontent.com“,
 * Secrets beginnen mit „GOCSPX-“, TikTok-Keys mit „aw“, X-Client-IDs enden auf
 * „MTpjaQ“.
 *
 * Wo eine Form weniger eindeutig ist (32 Hex-Zeichen, 16 Ziffern), wird sie nur
 * übernommen, wenn genau dieser eine Wert in der Zwischenablage liegt – nicht
 * aus einem längeren Text heraus.
 */

/** Je Plattform: Feld und Form, in der Reihenfolge der Prüfung. */
const FORMS = {
  google: [
    ['clientId', /^\d{6,}-[a-z0-9]{20,}\.apps\.googleusercontent\.com$/],
    ['clientSecret', /^GOCSPX-[A-Za-z0-9_-]{20,}$/],
  ],
  tiktok: [
    ['clientKey', /^aw[a-z0-9]{14,18}$/],
    ['clientSecret', /^[A-Za-z0-9]{32}$/],
  ],
  meta: [
    ['appId', /^\d{14,17}$/],
    ['appSecret', /^[a-f0-9]{32}$/],
  ],
  linkedin: [
    ['clientSecret', /^WPL_AP\d\.[A-Za-z0-9._=-]{8,}$/],
    ['clientId', /^(?=[a-z0-9]*\d)(?=[a-z0-9]*[a-z])[a-z0-9]{12,16}$/],
    ['clientSecret', /^(?=[A-Za-z0-9]*[A-Z])(?=[A-Za-z0-9]*[a-z])(?=[A-Za-z0-9]*\d)[A-Za-z0-9]{16}$/],
  ],
  x: [
    ['clientId', /^[A-Za-z0-9_-]{16,}MTpjaQ$/],
  ],
  twitch: [
    ['clientId', /^[a-z0-9]{30}$/],
  ],
};

/** Formen, die nur als alleiniger Wert zählen. */
const WEAK = new Set([
  'tiktok.clientSecret',
  'meta.appId',
  'meta.appSecret',
  'linkedin.clientId',
  'linkedin.clientSecret',
  'twitch.clientId',
]);

/**
 * @param {string} provider google | tiktok | meta | linkedin | x | twitch
 * @param {string} text Inhalt der Zwischenablage oder einer Datei
 * @returns {Record<string, string>} erkannte Felder
 */
function detectKeys(provider, text) {
  const found = {};
  const raw = String(text || '').trim();
  const forms = FORMS[provider];
  if (!raw || !forms || raw.length > 200_000) return found;

  // Google bietet die Zugangsdaten als JSON-Datei zum Herunterladen an.
  try {
    const data = JSON.parse(raw);
    const client = data.installed || data.web || data;
    if (provider === 'google' && client?.client_id) {
      found.clientId = String(client.client_id);
      if (client.client_secret) found.clientSecret = String(client.client_secret);
      return found;
    }
  } catch { /* kein JSON */ }

  // „=“ gehört bei manchen Secrets zum Wert (Auffüllzeichen) – deshalb nur an
  // Leerraum und Satzzeichen trennen und „schlüssel=wert“ zusätzlich zerlegen.
  const tokens = raw.split(/[\s"'`,;<>()[\]{}|]+/).filter(Boolean);
  const single = tokens.length === 1;

  for (const token of tokens) {
    const split = token.search(/[=:]/);
    const candidates = split > 0 ? [token, token.slice(split + 1)] : [token];
    for (const candidate of candidates) {
      let taken = false;
      for (const [field, form] of forms) {
        if (found[field] || !form.test(candidate)) continue;
        if (!single && WEAK.has(`${provider}.${field}`)) continue;
        found[field] = candidate;
        taken = true;
        break;
      }
      if (taken) break;
    }
  }
  return found;
}

module.exports = { detectKeys, FORMS };
