/**
 * Veröffentlichen: einmal bei jeder Plattform anmelden – danach gehen
 * geplante Beiträge zum Termin von selbst raus, wie bei Buffer.
 *
 * YouTube und Facebook planen selbst (das Video liegt vorher dort, der PC darf
 * zum Termin aus sein). TikTok, Instagram, LinkedIn und X können das nicht –
 * dort postet die App zum Termin, der PC muss dann laufen.
 */

import { h, card, fill } from '../lib/dom.js';
import * as fmt from '../lib/format.js';
import * as store from '../lib/store.js';
import { glyph } from '../lib/platforms.js';
import { toast, confirm, modal, copy, toggle } from '../lib/ui.js';
import { t, mark, language } from '../lib/i18n.js';

export const title = mark('Veröffentlichen');
export const lead = mark('Einmal anmelden – danach gehen Beiträge zum Termin von selbst raus.');

/** Ausführliche Anleitung – in der Sprache der Oberfläche. */
const guideUrl = () => `https://github.com/MoinMornhart/content-helper/blob/main/docs/${language() === 'en' ? 'PUBLISHING' : 'VEROEFFENTLICHEN'}.md`;
const APP_REDIRECT = 'https://moinmornhart.github.io/content-helper/anmeldung/';

/** Die Anmeldungen, in der Reihenfolge, in der Creator sie meist brauchen. */
const ACCOUNTS = [
  {
    id: 'youtube', signIn: 'youtube', setup: 'google', glyph: 'youtube', name: 'YouTube', covers: mark('YouTube und YouTube Shorts'),
    native: true, where: mark('im Browser'),
    note: mark('Das Video wird gleich nach dem Einplanen hochgeladen, YouTube schaltet es zum Termin selbst frei. Dein PC darf dann aus sein.'),
    fields: [['clientId', mark('Client-ID')], ['clientSecret', mark('Client-Secret')]],
    redirect: null,
  },
  {
    id: 'tiktok', signIn: 'tiktok', setup: 'tiktok', glyph: 'tiktok', name: 'TikTok', covers: 'TikTok',
    native: false, where: mark('im Browser'),
    note: mark('TikTok kann nicht vorausplanen: Der Beitrag geht zum Termin raus – dein PC muss dann laufen.'),
    fields: [['clientKey', 'Client Key'], ['clientSecret', 'Client Secret']],
    redirect: 'http://127.0.0.1:51789/callback/',
  },
  {
    id: 'meta', signIn: 'meta', setup: 'meta', glyph: 'instagram_reels', name: 'Instagram & Facebook', covers: mark('Instagram-Reels und deine Facebook-Seite'),
    native: null, where: mark('in einem Anmeldefenster'),
    note: mark('Eine Anmeldung über Facebook für beide. Facebook plant selbst; Instagram-Reels gehen zum Termin raus, dein PC muss dann laufen.'),
    fields: [['appId', mark('App-ID')], ['appSecret', mark('App-Geheimcode')], ['configId', mark('Konfigurations-ID (nur bei „Facebook Login for Business“)')]],
    redirect: 'https://www.facebook.com/connect/login_success.html',
  },
  {
    id: 'linkedin', signIn: 'linkedin', setup: 'linkedin', glyph: 'linkedin', name: 'LinkedIn', covers: mark('dein LinkedIn-Profil'),
    native: false, where: mark('in einem Anmeldefenster'),
    note: mark('Geht zum Termin raus – dein PC muss dann laufen. LinkedIn verlangt alle 60 Tage eine neue Bestätigung; die App erinnert dich vorher.'),
    fields: [['clientId', mark('Client-ID')], ['clientSecret', mark('Client-Secret')]],
    redirect: APP_REDIRECT,
  },
  {
    id: 'x', signIn: 'x', setup: 'x', glyph: 'x', name: 'X (Twitter)', covers: mark('dein X-Konto'),
    native: false, where: mark('in einem Anmeldefenster'),
    note: mark('Geht zum Termin raus – dein PC muss dann laufen. X rechnet jeden Post über die Schnittstelle einzeln ab (derzeit 1,5 Cent), bezahlt vom Entwicklerkonto der Anwendung.'),
    fields: [['clientId', mark('Client-ID (OAuth 2.0)')]],
    redirect: APP_REDIRECT,
  },
];

