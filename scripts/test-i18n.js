'use strict';

/**
 * Prüft die Übersetzung ins Englische.
 *
 * - Jeder Text in t('…') und mark('…') muss im Wörterbuch stehen
 *   (src/shared/i18n/en/*.json).
 * - Platzhalter wie {when} müssen in beiden Sprachen dieselben sein.
 * - In t() darf keine Vorlage mit ${…} stehen – der Schlüssel muss feststehen.
 *
 * Zusätzlich listet es verdächtige Stellen: Zeichenketten, die deutsch
 * aussehen, aber nicht übersetzt werden. Das ist eine Schätzung; Zeilen mit
 * „i18n-ignore“ (etwa Wortlisten für die Textprüfung) werden übersprungen.
 *
 *     node scripts/test-i18n.js                    Fehlendes prüfen
 *     node scripts/test-i18n.js --verbose          dazu verdächtige Stellen zeigen
 *     node scripts/test-i18n.js --only composer    nur Dateien, deren Pfad das enthält
 *     node scripts/test-i18n.js --strict           verdächtige Stellen zählen als Fehler
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DICT_DIR = path.join(ROOT, 'src', 'shared', 'i18n', 'en');
const SOURCES = ['src/renderer/js', 'src/main', 'src/mobile'];

const args = process.argv.slice(2);
const verbose = args.includes('--verbose');
const strict = args.includes('--strict');
const onlyIndex = args.indexOf('--only');
const only = onlyIndex >= 0 ? args[onlyIndex + 1] : null;

// ---------------------------------------------------------------- Wörterbuch

const dictionary = {};
const origin = {};
const problems = [];
const warnings = [];

for (const file of fs.readdirSync(DICT_DIR).filter((name) => name.endsWith('.json')).sort()) {
  let data;
  try {
    data = JSON.parse(fs.readFileSync(path.join(DICT_DIR, file), 'utf8'));
  } catch (error) {
    problems.push(`Wörterbuch ${file} ist kein gültiges JSON: ${error.message}`);
    continue;
  }
  for (const [key, value] of Object.entries(data)) {
    if (typeof value !== 'string' || !value.trim()) problems.push(`${file}: leere Übersetzung für „${key}“`);
    if (key in dictionary && dictionary[key] !== value) warnings.push(`„${key}“ steht in ${origin[key]} und ${file} unterschiedlich übersetzt`);
    dictionary[key] = value;
    origin[key] = file;
  }
}

const placeholders = (text) => [...String(text).matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort().join(',');
for (const [key, value] of Object.entries(dictionary)) {
  if (placeholders(key) !== placeholders(value)) problems.push(`Platzhalter passen nicht: „${key}“ → „${value}“`);
}

// ---------------------------------------------------------------- Quelltext

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

const files = SOURCES.flatMap((dir) => walk(path.join(ROOT, dir)))
  .filter((file) => !only || file.replace(/\\/g, '/').includes(only));

const CALL = /\b(t|mark)\(\s*(['"`])((?:\\.|(?!\2)[^\\])*?)\2/g;
const LITERAL = /(['"`])((?:\\.|(?!\1)[^\\\n])*)\1/g;
const GERMAN = /[äöüßÄÖÜ]|\b(und|oder|nicht|mit|für|bitte|kein|keine|noch|wird|werden|ist|sind|den|dem|ein|eine|einen|zum|zur|vom|beim|aus|nach|über|Beitrag|Beiträge|Kanal|Kanäle|jetzt|hier|dein|deine|Termin)\b/;

const unescape = (text) => text.replace(/\\(['"`\\])/g, '$1').replace(/\\n/g, '\n');

let used = 0;
const suspicious = new Map();

for (const file of files) {
  const source = fs.readFileSync(file, 'utf8');
  const relative = path.relative(ROOT, file).replace(/\\/g, '/');
  // Beispiele in Kommentaren sind keine echten Aufrufe.
  const code = source
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ' '))
    .replace(/^\s*\/\/.*$/gm, '');

  for (const match of code.matchAll(CALL)) {
    const key = unescape(match[3]);
    used += 1;
    if (match[2] === '`' && key.includes('${')) {
      problems.push(`${relative}: ${match[1]}() mit eingesetzter Vorlage – bitte {platzhalter} verwenden: ${key.slice(0, 60)}`);
      continue;
    }
    if (!(key in dictionary)) problems.push(`${relative}: keine Übersetzung für „${key}“`);
  }

  const lines = source.split('\n');
  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('*') || trimmed.startsWith('//') || trimmed.startsWith('/*')) return;
    if (line.includes('i18n-ignore') || /\b(require|import)\b/.test(line) || /console\.\w+\(/.test(line)) return;
    for (const match of line.matchAll(LITERAL)) {
      const text = match[2];
      if (text.length < 3 || !GERMAN.test(text)) continue;
      if (!/\s/.test(text) && !/[äöüßÄÖÜ]/.test(text)) continue;
      const before = line.slice(0, match.index);
      if (/\b(t|mark)\(\s*$/.test(before)) continue;
      if (!suspicious.has(relative)) suspicious.set(relative, []);
      suspicious.get(relative).push(`${index + 1}: ${text.slice(0, 90)}`);
    }
  });
}

// ---------------------------------------------------------------- Ausgabe

const suspiciousCount = [...suspicious.values()].reduce((sum, list) => sum + list.length, 0);

if (warnings.length) {
  process.stdout.write(`Hinweise (${warnings.length}):\n${warnings.slice(0, 20).map((line) => `  – ${line}`).join('\n')}\n`);
}
if (suspiciousCount && (verbose || strict)) {
  process.stdout.write(`\nVerdächtig, weil deutsch und nicht übersetzt (${suspiciousCount}):\n`);
  for (const [file, list] of suspicious) {
    process.stdout.write(`  ${file}\n${list.map((line) => `    ${line}`).join('\n')}\n`);
  }
} else if (suspiciousCount) {
  process.stdout.write(`${suspiciousCount} verdächtige Stellen in ${suspicious.size} Dateien (mit --verbose anzeigen).\n`);
}

if (problems.length || (strict && suspiciousCount)) {
  process.stdout.write(`\nFEHLGESCHLAGEN – ${problems.length} Fehler${strict ? `, ${suspiciousCount} verdächtige Stellen` : ''}:\n`);
  process.stdout.write(problems.slice(0, 80).map((line) => `  ✕ ${line}`).join('\n'));
  process.stdout.write('\n');
  process.exit(1);
}
process.stdout.write(`\nAlle Übersetzungen vorhanden (${used} Aufrufe, ${Object.keys(dictionary).length} Einträge im Wörterbuch).\n`);
