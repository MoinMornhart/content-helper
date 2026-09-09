/** Hinweise, Dialoge und kleine Interaktionsbausteine. */

import { h, fill } from './dom.js';

// ------------------------------------------------------------------ Kurzhinweise

let toastHost = null;

function host() {
  if (!toastHost) {
    toastHost = h('div.toasts');
    document.body.append(toastHost);
  }
  return toastHost;
}

/**
 * @param {string} message Text
 * @param {'ok'|'info'|'warn'|'danger'} tone
 */
export function toast(message, tone = 'info', ms = 3200) {
  const glyphs = { ok: '✓', info: 'ℹ', warn: '!', danger: '✕' };
  const node = h(`div.toast.is-${tone}`, null,
    h('span', { text: glyphs[tone] || 'ℹ' }),
    h('span.grow', { text: message }));
  host().append(node);

  const close = () => {
    node.classList.add('is-leaving');
    setTimeout(() => node.remove(), 200);
  };
  node.addEventListener('click', close);
  setTimeout(close, ms);
  return close;
}

// ------------------------------------------------------------------ Dialoge

/**
 * Oeffnet einen Dialog. `build` bekommt Hilfsfunktionen und liefert den Inhalt.
 *
 * @param {object} options
 * @param {string} options.title
 * @param {(api: {close: Function}) => Node} options.body
 * @param {Array<{label: string, tone?: string, action?: Function, primary?: boolean}>} [options.actions]
 * @param {'narrow'|'wide'} [options.size]
 */
export function modal({ title, body, actions = [], size = '', onClose }) {
  const backdrop = h('div.modal-backdrop');
  const dialog = h(`div.modal${size ? `.modal--${size}` : ''}`);

  const close = (result) => {
    backdrop.remove();
    document.removeEventListener('keydown', onKey);
    onClose?.(result);
  };

  const onKey = (event) => {
    if (event.key === 'Escape') close(null);
  };

  const content = typeof body === 'function' ? body({ close }) : body;

  dialog.append(
    h('div.modal__head', null,
      h('h2.modal__title', { text: title }),
      h('button.btn.btn--ghost.btn--icon', { text: '✕', title: 'Schliessen', onClick: () => close(null) })),
    h('div.modal__body', null, content),
    actions.length
      ? h('div.modal__foot', null,
          ...actions.map((action) =>
            h(`button.btn${action.primary ? '.btn--primary' : ''}${action.tone === 'danger' ? '.btn--danger' : ''}`, {
              text: action.label,
              onClick: async () => {
                const keepOpen = await action.action?.({ close });
                if (keepOpen !== false && action.closeAfter !== false) close(action.value ?? true);
              },
            })))
      : null
  );

  backdrop.append(dialog);
  backdrop.addEventListener('mousedown', (event) => {
    if (event.target === backdrop) close(null);
  });
  document.addEventListener('keydown', onKey);
  document.body.append(backdrop);

  const firstInput = dialog.querySelector('input, textarea, select');
  setTimeout(() => firstInput?.focus(), 40);

  return { close, dialog };
}

/** Rueckfrage mit Ja/Nein, liefert ein Versprechen auf true/false. */
export function confirm({ title, message, confirmLabel = 'Bestätigen', tone = '' }) {
  return new Promise((resolve) => {
    let decided = false;
    modal({
      title,
      size: 'narrow',
      body: h('p', { text: message }),
      actions: [
        { label: 'Abbrechen', action: () => { decided = true; resolve(false); } },
        {
          label: confirmLabel,
          primary: tone !== 'danger',
          tone,
          action: () => { decided = true; resolve(true); },
        },
      ],
      onClose: () => { if (!decided) resolve(false); },
    });
  });
}

/** Einzeiliger Texteingabe-Dialog. */
export function prompt({ title, label, value = '', placeholder = '', multiline = false }) {
  return new Promise((resolve) => {
    const input = multiline
      ? h('textarea.textarea', { value, placeholder })
      : h('input.input', { type: 'text', value, placeholder });
    let decided = false;

    const submit = () => {
      decided = true;
      resolve(input.value.trim() || null);
    };

    if (!multiline) {
      input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          submit();
          instance.close();
        }
      });
    }

    const instance = modal({
      title,
      size: 'narrow',
      body: h('div.field', null, label ? h('span.field__label', { text: label }) : null, input),
      actions: [
        { label: 'Abbrechen', action: () => { decided = true; resolve(null); } },
        { label: 'Übernehmen', primary: true, action: submit },
      ],
      onClose: () => { if (!decided) resolve(null); },
    });
  });
}

// ------------------------------------------------------------------ Bausteine

/** Umschaltleiste, z. B. Monat/Woche oder Zeitraum. */
export function segmented(options, active, onChange) {
  const group = h('div.btn-group');
  const render = (current) => {
    fill(group, ...options.map((option) =>
      h(`button.btn${option.value === current ? '.is-active' : ''}`, {
        text: option.label,
        title: option.title || '',
        onClick: () => {
          render(option.value);
          onChange(option.value);
        },
      })));
  };
  render(active);
  return group;
}

/** Ein/Aus-Schalter mit Beschriftung. */
export function toggle(label, checked, onChange) {
  const input = h('input', { type: 'checkbox', checked, onChange: (event) => onChange(event.target.checked) });
  return h('label.switch', null, input, h('span.switch__track'), h('span', { text: label }));
}

/** Kopiert Text und meldet es kurz zurueck. */
export async function copy(text, message = 'In die Zwischenablage kopiert') {
  await window.ch.system.copy(text);
  toast(message, 'ok', 1800);
}
