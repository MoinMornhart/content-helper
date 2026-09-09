/**
 * Composer: ein Beitrag, alle Kanäle.
 *
 * Links geschrieben, rechts sofort gesehen, wie es auf jeder Plattform ankommt –
 * mit Limits, Vorschau und plattformeigenen Fassungen, wo es nötig ist.
 */

import { h, card, fill } from '../lib/dom.js';
import * as fmt from '../lib/format.js';
import * as store from '../lib/store.js';
import * as posts from '../lib/posts.js';
import * as writing from '../lib/writing.js';
import { active, platform, glyph, limitState, suggestedSlots, KIND_LABEL } from '../lib/platforms.js';
import { toast, confirm, prompt, modal } from '../lib/ui.js';

export const title = 'Composer';
export const lead = 'Einmal schreiben, überall passend ausspielen.';

/** Der Beitrag, an dem gerade gearbeitet wird. */
let draft = null;
let saveTimer = null;
let activeVariant = null;

// ------------------------------------------------------------------ Speichern

function markDirty(rerender) {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    if (draft.id) {
      await store.patch('posts', draft.id, draft);
    } else if (draft.title || draft.body) {
      const created = await store.add('posts', draft);
      draft = { ...created };
      rerender?.();
    }
  }, 700);
}

// ------------------------------------------------------------------ Bausteine

/** Zeichenzähler unter einem Feld. */
function counter(text, limit) {
  const state = limitState(text, limit);
  const node = h(`span.counter${state.state === 'over' ? '.is-over' : state.state === 'warn' ? '.is-warn' : ''}`, {
    text: limit ? `${state.used} / ${limit}` : `${state.used} Zeichen`,
  });
  return node;
}

/** Vorschau, wie der Beitrag auf einer Plattform aussieht. */
function preview(post, platformId) {
  const p = platform(platformId);
  const variant = post.perPlatform?.[platformId] || {};
  const titleText = variant.title ?? post.title;
  const bodyText = variant.body ?? post.body;
  const tags = (variant.hashtags?.length ? variant.hashtags : post.hashtags) || [];

  const bodyLimit = p.limits?.body || 0;
  const bodyState = limitState(bodyText, bodyLimit);

  /** Text über dem Limit wird rot hinterlegt, statt nur gezählt zu werden. */
  const bodyNode = h('div.preview__body');
  if (bodyState.state === 'over' && bodyLimit) {
    const chars = [...String(bodyText || '')];
    bodyNode.append(
      document.createTextNode(chars.slice(0, bodyLimit).join('')),
      h('span.preview__over', { text: chars.slice(bodyLimit).join('') })
    );
  } else {
    bodyNode.textContent = bodyText || '';
  }

  return h('div.preview', null,
    h('div.preview__head', null,
      glyph(platformId, 18),
      h('span.grow', { text: p.name }),
      h('span.text-xs.faint', { text: KIND_LABEL[p.kind] || p.kind }),
      counter(bodyText, bodyLimit)),
    h('div', null,
      p.limits?.title
        ? h('div.preview__body', { style: { paddingBottom: '0' } },
            h('div.preview__title', { text: titleText || 'Ohne Titel' }),
            counter(titleText, p.limits.title))
        : null,
      bodyNode,
      tags.length
        ? h('div.preview__body', { style: { paddingTop: '0' } },
            h('div.preview__tags', {
              text: tags.map((tag) => (tag.startsWith('#') ? tag : `#${tag}`)).join(' '),
            }),
            p.limits?.hashtags && tags.length > p.limits.hashtags
              ? h('div.text-xs', { style: { color: 'var(--danger)' }, text: `${p.name} erlaubt höchstens ${p.limits.hashtags} Hashtags.` })
              : null)
        : null),
    h('div.row.gap-sm', { style: { padding: '0 13px 13px' } },
      h('button.btn.btn--sm', {
        text: 'Text kopieren',
        onClick: async () => {
          await window.ch.system.copy(posts.renderFor(post, platformId));
          toast(`Fassung für ${p.name} kopiert.`, 'ok');
        },
      }),
      p.uploadUrl
        ? h('button.btn.btn--sm.btn--ghost', {
            text: 'Upload öffnen',
            onClick: () => window.ch.system.openExternal(p.uploadUrl),
          })
        : null,
      h('button.btn.btn--sm.btn--ghost', {
        text: post.perPlatform?.[platformId] ? 'Eigene Fassung bearbeiten' : 'Eigene Fassung',
        onClick: () => openVariantEditor(post, platformId),
      })));
}

