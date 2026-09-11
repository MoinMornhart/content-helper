/**
 * Skript-Werkstatt.
 *
 * Ein Skript entsteht hier nicht als leeres Blatt, sondern als Abfolge von
 * Abschnitten mit Aufgabe und Zielzeit. Nebenbei wird mitgerechnet, wie lang
 * das Ganze gesprochen dauert – der häufigste blinde Fleck beim Schreiben.
 */

import { h, card, empty, fill } from '../lib/dom.js';
import * as fmt from '../lib/format.js';
import * as store from '../lib/store.js';
import * as writing from '../lib/writing.js';
import * as posts from '../lib/posts.js';
import { toast, confirm, modal } from '../lib/ui.js';
import { t, mark } from '../lib/i18n.js';

export const title = mark('Skripte');
export const lead = mark('Struktur zuerst, Formulierung danach.');

let openId = null;

const scripts = () => store.all('notes').filter((note) => note.type === 'script');

const totalSeconds = (script) =>
  (script.beats || []).reduce((sum, beat) => sum + fmt.speakingSeconds(beat.text), 0);

const targetSeconds = (script) =>
  (script.beats || []).reduce((sum, beat) => sum + (beat.seconds || 0), 0);

/** Neues Skript aus einer Vorlage. */
async function createFromTemplate(key, refresh) {
  const template = writing.SCRIPT_TEMPLATES[key];
  const created = await store.add('notes', {
    type: 'script',
    title: t('Neues Skript · {label}', { label: t(template.label) }),
    templateKey: key,
    beats: template.beats.map((beat) => ({ name: beat.name, seconds: beat.seconds, hint: beat.hint, text: '' })),
  });
  openId = created.id;
  toast(t('Skript angelegt.'), 'ok');
  refresh();
}

/** Vollbild-Ansicht zum Ablesen beim Dreh. */
function teleprompter(script) {
  const text = (script.beats || [])
    .filter((beat) => beat.text.trim())
    .map((beat) => beat.text.trim())
    .join('\n\n');

  modal({
    title: t('{title} · Ablesen', { title: script.title }),
    size: 'wide',
    body: h('div', {
      style: { fontSize: '25px', lineHeight: '1.75', whiteSpace: 'pre-wrap', padding: '10px 4px' },
      text: text || t('Noch kein Text geschrieben.'),
    }),
    actions: [
      { label: t('Text kopieren'), action: () => window.ch.system.copy(text), closeAfter: false },
    ],
  });
}

function editor(script, refresh, goto) {
  const titleInput = h('input.input', {
    value: script.title,
    onchange: (event) => store.patch('notes', script.id, { title: event.target.value.trim() || script.title }),
  });

  const summary = h('div.row.gap-lg.text-sm.muted');
  const beatsHost = h('div.col.gap-lg');

  const updateSummary = () => {
    const spoken = totalSeconds(script);
    const target = targetSeconds(script);
    const words = (script.beats || []).reduce((sum, beat) => sum + fmt.wordCount(beat.text), 0);
    fill(summary,
      h('span', { text: t('{n} Wörter', { n: fmt.num(words) }) }),
      h('span', { text: t('gesprochen {time}', { time: fmt.duration(spoken) }) }),
      target ? h('span', { text: t('Zielzeit {time}', { time: fmt.duration(target) }) }) : null,
      target
        ? h('span', {
            class: spoken > target * 1.25 ? 'trend down' : spoken < target * 0.5 ? 'trend flat' : 'trend up',
            text: spoken > target * 1.25 ? t('deutlich zu lang') : spoken < target * 0.5 ? t('noch dünn') : t('im Rahmen'),
          })
        : null);
  };

  const renderBeats = () => {
    fill(beatsHost, ...(script.beats || []).map((beat, index) => {
      const area = h('textarea.textarea', {
        value: beat.text,
        placeholder: beat.hint ? t(beat.hint) : '',
        style: { minHeight: '84px' },
        oninput: (event) => {
          script.beats[index].text = event.target.value;
          updateSummary();
          renderMeta(index);
          clearTimeout(script._timer);
          script._timer = setTimeout(() => store.patch('notes', script.id, { beats: script.beats }), 700);
        },
      });

      const meta = h('div.text-xs.faint');
      const renderMeta = () => {
        const spoken = fmt.speakingSeconds(script.beats[index].text);
        const target = script.beats[index].seconds;
        meta.textContent = target
          ? t('{spoken} von {target} Zielzeit', { spoken: fmt.duration(spoken), target: fmt.duration(target) })
          : t('{time} gesprochen', { time: fmt.duration(spoken) });
        meta.style.color = target && spoken > target * 1.4 ? 'var(--warn)' : '';
      };
      renderMeta();

      return h('div.col.gap-xs', null,
        h('div.row.between', null,
          h('div.row.gap-sm', null,
            h('span.badge.badge--accent', { text: String(index + 1) }),
            h('span.strong', { text: t(beat.name) }),
            beat.seconds ? h('span.text-xs.faint', { text: `~${fmt.duration(beat.seconds)}` }) : null),
          meta),
        beat.hint ? h('div.text-xs.faint', { text: t(beat.hint) }) : null,
        area);
    }));
    updateSummary();
  };
  renderBeats();

  return card(null, {},
    h('div.row.between.mb', null, titleInput,
      h('div.row.gap-sm', null,
        h('button.btn.btn--sm', { text: t('Ablesen'), onClick: () => teleprompter(script) }),
        h('button.btn.btn--sm', {
          text: t('Als Beitrag'),
          onClick: async () => {
            const body = (script.beats || []).map((beat) => beat.text.trim()).filter(Boolean).join('\n\n');
            const created = await store.add('posts', posts.blankPost({
              title: script.title,
              body,
              status: 'draft',
              platforms: [...(store.settings().activePlatforms || [])].slice(0, 1),
            }));
            toast(t('Beitrag aus Skript erstellt.'), 'ok');
            goto('composer', { id: created.id });
          },
        }),
        h('button.btn.btn--sm.btn--danger', {
          text: t('Löschen'),
          onClick: async () => {
            if (!(await confirm({ title: t('Skript löschen?'), message: t('Der Text geht verloren.'), confirmLabel: t('Löschen'), tone: 'danger' }))) return;
            await store.remove('notes', script.id);
            openId = null;
            refresh();
          },
        }))),
    summary,
    h('hr.divider'),
    beatsHost);
}

