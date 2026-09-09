'use strict';

/**
 * Kleiner HTTP-Helfer für die Verbindungen nach draussen.
 *
 * Bewusst auf Node-Bordmitteln aufgebaut: kein Zusatzpaket, dadurch auch ohne
 * Electron testbar. Alle Aufrufe haben eine Zeitgrenze, folgen Weiterleitungen
 * und melden Fehler mit lesbarem Text statt mit einer Statusnummer.
 */

const https = require('https');
const { URL } = require('url');

const TIMEOUT_MS = 15_000;
const MAX_REDIRECTS = 3;
const MAX_BYTES = 8 * 1024 * 1024;

/**
 * Führt eine Anfrage aus und liefert den Rohtext zurück.
 *
 * @param {string} url
 * @param {{method?: string, headers?: object, body?: string, redirects?: number}} options
 * @returns {Promise<{status: number, headers: object, text: string}>}
 */
function request(url, options = {}) {
  const { method = 'GET', headers = {}, body = null, redirects = 0 } = options;

  return new Promise((resolve, reject) => {
    let target;
    try {
      target = new URL(url);
    } catch {
      return reject(new Error(`Ungültige Adresse: ${url}`));
    }
    if (target.protocol !== 'https:') {
      return reject(new Error('Nur verschlüsselte Verbindungen sind erlaubt.'));
    }

    const req = https.request(
      {
        method,
        hostname: target.hostname,
        path: `${target.pathname}${target.search}`,
        headers: {
          'User-Agent': 'ContentHelper (lokale Desktop-App)',
          'Accept-Language': 'de,en;q=0.8',
          ...headers,
          ...(body ? { 'Content-Length': Buffer.byteLength(body) } : {}),
        },
        timeout: TIMEOUT_MS,
      },
      (response) => {
        // Weiterleitungen selbst verfolgen, damit die Zeitgrenze erhalten bleibt.
        if ([301, 302, 303, 307, 308].includes(response.statusCode) && response.headers.location) {
          response.resume();
          if (redirects >= MAX_REDIRECTS) return reject(new Error('Zu viele Weiterleitungen.'));
          const next = new URL(response.headers.location, url).toString();
          return resolve(request(next, { ...options, redirects: redirects + 1 }));
        }

        let text = '';
        let size = 0;
        response.setEncoding('utf8');
        response.on('data', (chunk) => {
          size += Buffer.byteLength(chunk);
          if (size > MAX_BYTES) {
            response.destroy();
            return reject(new Error('Die Antwort war unerwartet gross.'));
          }
          text += chunk;
        });
        response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, text }));
      }
    );

    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Zeitüberschreitung – die Gegenstelle hat nicht geantwortet.'));
    });

    req.on('error', (error) => {
      reject(new Error(
        error.code === 'ENOTFOUND' || error.code === 'EAI_AGAIN'
          ? 'Keine Verbindung zum Internet.'
          : error.message
      ));
    });

    if (body) req.write(body);
    req.end();
  });
}

/** Anfrage mit JSON-Antwort. Wirft mit lesbarem Text, wenn etwas schiefgeht. */
async function json(url, options = {}) {
  const response = await request(url, {
    ...options,
    headers: { Accept: 'application/json', ...(options.headers || {}) },
  });

  let payload = null;
  try {
    payload = JSON.parse(response.text);
  } catch {
    if (response.status >= 400) throw new Error(`Die Gegenstelle antwortete mit Status ${response.status}.`);
    throw new Error('Die Antwort war kein gültiges JSON.');
  }

  if (response.status >= 400) {
    const message = payload?.message || payload?.error_description || payload?.error || `Status ${response.status}`;
    throw new Error(message);
  }
  return payload;
}

/** Anfrage mit Textantwort, etwa für Feeds und Webseiten. */
async function text(url, options = {}) {
  const response = await request(url, options);
  if (response.status >= 400) throw new Error(`Die Gegenstelle antwortete mit Status ${response.status}.`);
  return response.text;
}

module.exports = { request, json, text };
