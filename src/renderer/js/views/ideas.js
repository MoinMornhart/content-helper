/**
 * Ideen: Vorratslager und Ideenmaschine.
 *
 * Links das Brett mit vier Spalten, in denen Ideen per Ziehen wandern.
 * Rechts der Generator, der aus einem Thema Blickwinkel, Titel und
 * Einstiegssätze erzeugt – regelbasiert, ohne Modell und ohne Schlüssel.
 */

import { h, card, empty, fill } from '../lib/dom.js';
import * as fmt from '../lib/format.js';
import * as store from '../lib/store.js';
import * as writing from '../lib/writing.js';
import * as posts from '../lib/posts.js';
import { active, glyph } from '../lib/platforms.js';
import { toast, confirm, modal } from '../lib/ui.js';

export const title = 'Ideen';
export const lead = 'Der Vorrat, aus dem alles andere entsteht.';

const COLUMNS = [
  { id: 'inbox', label: 'Eingang', hint: 'roh, unsortiert' },
  { id: 'doing', label: 'In Arbeit', hint: 'wird ausgearbeitet' },
  { id: 'ready', label: 'Drehreif', hint: 'kann produziert werden' },
  { id: 'done', label: 'Umgesetzt', hint: 'ist Beitrag geworden' },
];

/** Bewertung von eins bis fünf, direkt in der Karte änderbar. */
function scoreControl(idea, refresh) {
  const row = h('span.score', { title: 'Wie stark ist die Idee?' });
  for (let value = 1; value <= 5; value += 1) {
    row.append(h(`span.score__pip${value <= (idea.score || 0) ? '.is-on' : ''}`, {
      onClick: async (event) => {
        event.stopPropagation();
        await store.patch('ideas', idea.id, { score: value === idea.score ? 0 : value });
        refresh();
      },
    }));
  }
  return row;
}

function ideaCard(idea, { goto, refresh }) {
  return h('div.idea-card', {
    draggable: true,
    onDragStart: (event) => {
      event.dataTransfer.setData('text/plain', idea.id);
      event.currentTarget.classList.add('is-dragging');
    },
    onDragEnd: (event) => event.currentTarget.classList.remove('is-dragging'),
    onClick: () => openIdea(idea, { goto, refresh }),
  },
    h('div.idea-card__title', { text: idea.title }),
    idea.angle ? h('div.text-xs.faint.mb-sm', { text: idea.angle }) : null,
    h('div.row.between', null,
      scoreControl(idea, refresh),
      h('div.row.gap-xs', null,
        ...(idea.platforms || []).slice(0, 3).map((id) => glyph(id, 15)),
        h('span.text-xs.faint', { text: fmt.relative(idea.createdAt) }))));
}