/** Dialog für eine plattformeigene Fassung von Titel, Text und Hashtags. */
function openVariantEditor(post, platformId) {
  const p = platform(platformId);
  const variant = { ...(post.perPlatform?.[platformId] || {}) };

  const titleInput = h('input.input', {
    value: variant.title ?? post.title ?? '',
    placeholder: 'Titel für diese Plattform',
  });
  const bodyInput = h('textarea.textarea.textarea--tall', {
    value: variant.body ?? post.body ?? '',
    placeholder: 'Text für diese Plattform',
  });
  const tagsInput = h('input.input', {
    value: (variant.hashtags ?? post.hashtags ?? []).join(' '),
    placeholder: '#hashtag #beispiel',
  });

  modal({
    title: `Eigene Fassung für ${p.name}`,
    body: h('div.col.gap-lg', null,
      h('p.text-sm.muted', { text: `Limits: ${p.limits?.title ? `Titel ${p.limits.title} Zeichen, ` : ''}Text ${p.limits?.body || '–'} Zeichen${p.limits?.hashtags ? `, ${p.limits.hashtags} Hashtags` : ''}.` }),
      p.limits?.title ? h('label.field', null, h('span.field__label', { text: 'Titel' }), titleInput) : null,
      h('label.field', null, h('span.field__label', { text: 'Text' }), bodyInput),
      h('label.field', null, h('span.field__label', { text: 'Hashtags' }), tagsInput),
      p.tips?.length
        ? h('div.notice.notice--accent', null,
            h('span.notice__icon', { text: '◆' }),
            h('div', null,
              h('div.strong.text-sm', { text: `Worauf es bei ${p.name} ankommt` }),
              h('ul.text-sm.muted', { style: { margin: '6px 0 0', paddingLeft: '18px' } },
                ...p.tips.map((tip) => h('li', { text: tip })))))
        : null),
    actions: [
      {
        label: 'Eigene Fassung entfernen',
        action: async () => {
          const next = { ...(draft.perPlatform || {}) };
          delete next[platformId];
          draft.perPlatform = next;
          await store.patch('posts', draft.id, { perPlatform: next });
          toast('Fassung entfernt – es gilt wieder der gemeinsame Text.', 'ok');
          rerenderPreviews();
        },
      },
      {
        label: 'Übernehmen',
        primary: true,
        action: async () => {
          draft.perPlatform = {
            ...(draft.perPlatform || {}),
            [platformId]: {
              title: titleInput.value.trim(),
              body: bodyInput.value,
              hashtags: tagsInput.value.split(/[\s,]+/).map((tag) => tag.replace(/^#/, '')).filter(Boolean),
            },
          };
          if (draft.id) await store.patch('posts', draft.id, { perPlatform: draft.perPlatform });
          toast(`Eigene Fassung für ${p.name} gespeichert.`, 'ok');
          rerenderPreviews();
        },
      },
    ],
  });
}

let previewHost = null;
function rerenderPreviews() {
  if (!previewHost) return;
  fill(previewHost, ...(draft.platforms || []).map((id) => preview(draft, id)));
}

// ------------------------------------------------------------------ Ansicht

export async function render({ params, goto, setActions, refresh }) {
  const settings = store.settings();

  if (params.id) {
    draft = { ...store.byId('posts', params.id) };
  } else if (params.fresh || !draft) {
    draft = posts.blankPost({ platforms: [...(settings.activePlatforms || [])].slice(0, 2) });
  }
  activeVariant = null;

  const isNew = !draft.id;

  // ---------------------------------------------------------------- Kopfzeile
  setActions(
    h('span.badge', { text: posts.statusLabel(draft.status) }),
    h('button.btn.btn--sm', {
      text: 'Speichern',
      onClick: async () => {
        clearTimeout(saveTimer);
        if (draft.id) await store.patch('posts', draft.id, draft);
        else draft = await store.add('posts', draft);
        toast('Gespeichert.', 'ok');
        refresh();
      },
    }),
    h('button.btn.btn--sm.btn--primary', { text: 'Einplanen', onClick: () => openScheduler() }),
    draft.id
      ? h('button.btn.btn--sm.btn--danger', {
          text: 'Löschen',
          onClick: async () => {
            if (!(await confirm({ title: 'Beitrag löschen?', message: 'Das lässt sich nicht rückgängig machen.', confirmLabel: 'Löschen', tone: 'danger' }))) return;
            await store.remove('posts', draft.id);
            draft = null;
            toast('Gelöscht.', 'ok');
            goto('calendar');
          },
        })
      : null
  );

  // ---------------------------------------------------------------- Editor
  const titleInput = h('input.input', {
    value: draft.title || '',
    placeholder: 'Titel – das Versprechen an die Zuschauer',
    oninput: (event) => {
      draft.title = event.target.value;
      updateChecks();
      rerenderPreviews();
      markDirty(refresh);
    },
  });

  const bodyInput = h('textarea.textarea.textarea--tall', {
    value: draft.body || '',
    placeholder: 'Text, Beschreibung oder Skript …',
    oninput: (event) => {
      draft.body = event.target.value;
      updateChecks();
      rerenderPreviews();
      markDirty(refresh);
    },
  });

  const tagsInput = h('input.input', {
    value: (draft.hashtags || []).join(' '),
    placeholder: '#thema #kanal',
    onchange: (event) => {
      draft.hashtags = event.target.value.split(/[\s,]+/).map((tag) => tag.replace(/^#/, '')).filter(Boolean);
      rerenderPreviews();
      markDirty(refresh);
    },
  });

  const checksHost = h('div.col.gap-xs');
  function updateChecks() {
    const primary = draft.platforms?.[0] || null;
    const notes = [
      ...writing.check(draft.title, { platformId: primary, field: 'title' }),
      ...writing.check(draft.body, {
        platformId: primary,
        field: 'body',
        isVideoScript: ['video', 'short'].includes(platform(primary)?.kind),
      }),
    ];
    fill(checksHost, ...(notes.length
      ? notes.map((note) => h(`div.notice.notice--${note.tone === 'ok' ? 'ok' : note.tone}`, null,
          h('span.notice__icon', { text: note.tone === 'danger' ? '✕' : note.tone === 'warn' ? '!' : note.tone === 'ok' ? '✓' : 'ℹ' }),
          h('span', { text: note.message })))
      : [h('div.text-sm.faint', { text: 'Schreib etwas – die Prüfung meldet sich, sobald es etwas zu sagen gibt.' })]));
  }
  updateChecks();

  // ---------------------------------------------------------------- Kanäle
  const platformHost = h('div.platform-grid');
  const renderPlatformPicker = () => {
    const selected = new Set(draft.platforms || []);
    fill(platformHost, ...active(settings).map((p) =>
      h(`div.platform-toggle${selected.has(p.id) ? '.is-on' : ''}`, {
        onClick: () => {
          const next = new Set(draft.platforms || []);
          if (next.has(p.id)) next.delete(p.id);
          else next.add(p.id);
          draft.platforms = [...next];
          renderPlatformPicker();
          rerenderPreviews();
          updateChecks();
          markDirty(refresh);
        },
      },
        glyph(p.id, 18),
        h('span.truncate', { text: p.name }))));
  };
  renderPlatformPicker();

  previewHost = h('div.col.gap-sm');
  rerenderPreviews();

  // ---------------------------------------------------------------- Termin
  function openScheduler() {
    const input = h('input.input', {
      type: 'datetime-local',
      value: draft.scheduledAt ? fmt.inputDateTime(draft.scheduledAt) : fmt.inputDateTime(fmt.addDays(new Date(), 1)),
    });

    const slots = (draft.platforms || [])
      .flatMap((id) => suggestedSlots(id, 10).slice(0, 3).map((when) => ({ id, when })))
      .sort((a, b) => a.when - b.when)
      .slice(0, 8);

    modal({
      title: 'Termin festlegen',
      size: 'narrow',
      body: h('div.col.gap-lg', null,
        h('label.field', null, h('span.field__label', { text: 'Datum und Uhrzeit' }), input),
        slots.length
          ? h('div.col.gap-sm', null,
              h('div.field__label', { text: 'Empfohlene Zeitfenster deiner Kanäle' }),
              h('div.chips', null,
                ...slots.map((slot) =>
                  h('span.chip', {
                    onClick: () => { input.value = fmt.inputDateTime(slot.when); },
                  },
                    glyph(slot.id, 14),
                    h('span', { text: `${fmt.date(slot.when, 'day')} ${fmt.time(slot.when)}` })))))
          : null,
        h('p.text-xs.faint', { text: 'Zum Termin meldet sich die App, legt den Text in die Zwischenablage und öffnet auf Wunsch die Upload-Seite. Veröffentlicht wird nichts ohne dich.' })),
      actions: [
        {
          label: 'Termin entfernen',
          action: async () => {
            draft.scheduledAt = null;
            draft.status = 'ready';
            if (draft.id) await store.patch('posts', draft.id, { scheduledAt: null, status: 'ready' });
            toast('Termin entfernt.', 'ok');
            refresh();
          },
        },
        {
          label: 'Einplanen',
          primary: true,
          action: async () => {
            if (!input.value) return toast('Bitte einen Zeitpunkt wählen.', 'warn');
            draft.scheduledAt = new Date(input.value).toISOString();
            draft.status = 'scheduled';
            draft.preNotifiedAt = null;
            if (draft.id) await store.patch('posts', draft.id, draft);
            else draft = await store.add('posts', draft);
            toast(`Eingeplant für ${fmt.dateTime(draft.scheduledAt)}.`, 'ok');
            refresh();
          },
        },
      ],
    });
  }

  // ---------------------------------------------------------------- Checkliste
  const checklistHost = h('div.col.gap-xs');
  const renderChecklist = () => {
    const items = draft.checklist || [];
    fill(checklistHost, ...items.map((item, index) =>
      h(`div.check-item${item.done ? '.is-done' : ''}`, null,
        h('input', {
          type: 'checkbox',
          checked: item.done,
          onChange: (event) => {
            draft.checklist[index].done = event.target.checked;
            renderChecklist();
            markDirty(refresh);
          },
        }),
        h('span.grow.text-sm', { text: item.text }),
        h('button.btn.btn--ghost.btn--sm', {
          text: '✕',
          onClick: () => {
            draft.checklist.splice(index, 1);
            renderChecklist();
            markDirty(refresh);
          },
        }))),
      h('button.btn.btn--sm.btn--ghost', {
        text: '＋ Punkt hinzufügen',
        onClick: async () => {
          const text = await prompt({ title: 'Checklistenpunkt', label: 'Was fehlt noch?', placeholder: 'z. B. Thumbnail bauen' });
          if (!text) return;
          draft.checklist = [...(draft.checklist || []), { text, done: false }];
          renderChecklist();
          markDirty(refresh);
        },
      }),
      !items.length
        ? h('button.btn.btn--sm.btn--ghost', {
            text: 'Standard-Checkliste einsetzen',
            onClick: () => {
              draft.checklist = defaultChecklist(draft.platforms || []);
              renderChecklist();
              markDirty(refresh);
            },
          })
        : null);
  };
  renderChecklist();

  // ---------------------------------------------------------------- Aufbau
  return h('div.split', null,
    h('div.col.gap-lg', null,
      card('Inhalt', { hint: isNew ? 'neuer Beitrag' : `zuletzt geändert ${fmt.relative(draft.updatedAt)}` },
        h('div.col.gap-lg', null,
          h('label.field', null,
            h('div.row.between', null, h('span.field__label', { text: 'Titel' }), counter(draft.title, platform(draft.platforms?.[0])?.limits?.title || 0)),
            titleInput),
          h('label.field', null,
            h('div.row.between', null,
              h('span.field__label', { text: 'Text' }),
              h('span.text-xs.faint', { text: `${fmt.wordCount(draft.body)} Wörter · gesprochen ${fmt.duration(fmt.speakingSeconds(draft.body))}` })),
            bodyInput),
          h('div.row.gap-sm', null,
            h('button.btn.btn--sm', {
              text: '✦ Titel vorschlagen',
              onClick: () => suggestTitles(titleInput, () => { draft.title = titleInput.value; updateChecks(); rerenderPreviews(); markDirty(refresh); }),
            }),
            h('button.btn.btn--sm', {
              text: '⚑ Hook vorschlagen',
              onClick: () => suggestHooks(bodyInput, () => { draft.body = bodyInput.value; updateChecks(); rerenderPreviews(); markDirty(refresh); }),
            }),
            h('button.btn.btn--sm', {
              text: '# Hashtags ableiten',
              onClick: () => {
                const suggested = writing.suggestHashtags(`${draft.title} ${draft.body}`);
                if (!suggested.length) return toast('Zu wenig Text für Vorschläge.', 'warn');
                draft.hashtags = [...new Set([...(draft.hashtags || []), ...suggested])];
                tagsInput.value = draft.hashtags.join(' ');
                rerenderPreviews();
                markDirty(refresh);
                toast(`${suggested.length} Vorschläge übernommen.`, 'ok');
              },
            })),
          h('label.field', null, h('span.field__label', { text: 'Hashtags' }), tagsInput))),

      card('Prüfung', { hint: 'aktualisiert sich beim Tippen' }, checksHost),

      card('Kanäle', { hint: `${(draft.platforms || []).length} ausgewählt` },
        h('p.text-sm.muted.mb', { text: 'Nur aktive Kanäle erscheinen hier. Weitere schaltest du in den Einstellungen frei.' }),
        platformHost)),

    h('div.col.gap-lg', null,
      card('Termin', {},
        draft.scheduledAt
          ? h('div.col.gap-sm', null,
              h('div.text-lg.strong', { text: fmt.dateTime(draft.scheduledAt) }),
              h('div.text-sm.muted', { text: `${fmt.relative(draft.scheduledAt)} · ${posts.statusLabel(draft.status)}` }),
              h('div.row.gap-sm', null,
                h('button.btn.btn--sm', { text: 'Ändern', onClick: openScheduler }),
                h('button.btn.btn--sm.btn--primary', {
                  text: 'Als veröffentlicht markieren',
                  onClick: async () => {
                    draft.status = 'published';
                    draft.publishedAt = new Date().toISOString();
                    if (draft.id) await store.patch('posts', draft.id, draft);
                    toast('Abgehakt. Trag später die Zahlen nach, dann lernt der Coach mit.', 'ok');
                    refresh();
                  },
                })))
          : h('div.col.gap-sm', null,
              h('p.text-sm.muted', { text: 'Noch kein Termin gesetzt.' }),
              h('button.btn.btn--primary.btn--block', { text: 'Termin festlegen', onClick: openScheduler })))
      ,
      card('Format', { hint: 'für die Auswertung' },
        h('select.select', {
          onChange: (event) => { draft.format = event.target.value; markDirty(refresh); },
        },
          h('option', { value: '', text: '– kein Format –', selected: !draft.format }),
          ...[...new Set((draft.platforms || []).flatMap((id) => platform(id)?.formats || []))].map((format) =>
            h('option', { value: format, text: format, selected: draft.format === format })))),

      card('Checkliste', { hint: 'was vor dem Hochladen fertig sein muss' }, checklistHost),

      h('section.section.mt-0', null,
        h('div.section__head', null,
          h('div.section__title', { text: 'Vorschau je Kanal' }),
          h('div.section__hint', { text: 'so kommt es dort an' })),
        (draft.platforms || []).length
          ? previewHost
          : card(null, { class: 'card--quiet' }, h('p.text-sm.muted', { text: 'Wähle links mindestens einen Kanal aus.' })))));
}

// ------------------------------------------------------------------ Vorschläge

function suggestTitles(input, onPick) {
  const topic = input.value.trim() || 'dein Thema';
  let offset = 0;
  const list = h('div.col.gap-sm');

  const renderList = () => {
    fill(list, ...writing.titles(topic, 8, offset).map((item) =>
      h('div.post-row', {
        onClick: () => { input.value = item.text; onPick(); toast('Titel übernommen.', 'ok'); instance.close(); },
      },
        h('span.badge', { text: item.kind }),
        h('span.grow', { text: item.text }))));
  };
  renderList();

  const instance = modal({
    title: 'Titelvorschläge',
    body: h('div.col.gap-lg', null,
      h('p.text-sm.muted', { text: `Muster, die auf Video- und Kurzvideoplattformen zuverlässig tragen – angewandt auf „${topic}“. Als Ausgangspunkt gedacht, nicht als fertiger Titel.` }),
      list),
    actions: [{ label: 'Andere Vorschläge', action: () => { offset += 5; renderList(); return false; }, closeAfter: false }],
  });
}

function suggestHooks(textarea, onPick) {
  const topic = (textarea.value.split('\n')[0] || '').trim().slice(0, 60) || 'dein Thema';
  let offset = 0;
  const list = h('div.col.gap-sm');

  const renderList = () => {
    fill(list, ...writing.hooks(topic, 6, offset).map((hook) =>
      h('div.post-row', {
        onClick: () => {
          textarea.value = `${hook}\n\n${textarea.value}`;
          onPick();
          toast('Hook vorangestellt.', 'ok');
          instance.close();
        },
      }, h('span.grow', { text: hook }))));
  };
  renderList();

  const instance = modal({
    title: 'Einstiegssätze',
    body: h('div.col.gap-lg', null,
      h('p.text-sm.muted', { text: 'Die ersten Sekunden entscheiden über alles Weitere. Ein Satz, der eine Lücke öffnet, schlägt jede Begrüßung.' }),
      list),
    actions: [{ label: 'Andere Vorschläge', action: () => { offset += 3; renderList(); return false; }, closeAfter: false }],
  });
}

/** Sinnvolle Standardpunkte, abhängig von den gewählten Kanälen. */
function defaultChecklist(platformIds) {
  const kinds = new Set(platformIds.map((id) => platform(id)?.kind));
  const items = ['Text gegengelesen', 'Rechte an Musik und Material geklärt'];
  if (kinds.has('video')) items.unshift('Thumbnail gebaut', 'Kapitelmarken gesetzt', 'Beschreibung mit Links gefüllt');
  if (kinds.has('short')) items.unshift('Untertitel eingebrannt', 'Hook in Sekunde 1 geprüft', 'Cover-Frame gewählt');
  if (kinds.has('live')) items.unshift('Titel und Kategorie gesetzt', 'Technik getestet', 'Ankündigung verschickt');
  if (kinds.has('image')) items.unshift('Bildformat geprüft', 'Alt-Text geschrieben');
  return items.map((text) => ({ text, done: false }));
}