export async function render({ goto, setActions, refresh }) {
  const list = scripts();
  const current = openId ? list.find((script) => script.id === openId) : list[0];

  setActions(
    h('div.btn-group', null,
      ...Object.entries(writing.SCRIPT_TEMPLATES).map(([key, template]) =>
        h('button.btn', { text: t(template.label).split(' ')[0], title: t(template.label), onClick: () => createFromTemplate(key, refresh) })))
  );

  if (!list.length) {
    return card(null, {},
      empty(t('Noch kein Skript'),
        t('Wähle oben eine Vorlage. Jede bringt die Abschnitte mit, die dieses Format trägt – vom Haken bis zum Abbinder.'),
        h('div.row.gap-sm.mt', null,
          ...Object.entries(writing.SCRIPT_TEMPLATES).map(([key, template]) =>
            h('button.btn.btn--sm', { text: t(template.label), onClick: () => createFromTemplate(key, refresh) })))));
  }

  return h('div.split', null,
    current ? editor(current, refresh, goto) : h('div'),
    h('div.col.gap-lg', null,
      card(t('Alle Skripte'), { hint: fmt.plural(list.length, mark('Skript'), mark('Skripte')) },
        h('div.col.gap-sm', null,
          ...list.map((script) =>
            h(`div.post-row${script.id === current?.id ? '' : ''}`, {
              onClick: () => { openId = script.id; refresh(); },
              style: script.id === current?.id ? { borderColor: 'var(--accent)' } : {},
            },
              h('div.grow', null,
                h('div.post-row__title.truncate', { text: script.title }),
                h('div.post-row__sub', {
                  text: t('{time} gesprochen · geändert {when}', { time: fmt.duration(totalSeconds(script)), when: fmt.relative(script.updatedAt) }),
                })))))),

      card(t('Warum Struktur zuerst'), {},
        h('p.text-sm.muted', { text: t('Die meisten Videos scheitern nicht an der Formulierung, sondern am Aufbau: zu langer Einstieg, kein klares Versprechen, kein Grund weiterzuschauen. Die Vorlagen setzen genau dort an.') }),
        h('ul.text-sm.muted', { style: { paddingLeft: '18px', margin: '10px 0 0' } },
          h('li', { text: t('Der Haken steht vor allem anderen – auch vor der Begrüßung.') }),
          h('li', { text: t('Jeder Abschnitt hat eine Aufgabe. Wer sie nicht benennen kann, streicht ihn.') }),
          h('li', { text: t('Die Zielzeiten sind Richtwerte, keine Vorschrift – aber ein überschrittener Rahmen fällt so früh auf.') })))));
}
