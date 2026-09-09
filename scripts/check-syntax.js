'use strict';

/**
 * Syntaxpruefung aller Module der Oberflaeche.
 *
 * Die Oberflaeche laedt Ansichten erst beim Aufruf. Ein Tippfehler in einer
 * selten geoeffneten Ansicht faellt dadurch spaet auf. Diese Pruefung liest
 * jede Datei einmal ein, bevor die App ueberhaupt startet.
 *
 * Node parst .js standardmaessig als CommonJS – deshalb wird jede Datei als
 * .mjs kopiert und mit `node --check` geprueft.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOTS = [
  path.join(__dirname, '..', 'src', 'renderer', 'js'),
  path.join(__dirname, '..', 'src', 'main'),
];

function collect(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) collect(full, out);
    else if (entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ch-syntax-'));
const problems = [];
let checked = 0;

for (const root of ROOTS) {
  if (!fs.existsSync(root)) continue;
  const isRenderer = root.includes('renderer');

  for (const file of collect(root)) {
    // Der Hauptprozess ist CommonJS, die Oberflaeche nutzt Module.
    const target = path.join(tmp, `check.${isRenderer ? 'mjs' : 'cjs'}`);
    fs.writeFileSync(target, fs.readFileSync(file));
    checked += 1;
    try {
      execFileSync(process.execPath, ['--check', target], { stdio: 'pipe' });
    } catch (error) {
      const message = String(error.stderr || error.message)
        .split('\n')
        .filter((line) => line.includes('Error') || line.trim().startsWith('^') || /^\s{4}at checkSyntax/.test(line) === false)
        .slice(0, 4)
        .join('\n');
      problems.push(`${path.relative(process.cwd(), file)}\n${message}`);
    }
  }
}

fs.rmSync(tmp, { recursive: true, force: true });

if (problems.length) {
  process.stdout.write(`Syntaxfehler in ${problems.length} von ${checked} Dateien:\n\n`);
  for (const problem of problems) process.stdout.write(`${problem}\n\n`);
  process.exit(1);
}

process.stdout.write(`Syntax in Ordnung (${checked} Dateien geprüft).\n`);