const unwrap = (result) => {
  if (!result?.ok) throw new Error(result?.error || t('Unbekannter Fehler'));
  return result.data;
};

// ------------------------------------------------------------------ Einrichten

/**
 * Wo es die Kennungen gibt – je Plattform die direkten Links, in der
 * Reihenfolge, in der man sie braucht. `copy` legt eine Adresse gleich in die
 * Zwischenablage, weil sie dort eingetragen werden muss.
 */
const STEPS = {
  google: [
    { text: mark('Projekt anlegen – Name z. B. „Content Helper“.'), url: 'https://console.cloud.google.com/projectcreate', label: mark('Projekt anlegen') },
    { text: mark('YouTube Data API v3 aktivieren.'), url: 'https://console.cloud.google.com/apis/library/youtube.googleapis.com', label: mark('API aktivieren') },
    { text: mark('Zustimmungsbildschirm: Zielgruppe „Extern“, danach auf „In Produktion“ stellen – im Testmodus läuft die Anmeldung nach 7 Tagen ab.'), url: 'https://console.cloud.google.com/auth/overview', label: mark('Zustimmungsbildschirm') },
    { text: mark('Client erstellen, Typ „Desktop-App“. Dann Client-ID und Secret kopieren – oder die JSON-Datei herunterladen und hier einlesen.'), url: 'https://console.cloud.google.com/auth/clients/create', label: mark('Client erstellen') },
  ],
  tiktok: [
    { text: mark('App anlegen, Plattform „Desktop“.'), url: 'https://developers.tiktok.com/apps/', label: mark('TikTok-Apps öffnen') },
    { text: mark('Produkte „Login Kit“ und „Content Posting API“ hinzufügen, „Direct Post“ einschalten, Bereiche user.info.basic, video.publish und video.upload.') },
    { text: mark('Diese Rückleitungsadresse eintragen:'), copy: 'http://127.0.0.1:51789/callback/' },
    { text: mark('Client Key und Client Secret kopieren.') },
  ],
  meta: [
    { text: mark('App anlegen, Typ „Business“.'), url: 'https://developers.facebook.com/apps/creation/', label: mark('Meta-App anlegen') },
    { text: mark('Produkte „Facebook Login“ und „Instagram“ hinzufügen, bei Facebook Login „Embedded Browser OAuth Login“ einschalten.') },
    { text: mark('Diese Rückleitungsadresse eintragen:'), copy: 'https://www.facebook.com/connect/login_success.html' },
    { text: mark('Unter „App-Einstellungen → Allgemein“ App-ID und App-Geheimcode kopieren.'), url: 'https://developers.facebook.com/apps/', label: mark('Meine Apps') },
  ],
  linkedin: [
    { text: mark('App anlegen (braucht eine LinkedIn-Unternehmensseite).'), url: 'https://www.linkedin.com/developers/apps/new', label: mark('LinkedIn-App anlegen') },
    { text: mark('Unter „Products“: „Share on LinkedIn“ und „Sign In with LinkedIn using OpenID Connect“.') },
    { text: mark('Unter „Auth“ diese Rückleitungsadresse eintragen:'), copy: APP_REDIRECT },
    { text: mark('Client ID und Primary Client Secret kopieren.') },
  ],
  x: [
    { text: mark('Projekt und App anlegen.'), url: 'https://developer.x.com/en/portal/projects-and-apps', label: mark('X-Entwicklerportal') },
    { text: mark('„User authentication settings“: OAuth 2.0, Typ „Native App“, Berechtigung „Read and write“.') },
    { text: mark('Als Callback diese Adresse eintragen:'), copy: APP_REDIRECT },
    { text: mark('Die OAuth-2.0-Client-ID kopieren.') },
  ],
};

