/**
 * QR-Code-Erzeugung, vollständig offline.
 *
 * Deckt Byte-Modus mit Fehlerkorrekturstufe M in den Versionen 1 bis 9 ab –
 * das reicht für bis zu 180 Zeichen und damit für jede Adresse im Heimnetz.
 * Bewusst selbst geschrieben: eine Bibliothek von einem fremden Server zu laden
 * würde dem Grundsatz widersprechen, dass die App ohne Netz auskommt.
 *
 * Ablauf nach ISO/IEC 18004: Daten kodieren, Reed-Solomon-Fehlerkorrektur
 * anhängen, Blöcke verschränken, Muster setzen, acht Masken bewerten und die
 * mit der geringsten Strafpunktzahl wählen.
 */

import { t } from './i18n.js';

// ------------------------------------------------------------------ Tabellen

/** Je Version (1–9) bei Stufe M: Gesamt-Codewörter, EC je Block, Blockgrößen. */
const VERSIONS = {
  1: { total: 26,  ecPerBlock: 10, blocks: [16] },
  2: { total: 44,  ecPerBlock: 16, blocks: [28] },
  3: { total: 70,  ecPerBlock: 26, blocks: [44] },
  4: { total: 100, ecPerBlock: 18, blocks: [32, 32] },
  5: { total: 134, ecPerBlock: 24, blocks: [43, 43] },
  6: { total: 172, ecPerBlock: 16, blocks: [27, 27, 27, 27] },
  7: { total: 196, ecPerBlock: 18, blocks: [31, 31, 31, 31] },
  8: { total: 242, ecPerBlock: 22, blocks: [38, 38, 39, 39] },
  9: { total: 292, ecPerBlock: 22, blocks: [36, 36, 36, 37, 37] },
};

/** Mittelpunkte der Ausrichtungsmuster je Version. */
const ALIGNMENT = {
  1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30],
  6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46],
};

// ------------------------------------------------------------------ Galois-Feld

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
(() => {
  let value = 1;
  for (let i = 0; i < 255; i += 1) {
    EXP[i] = value;
    LOG[value] = i;
    value <<= 1;
    if (value & 0x100) value ^= 0x11d; // primitives Polynom
  }
  for (let i = 255; i < 512; i += 1) EXP[i] = EXP[i - 255];
})();

const mul = (a, b) => (a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]]);

/** Generatorpolynom für n Fehlerkorrektur-Codewörter. */
function generator(n) {
  let poly = [1];
  for (let i = 0; i < n; i += 1) {
    const next = new Array(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j += 1) {
      next[j] ^= poly[j];
      next[j + 1] ^= mul(poly[j], EXP[i]);
    }
    poly = next;
  }
  return poly;
}

/** Reed-Solomon-Rest eines Datenblocks. */
function ecCodewords(data, count) {
  const gen = generator(count);
  const result = new Array(count).fill(0);
  for (const byte of data) {
    const factor = byte ^ result[0];
    result.shift();
    result.push(0);
    if (factor !== 0) {
      for (let i = 0; i < gen.length - 1; i += 1) {
        result[i] ^= mul(gen[i + 1], factor);
      }
    }
  }
  return result;
}

// ------------------------------------------------------------------ Bitfolge

class Bits {
  constructor() { this.values = []; }
  push(value, length) {
    for (let i = length - 1; i >= 0; i -= 1) this.values.push((value >> i) & 1);
  }
  get length() { return this.values.length; }
  toBytes() {
    const bytes = [];
    for (let i = 0; i < this.values.length; i += 8) {
      let byte = 0;
      for (let j = 0; j < 8; j += 1) byte = (byte << 1) | (this.values[i + j] || 0);
      bytes.push(byte);
    }
    return bytes;
  }
}

/** Kleinste Version, in die der Text passt. */
function chooseVersion(byteLength) {
  for (let version = 1; version <= 9; version += 1) {
    const capacityBits = VERSIONS[version].blocks.reduce((sum, size) => sum + size, 0) * 8;
    if (4 + 8 + byteLength * 8 <= capacityBits) return version;
  }
  throw new Error(t('Der Inhalt ist zu lang für einen QR-Code dieser Größe.'));
}

// ------------------------------------------------------------------ Raster

function emptyMatrix(size) {
  return Array.from({ length: size }, () => new Array(size).fill(null));
}

function placeFinder(matrix, row, col) {
  for (let r = -1; r <= 7; r += 1) {
    for (let c = -1; c <= 7; c += 1) {
      const y = row + r;
      const x = col + c;
      if (y < 0 || x < 0 || y >= matrix.length || x >= matrix.length) continue;
      const border = r === -1 || r === 7 || c === -1 || c === 7;
      const ring = (r === 0 || r === 6) && c >= 0 && c <= 6;
      const side = (c === 0 || c === 6) && r >= 0 && r <= 6;
      const core = r >= 2 && r <= 4 && c >= 2 && c <= 4;
      matrix[y][x] = border ? 0 : ring || side || core ? 1 : 0;
    }
  }
}

