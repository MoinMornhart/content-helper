/**
 * Medienbibliothek.
 *
 * Verwaltet Verweise auf Dateien, nicht Kopien: die App merkt sich Ort, Name,
 * Größe und Schlagwörter. So bleibt der Datenbestand klein und die Originale
 * liegen dort, wo dein Schnittprogramm sie erwartet.
 */

import { h, card, empty, fill } from '../lib/dom.js';
import * as fmt from '../lib/format.js';
import * as store from '../lib/store.js';
import * as posts from '../lib/posts.js';
import { toast, confirm, prompt } from '../lib/ui.js';

export const title = 'Medien';
export const lead = 'Videos, Bilder und Ton – mit Schlagwörtern statt Ordnerchaos.';

let filterTag = null;
let query = '';

const ICONS = { mp4: '▶', mov: '▶', mkv: '▶', webm: '▶', avi: '▶', png: '▣', jpg: '▣', jpeg: '▣', gif: '▣', webp: '▣', mp3: '♪', wav: '♪', m4a: '♪' };

/** Welche Beiträge verwenden diese Datei? */
const usedBy = (mediaId) => store.all('posts').filter((post) => (post.mediaIds || []).includes(mediaId));

async function importFiles(refresh) {
  const result = await window.ch.media.pick();
  if (!result?.ok) return toast('Auswahl fehlgeschlagen.', 'danger');
  const files = result.data || [];
  if (!files.length) return;

  const known = new Set(store.all('media').map((item) => item.filePath));
  let added = 0;
  for (const file of files) {
    if (known.has(file.filePath)) continue;
    await store.add('media', { ...file, tags: [] });
    added += 1;
  }
  toast(added ? `${fmt.plural(added, 'Datei', 'Dateien')} aufgenommen.` : 'Alles schon in der Bibliothek.', added ? 'ok' : 'info');
  refresh();
}

function mediaCard(item, refresh) {
  const thumb = h('div.media-card__thumb', { text: ICONS[item.ext] || '◆' });

  // Bilder bekommen eine echte Vorschau, sobald sie geladen ist.
  if (['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(item.ext)) {
    window.ch.media.thumbnail(item.filePath).then((result) => {
      if (result?.ok && result.data) fill(thumb, h('img', { src: result.data, alt: item.name }));
    });
  }

  const uses = usedBy(item.id);

  return h('div.media-card', { onClick: () => window.ch.media.open(item.filePath) },
    thumb,
    h('div.media-card__body', null,
      h('div.media-card__name', { title: item.filePath, text: item.name }),
      h('div.text-xs.faint', { text: `${item.ext?.toUpperCase() || '?'} · ${fmt.bytes(item.size)}` }),
      item.tags?.length
        ? h('div.chips.mt-sm', null, ...item.tags.slice(0, 3).map((tag) => h('span.badge', { text: tag })))
        : null,
      uses.length ? h('div.text-xs.mt-sm', { style: { color: 'var(--accent)' }, text: `in ${fmt.plural(uses.length, 'Beitrag', 'Beiträgen')}` }) : null,
      h('div.row.gap-xs.mt-sm', null,
        h('button.btn.btn--sm.btn--ghost', {
          text: 'Schlagwörter',
          onClick: async (event) => {
            event.stopPropagation();
            const value = await prompt({
              title: 'Schlagwörter',
              label: 'Mit Leerzeichen getrennt',
              value: (item.tags || []).join(' '),
            });
            if (value === null) return;
            await store.patch('media', item.id, { tags: value.split(/[\s,]+/).filter(Boolean) });
            refresh();
          },
        }),
        h('button.btn.btn--sm.btn--ghost', {
          text: 'Ordner',
          onClick: (event) => { event.stopPropagation(); window.ch.media.reveal(item.filePath); },
        }),
        h('button.btn.btn--sm.btn--ghost', {
          text: '✕',
          title: 'Aus der Bibliothek entfernen (Datei bleibt erhalten)',
          onClick: async (event) => {
            event.stopPropagation();
            if (!(await confirm({
              title: 'Aus der Bibliothek entfernen?',
              message: 'Die Datei auf der Festplatte bleibt unangetastet – nur der Eintrag hier verschwindet.',
              confirmLabel: 'Entfernen',
            }))) return;
            await store.remove('media', item.id);
            refresh();
          },
        }))));
}

export async function render({ params, setActions, refresh, goto }) {
  if (params.pick) importFiles(refresh);

  const all = store.all('media');
  const tags = [...new Set(all.flatMap((item) => item.tags || []))].sort((a, b) => a.localeCompare(b, 'de'));

  setActions(
    h('button.btn.btn--sm.btn--primary', { text: '＋ Dateien aufnehmen', onClick: () => importFiles(refresh) })
  );

  const searchInput = h('input.input', {
    type: 'search',
    placeholder: 'Nach Name oder Schlagwort suchen …',
    value: query,
    oninput: (event) => { query = event.target.value.toLowerCase(); renderGrid(); },
  });

  const grid = h('div.media-grid');
  const renderGrid = () => {
    const filtered = all.filter((item) => {
      if (filterTag && !(item.tags || []).includes(filterTag)) return false;
      if (!query) return true;
      return `${item.name} ${(item.tags || []).join(' ')}`.toLowerCase().includes(query);
    });
    fill(grid, ...(filtered.length
      ? filtered.map((item) => mediaCard(item, refresh))
      : [h('div.text-sm.muted', { text: 'Nichts gefunden.' })]));
  };
  renderGrid();

  const tagRow = h('div.chips');
  const renderTags = () => {
    fill(tagRow,
      h(`span.chip${filterTag === null ? '.is-active' : ''}`, {
        text: `Alle (${all.length})`,
        onClick: () => { filterTag = null; renderTags(); renderGrid(); },
      }),
      ...tags.map((tag) =>
        h(`span.chip${filterTag === tag ? '.is-active' : ''}`, {
          text: tag,
          onClick: () => { filterTag = filterTag === tag ? null : tag; renderTags(); renderGrid(); },
        })));
  };
  renderTags();

  const totalSize = all.reduce((sum, item) => sum + (item.size || 0), 0);
  const unused = all.filter((item) => !usedBy(item.id).length);

  if (!all.length) {
    return card(null, {},
      empty('Die Bibliothek ist leer',
        'Nimm Videos, Thumbnails und Tonspuren auf. Die App merkt sich nur, wo sie liegen – kopiert wird nichts.',
        h('button.btn.btn--primary.mt', { text: 'Dateien auswählen', onClick: () => importFiles(refresh) })));
  }

  return h('div.col.gap-lg', null,
    h('div.grid.grid-4', null,
      card(null, {}, h('div.stat', null, h('div.stat__label', { text: 'Dateien' }), h('div.stat__value', { text: String(all.length) }))),
      card(null, {}, h('div.stat', null, h('div.stat__label', { text: 'Gesamtgröße' }), h('div.stat__value', { text: fmt.bytes(totalSize) }))),
      card(null, {}, h('div.stat', null, h('div.stat__label', { text: 'Schlagwörter' }), h('div.stat__value', { text: String(tags.length) }))),
      card(null, {}, h('div.stat', null, h('div.stat__label', { text: 'Unverwendet' }), h('div.stat__value', { text: String(unused.length) }), h('div.stat__meta', { text: 'noch keinem Beitrag zugeordnet' })))),

    h('div.row.gap-sm', null, searchInput),
    tagRow,
    grid);
}