/**
 * Einrichten in so wenig Schritten wie möglich: Die richtige Seite öffnet sich,
 * und was dort kopiert wird, landet von selbst im richtigen Feld. Sobald alles
 * da ist, speichert die App und startet die Anmeldung.
 *
 * Einmaliger Schritt für den Herausgeber, solange die Kennungen nicht fest im
 * Installationspaket stecken. Nutzer der fertigen App sehen das nie.
 */
function setupDialog(account, refresh) {
  const steps = STEPS[account.setup] || [];
  const inputs = {};
  const marks = {};
  for (const [key] of account.fields) {
    inputs[key] = h('input.input', { placeholder: key === 'configId' ? t('optional') : t('wird erkannt, sobald du es kopierst') });
    marks[key] = h('span.text-xs.faint', { text: key === 'configId' ? '' : t('wartet …') });
    inputs[key].addEventListener('input', () => {
      marks[key].textContent = inputs[key].value.trim() ? t('✓ eingetragen') : t('wartet …');
    });
  }
  const required = account.fields.map(([key]) => key).filter((key) => key !== 'configId');
  const complete = () => required.every((key) => inputs[key].value.trim());
  let done = false;
  let timer = null;

  const finish = async () => {
    if (done) return;
    done = true;
    clearInterval(timer);
    const values = Object.fromEntries(Object.entries(inputs).map(([key, input]) => [key, input.value.trim()]));
    await window.ch.publish.setup(account.setup, values);
    instance.close(true);
    toast(t('{name} ist eingerichtet – jetzt noch anmelden.', { name: account.name }), 'ok');
    refresh();
    // Direkt weiter zur Anmeldung, damit nichts mehr zu klicken bleibt.
    setTimeout(() => signIn(account, refresh), 400);
  };

  /** Erkanntes eintragen; ist dann alles da, geht es von selbst weiter. */
  const apply = (found, source) => {
    let changed = false;
    for (const [key, value] of Object.entries(found || {})) {
      if (!inputs[key] || inputs[key].value.trim() === value) continue;
      inputs[key].value = value;
      marks[key].textContent = `✓ ${source}`;
      marks[key].style.color = 'var(--ok)';
      changed = true;
    }
    if (changed && complete()) setTimeout(finish, 700);
  };

  const stepRows = steps.map((step, index) => h('div.row.gap-sm', { style: { alignItems: 'flex-start' } },
    h('span.badge.badge--accent', { text: String(index + 1) }),
    h('div.grow.col.gap-xs', null,
      h('div.text-sm', { text: t(step.text) }),
      step.copy
        ? h('div.row.gap-sm', null,
            h('code.mono.text-xs.grow', { text: step.copy, style: { padding: '6px 9px', background: 'var(--surface-2)', borderRadius: '8px', wordBreak: 'break-all' } }),
            h('button.btn.btn--sm', { text: t('Kopieren'), onClick: () => copy(step.copy, t('Adresse kopiert – jetzt dort einfügen.')) }))
        : null),
    step.url ? h('button.btn.btn--sm', { text: `${t(step.label)} ↗`, onClick: () => window.ch.system.openExternal(step.url) }) : null));

  const instance = modal({
    title: t('{name} einrichten', { name: account.name }),
    body: h('div.col.gap-lg', null,
      h('div.notice.notice--accent', null,
        h('span.notice__icon', { text: '✦' }),
        h('div.text-sm.muted', { text: t('Die Seite von {name} hat sich im Browser geöffnet. Was du dort kopierst, trägt die App von selbst ein – sobald alles da ist, geht es direkt weiter zur Anmeldung.', { name: account.name }) })),
      h('div.col.gap-sm', null, ...stepRows),
      h('div.col.gap-sm', null,
        ...account.fields.map(([key, label]) => h('label.field', null,
          h('div.row.between', null, h('span.field__label', { text: t(label) }), marks[key]),
          inputs[key]))),
      h('div.row.wrap.gap-sm', null,
        h('button.btn.btn--sm.btn--ghost', {
          text: account.setup === 'google' ? t('Heruntergeladene JSON-Datei einlesen') : t('Datei mit den Zugangsdaten einlesen'),
          onClick: async () => {
            const result = unwrap(await window.ch.publish.importFile(account.setup));
            if (result.canceled) return;
            if (!Object.keys(result.found || {}).length) return toast(t('In der Datei war nichts, das nach Zugangsdaten aussieht.'), 'warn');
            apply(result.found, t('aus der Datei'));
          },
        }),
        h('button.btn.btn--sm.btn--ghost', { text: t('Ausführliche Anleitung'), onClick: () => window.ch.system.openExternal(guideUrl()) })),
      h('p.text-xs.faint', { text: t('Die Zwischenablage wird nur gelesen, solange dieses Fenster offen ist, und nur übernommen, was wie eine Kennung von dieser Plattform aussieht.') })),
    onClose: () => clearInterval(timer),
    actions: [
      { label: t('Abbrechen') },
      {
        label: t('Speichern und anmelden'),
        primary: true,
        action: async () => {
          if (!complete()) {
            const missing = account.fields.filter(([key]) => required.includes(key) && !inputs[key].value.trim());
            toast(t('Es fehlt noch: {fields}.', { fields: missing.map(([, label]) => t(label)).join(', ') }), 'warn');
            return false;
          }
          await finish();
          return false;
        },
      },
    ],
  });

  // Die erste Seite gleich öffnen und ab jetzt auf Kopiertes achten.
  if (steps[0]?.url) window.ch.system.openExternal(steps[0].url);
  timer = setInterval(async () => {
    if (done) return;
    const result = await window.ch.publish.detectClipboard(account.setup);
    if (result?.ok) apply(result.data, t('aus der Zwischenablage'));
  }, 900);
}

