/**
 * Diagramme als eingebettetes SVG – ohne Bibliothek.
 *
 * Bewusst reduziert: Linie, Flaeche, Balken, Sparkline. Farben kommen aus den
 * Design-Variablen, damit Hell/Dunkel und Akzentfarbe automatisch passen.
 */

import * as fmt from './format.js';

const NS = 'http://www.w3.org/2000/svg';

function svgEl(tag, attrs = {}) {
  const node = document.createElementNS(NS, tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined) continue;
    node.setAttribute(key, value);
  }
  return node;
}

/** Rundet Achsen auf gut lesbare Werte auf. */
function niceMax(value) {
  if (value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const normalized = value / magnitude;
  const step = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return step * magnitude;
}

/**
 * Liniendiagramm mit gefuellter Flaeche.
 * @param {Array<{label: string, value: number}>} data
 * @param {{height?: number, format?: (n: number) => string, showPoints?: boolean}} options
 */
export function line(data, { height = 200, format = (n) => fmt.num(n, { compact: true }), showPoints = true } = {}) {
  const width = 720;
  const pad = { top: 14, right: 12, bottom: 26, left: 46 };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;

  const svg = svgEl('svg', {
    class: 'chart',
    viewBox: `0 0 ${width} ${height}`,
    preserveAspectRatio: 'none',
    role: 'img',
  });

  if (!data.length) return svg;

  const max = niceMax(Math.max(...data.map((point) => point.value), 0));
  const x = (index) => pad.left + (data.length === 1 ? innerW / 2 : (index / (data.length - 1)) * innerW);
  const y = (value) => pad.top + innerH - (value / max) * innerH;

  // Gitter und Beschriftung der Werteachse
  for (let step = 0; step <= 4; step += 1) {
    const value = (max / 4) * step;
    const py = y(value);
    svg.append(svgEl('line', { class: 'grid-line', x1: pad.left, x2: width - pad.right, y1: py, y2: py }));
    const label = svgEl('text', { x: pad.left - 7, y: py + 3, 'text-anchor': 'end' });
    label.textContent = format(value);
    svg.append(label);
  }

  const points = data.map((point, index) => `${x(index)},${y(point.value)}`);
  svg.append(svgEl('polygon', {
    class: 'series-area',
    points: `${pad.left},${pad.top + innerH} ${points.join(' ')} ${x(data.length - 1)},${pad.top + innerH}`,
  }));
  svg.append(svgEl('polyline', { class: 'series-line', points: points.join(' ') }));

  if (showPoints && data.length <= 45) {
    data.forEach((point, index) => {
      const dot = svgEl('circle', { class: 'point', cx: x(index), cy: y(point.value), r: 2.5 });
      const tooltip = svgEl('title');
      tooltip.textContent = `${point.label}: ${format(point.value)}`;
      dot.append(tooltip);
      svg.append(dot);
    });
  }

  // Beschriftung der Zeitachse: hoechstens sechs Marken
  const stepSize = Math.max(1, Math.ceil(data.length / 6));
  data.forEach((point, index) => {
    if (index % stepSize && index !== data.length - 1) return;
    const label = svgEl('text', { x: x(index), y: height - 8, 'text-anchor': 'middle' });
    label.textContent = point.label;
    svg.append(label);
  });

  return svg;
}

/**
 * Balkendiagramm, waagerecht beschriftet.
 * @param {Array<{label: string, value: number, color?: string}>} data
 */
export function bars(data, { height = 220, format = (n) => fmt.num(n, { compact: true }) } = {}) {
  const width = 720;
  const pad = { top: 14, right: 12, bottom: 30, left: 46 };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;

  const svg = svgEl('svg', { class: 'chart', viewBox: `0 0 ${width} ${height}`, role: 'img' });
  if (!data.length) return svg;

  const max = niceMax(Math.max(...data.map((point) => point.value), 0));
  const slot = innerW / data.length;
  const barWidth = Math.min(52, slot * 0.68);

  for (let step = 0; step <= 4; step += 1) {
    const value = (max / 4) * step;
    const py = pad.top + innerH - (value / max) * innerH;
    svg.append(svgEl('line', { class: 'grid-line', x1: pad.left, x2: width - pad.right, y1: py, y2: py }));
    const label = svgEl('text', { x: pad.left - 7, y: py + 3, 'text-anchor': 'end' });
    label.textContent = format(value);
    svg.append(label);
  }

  data.forEach((point, index) => {
    const barHeight = Math.max(1, (point.value / max) * innerH);
    const bx = pad.left + slot * index + (slot - barWidth) / 2;
    const rect = svgEl('rect', {
      class: 'bar-rect',
      x: bx,
      y: pad.top + innerH - barHeight,
      width: barWidth,
      height: barHeight,
      fill: point.color || undefined,
    });
    const tooltip = svgEl('title');
    tooltip.textContent = `${point.label}: ${format(point.value)}`;
    rect.append(tooltip);
    svg.append(rect);

    const label = svgEl('text', { x: bx + barWidth / 2, y: height - 10, 'text-anchor': 'middle' });
    label.textContent = point.label;
    svg.append(label);
  });

  return svg;
}

/** Kleine Verlaufslinie ohne Achsen, fuer Kennzahlkarten. */
export function sparkline(values, { height = 30 } = {}) {
  const width = 120;
  const svg = svgEl('svg', { class: 'chart sparkline', viewBox: `0 0 ${width} ${height}`, preserveAspectRatio: 'none' });
  if (values.length < 2) return svg;

  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const span = max - min || 1;
  const points = values.map((value, index) => {
    const x = (index / (values.length - 1)) * width;
    const y = height - 2 - ((value - min) / span) * (height - 4);
    return `${x},${y}`;
  });

  svg.append(svgEl('polyline', { class: 'series-line', points: points.join(' '), 'stroke-width': 1.5 }));
  return svg;
}
