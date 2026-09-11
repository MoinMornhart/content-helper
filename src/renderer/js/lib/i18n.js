/**
 * Sprache der Oberfläche: Deutsch oder Englisch.
 *
 * Der deutsche Text bleibt im Code stehen und ist zugleich der Schlüssel –
 * `t('Gespeichert.')` liefert auf Englisch „Saved.“. Fehlt eine Übersetzung,
 * erscheint der deutsche Text; kaputt geht dabei nichts.
 *
 * Werte werden mit geschweiften Klammern eingesetzt:
 *     t('Eingeplant für {when}.', { when: fmt.dateTime(date) })
 *
 * Texte, die schon beim Laden eines Moduls feststehen (Menüpunkte, Titel der
 * Ansichten), werden mit `mark()` gekennzeichnet und erst beim Anzeigen mit
 * `t()` übersetzt – die Sprache steht erst nach dem Start fest.
 *
 * Die Wörterbücher liegen unter src/shared/i18n/en/*.json.
 */

const dictionary = window.ch?.catalog?.i18n?.en || {};
let current = 'de';

/** „auto“ folgt der Sprache von Windows: Deutsch bleibt Deutsch, alles andere wird Englisch. */
export function resolveLanguage(setting) {
  if (setting === 'de' || setting === 'en') return setting;
  return String(navigator.language || 'de').toLowerCase().startsWith('de') ? 'de' : 'en';
}

export function setLanguage(setting) {
  current = resolveLanguage(setting);
  document.documentElement.lang = current;
  return current;
}

export const language = () => current;

/** Für Zahlen und Datumsangaben. */
export const locale = () => (current === 'en' ? 'en-US' : 'de-DE');

/** Kennzeichnet einen Text als übersetzbar, ohne ihn schon zu übersetzen. */
export const mark = (text) => text;

/**
 * @param {string} text deutscher Text, zugleich Schlüssel
 * @param {Record<string, unknown>} [params] Werte für {platzhalter}
 */
export function t(text, params) {
  let out = current === 'en' ? (dictionary[text] ?? text) : text;
  if (params) out = out.replace(/\{(\w+)\}/g, (match, key) => (key in params ? String(params[key]) : match));
  return out;
}
