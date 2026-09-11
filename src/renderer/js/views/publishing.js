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

export const title = 'Veröffentlichen';
export const lead = 'Einmal anmelden – danach gehen Beiträge zum Termin von selbst raus.';

const GUIDE = 'https://github.com/MoinMornhart/content-helper/blob/main/docs/VEROEFFENTLICHEN.md';
const APP_REDIRECT = 'https://moinmornhart.github.io/content-helper/anmeldung/';

/** Die Anmeldungen, in der Reihenfolge, in der Creator sie meist brauchen. */
const ACCOUNTS = [
  {
    id: 'youtube', signIn: 'youtube', setup: 'google', glyph: 'youtube', name: 'YouTube', covers: 'YouTube und YouTube Shorts',
    native: true, where: 'im Browser',
    note: 'Das Video wird gleich nach dem Einplanen hochgeladen, YouTube schaltet es zum Termin selbst frei. Dein PC darf dann aus sein.',
    fields: [['clientId', 'Client-ID'], ['clientSecret', 'Client-Secret']],
    redirect: null,
  },
  {
    id: 'tiktok', signIn: 'tiktok', setup: 'tiktok', glyph: 'tiktok', name: 'TikTok', covers: 'TikTok',
    native: false, where: 'im Browser',
    note: 'TikTok kann nicht vorausplanen: Der Beitrag geht zum Termin raus – dein PC muss dann laufen.',
    fields: [['clientKey', 'Client Key'], ['clientSecret', 'Client Secret']],
    redirect: 'http://127.0.0.1:51789/callback/',
  },
  {
    id: 'meta', signIn: 'meta', setup: 'meta', glyph: 'instagram_reels', name: 'Instagram & Facebook', covers: 'Instagram-Reels und deine Facebook-Seite',
    native: null, where: 'in einem Anmeldefenster',
    note: 'Eine Anmeldung über Facebook für beide. Facebook plant selbst; Instagram-Reels gehen zum Termin raus, dein PC muss dann laufen.',
    fields: [['appId', 'App-ID'], ['appSecret', 'App-Geheimcode'], ['configId', 'Konfigurations-ID (nur bei „Facebook Login for Business“)']],
    redirect: 'https://www.facebook.com/connect/login_success.html',
  },
  {
    id: 'linkedin', signIn: 'linkedin', setup: 'linkedin', glyph: 'linkedin', name: 'LinkedIn', covers: 'dein LinkedIn-Profil',
    native: false, where: 'in einem Anmeldefenster',
    note: 'Geht zum Termin raus – dein PC muss dann laufen. LinkedIn verlangt alle 60 Tage eine neue Bestätigung; die App erinnert dich vorher.',
    fields: [['clientId', 'Client-ID'], ['clientSecret', 'Client-Secret']],
    redirect: APP_REDIRECT,
  },
  {
    id: 'x', signIn: 'x', setup: 'x', glyph: 'x', name: 'X (Twitter)', covers: 'dein X-Konto',
    native: false, where: 'in einem Anmeldefenster',
    note: 'Geht zum Termin raus – dein PC muss dann laufen. X rechnet jeden Post über die Schnittstelle einzeln ab (derzeit 1,5 Cent), bezahlt vom Entwicklerkonto der Anwendung.',
    fields: [['clientId', 'Client-ID (OAuth 2.0)']],
    redirect: APP_REDIRECT,
  },
];

const unwrap = (result) => {
  if (!result?.ok) throw new Error(result?.error || 'Unbekannter Fehler');
  return result.data;
};

// ------------------------------------------------------------------ Einrichten

/**
 * Einmaliger Schritt für den Herausgeber, solange die Kennungen nicht fest im
 * Installationspaket stecken. Nutzer der fertigen App sehen das nie.
 */