/** Dialog: Idee bearbeiten, bewerten, in einen Beitrag überführen. */
function openIdea(idea, { goto, refresh }) {
  const titleInput = h('input.input', { value: idea.title || '' });
  const notesInput = h('textarea.textarea', { value: idea.notes || '', placeholder: 'Notizen, Rechercheergebnisse, offene Fragen …' });
  const hookInput = h('input.input', { value: idea.hook || '', placeholder: 'Einstiegssatz' });

  const selected = new Set(idea.platforms || []);
  const platformRow = h('div.chips');
  const renderPlatforms = () => {
    fill(platformRow, ...active(store.settings()).map((p) =>
      h(`span.chip${selected.has(p.id) ? '.is-active' : ''}`, {
        onClick: () => {
          if (selected.has(p.id)) selected.delete(p.id);
          else selected.add(p.id);
          renderPlatforms();
        },
      }, glyph(p.id, 14), h('span', { text: p.short || p.name }))));
  };
  renderPlatforms();

  const save = async () => {
    await store.patch('ideas', idea.id, {
      title: titleInput.value.trim() || idea.title,
      notes: notesInput.value,
      hook: hookInput.value.trim(),
      platforms: [...selected],
    });
    refresh();
  };

  modal({
    title: 'Idee',
    body: h('div.col.gap-lg', null,
      h('label.field', null, h('span.field__label', { text: 'Titel' }), titleInput),
      h('label.field', null, h('span.field__label', { text: 'Einstiegssatz' }), hookInput),
      h('div.field', null, h('span.field__label', { text: 'Gedachte Kanäle' }), platformRow),
      h('label.field', null, h('span.field__label', { text: 'Notizen' }), notesInput),
      h('div.row.gap-sm', null,
        h('button.btn.btn--sm', {
          text: '✦ Titel-Varianten',
          onClick: () => {
            const list = writing.titles(titleInput.value || idea.title, 6);
            modal({
              title: 'Andere Fassungen desselben Themas',
              size: 'narrow',
              body: h('div.col.gap-sm', null,
                ...list.map((item) =>
                  h('div.post-row', { onClick: () => { titleInput.value = item.text; toast('Übernommen.', 'ok'); } },
                    h('span.badge', { text: item.kind }),
                    h('span.grow', { text: item.text })))),
            });
          },
        }),
        h('button.btn.btn--sm', {
          text: '⚑ Hook vorschlagen',
          onClick: () => {
            const list = writing.hooks(titleInput.value || idea.title, 5);
            modal({
              title: 'Einstiegssätze',
              size: 'narrow',
              body: h('div.col.gap-sm', null,
                ...list.map((hook) =>
                  h('div.post-row', { onClick: () => { hookInput.value = hook; toast('Übernommen.', 'ok'); } },
                    h('span.grow', { text: hook })))),
            });
          },
        }))),
    actions: [
      {
        label: 'Löschen',
        tone: 'danger',
        action: async () => {
          if (!(await confirm({ title: 'Idee löschen?', message: 'Sie verschwindet endgültig.', confirmLabel: 'Löschen', tone: 'danger' }))) return false;
          await store.remove('ideas', idea.id);
          toast('Gelöscht.', 'ok');
          refresh();
        },
      },
      { label: 'Speichern', action: async () => { await save(); toast('Gespeichert.', 'ok'); } },
      {
        label: 'Beitrag daraus machen',
        primary: true,
        action: async () => {
          await save();
          const created = await store.add('posts', posts.blankPost({
            title: titleInput.value.trim() || idea.title,
            body: hookInput.value ? `${hookInput.value}\n\n` : '',
            platforms: [...selected],
            notes: notesInput.value,
            status: 'draft',
          }));
          await store.patch('ideas', idea.id, { status: 'done', postId: created.id });
          toast('Beitrag angelegt.', 'ok');
          goto('composer', { id: created.id });
        },
      },
    ],
  });
}

/** Die Ideenmaschine: aus einem Thema werden mehrere Blickwinkel. */
function generator(refresh) {
  const topicInput = h('input.input', { placeholder: 'Thema, z. B. „Streaming-Setup“ oder „Videoschnitt“' });
  const results = h('div.col.gap-sm');
  let offset = 0;

  const run = () => {
    const topic = topicInput.value.trim();
    if (!topic) return toast('Bitte ein Thema eingeben.', 'warn');
    const list = writing.ideas(topic, 8, offset);
    fill(results, ...list.map((item) =>
      h('div.idea-card', null,
        h('div.row.between.mb-sm', null,
          h('span.badge.badge--accent', { text: item.angle }),
          h('button.btn.btn--sm', {
            text: '＋ übernehmen',
            onClick: async () => {
              await store.add('ideas', {
                title: item.title,
                notes: item.prompt,
                hook: item.hook,
                status: 'inbox',
                score: 0,
                platforms: [],
                source: `Generator · ${topic}`,
              });
              toast('In den Eingang gelegt.', 'ok');
              refresh();
            },
          })),
        h('div.idea-card__title', { text: item.title }),
        h('div.text-sm.muted', { text: item.prompt }),
        h('div.text-xs.faint.mt-sm', { text: `Einstieg: ${item.hook}` }))));
  };

  topicInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') { offset = 0; run(); }
  });

  return card('Ideenmaschine', { hint: 'läuft lokal, ohne Modell' },
    h('p.text-sm.muted.mb', { text: 'Ein Thema hinein – heraus kommen Blickwinkel, die daraus je einen eigenständigen Inhalt machen. Aus einem Thema entstehen so acht Beiträge statt einem.' }),
    h('div.row.gap-sm.mb', null,
      topicInput,
      h('button.btn.btn--primary.nowrap', { text: 'Erzeugen', onClick: () => { offset = 0; run(); } }),
      h('button.btn.nowrap', { text: 'Andere', onClick: () => { offset += 5; run(); } })),
    results);
}

