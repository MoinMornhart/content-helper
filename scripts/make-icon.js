'use strict';

/**
 * Erzeugt die App-Symbole ohne Bildbearbeitungsprogramm und ohne Zusatzpakete.
 *
 * Gezeichnet wird direkt in einen RGBA-Puffer und anschliessend als PNG
 * geschrieben (eigener Minimal-Encoder auf Basis von zlib). So bleibt das
 * Repository frei von Binaer-Abhaengigkeiten und das Symbol laesst sich jederzeit
 * mit `node scripts/make-icon.js` neu erzeugen.
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// ------------------------------------------------------------------ PNG-Encoder

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}

function encodePng(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (width * 4 + 1)] = 0; // Filter: none
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // Bittiefe
  ihdr[9] = 6; // Farbtyp RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ------------------------------------------------------------------ Zeichnen

/** Weicher Deckungsgrad an Kanten: 1 innen, 0 aussen, dazwischen linear. */
function coverage(distance, feather = 1.2) {
  return Math.min(1, Math.max(0, 0.5 - distance / feather));
}

function roundedRectDistance(x, y, size, radius, inset) {
  const half = size / 2 - inset;
  const dx = Math.abs(x - size / 2) - (half - radius);
  const dy = Math.abs(y - size / 2) - (half - radius);
  const ax = Math.max(dx, 0);
  const ay = Math.max(dy, 0);
  return Math.sqrt(ax * ax + ay * ay) + Math.min(Math.max(dx, dy), 0) - radius;
}

function blend(target, index, r, g, b, alpha) {
  const inv = 1 - alpha;
  target[index] = Math.round(r * alpha + target[index] * inv);
  target[index + 1] = Math.round(g * alpha + target[index + 1] * inv);
  target[index + 2] = Math.round(b * alpha + target[index + 2] * inv);
  target[index + 3] = Math.round(255 * alpha + target[index + 3] * inv);
}

/**
 * Symbol: abgerundetes Quadrat mit Verlauf von Violett nach Pink,
 * darin ein weisses Wiedergabe-Dreieck mit Funken-Punkt.
 */
function drawIcon(size, { transparentBackground = false } = {}) {
  const rgba = Buffer.alloc(size * size * 4, 0);
  const radius = size * 0.23;
  const inset = size * 0.04;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const i = (y * size + x) * 4;
      const t = (x / size) * 0.55 + (y / size) * 0.45;
      const r = Math.round(124 + t * 112); // #7c3aed -> #ec4899
      const g = Math.round(58 + t * 14);
      const b = Math.round(237 - t * 84);
      const alpha = transparentBackground
        ? coverage(roundedRectDistance(x, y, size, radius, inset), size * 0.02)
        : coverage(roundedRectDistance(x, y, size, radius, inset), size * 0.02);
      if (alpha > 0) blend(rgba, i, r, g, b, alpha);
    }
  }

  // Wiedergabe-Dreieck
  const cx = size * 0.44;
  const cy = size * 0.5;
  const tri = size * 0.19;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const dx = x - cx;
      const dy = y - cy;
      const inside = dx > -tri && dx < tri * 1.15 && Math.abs(dy) < (tri * 1.15 - dx) * 0.62;
      if (!inside) continue;
      blend(rgba, (y * size + x) * 4, 255, 255, 255, 0.97);
    }
  }

  // Funken-Punkt oben rechts
  const px = size * 0.72;
  const py = size * 0.31;
  const pr = size * 0.075;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const d = Math.hypot(x - px, y - py) - pr;
      const alpha = coverage(d, size * 0.02);
      if (alpha > 0) blend(rgba, (y * size + x) * 4, 255, 255, 255, alpha * 0.95);
    }
  }

  return rgba;
}

// ------------------------------------------------------------------ ICO-Datei

/**
 * Packt mehrere PNG-Groessen in eine Windows-Symboldatei.
 *
 * Seit Windows Vista duerfen die einzelnen Bilder einer .ico-Datei als PNG
 * abgelegt werden – damit reicht der vorhandene Encoder und es braucht kein
 * weiteres Werkzeug. Genau daran scheiterte bisher der Bau: das von
 * electron-builder nachgeladene Umwandlungsprogramm konnte auf diesem Rechner
 * keinen WebAssembly-Speicher belegen. Eine fertig mitgelieferte .ico umgeht
 * diesen Schritt vollstaendig.
 */
function encodeIco(sizes) {
  const images = sizes.map((size) => ({ size, data: encodePng(size, size, drawIcon(size)) }));

  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);              // reserviert
  header.writeUInt16LE(1, 2);              // Typ 1 = Symbol
  header.writeUInt16LE(images.length, 4);  // Anzahl der Bilder

  const directory = Buffer.alloc(16 * images.length);
  let offset = header.length + directory.length;

  images.forEach((image, index) => {
    const at = index * 16;
    directory[at] = image.size >= 256 ? 0 : image.size;      // 0 bedeutet 256
    directory[at + 1] = image.size >= 256 ? 0 : image.size;
    directory[at + 2] = 0;                                    // Farbanzahl
    directory[at + 3] = 0;                                    // reserviert
    directory.writeUInt16LE(1, at + 4);                       // Ebenen
    directory.writeUInt16LE(32, at + 6);                      // Bit je Bildpunkt
    directory.writeUInt32LE(image.data.length, at + 8);
    directory.writeUInt32LE(offset, at + 12);
    offset += image.data.length;
  });

  return Buffer.concat([header, directory, ...images.map((image) => image.data)]);
}

// ------------------------------------------------------------------ Ausgabe

const targets = [
  { file: path.join(__dirname, '..', 'build', 'icon.png'), size: 512 },
  { file: path.join(__dirname, '..', 'src', 'renderer', 'assets', 'icon.png'), size: 256 },
  { file: path.join(__dirname, '..', 'src', 'renderer', 'assets', 'tray.png'), size: 32 },
  { file: path.join(__dirname, '..', 'src', 'mobile', 'icon-192.png'), size: 192 },
  { file: path.join(__dirname, '..', 'src', 'mobile', 'icon-512.png'), size: 512 },
];

for (const target of targets) {
  fs.mkdirSync(path.dirname(target.file), { recursive: true });
  fs.writeFileSync(target.file, encodePng(target.size, target.size, drawIcon(target.size)));
  process.stdout.write(`geschrieben: ${path.relative(process.cwd(), target.file)} (${target.size}px)\n`);
}

// Windows-Symboldatei mit allen üblichen Größen.
const icoPath = path.join(__dirname, '..', 'build', 'icon.ico');
fs.writeFileSync(icoPath, encodeIco([16, 24, 32, 48, 64, 128, 256]));
process.stdout.write(`geschrieben: ${path.relative(process.cwd(), icoPath)} (7 Größen)\n`);
