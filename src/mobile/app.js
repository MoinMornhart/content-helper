/**
 * Content Helper – Handy-Begleiter.
 *
 * Läuft im Browser des Telefons und spricht ausschließlich mit der Desktop-App
 * im selben WLAN. Kein Konto, kein Zugangsschlüssel, keine Cloud.
 *
 * Ohne Verbindung bleibt die App bedienbar: Was du eingibst, wird gespeichert
 * und beim nächsten Kontakt automatisch nachgereicht.
 *
 * Die Sprache folgt der Desktop-App: Sie liefert über /api/i18n die Sprache
 * und die englischen Texte. Der deutsche Text ist der Schlüssel – fehlt eine
 * Übersetzung (oder ist die Desktop-App älter), bleibt es deutsch.
 */

(() => {
  'use strict';

  const KEY_TOKEN = 'ch.token';
  const KEY_QUEUE = 'ch.queue';
  const KEY_CACHE = 'ch.cache';
  const KEY_I18N = 'ch.i18n';
  const NOT_CONNECTED = 'nicht-verbunden'; // i18n-ignore – interne Kennung

  const app = document.getElementById('app');
  const tabbar = document.getElementById('tabbar');

  const state = {
    tab: 'today',
    data: null,
    catalog: [],
    online: true,
    loading: false,
  };

  // ---------------------------------------------------------------- Speicher

  const readStore = (key, fallback) => {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  };
  const writeStore = (key, value) => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch { /* voller Speicher darf die App nicht anhalten */ }
  };

  // ---------------------------------------------------------------- Sprache

  const GERMAN = { language: 'de', dictionary: {} };
  let i18n = readStore(KEY_I18N, GERMAN);

  /** Kennzeichnet einen Text als übersetzbar, ohne ihn schon zu übersetzen. */
  const mark = (text) => text;

  /** Deutscher Text als Schlüssel, Werte als {platzhalter}. */
  function t(text, params) {
    let out = i18n.language === 'en' ? (i18n.dictionary?.[text] ?? text) : text;
    if (params) out = out.replace(/\{(\w+)\}/g, (match, key) => (key in params ? String(params[key]) : match));
    return out;
  }

  const locale = () => (i18n.language === 'en' ? 'en-US' : 'de-DE');

  const TABS = { today: mark('Heute'), ideas: mark('Ideen'), numbers: mark('Zahlen') };

  /** Texte aus index.html, die schon vor dem ersten Aufbau sichtbar sind. */
  function applyStatic() {
    document.documentElement.lang = i18n.language;
    const boot = app.querySelector('.boot');
    if (boot) boot.textContent = t('Verbinde …');
    for (const tab of tabbar.children) {
      const label = tab.lastChild;
      if (label && label.nodeType === Node.TEXT_NODE && TABS[tab.dataset.tab]) label.textContent = t(TABS[tab.dataset.tab]);
    }
  }

  /** Token steht beim ersten Aufruf im Adressanker und wird dann behalten. */
  function token() {
    const fromHash = location.hash.replace(/^#/, '').trim();
    if (fromHash && /^[a-f0-9]{32}$/i.test(fromHash)) {
      localStorage.setItem(KEY_TOKEN, fromHash);
      history.replaceState(null, '', location.pathname);
      return fromHash;
    }
    return localStorage.getItem(KEY_TOKEN) || '';
  }

  // ---------------------------------------------------------------- Netz

  async function api(path, options = {}) {
    const response = await fetch(`/api/${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token()}`,
        ...(options.headers || {}),
      },
    });
    if (response.status === 401) throw new Error(NOT_CONNECTED);
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      const error = new Error(payload.error || t('Fehler {status}', { status: response.status }));
      error.status = response.status;
      throw error;
    }
    return response.json();
  }

  /**
   * Sprache der Desktop-App übernehmen. Kennt die Desktop-App den Aufruf noch
   * nicht (ältere Version), bleibt es deutsch; ohne Netz gilt der letzte Stand.
   */
  async function loadLanguage() {
    try {
      const result = await api('i18n');
      i18n = {
        language: result?.language === 'en' ? 'en' : 'de',
        dictionary: result?.dictionary && typeof result.dictionary === 'object' ? result.dictionary : {},
      };
    } catch (error) {
      if (error.message === NOT_CONNECTED) throw error;
      if (error.status) i18n = GERMAN;
      else return;
    }
    writeStore(KEY_I18N, i18n);
    applyStatic();
  }

  /**
   * Änderungen werden gepuffert: geht der Aufruf jetzt nicht durch, wandert er
   * in die Warteschlange und wird später erneut versucht.
   */
  async function send(path, body) {
    try {
      const result = await api(path, { method: 'POST', body: JSON.stringify(body) });
      state.online = true;
      return result;
    } catch (error) {
      if (error.message === NOT_CONNECTED) throw error;
      const queue = readStore(KEY_QUEUE, []);
      queue.push({ path, body, at: Date.now() });
      writeStore(KEY_QUEUE, queue);
      state.online = false;
      return { queued: true };
    }
  }

  async function flushQueue() {
    const queue = readStore(KEY_QUEUE, []);
    if (!queue.length) return 0;
    const rest = [];
    let sent = 0;
    for (const entry of queue) {
      try {
        await api(entry.path, { method: 'POST', body: JSON.stringify(entry.body) });
        sent += 1;
      } catch {
        rest.push(entry);
      }
    }
    writeStore(KEY_QUEUE, rest);
    return sent;
  }

  async function load({ silent = false } = {}) {
    if (!silent) state.loading = true;
    try {
      if (!state.catalog.length) state.catalog = await api('catalog');
      const data = await api('state');
      await loadLanguage();
      state.data = data;
      state.online = true;
      writeStore(KEY_CACHE, data);
      const sent = await flushQueue();
      if (sent) toast(t('{count} nachgereicht.', { count: sent }), 'ok');
    } catch (error) {
      if (error.message === NOT_CONNECTED) return renderPairing();
      state.online = false;
      state.data = state.data || readStore(KEY_CACHE, null);
    } finally {
      state.loading = false;
      render();
    }
  }

  // ---------------------------------------------------------------- Bausteine

  const el = (tag, props = {}, ...children) => {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
      if (value === null || value === undefined || value === false) continue;
      if (key === 'class') node.className = value;
      else if (key === 'text') node.textContent = value;
      else if (key === 'html') node.innerHTML = value;
      else if (key.startsWith('on')) node.addEventListener(key.slice(2).toLowerCase(), value);
      else node.setAttribute(key, value === true ? '' : value);
    }
    for (const child of children.flat()) {
      if (child === null || child === undefined || child === false) continue;
      node.append(child instanceof Node ? child : document.createTextNode(String(child)));
    }
    return node;
  };

  function toast(message, tone = 'ok') {
    document.querySelector('.toast')?.remove();
    const node = el('div', { class: `toast ${tone}`, text: message });
    document.body.append(node);
    setTimeout(() => node.remove(), 2600);
  }

  const platformOf = (id) => state.catalog.find((entry) => entry.id === id);

  const marks = (ids = []) => el('div', { class: 'marks' },
    ...ids.map((id) => {
      const platform = platformOf(id);
      return el('span', {
        class: 'mark',
        style: `background:${platform?.color || '#3b3550'}`,
        title: platform?.name || id,
        text: platform?.glyph || '?',
      });
    }));

  const timeText = (value) => {
    if (!value) return t('ohne Termin');
    const date = new Date(value);
    const today = new Date();
    const sameDay = date.toDateString() === today.toDateString();
    const time = date.toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' });
    if (sameDay) return t('heute {time}', { time });
    return `${date.toLocaleDateString(locale(), { weekday: 'short', day: 'numeric', month: 'short' })} ${time}`;
  };

  // ---------------------------------------------------------------- Ansichten

  function renderPairing() {
    tabbar.hidden = true;
    app.replaceChildren(
      el('div', { class: 'empty' },
        el('b', { text: t('Noch nicht verbunden') }),
        el('p', { class: 'small muted', text: t('Öffne am PC im Content Helper die Ansicht „Handy“ und scanne den QR-Code. Dieser Link enthält den Schlüssel für dein Gerät.') }),
        el('button', { class: 'btn btn--primary', text: t('Erneut versuchen'), onClick: () => load() })));
  }

  function renderToday() {
    const data = state.data;
    const posts = data?.posts || [];
    const due = posts.filter((post) => post.status === 'due' || post.status === 'missed');
    const upcoming = posts.filter((post) => post.status === 'scheduled');
    const summary = data?.summary || {};

    return [
      el('h1', { text: t('Heute') }),
      el('div', { class: 'sub', text: new Date().toLocaleDateString(locale(), { weekday: 'long', day: 'numeric', month: 'long' }) }),

      el('div', { class: 'stats' },
        el('div', { class: 'stat' }, el('b', { text: String(summary.dueCount ?? 0) }), el('span', { text: t('fällig') })),
        el('div', { class: 'stat' }, el('b', { text: String(summary.scheduledCount ?? 0) }), el('span', { text: t('geplant') })),
        el('div', { class: 'stat' }, el('b', { text: String((data?.ideas || []).length) }), el('span', { text: t('Ideen') }))),

      due.length ? el('h2', { text: t('Jetzt dran') }) : null,
      ...due.map((post) => postCard(post, true)),

      el('h2', { text: t('Als Nächstes') }),
      upcoming.length
        ? upcoming.slice(0, 12).map((post) => postCard(post, false))
        : el('div', { class: 'empty' }, el('b', { text: t('Nichts eingeplant') }), t('Am PC lässt sich die Warteschlange füllen.')),
    ];
  }

  function postCard(post, urgent) {
    return el('div', { class: 'card', onClick: () => openPost(post) },
      el('div', { class: 'post' },
        el('span', { class: `dot ${post.status}` }),
        el('div', { class: 'grow' },
          el('div', { class: 'strong truncate', text: post.title || t('Ohne Titel') }),
          el('div', { class: 'small muted', text: timeText(post.scheduledAt) }),
          marks(post.platforms)),
        urgent ? el('span', { class: 'badge due', text: post.status === 'missed' ? t('verpasst') : t('fällig') }) : null));
  }

  /** Detailblatt: Text kopieren, Checkliste abhaken, abschliessen. */
  function openPost(post) {
    const sheet = el('div', { class: 'sheet', onClick: (event) => { if (event.target === sheet) sheet.remove(); } });

    const text = [post.title, post.body, (post.hashtags || []).map((tag) => `#${tag}`).join(' ')]
      .filter(Boolean)
      .join('\n\n');

    const checklist = el('div', {});
    const renderChecklist = () => {
      checklist.replaceChildren(...(post.checklist || []).map((item, index) =>
        el('label', { class: `check ${item.done ? 'done' : ''}` },
          el('input', {
            type: 'checkbox',
            ...(item.done ? { checked: true } : {}),
            onChange: async (event) => {
              item.done = event.target.checked;
              renderChecklist();
              await send('checklist', { id: post.id, index, done: item.done });
            },
          }),
          el('span', { text: item.text }))));
    };
    renderChecklist();

    sheet.append(el('div', { class: 'sheet__inner' },
      el('h1', { text: post.title || t('Ohne Titel') }),
      el('div', { class: 'sub', text: timeText(post.scheduledAt) }),
      marks(post.platforms),

      post.body ? el('div', { class: 'card', style: 'white-space:pre-wrap', text: post.body }) : null,
      (post.hashtags || []).length
        ? el('div', { class: 'card card--tight small', style: 'color:var(--accent)', text: post.hashtags.map((tag) => `#${tag}`).join(' ') })
        : null,

      (post.checklist || []).length ? el('h2', { text: t('Checkliste') }) : null,
      checklist,

      el('div', { class: 'col', style: 'margin-top:18px' },
        el('button', {
          class: 'btn btn--block',
          text: t('Text kopieren'),
          onClick: async () => {
            try {
              await navigator.clipboard.writeText(text);
              toast(t('Kopiert.'), 'ok');
            } catch {
              toast(t('Kopieren ging nicht – Text markieren und halten.'), 'warn');
            }
          },
        }),
        el('button', {
          class: 'btn btn--block btn--primary',
          text: t('Als veröffentlicht markieren'),
          onClick: async () => {
            const result = await send('post-status', { id: post.id, status: 'published' });
            toast(result.queued ? t('Gemerkt – wird nachgereicht.') : t('Abgehakt.'), result.queued ? 'warn' : 'ok');
            sheet.remove();
            load({ silent: true });
          },
        }),
        el('button', { class: 'btn btn--block btn--ghost', text: t('Schliessen'), onClick: () => sheet.remove() }))));

    document.body.append(sheet);
  }

  function renderIdeas() {
    const input = el('textarea', { class: 'textarea', placeholder: t('Idee festhalten, bevor sie weg ist …') });

    const save = async () => {
      const title = input.value.trim();
      if (!title) return toast(t('Erst etwas eintippen.'), 'warn');
      const result = await send('ideas', { title });
      input.value = '';
      toast(result.queued ? t('Gemerkt – wird nachgereicht.') : t('Im Eingang gelandet.'), result.queued ? 'warn' : 'ok');
      load({ silent: true });
    };

    return [
      el('h1', { text: t('Ideen') }),
      el('div', { class: 'sub', text: t('Unterwegs fällt am meisten ein. Hier landet es sofort im Vorrat am PC.') }),
      el('div', { class: 'card' },
        input,
        el('button', { class: 'btn btn--primary btn--block', style: 'margin-top:10px', text: t('Speichern'), onClick: save })),

      el('h2', { text: t('Im Vorrat') }),
      (state.data?.ideas || []).length
        ? (state.data.ideas || []).map((idea) =>
            el('div', { class: 'card card--tight' },
              el('div', { class: 'row between' },
                el('span', { class: 'grow truncate', text: idea.title }),
                el('span', { class: 'badge', text: idea.status }))))
        : el('div', { class: 'empty' }, el('b', { text: t('Noch nichts da') }), t('Die erste Idee wartet auf dich.')),
    ];
  }

  function renderNumbers() {
    const active = (state.data?.platforms || []).map(platformOf).filter(Boolean);
    let chosen = active[0]?.id || null;

    const fields = el('div', {});
    const inputs = new Map();

    const renderFields = () => {
      inputs.clear();
      const platform = platformOf(chosen);
      fields.replaceChildren(...(platform?.metrics || []).slice(0, 6).map((key) => {
        const input = el('input', { class: 'input', type: 'number', inputmode: 'decimal' });
        inputs.set(key, input);
        return el('label', { class: 'field' }, el('span', { text: LABELS[key] ? t(LABELS[key]) : key }), input);
      }));
    };

    const chips = el('div', { class: 'chips', style: 'margin-bottom:14px' },
      ...active.map((platform) =>
        el('button', {
          class: `chip ${platform.id === chosen ? 'on' : ''}`,
          text: platform.name,
          onClick: (event) => {
            chosen = platform.id;
            for (const chip of event.target.parentElement.children) chip.classList.remove('on');
            event.target.classList.add('on');
            renderFields();
          },
        })));
    renderFields();

    const dateInput = el('input', { class: 'input', type: 'date', value: new Date().toISOString().slice(0, 10) });
    const titleInput = el('input', { class: 'input', placeholder: t('Bezeichnung, z. B. Videotitel') });

    return [
      el('h1', { text: t('Zahlen') }),
      el('div', { class: 'sub', text: t('Werte direkt aus der Studio-App abtippen – sie landen sofort in der Auswertung am PC.') }),
      chips,
      el('div', { class: 'card' },
        el('label', { class: 'field' }, el('span', { text: t('Datum') }), dateInput),
        el('label', { class: 'field' }, el('span', { text: t('Bezeichnung') }), titleInput),
        fields,
        el('button', {
          class: 'btn btn--primary btn--block',
          text: t('Speichern'),
          onClick: async () => {
            const metrics = {};
            for (const [key, input] of inputs) {
              if (input.value.trim() !== '') metrics[key] = Number(input.value);
            }
            if (!Object.keys(metrics).length) return toast(t('Mindestens einen Wert eintragen.'), 'warn');
            const result = await send('analytics', {
              platformId: chosen,
              date: dateInput.value,
              title: titleInput.value.trim(),
              metrics,
            });
            for (const input of inputs.values()) input.value = '';
            titleInput.value = '';
            toast(result.queued ? t('Gemerkt – wird nachgereicht.') : t('Erfasst.'), result.queued ? 'warn' : 'ok');
          },
        })),
    ];
  }

  /** Kennzahl-Namen fürs Eintippen – übersetzt wird beim Anzeigen. */
  const LABELS = {
    views: mark('Aufrufe'), impressions: mark('Impressionen'), reach: mark('Reichweite'), ctr: mark('Klickrate (%)'),
    avgViewSec: mark('Ø Dauer (Sek.)'), completionRate: mark('Abschlussrate (%)'), watchHours: mark('Wiedergabezeit (Std.)'),
    likes: 'Likes', comments: mark('Kommentare'), shares: mark('Geteilt'), saves: mark('Gespeichert'),
    followersGained: mark('Neue Follower'), subsGained: mark('Neue Abos'), profileVisits: mark('Profilaufrufe'),
    linkClicks: mark('Linkklicks'), replies: mark('Antworten'), reposts: 'Reposts', bookmarks: mark('Lesezeichen'),
    avgViewers: mark('Ø Zuschauer'), peakViewers: mark('Spitze'), hoursWatched: mark('Gesehene Stunden'),
    chatMessages: mark('Chatnachrichten'), streamMinutes: mark('Streamdauer (Min.)'), upvotes: 'Upvotes',
    repins: mark('Merken'), outboundClicks: mark('Ausgehende Klicks'), openRate: mark('Öffnungsrate (%)'),
    storyReplies: mark('Story-Antworten'), storyExits: mark('Story-Absprünge'), unsubscribes: mark('Abmeldungen'),
    engagementRate: 'Engagement (%)',
  };

  // ---------------------------------------------------------------- Aufbau

  function render() {
    tabbar.hidden = false;
    applyStatic();
    const queued = readStore(KEY_QUEUE, []).length;

    const content = state.tab === 'ideas' ? renderIdeas()
      : state.tab === 'numbers' ? renderNumbers()
      : renderToday();

    app.replaceChildren(
      !state.online
        ? el('div', { class: 'offline' },
            el('div', { class: 'strong', text: t('Keine Verbindung zum PC') }),
            el('div', { class: 'small', text: queued ? t('{count} Eingabe(n) warten auf die Übertragung.', { count: queued }) : t('Die App ist nutzbar, Eingaben werden nachgereicht.') }))
        : null,
      ...[content].flat().filter(Boolean));

    for (const tab of tabbar.children) {
      tab.classList.toggle('is-active', tab.dataset.tab === state.tab);
    }
  }

  for (const tab of tabbar.children) {
    tab.addEventListener('click', () => {
      state.tab = tab.dataset.tab;
      render();
    });
  }

  window.addEventListener('online', () => load({ silent: true }));
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) load({ silent: true });
  });
  setInterval(() => { if (!document.hidden) load({ silent: true }); }, 45_000);

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => { /* ohne Offline-Puffer geht es auch */ });
  }

  applyStatic();
  if (!token()) renderPairing();
  else load();
})();