function placePatterns(matrix, version) {
  const size = matrix.length;

  placeFinder(matrix, 0, 0);
  placeFinder(matrix, 0, size - 7);
  placeFinder(matrix, size - 7, 0);

  // Taktmuster
  for (let i = 8; i < size - 8; i += 1) {
    const bit = i % 2 === 0 ? 1 : 0;
    matrix[6][i] = bit;
    matrix[i][6] = bit;
  }

  // Ausrichtungsmuster
  const centers = ALIGNMENT[version];
  for (const row of centers) {
    for (const col of centers) {
      const nearFinder =
        (row <= 8 && col <= 8) ||
        (row <= 8 && col >= size - 9) ||
        (row >= size - 9 && col <= 8);
      if (nearFinder) continue;
      for (let r = -2; r <= 2; r += 1) {
        for (let c = -2; c <= 2; c += 1) {
          matrix[row + r][col + c] = Math.max(Math.abs(r), Math.abs(c)) !== 1 ? 1 : 0;
        }
      }
    }
  }

  matrix[size - 8][8] = 1; // dunkles Modul

  // Plätze für die Formatinformation freihalten
  for (let i = 0; i < 9; i += 1) {
    if (matrix[8][i] === null) matrix[8][i] = 0;
    if (matrix[i][8] === null) matrix[i][8] = 0;
  }
  for (let i = 0; i < 8; i += 1) {
    if (matrix[8][size - 1 - i] === null) matrix[8][size - 1 - i] = 0;
    if (matrix[size - 1 - i][8] === null) matrix[size - 1 - i][8] = 0;
  }

  // Versionsinformation ab Version 7
  if (version >= 7) {
    const bits = versionBits(version);
    for (let i = 0; i < 18; i += 1) {
      const bit = (bits >> i) & 1;
      const row = Math.floor(i / 3);
      const col = i % 3;
      matrix[size - 11 + col][row] = bit;
      matrix[row][size - 11 + col] = bit;
    }
  }
}

/** 18-Bit-Versionsinformation mit BCH-Prüfteil. */
function versionBits(version) {
  let value = version << 12;
  let rest = value;
  for (let i = 17; i >= 12; i -= 1) {
    if ((rest >> i) & 1) rest ^= 0x1f25 << (i - 12);
  }
  return value | rest;
}

/** 15-Bit-Formatinformation für Stufe M und die gewählte Maske. */
function formatBits(mask) {
  const data = (0b00 << 3) | mask; // Stufe M entspricht 00
  let rest = data << 10;
  for (let i = 14; i >= 10; i -= 1) {
    if ((rest >> i) & 1) rest ^= 0x537 << (i - 10);
  }
  return ((data << 10) | rest) ^ 0x5412;
}

function placeFormat(matrix, mask) {
  const size = matrix.length;
  const bits = formatBits(mask);
  for (let i = 0; i < 15; i += 1) {
    const bit = (bits >> i) & 1;
    // erste Kopie
    if (i < 6) matrix[8][i] = bit;
    else if (i === 6) matrix[8][7] = bit;
    else if (i === 7) matrix[8][8] = bit;
    else if (i === 8) matrix[7][8] = bit;
    else matrix[14 - i][8] = bit;
    // Zweite Kopie: sieben Module in der letzten Spalte von unten nach oben,
    // dann acht in der achten Zeile. Das Modul bei (size-8, 8) bleibt frei –
    // dort steht das vorgeschriebene dunkle Modul.
    if (i < 7) matrix[size - 1 - i][8] = bit;
    else matrix[8][size - 15 + i] = bit;
  }
}