function setupDialog(account, refresh) {
  const inputs = Object.fromEntries(account.fields.map(([key]) => [key, h('input.input', { placeholder: key === 'configId' ? 'optional' : '' })]));

  modal({
    title: `${account.name}: Anwendung hinterlegen`,
    body: h('div.col.gap-lg', null,
      h('div.notice.notice--accent', null,
        h('span.notice__icon', { text: 'ℹ' }),
        h('div.text-sm.muted', { text: `${account.name} gibt Uploads nur an registrierte Anwendungen frei. Diese Anwendung legt der Herausgeber des Content Helpers einmal an und trägt die Werte hier ein – oder sie stecken schon im Installationspaket, dann entfällt dieser Schritt. Wer die App nur benutzt, meldet sich einfach an.` })),
      account.redirect
        ? h('div.col.gap-sm', null,
            h('div.field__label', { text: 'Diese Rückleitungsadresse in der Anwendung eintragen' }),
            h('div.row.gap-sm', null,
              h('code.mono.text-xs.grow', { text: account.redirect, style: { padding: '8px 10px', background: 'var(--surface-2)', borderRadius: '8px', wordBreak: 'break-all' } }),
              h('button.btn.btn--sm', { text: 'Kopieren', onClick: () => copy(account.redirect, 'Adresse kopiert.') })))
        : h('p.text-sm.muted', { text: 'Bei Google als Anwendungstyp „Desktop-App“ wählen – eine Rückleitungsadresse ist dann nicht nötig.' }),
      ...account.fields.map(([key, label]) => h('label.field', null, h('span.field__label', { text: label }), inputs[key])),
      h('button.btn.btn--ghost.btn--sm', { text: 'Schritt-für-Schritt-Anleitung öffnen', onClick: () => window.ch.system.openExternal(GUIDE) })),
    actions: [
      { label: 'Abbrechen' },
      {
        label: 'Speichern',
        primary: true,
        action: async () => {
          const values = Object.fromEntries(Object.entries(inputs).map(([key, input]) => [key, input.value.trim()]));
          const missing = account.fields.filter(([key]) => key !== 'configId' && !values[key]);
          if (missing.length) {
            toast(`Bitte ${missing.map(([, label]) => label).join(' und ')} eintragen.`, 'warn');
            return false;
          }
          await window.ch.publish.setup(account.setup, values);
          toast('Gespeichert. Jetzt kannst du dich anmelden.', 'ok');
          refresh();
          return true;
        },
      },
    ],
  });
}