async function signIn(account, refresh, button = null) {
  if (button) {
    button.disabled = true;
    button.textContent = t('Warte auf Anmeldung …');
  }
  const close = toast(t('Die Anmeldung läuft {where}. Bestätige dort den Zugriff.', { where: t(account.where) }), 'info', 300000);
  try {
    unwrap(await window.ch.publish.signIn(account.signIn));
    close();
    toast(t('{name} ist verbunden.', { name: account.name }), 'ok');
    refresh();
  } catch (error) {
    close();
    toast(error.message, 'danger', 9000);
    if (button) {
      button.disabled = false;
      button.textContent = t('Anmelden');
    }
  }
}

// ------------------------------------------------------------------ Karten

function accountLine(avatar, name, meta) {
  return h('div.provider-card__account', null,
    avatar ? h('img.provider-card__avatar', { src: avatar, alt: '' }) : h('div.provider-card__avatar'),
    h('div', null,
      h('div.strong', { text: name }),
      meta ? h('div.text-xs.faint', { text: meta }) : null));
}

function accountCard(account, info, refresh) {
  const providers = info.providers || [];
  const isMeta = account.id === 'meta';
  const meta = info.meta || {};
  const provider = providers.find((entry) => entry.id === account.id) || {};
  const instagram = providers.find((entry) => entry.id === 'instagram') || {};
  const facebook = providers.find((entry) => entry.id === 'facebook') || {};

  const needsSetup = isMeta ? meta.needsSetup : provider.needsSetup;
  const connected = isMeta ? meta.signedIn : provider.connected;
  const lastError = isMeta ? meta.lastError : provider.lastError;

  const badge = connected
    ? h('span.badge.badge--ok', { text: t('verbunden') })
    : needsSetup
      ? h('span.badge.badge--warn', { text: t('einmalig einrichten') })
      : h('span.badge', { text: t('nicht verbunden') });

  const signInButton = h('button.btn.btn--primary', { text: t('Anmelden') });
  signInButton.addEventListener('click', () => signIn(account, refresh, signInButton));

  const body = [];
  if (connected && isMeta) {
    body.push(accountLine(meta.pages?.find((page) => page.id === meta.pageId)?.picture, meta.userName || t('Angemeldet'), t('seit {when}', { when: fmt.relative(meta.connectedAt) })));
    if ((meta.pages || []).length > 1) {
      body.push(h('label.field', null,
        h('span.field__label', { text: t('Facebook-Seite') }),
        h('select.select', {
          onChange: async (event) => {
            await window.ch.publish.selectPage(event.target.value);
            refresh();
          },
        }, ...meta.pages.map((page) => h('option', {
          value: page.id,
          selected: page.id === meta.pageId,
          text: `${page.name}${page.instagram?.username ? ` · Instagram @${page.instagram.username}` : ` · ${t('ohne Instagram')}`}`,
        })))));
    }
    body.push(h('div.row.wrap.gap-sm', null,
      h(`span.badge${instagram.connected ? '.badge--ok' : '.badge--warn'}`, { text: instagram.connected ? `Instagram ${instagram.account}` : t('Instagram: kein Profikonto verbunden') }),
      h(`span.badge${facebook.connected ? '.badge--ok' : ''}`, { text: facebook.connected ? `Facebook: ${facebook.account}` : t('Facebook: keine Seite') })));
    if (!instagram.connected) {
      body.push(h('p.text-xs.faint', { text: t('Für Instagram braucht es ein Profikonto (Business oder Creator), das in den Instagram-Einstellungen mit dieser Facebook-Seite verbunden ist.') }));
    }
  } else if (connected) {
    body.push(accountLine(provider.avatar, provider.account || t('Angemeldet'), provider.connectedAt ? t('seit {when}', { when: fmt.relative(provider.connectedAt) }) : null));
    if (provider.expiringSoon) {
      body.push(h('div.notice.notice--warn', null,
        h('span.notice__icon', { text: '!' }),
        h('div.text-sm', { text: t('Die Anmeldung läuft {when} ab. Einmal neu anmelden, dann gilt sie wieder 60 Tage.', { when: fmt.relative(provider.expiresAt) }) })));
    }
  }

  return card(null, { class: connected ? 'card--accent' : '' },
    h('div.row.gap-sm.mb', null,
      glyph(account.glyph, 26),
      isMeta ? glyph('facebook', 22) : null,
      h('h3.grow', { text: account.name }),
      badge),
    h('p.text-sm.muted.mb', { text: t(account.note) }),
    body.length ? h('div.col.gap-sm.mb', null, ...body) : null,
    lastError && !connected
      ? h('div.notice.notice--danger.mb', null, h('span.notice__icon', { text: '✕' }), h('div.text-sm', { text: lastError }))
      : null,
    h('div.row.wrap.gap-sm', null,
      connected
        ? h('button.btn.btn--sm', {
            text: t('Abmelden'),
            onClick: async () => {
              if (!(await confirm({
                title: t('Von {name} abmelden?', { name: account.name }),
                message: t('Geplante Beiträge für diese Plattform gehen dann nicht mehr von selbst raus – die App erinnert dich stattdessen.'),
                confirmLabel: t('Abmelden'),
                tone: 'danger',
              }))) return;
              await window.ch.publish.signOut(account.signIn);
              refresh();
            },
          })
        : needsSetup
          ? h('button.btn.btn--primary', { text: t('Einrichten'), onClick: () => setupDialog(account, refresh) })
          : signInButton,
      connected && provider.expiringSoon ? signInButton : null,
      !connected && !needsSetup
        ? h('button.btn.btn--sm.btn--ghost', { text: t('Anwendung ändern'), onClick: () => setupDialog(account, refresh) })
        : null,
      h('span.text-xs.faint.grow', { style: { textAlign: 'right' }, text: account.native === true ? t('plant selbst') : account.native === false ? t('PC muss zum Termin laufen') : '' })));
}