const MASKS = [
  (r, c) => (r + c) % 2 === 0,
  (r) => r % 2 === 0,
  (r, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
  (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
];

/** Strafpunkte nach den vier Regeln der Norm – je weniger, desto lesbarer. */
function penalty(matrix) {
  const size = matrix.length;
  let score = 0;

  // Regel 1: gleichfarbige Reihen
  for (let i = 0; i < size; i += 1) {
    for (const line of [matrix[i], matrix.map((row) => row[i])]) {
      let run = 1;
      for (let j = 1; j < size; j += 1) {
        if (line[j] === line[j - 1]) run += 1;
        else {
          if (run >= 5) score += run - 2;
          run = 1;
        }
      }
      if (run >= 5) score += run - 2;
    }
  }

  // Regel 2: gleichfarbige Blöcke
  for (let r = 0; r < size - 1; r += 1) {
    for (let c = 0; c < size - 1; c += 1) {
      const value = matrix[r][c];
      if (value === matrix[r][c + 1] && value === matrix[r + 1][c] && value === matrix[r + 1][c + 1]) score += 3;
    }
  }

  // Regel 3: Muster, die dem Suchmuster ähneln
  const pattern = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0];
  const reversed = [...pattern].reverse();
  for (let i = 0; i < size; i += 1) {
    for (let j = 0; j <= size - 11; j += 1) {
      const row = matrix[i].slice(j, j + 11);
      const col = matrix.slice(j, j + 11).map((line) => line[i]);
      for (const candidate of [row, col]) {
        if (candidate.every((bit, index) => bit === pattern[index])) score += 40;
        else if (candidate.every((bit, index) => bit === reversed[index])) score += 40;
      }
    }
  }

  // Regel 4: Verhältnis dunkler Module
  const dark = matrix.flat().filter((bit) => bit === 1).length;
  const ratio = (dark * 100) / (size * size);
  score += Math.floor(Math.abs(ratio - 50) / 5) * 10;

  return score;
}

// ------------------------------------------------------------------ Aufbau

/**
 * Erzeugt die Modul-Matrix für einen Text.
 * @param {string} text
 * @returns {number[][]} Raster aus 0 und 1
 */
export function matrixFor(text) {
  const bytes = [...new TextEncoder().encode(text)];
  const version = chooseVersion(bytes.length);
  const spec = VERSIONS[version];
  const dataCapacity = spec.blocks.reduce((sum, size) => sum + size, 0);

  // Datenbits: Modus 0100, Länge, Nutzdaten, Abschluss, Auffüllen
  const bits = new Bits();
  bits.push(0b0100, 4);
  bits.push(bytes.length, 8);
  for (const byte of bytes) bits.push(byte, 8);
  bits.push(0, Math.min(4, dataCapacity * 8 - bits.length));
  while (bits.length % 8) bits.push(0, 1);

  const dataBytes = bits.toBytes();
  const padding = [0xec, 0x11];
  let index = 0;
  while (dataBytes.length < dataCapacity) {
    dataBytes.push(padding[index % 2]);
    index += 1;
  }

  // In Blöcke teilen und Fehlerkorrektur berechnen
  const dataBlocks = [];
  const ecBlocks = [];
  let offset = 0;
  for (const size of spec.blocks) {
    const block = dataBytes.slice(offset, offset + size);
    offset += size;
    dataBlocks.push(block);
    ecBlocks.push(ecCodewords(block, spec.ecPerBlock));
  }

  // Blöcke verschränken
  const interleaved = [];
  const maxData = Math.max(...spec.blocks);
  for (let i = 0; i < maxData; i += 1) {
    for (const block of dataBlocks) if (i < block.length) interleaved.push(block[i]);
  }
  for (let i = 0; i < spec.ecPerBlock; i += 1) {
    for (const block of ecBlocks) interleaved.push(block[i]);
  }

  const size = version * 4 + 17;
  const base = emptyMatrix(size);
  placePatterns(base, version);

  // Datenbits im Zickzack von rechts unten nach oben setzen
  const stream = [];
  for (const byte of interleaved) {
    for (let i = 7; i >= 0; i -= 1) stream.push((byte >> i) & 1);
  }

  const candidates = MASKS.map((maskFn, maskIndex) => {
    const matrix = base.map((row) => [...row]);
    let bitIndex = 0;
    let upward = true;

    for (let col = size - 1; col > 0; col -= 2) {
      if (col === 6) col -= 1; // Spalte des Taktmusters überspringen
      for (let step = 0; step < size; step += 1) {
        const row = upward ? size - 1 - step : step;
        for (const c of [col, col - 1]) {
          if (matrix[row][c] !== null) continue;
          const bit = stream[bitIndex] ?? 0;
          bitIndex += 1;
          matrix[row][c] = maskFn(row, c) ? bit ^ 1 : bit;
        }
      }
      upward = !upward;
    }

    placeFormat(matrix, maskIndex);
    return { matrix, score: penalty(matrix) };
  });

  return candidates.sort((a, b) => a.score - b.score)[0].matrix;
}

/**
 * Zeichnet den QR-Code als SVG-Element.
 * @param {string} text
 * @param {{size?: number, quiet?: number, dark?: string, light?: string}} options
 */
export function svg(text, { size = 220, quiet = 3, dark = '#0b0912', light = '#ffffff' } = {}) {
  const matrix = matrixFor(text);
  const modules = matrix.length + quiet * 2;
  const NS = 'http://www.w3.org/2000/svg';

  const node = document.createElementNS(NS, 'svg');
  node.setAttribute('viewBox', `0 0 ${modules} ${modules}`);
  node.setAttribute('width', size);
  node.setAttribute('height', size);
  node.setAttribute('role', 'img');
  node.setAttribute('aria-label', t('QR-Code zum Verbinden'));
  node.style.borderRadius = '10px';
  node.style.display = 'block';

  const background = document.createElementNS(NS, 'rect');
  background.setAttribute('width', modules);
  background.setAttribute('height', modules);
  background.setAttribute('fill', light);
  node.append(background);

  // Alle dunklen Module als ein einziger Pfad – schlank und scharf.
  let path = '';
  for (let row = 0; row < matrix.length; row += 1) {
    for (let col = 0; col < matrix.length; col += 1) {
      if (matrix[row][col] === 1) path += `M${col + quiet} ${row + quiet}h1v1h-1z`;
    }
  }
  const shape = document.createElementNS(NS, 'path');
  shape.setAttribute('d', path);
  shape.setAttribute('fill', dark);
  node.append(shape);

  return node;
}