async function signIn(account, refresh, button) {
  button.disabled = true;
  button.textContent = 'Warte auf Anmeldung …';
  const close = toast(`Die Anmeldung läuft ${account.where}. Bestätige dort den Zugriff.`, 'info', 300000);
  try {
    unwrap(await window.ch.publish.signIn(account.signIn));
    close();
    toast(`${account.name} ist verbunden.`, 'ok');
    refresh();
  } catch (error) {
    close();
    toast(error.message, 'danger', 9000);
    button.disabled = false;
    button.textContent = 'Anmelden';
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
    ? h('span.badge.badge--ok', { text: 'verbunden' })
    : needsSetup
      ? h('span.badge.badge--warn', { text: 'einmalig einrichten' })
      : h('span.badge', { text: 'nicht verbunden' });

  const signInButton = h('button.btn.btn--primary', { text: 'Anmelden' });
  signInButton.addEventListener('click', () => signIn(account, refresh, signInButton));

  const body = [];
  if (connected && isMeta) {
    body.push(accountLine(meta.pages?.find((page) => page.id === meta.pageId)?.picture, meta.userName || 'Angemeldet', `seit ${fmt.relative(meta.connectedAt)}`));
    if ((meta.pages || []).length > 1) {
      body.push(h('label.field', null,
        h('span.field__label', { text: 'Facebook-Seite' }),
        h('select.select', {
          onChange: async (event) => {
            await window.ch.publish.selectPage(event.target.value);
            refresh();
          },
        }, ...meta.pages.map((page) => h('option', {
          value: page.id,
          selected: page.id === meta.pageId,
          text: `${page.name}${page.instagram?.username ? ` · Instagram @${page.instagram.username}` : ' · ohne Instagram'}`,
        })))));
    }
    body.push(h('div.row.wrap.gap-sm', null,
      h(`span.badge${instagram.connected ? '.badge--ok' : '.badge--warn'}`, { text: instagram.connected ? `Instagram ${instagram.account}` : 'Instagram: kein Profikonto verbunden' }),
      h(`span.badge${facebook.connected ? '.badge--ok' : ''}`, { text: facebook.connected ? `Facebook: ${facebook.account}` : 'Facebook: keine Seite' })));
    if (!instagram.connected) {
      body.push(h('p.text-xs.faint', { text: 'Für Instagram braucht es ein Profikonto (Business oder Creator), das in den Instagram-Einstellungen mit dieser Facebook-Seite verbunden ist.' }));
    }
  } else if (connected) {
    body.push(accountLine(provider.avatar, provider.account || 'Angemeldet', provider.connectedAt ? `seit ${fmt.relative(provider.connectedAt)}` : null));
    if (provider.expiringSoon) {
      body.push(h('div.notice.notice--warn', null,
        h('span.notice__icon', { text: '!' }),
        h('div.text-sm', { text: `Die Anmeldung läuft ${fmt.relative(provider.expiresAt)} ab. Einmal neu anmelden, dann gilt sie wieder 60 Tage.` })));
    }
  }

  return card(null, { class: connected ? 'card--accent' : '' },
    h('div.row.gap-sm.mb', null,
      glyph(account.glyph, 26),
      isMeta ? glyph('facebook', 22) : null,
      h('h3.grow', { text: account.name }),
      badge),
    h('p.text-sm.muted.mb', { text: account.note }),
    body.length ? h('div.col.gap-sm.mb', null, ...body) : null,
    lastError && !connected
      ? h('div.notice.notice--danger.mb', null, h('span.notice__icon', { text: '✕' }), h('div.text-sm', { text: lastError }))
      : null,
    h('div.row.wrap.gap-sm', null,
      connected
        ? h('button.btn.btn--sm', {
            text: 'Abmelden',
            onClick: async () => {
              if (!(await confirm({
                title: `Von ${account.name} abmelden?`,
                message: 'Geplante Beiträge für diese Plattform gehen dann nicht mehr von selbst raus – die App erinnert dich stattdessen.',
                confirmLabel: 'Abmelden',
                tone: 'danger',
              }))) return;
              await window.ch.publish.signOut(account.signIn);
              refresh();
            },
          })
        : needsSetup
          ? h('button.btn.btn--primary', { text: 'Einrichten', onClick: () => setupDialog(account, refresh) })
          : signInButton,
      connected && provider.expiringSoon ? signInButton : null,
      !connected && !needsSetup
        ? h('button.btn.btn--sm.btn--ghost', { text: 'Anwendung ändern', onClick: () => setupDialog(account, refresh) })
        : null,
      h('span.text-xs.faint.grow', { style: { textAlign: 'right' }, text: account.native === true ? 'plant selbst' : account.native === false ? 'PC muss zum Termin laufen' : '' })));
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
        h('div.stat__label', { text: 'Plattformen automatisch' }),
        h('div.stat__value', { text: `${connected.length} / ${(info.providers || []).length || 6}` }),
        h('div.stat__meta', { text: connected.length ? connected.map((provider) => provider.name).join(', ') : 'noch keine angemeldet' }))),
      card(null, {}, h('div.stat', null,
        h('div.stat__label', { text: 'Warten auf ihren Termin' }),
        h('div.stat__value', { text: String(waiting.length) }),
        h('div.stat__meta', { text: waiting.length ? `nächster ${fmt.relative(waiting.map((post) => post.scheduledAt).sort()[0])}` : 'nichts eingeplant' }))),
      card(null, {}, h('div.stat', null,
        h('div.stat__label', { text: 'Zuletzt automatisch' }),
        h('div.stat__value', { text: lastPublished ? fmt.relative(lastPublished.at) : '–', style: { fontSize: '21px' } }),
        h('div.stat__meta', { text: lastPublished?.title || 'noch nichts veröffentlicht' })))),

    info.primary
      ? null
      : h('div.notice.notice--warn', null,
          h('span.notice__icon', { text: '!' }),
          h('div', null,
            h('div.strong.text-sm', { text: 'Veröffentlicht wird auf deinem anderen PC' }),
            h('div.text-sm.muted', { text: 'Mehrere PCs sind verbunden – damit nichts doppelt rausgeht, veröffentlicht nur der PC, der auch YouTube und Twitch abholt. Anmelden musst du dich deshalb dort. Umstellen kannst du das unter „PCs verbinden“.' }),
            h('button.btn.btn--sm.mt-sm', { text: 'PCs verbinden öffnen', onClick: () => goto('devices') }))),

    h('div.grid.grid-2', null, ...ACCOUNTS.map((account) => accountCard(account, info, refresh))),

    card('Damit nichts verpasst wird', {},
      h('p.text-sm.muted.mb', { text: 'Wo die Plattform nicht selbst planen kann, postet die App zum Termin. Beim Schließen des Fensters bleibt sie deshalb im Infobereich aktiv. War der PC aus, holt sie verpasste Beiträge beim nächsten Start nach – bis zu einem Tag später, danach fragt sie lieber nach.' }),
      h('div.col.gap-sm', null,
        toggle('Mit Windows starten (unsichtbar im Infobereich)', Boolean(settings.launchOnStartup), async (value) => {
          await window.ch.system.setStartup(value);
          await store.saveSettings({ launchOnStartup: value });
          toast(value ? 'Startet ab jetzt mit Windows.' : 'Startet nicht mehr mit Windows.', 'ok');
        }),
        toggle('Beim Schließen im Infobereich weiterlaufen', settings.minimizeToTray !== false, async (value) => {
          await store.saveSettings({ minimizeToTray: value });
        }))),

    h('div.notice', null,
      h('span.notice__icon', { text: 'ℹ' }),
      h('div', null,
        h('div.strong.text-sm', { text: 'Was bei der Anmeldung passiert' }),
        h('div.text-sm.muted', { text: 'Dein Passwort sieht die App nie – die Plattform gibt ihr nur ein widerrufbares Merkmal, das auf diesem PC bleibt und beim Abgleich zwischen PCs nicht übertragen wird. Hochgeladen wird nur, was du einplanst.' }))));
}
