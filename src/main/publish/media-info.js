'use strict';

/**
 * Liest Eckdaten eines Videos, ohne es zu dekodieren: Dauer, Bildgröße.
 *
 * Reicht für MP4 und MOV – die Formate, die alle Plattformen annehmen. Die
 * Plattformen haben harte Grenzen (Facebook-Reels bis 90 Sekunden, TikTok je
 * nach Konto); die App soll das vorher sagen, statt einen Upload von einem
 * Gigabyte anzufangen, der am Ende abgelehnt wird.
 *
 * Aufbau einer MP4-Datei: eine Folge von Kästen [Größe][Typ][Inhalt]. Die Dauer
 * steht in moov → mvhd, die Bildgröße in moov → trak → tkhd. „moov“ liegt je
 * nach Programm am Anfang oder am Ende – deshalb wird gesprungen, nicht gelesen.
 */

const fs = require('fs');

function readAt(fd, position, length) {
  const buffer = Buffer.alloc(length);
  const read = fs.readSync(fd, buffer, 0, length, position);
  return buffer.subarray(0, read);
}

/** Findet einen Kasten zwischen start und end; liefert Beginn und Größe seines Inhalts. */
function findBox(fd, start, end, type) {
  let position = start;
  while (position + 8 <= end) {
    const head = readAt(fd, position, 16);
    if (head.length < 8) return null;
    let size = head.readUInt32BE(0);
    const name = head.toString('latin1', 4, 8);
    let header = 8;
    if (size === 1) {
      size = Number(head.readBigUInt64BE(8));
      header = 16;
    } else if (size === 0) {
      size = end - position;
    }
    if (size < header) return null;
    if (name === type) return { start: position + header, end: position + size };
    position += size;
  }
  return null;
}

/**
 * @param {string} filePath
 * @returns {{durationSec: number|null, width: number|null, height: number|null}}
 */
function probe(filePath) {
  const info = { durationSec: null, width: null, height: null };
  let fd;
  try {
    fd = fs.openSync(filePath, 'r');
    const size = fs.fstatSync(fd).size;
    const moov = findBox(fd, 0, size, 'moov');
    if (!moov) return info;

    const mvhd = findBox(fd, moov.start, moov.end, 'mvhd');
    if (mvhd) {
      const body = readAt(fd, mvhd.start, 32);
      const version = body[0];
      const timescale = version === 1 ? body.readUInt32BE(20) : body.readUInt32BE(12);
      const duration = version === 1 ? Number(body.readBigUInt64BE(24)) : body.readUInt32BE(16);
      if (timescale) info.durationSec = Math.round((duration / timescale) * 10) / 10;
    }

    // Die erste Spur mit einer Bildgröße ist die Videospur.
    let position = moov.start;
    while (position < moov.end) {
      const trak = findBox(fd, position, moov.end, 'trak');
      if (!trak) break;
      const tkhd = findBox(fd, trak.start, trak.end, 'tkhd');
      if (tkhd) {
        const body = readAt(fd, tkhd.start, 96);
        const offset = body[0] === 1 ? 88 : 76;
        if (body.length >= offset + 8) {
          const width = body.readUInt32BE(offset) / 65536;
          const height = body.readUInt32BE(offset + 4) / 65536;
          if (width && height) {
            info.width = Math.round(width);
            info.height = Math.round(height);
            break;
          }
        }
      }
      position = trak.end;
    }
  } catch {
    /* kein MP4 oder nicht lesbar – dann eben ohne Eckdaten */
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
  return info;
}

const MIME = { mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', mkv: 'video/x-matroska', avi: 'video/x-msvideo', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
const mimeOf = (ext) => MIME[String(ext || '').toLowerCase()] || 'application/octet-stream';

module.exports = { probe, mimeOf };