// ------------------------------------------------------------------ Ansicht

export async function render({ goto, setActions, refresh, params }) {
  const all = store.all('ideas');

  setActions(
    h('button.btn.btn--sm.btn--primary', {
      text: '＋ Idee',
      onClick: async () => {
        const created = await store.add('ideas', { title: 'Neue Idee', status: 'inbox', score: 0, platforms: [] });
        openIdea(created, { goto, refresh });
      },
    })
  );

  const board = h('div.board');
  for (const column of COLUMNS) {
    const items = all.filter((idea) => idea.status === column.id);
    const col = h('div.board__col', null,
      h('div.board__title', null,
        h('span', { text: column.label }),
        h('span', { text: String(items.length) })),
      ...items.map((idea) => ideaCard(idea, { goto, refresh })),
      items.length ? null : h('div.text-xs.faint', { text: column.hint }));

    col.addEventListener('dragover', (event) => {
      event.preventDefault();
      col.classList.add('is-drop');
    });
    col.addEventListener('dragleave', () => col.classList.remove('is-drop'));
    col.addEventListener('drop', async (event) => {
      event.preventDefault();
      col.classList.remove('is-drop');
      const id = event.dataTransfer.getData('text/plain');
      if (!id) return;
      await store.patch('ideas', id, { status: column.id });
      refresh();
    });

    board.append(col);
  }

  const open = all.filter((idea) => !['done', 'archived'].includes(idea.status));
  const strong = open.filter((idea) => (idea.score || 0) >= 4);

  return h('div.col.gap-xl', null,
    h('div.grid.grid-4', null,
      card(null, {}, h('div.stat', null, h('div.stat__label', { text: 'Im Vorrat' }), h('div.stat__value', { text: String(open.length) }), h('div.stat__meta', { text: open.length < 8 ? 'unter dem empfohlenen Vorrat' : 'gute Reserve' }))),
      card(null, {}, h('div.stat', null, h('div.stat__label', { text: 'Stark bewertet' }), h('div.stat__value', { text: String(strong.length) }), h('div.stat__meta', { text: 'vier Punkte und mehr' }))),
      card(null, {}, h('div.stat', null, h('div.stat__label', { text: 'Drehreif' }), h('div.stat__value', { text: String(all.filter((idea) => idea.status === 'ready').length) }), h('div.stat__meta', { text: 'kann sofort produziert werden' }))),
      card(null, {}, h('div.stat', null, h('div.stat__label', { text: 'Umgesetzt' }), h('div.stat__value', { text: String(all.filter((idea) => idea.status === 'done').length) }), h('div.stat__meta', { text: 'insgesamt' })))),

    all.length
      ? board
      : card(null, { class: 'card--quiet' },
          empty('Noch keine Ideen', 'Gib unten ein Thema in die Ideenmaschine – sie macht daraus acht verschiedene Blickwinkel.')),

    all.length ? h('p.text-xs.faint', { text: 'Karten lassen sich zwischen den Spalten ziehen. Ein Klick öffnet die Idee, dort wird sie zum Beitrag.' }) : null,

    generator(refresh));
}
