/**
 * Winzige Bauhilfe fuer DOM-Elemente.
 *
 * Bewusst kein Framework: die App erzeugt ihre Ansichten direkt, das haelt den
 * Start schnell, den Aufbau nachvollziehbar und das Projekt frei von
 * Abhaengigkeiten und Build-Schritten.
 */

/**
 * Erzeugt ein Element.
 *
 * @param {string} tag CSS-artige Kurzform, z. B. "div.card.is-active" oder "button#save.btn".
 * @param {object|null} props Attribute; Sonderfaelle: class, style (Objekt), dataset,
 *   html (innerHTML), text (textContent) und on* fuer Ereignisse.
 * @param {...any} children Kindelemente, Zeichenketten, Zahlen oder Listen davon.
 */
export function h(tag, props = null, ...children) {
  const [, name = 'div', rest = ''] = /^([a-zA-Z0-9-]*)(.*)$/.exec(tag) || [];
  const node = document.createElement(name || 'div');

  for (const token of rest.split(/(?=[.#])/)) {
    if (token.startsWith('.')) node.classList.add(token.slice(1));
    else if (token.startsWith('#')) node.id = token.slice(1);
  }

  if (props) {
    for (const [key, value] of Object.entries(props)) {
      if (value === null || value === undefined || value === false) continue;
      if (key === 'class' || key === 'className') {
        for (const cls of String(value).split(/\s+/).filter(Boolean)) node.classList.add(cls);
      } else if (key === 'style' && typeof value === 'object') {
        Object.assign(node.style, value);
      } else if (key === 'dataset' && typeof value === 'object') {
        Object.assign(node.dataset, value);
      } else if (key === 'html') {
        node.innerHTML = value;
      } else if (key === 'text') {
        node.textContent = value;
      } else if (key.startsWith('on') && typeof value === 'function') {
        node.addEventListener(key.slice(2).toLowerCase(), value);
      } else if (key in node && key !== 'list' && key !== 'form') {
        node[key] = value;
      } else {
        node.setAttribute(key, value === true ? '' : value);
      }
    }
  }

  append(node, children);
  return node;
}

/** Haengt beliebig verschachtelte Kinder an. */
export function append(parent, children) {
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false || child === true) continue;
    parent.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return parent;
}

export const qs = (selector, root = document) => root.querySelector(selector);
export const qsa = (selector, root = document) => [...root.querySelectorAll(selector)];

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

/** Ersetzt den Inhalt eines Knotens. */
export function fill(node, ...children) {
  clear(node);
  return append(node, children);
}

/** Ereignis-Delegation: spart Listener bei langen Listen. */
export function delegate(root, selector, type, handler) {
  root.addEventListener(type, (event) => {
    const target = event.target.closest(selector);
    if (target && root.contains(target)) handler(event, target);
  });
}

/** Kurzform fuer haeufige Bausteine. */
export const icon = (glyph, className = '') => h(`span.icon${className ? `.${className}` : ''}`, { text: glyph });

export function field(label, control, hint) {
  return h('label.field', null, h('span.field__label', { text: label }), control, hint ? h('span.field__hint', { text: hint }) : null);
}

export function card(title, options = {}, ...children) {
  const head = title
    ? h('div.card__head', null,
        h('div.card__title', { text: title }),
        options.action || (options.hint ? h('div.card__hint', { text: options.hint }) : null))
    : null;
  return h(`div.card${options.class ? `.${options.class}` : ''}`, null, head, ...children);
}

export function empty(title, hint, action) {
  return h('div.empty', null,
    h('div.empty__icon', { text: '◍' }),
    h('div.empty__title', { text: title }),
    hint ? h('div.text-sm.muted', { text: hint }) : null,
    action || null);
}

export function stat(label, value, meta) {
  return h('div.stat', null,
    h('div.stat__label', { text: label }),
    h('div.stat__value', { text: value }),
    meta ? (meta instanceof Node ? meta : h('div.stat__meta', { text: meta })) : null);
}

/** Fortschrittsbalken mit optionaler Faerbung nach Zielerreichung. */
export function bar(ratio, tone = '') {
  const percent = Math.max(0, Math.min(1, ratio || 0)) * 100;
  return h('div.bar', null, h(`div.bar__fill${tone ? `.is-${tone}` : ''}`, { style: { width: `${percent}%` } }));
}
