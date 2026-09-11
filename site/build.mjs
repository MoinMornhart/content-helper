// Baut die Webseite (GitHub Pages) nach _site/: Seiten aus site/pages/**/*.html
// werden in site/layout.html gesetzt; Banner und Bildschirmfotos kommen aus
// dem Repo dazu, damit nichts doppelt gepflegt wird. Ohne Abhängigkeiten.
//   node site/build.mjs
import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, '_site');
const pagesDir = path.join(root, 'site', 'pages');

// Der Download-Knopf zeigt immer auf die Version, die gerade im Repo steht.
const version = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).version;
const releases = 'https://github.com/MoinMornhart/content-helper/releases';

const NAV = {
  de: { features: 'Funktionen', docs: 'Doku', switch: 'English', footer: 'Content Helper · MIT-Lizenz · läuft auf deinem PC, ohne Tracking' },
  en: { features: 'Features', docs: 'Docs', switch: 'Deutsch', footer: 'Content Helper · MIT license · runs on your PC, no tracking' },
};

const fill = (text, vars) => text.replace(/\{\{([\w.]+)\}\}/g, (match, key) => (key in vars ? vars[key] : match));

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : name.endsWith('.html') ? [full] : [];
  });
}

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const layout = readFileSync(path.join(root, 'site', 'layout.html'), 'utf8');

let count = 0;
for (const file of walk(pagesDir)) {
  const src = readFileSync(file, 'utf8');
  const head = src.match(/^<!--\s*(\{[\s\S]*?\})\s*-->/);
  if (!head) throw new Error(`${path.relative(root, file)}: Kopfzeile fehlt`);
  const meta = JSON.parse(head[1]);
  const depth = meta.path.split('/').length - 1;
  const nav = NAV[meta.lang];
  const vars = {
    lang: meta.lang,
    title: meta.title,
    description: meta.description,
    base: depth ? '../'.repeat(depth) : './',
    home: meta.lang === 'en' ? 'en/' : '',
    alt: meta.alt,
    altLang: meta.lang === 'en' ? 'de' : 'en',
    version,
    download: `${releases}/download/v${version}/Content-Helper-Setup-${version}.exe`,
    portable: `${releases}/download/v${version}/Content-Helper-${version}.exe`,
    releases,
    'nav.features': nav.features,
    'nav.docs': nav.docs,
    'nav.switch': nav.switch,
    'nav.footer': nav.footer,
  };
  // Erst den Seiteninhalt füllen, dann ins Layout – Unbekanntes bleibt stehen.
  const body = fill(src.slice(head[0].length).trim(), vars);
  const html = fill(layout, { ...vars, body });
  const target = path.join(out, meta.path);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, html);
  count++;
}

cpSync(path.join(root, 'site', 'static'), out, { recursive: true });
cpSync(path.join(root, 'docs', 'assets'), path.join(out, 'assets'), { recursive: true });
cpSync(path.join(root, 'docs', 'screenshots'), path.join(out, 'screenshots'), { recursive: true });
writeFileSync(path.join(out, '.nojekyll'), '');
console.log(`Webseite gebaut: ${count} Seiten, Version ${version} → _site/`);