// ------------------------------------------------------------------ Ansicht

export async function render({ setActions, refresh, goto }) {
  setActions();
  const info = unwrap(await window.ch.publish.status());
  const settings = store.settings();

  const connected = (info.providers || []).filter((provider) => provider.connected);
  const automaticIds = new Set(connected.flatMap((provider) => provider.platformIds));
  const waiting = store.all('posts').filter((post) =>
    ['scheduled', 'publishing'].includes(post.status) && (post.platforms || []).some((id) => automaticIds.has(id)));
  const lastPublished = store.all('activity')
    .filter((entry) => entry.type === 'published')
    .sort((a, b) => String(b.at).localeCompare(String(a.at)))[0];

  return h('div.col.gap-lg', null,
    h('div.grid.grid-3', null,
      card(null, {}, h('div.stat', null,
        h('div.stat__label', { text: t('Plattformen automatisch') }),
        h('div.stat__value', { text: `${connected.length} / ${(info.providers || []).length || 6}` }),
        h('div.stat__meta', { text: connected.length ? connected.map((provider) => provider.name).join(', ') : t('noch keine angemeldet') }))),
      card(null, {}, h('div.stat', null,
        h('div.stat__label', { text: t('Warten auf ihren Termin') }),
        h('div.stat__value', { text: String(waiting.length) }),
        h('div.stat__meta', { text: waiting.length ? t('nächster {when}', { when: fmt.relative(waiting.map((post) => post.scheduledAt).sort()[0]) }) : t('nichts eingeplant') }))),
      card(null, {}, h('div.stat', null,
        h('div.stat__label', { text: t('Zuletzt automatisch') }),
        h('div.stat__value', { text: lastPublished ? fmt.relative(lastPublished.at) : '–', style: { fontSize: '21px' } }),
        h('div.stat__meta', { text: lastPublished?.title || t('noch nichts veröffentlicht') })))),

    info.primary
      ? null
      : h('div.notice.notice--warn', null,
          h('span.notice__icon', { text: '!' }),
          h('div', null,
            h('div.strong.text-sm', { text: t('Veröffentlicht wird auf deinem anderen PC') }),
            h('div.text-sm.muted', { text: t('Mehrere PCs sind verbunden – damit nichts doppelt rausgeht, veröffentlicht nur der PC, der auch YouTube und Twitch abholt. Anmelden musst du dich deshalb dort. Umstellen kannst du das unter „PCs verbinden“.') }),
            h('button.btn.btn--sm.mt-sm', { text: t('PCs verbinden öffnen'), onClick: () => goto('devices') }))),

    h('div.grid.grid-2', null, ...ACCOUNTS.map((account) => accountCard(account, info, refresh))),

    card(t('Damit nichts verpasst wird'), {},
      h('p.text-sm.muted.mb', { text: t('Wo die Plattform nicht selbst planen kann, postet die App zum Termin. Beim Schließen des Fensters bleibt sie deshalb im Infobereich aktiv. War der PC aus, holt sie verpasste Beiträge beim nächsten Start nach – bis zu einem Tag später, danach fragt sie lieber nach.') }),
      h('div.col.gap-sm', null,
        toggle(t('Mit Windows starten (unsichtbar im Infobereich)'), Boolean(settings.launchOnStartup), async (value) => {
          await window.ch.system.setStartup(value);
          await store.saveSettings({ launchOnStartup: value });
          toast(value ? t('Startet ab jetzt mit Windows.') : t('Startet nicht mehr mit Windows.'), 'ok');
        }),
        toggle(t('Beim Schließen im Infobereich weiterlaufen'), settings.minimizeToTray !== false, async (value) => {
          await store.saveSettings({ minimizeToTray: value });
        }))),

    h('div.notice', null,
      h('span.notice__icon', { text: 'ℹ' }),
      h('div', null,
        h('div.strong.text-sm', { text: t('Was bei der Anmeldung passiert') }),
        h('div.text-sm.muted', { text: t('Dein Passwort sieht die App nie – die Plattform gibt ihr nur ein widerrufbares Merkmal, das auf diesem PC bleibt und beim Abgleich zwischen PCs nicht übertragen wird. Hochgeladen wird nur, was du einplanst.') }))));
}
