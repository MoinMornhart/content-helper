'use strict';

/**
 * Gemeinsames Werkzeug der Plattform-Anbindungen: Fehlerarten, Warten, JSON.
 */

const { PermanentError } = require('../publisher');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** Vorübergehend – der Publisher versucht es später erneut. */
function retryable(message, extra = {}) {
  return Object.assign(new Error(message), { retryable: true }, extra);
}

/** Dauerhaft – ein neuer Versuch ändert nichts. */
function permanent(message) {
  return new PermanentError(message);
}

const RELOGIN = 'Bitte unter „Einrichten → Veröffentlichen“ neu anmelden.';

/** Übersetzt einen HTTP-Status in die passende Fehlerart. */
function statusError(name, status, detail) {
  if (status === 401) return permanent(`${name}: Die Anmeldung ist abgelaufen oder wurde zurückgezogen. ${RELOGIN}`);
  if (status === 429) return retryable(`${name} bremst gerade – zu viele Anfragen. Es geht gleich weiter.`);
  if (status >= 500) return retryable(`${name} hat gerade ein Problem (Status ${status}). Neuer Versuch folgt.`);
  return permanent(`${name} meldet: ${detail || `Status ${status}`}`);
}

/** Wartet, bis eine Bedingung erfüllt ist – für „wird verarbeitet“ auf Plattformseite. */
async function poll(check, { every = 5_000, times = 60, wait = sleep } = {}) {
  for (let round = 0; round < times; round += 1) {
    const result = await check(round);
    if (result !== undefined && result !== null) return result;
    await wait(every);
  }
  return null;
}

/** Text auf eine Höchstlänge kürzen, ohne Zeichen zu zerschneiden. */
function clip(text, max) {
  const chars = [...String(text || '')];
  return chars.length > max ? `${chars.slice(0, max - 1).join('')}…` : chars.join('');
}

const length = (text) => [...String(text || '')].length;

module.exports = { sleep, parseJson, retryable, permanent, statusError, poll, clip, length, RELOGIN };
