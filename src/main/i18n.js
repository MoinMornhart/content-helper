'use strict';

/**
 * Sprache im Hauptprozess: Menü, Infobereich, Benachrichtigungen und
 * Fehlermeldungen, die in der Oberfläche landen.
 *
 * Gleiches Prinzip wie in der Oberfläche (src/renderer/js/lib/i18n.js): Der
 * deutsche Text ist der Schlüssel, die englischen Fassungen stehen in
 * src/shared/i18n/en/*.json. Ohne init() – etwa in den Prüfskripten – bleibt
 * alles deutsch.
 */

const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'shared', 'i18n', 'en');

let dictionary = null;
let getSetting = () => 'de';

/** Alle Wörterbuchdateien zu einem zusammenführen. */
function loadDictionary() {
  if (dictionary) return dictionary;
  dictionary = {};
  let files = [];
  try {
    files = fs.readdirSync(DIR).filter((file) => file.endsWith('.json')).sort();
  } catch {
    return dictionary;
  }
  for (const file of files) {
    try {
      Object.assign(dictionary, JSON.parse(fs.readFileSync(path.join(DIR, file), 'utf8')));
    } catch { /* eine kaputte Datei darf die App nicht aufhalten */ }
  }
  return dictionary;
}

/** @param {() => string} getter liefert die Einstellung: auto | de | en */
function init(getter) {
  getSetting = getter;
}

function language() {
  const setting = getSetting();
  if (setting === 'de' || setting === 'en') return setting;
  try {
    const { app } = require('electron');
    return String(app.getLocale() || 'de').toLowerCase().startsWith('de') ? 'de' : 'en';
  } catch {
    return 'de';
  }
}

const locale = () => (language() === 'en' ? 'en-US' : 'de-DE');

const mark = (text) => text;

function t(text, params) {
  let out = language() === 'en' ? (loadDictionary()[text] ?? text) : text;
  if (params) out = out.replace(/\{(\w+)\}/g, (match, key) => (key in params ? String(params[key]) : match));
  return out;
}

module.exports = { init, t, mark, language, locale, loadDictionary };
