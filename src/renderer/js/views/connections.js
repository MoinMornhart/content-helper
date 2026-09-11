/**
 * Verbindungen: Kanäle anbinden, damit Zahlen von selbst hereinkommen.
 *
 * Twitch läuft über eine gewöhnliche Anmeldung mit dem eigenen Konto – kein
 * Geheimnis, kein Kanalname, kein Nachschlagen. YouTube braucht nicht einmal
 * das, dort genügt der offene Kanal-Feed.
 */

import { h, card, fill } from '../lib/dom.js';
import * as fmt from '../lib/format.js';
import * as store from '../lib/store.js';
import { glyph } from '../lib/platforms.js';
import { toast, confirm, modal, copy } from '../lib/ui.js';
import { t, mark } from '../lib/i18n.js';

export const title = mark('Verbindungen');
export const lead = mark('Automatisch statt abtippen – so weit die Plattformen es zulassen.');

async function status() {
  const result = await window.ch.connectors.status();
  return result?.ok ? result.data : { twitch: {}, youtube: {} };
}

async function twitchAuthStatus() {
  const result = await window.ch.twitch.authStatus();
  return result?.ok ? result.data : { signedIn: false, needsClientId: true };
}

/** Ergebnis eines Abgleichs in einen Satz fassen. */
function describeSync(result) {
  const parts = [];
  if (result.added) parts.push(`${fmt.plural(result.added, 'neuer Eintrag', 'neue Einträge')}`); // i18n-ignore – plural() übersetzt
  if (result.updated) parts.push(t('{count} aufgefrischt', { count: result.updated }));
  if (result.posts) parts.push(t('{posts} übernommen', { posts: fmt.plural(result.posts, 'Beitrag', 'Beiträge') })); // i18n-ignore – plural() übersetzt
  if (result.ideas) parts.push(`${fmt.plural(result.ideas, 'Clip-Idee', 'Clip-Ideen')}`);
  if (result.channel?.followers != null) parts.push(t('{count} Follower', { count: fmt.num(result.channel.followers) }));
  if (result.live?.live) parts.push(t('Stream läuft gerade'));
  return parts.length ? parts.join(' · ') : t('Nichts Neues gefunden.');
}

async function runSync(name, refresh) {
  toast(t('Hole die neuesten Daten …'), 'info', 1600);
  const result = await window.ch.connectors.sync(name);
  if (!result?.ok) return toast(result?.error || t('Abgleich fehlgeschlagen.'), 'danger', 6000);
  await store.reload();
  toast(describeSync(result.data[name] || result.data), 'ok', 5000);
  refresh();
}

// ------------------------------------------------------------------ Twitch-Anmeldung

/**
 * Einmaliger Schritt, falls keine Client-ID eingebaut ist.
 *
 * Bewusst kurz gehalten: gebraucht wird genau ein Wert, und der ist kein
 * Geheimnis. Ein Client-Secret ist für diesen Anmeldeweg nicht nötig.
 */
function clientIdDialog(refresh) {
  const input = h('input.input', { placeholder: t('wird erkannt, sobald du sie kopierst') });
  const mark = h('span.text-xs.faint', { text: t('wartet …') });
  let timer = null;
  let done = false;

  const saveAndSignIn = async () => {
    if (done) return;
    if (!input.value.trim()) {
      toast(t('Bitte die Client-ID einfügen.'), 'warn');
      return;
    }
    const result = await window.ch.twitch.setClientId(input.value.trim());
    if (!result?.ok) {
      toast(result?.error || t('Speichern fehlgeschlagen.'), 'danger');
      return;
    }
    done = true;
    clearInterval(timer);
    instance.close();
    signIn(refresh);
  };

  const instance = modal({
    title: t('Einmalig: Twitch-Client-ID'),
    body: h('div.col.gap-lg', null,
      h('div.notice.notice--accent', null,
        h('span.notice__icon', { text: 'ℹ' }),
        h('div', null,
          h('div.strong.text-sm', { text: t('Warum das nicht ganz entfallen kann') }),
          h('div.text-sm.muted', { text: t('Twitch gibt Daten ausschliesslich an registrierte Anwendungen heraus – ohne Ausnahme, für jedes Programm. Die Client-ID ist dabei kein Passwort: sie steht in jeder öffentlichen App im Klartext. Du trägst sie genau einmal ein, danach meldest du dich nur noch ganz normal mit deinem Twitch-Konto an.') }))),

      h('div.col.gap-lg', null,
        h('div.row.gap-sm', { style: { alignItems: 'flex-start' } },
          h('span.badge.badge--accent', { text: '1' }),
          h('div', null,
            h('div.strong.text-sm', { text: t('Anwendung anlegen') }),
            h('div.text-sm.muted', { text: t('dev.twitch.tv öffnen, „Anwendung registrieren“. Name frei wählbar.') }))),
        h('div.row.gap-sm', { style: { alignItems: 'flex-start' } },
          h('span.badge.badge--accent', { text: '2' }),
          h('div', null,
            h('div.strong.text-sm', { text: t('Clienttyp: Öffentlich') }),
            h('div.text-sm.muted', { text: t('Als OAuth-Weiterleitung http://localhost eintragen, Kategorie „Application Integration“. Ein Secret brauchst du nicht.') }))),
        h('div.row.gap-sm', { style: { alignItems: 'flex-start' } },
          h('span.badge.badge--accent', { text: '3' }),
          h('div', null,
            h('div.strong.text-sm', { text: t('Client-ID kopieren') }),
            h('div.text-sm.muted', { text: t('Sie steht direkt auf der Seite der Anwendung – hier einfügen.') })))),

      h('button.btn.btn--sm', {
        text: t('dev.twitch.tv öffnen'),
        onClick: () => window.ch.system.openExternal('https://dev.twitch.tv/console/apps/create'),
      }),

      h('label.field', null, h('div.row.between', null, h('span.field__label', { text: t('Client-ID') }), mark), input),
      h('p.text-xs.faint', { text: t('Kopierst du die Client-ID auf der Twitch-Seite, trägt die App sie von selbst ein und startet die Anmeldung. Die Zwischenablage wird nur gelesen, solange dieses Fenster offen ist.') })),

    onClose: () => clearInterval(timer),
    actions: [
      {
        label: t('Speichern und anmelden'),
        primary: true,
        action: async () => {
          await saveAndSignIn();
          return false;
        },
      },
    ],
  });

  // Die Twitch-Seite gleich öffnen und auf die kopierte Client-ID achten.
  window.ch.system.openExternal('https://dev.twitch.tv/console/apps/create');
  timer = setInterval(async () => {
    if (done) return;
    const result = await window.ch.publish.detectClipboard('twitch');
    const value = result?.ok ? result.data.clientId : null;
    if (!value || input.value.trim() === value) return;
    input.value = value;
    mark.textContent = t('✓ aus der Zwischenablage');
    mark.style.color = 'var(--ok)';
    setTimeout(saveAndSignIn, 700);
  }, 900);
}

/**
 * Die eigentliche Anmeldung: Twitch nennt einen kurzen Code, der Browser geht
 * auf, der Nutzer bestätigt mit seinem Konto. Die App wartet derweil.
 */
async function signIn(refresh) {
  const result = await window.ch.twitch.signIn();
  if (!result?.ok) return toast(result?.error || t('Anmeldung konnte nicht gestartet werden.'), 'danger', 7000);

  const { userCode, url } = result.data;
  const state = h('div.text-sm.muted', { text: t('Warte auf deine Bestätigung im Browser …') });

  const instance = modal({
    title: t('Bei Twitch anmelden'),
    size: 'narrow',
    body: h('div.col.gap-lg', null,
      h('p.text-sm.muted', { text: t('Der Browser sollte sich geöffnet haben. Gib dort diesen Code ein und bestätige mit deinem Twitch-Konto:') }),
      h('div', {
        style: {
          fontFamily: 'var(--font-mono)',
          fontSize: '31px',
          letterSpacing: '0.22em',
          textAlign: 'center',
          padding: '18px',
          borderRadius: 'var(--radius)',
          background: 'var(--surface-2)',
          border: '1px solid var(--border)',
        },
        text: userCode,
      }),
      h('div.row.gap-sm', null,
        h('button.btn.btn--sm', { text: t('Code kopieren'), onClick: () => copy(userCode, t('Code kopiert.')) }),
        h('button.btn.btn--sm', { text: t('Seite erneut öffnen'), onClick: () => window.ch.system.openExternal(url) })),
      state,
      h('p.text-xs.faint', { text: t('Dein Passwort bekommt die App zu keinem Zeitpunkt zu sehen – die Anmeldung läuft vollständig bei Twitch.') })),
    actions: [
      { label: t('Abbrechen'), action: () => window.ch.twitch.cancelAuth() },
    ],
    onClose: () => window.ch.twitch.cancelAuth(),
  });

  // Auf das Ergebnis warten, das der Hauptprozess meldet.
  const off = window.ch.twitch.onAuth(async (update) => {
    if (update.state === 'done') {
      off();
      instance.close();
      toast(t('Angemeldet als {name}.', { name: update.user?.display_name || t('Twitch-Konto') }), 'ok', 6000);
      await store.reload();
      refresh();
    } else if (update.state === 'error') {
      state.textContent = update.message;
      state.style.color = 'var(--danger)';
    } else if (update.state === 'cancelled') {
      off();
    }
  });
}

function twitchCard(state, auth, refresh) {
  const info = state.twitch;

  // --- Noch nicht angemeldet
  if (!auth.signedIn) {
    return card(null, { class: 'card--accent' },
      h('div.row.gap-sm.mb', null, glyph('twitch', 26), h('h3', { text: 'Twitch' }), h('span.badge', { text: t('nicht verbunden') })),
      h('p.text-sm.muted.mb', { text: t('Angemeldet holt die App automatisch: vergangene Übertragungen mit Aufrufen und Dauer, die stärksten Clips der Woche als Kurzvideo-Ideen, deine Follower- und Abonnentenzahl – und während du live bist, alle zwei Minuten die Zuschauerzahl. Daraus entstehen Durchschnitt und Spitzenwert je Stream.') }),

      auth.needsClientId
        ? h('div.col.gap-sm', null,
            h('div.text-xs.faint', { text: t('Einmalig ist eine Client-ID nötig – Twitch gibt Daten nur an registrierte Anwendungen heraus. Danach nie wieder.') }),
            h('button.btn.btn--primary', { text: t('Einrichten und anmelden'), onClick: () => clientIdDialog(refresh) }))
        : h('button.btn.btn--primary', { text: t('Mit Twitch anmelden'), onClick: () => signIn(refresh) }),

      info.lastError
        ? h('div.notice.notice--danger.mt', null,
            h('span.notice__icon', { text: '✕' }),
            h('div.text-sm', { text: info.lastError }))
        : null);
  }

  // --- Angemeldet
  return card(null, { class: 'card--accent' },
    h('div.row.between.mb', null,
      h('div.row.gap-sm', null,
        glyph('twitch', 26),
        h('div', null,
          h('h3', { text: auth.displayName || auth.login }),
          h('div.text-xs.faint', { text: auth.signedInAt ? t('angemeldet {when}', { when: fmt.relative(auth.signedInAt) }) : t('angemeldet') }))),
      h('span.badge.badge--ok', { text: t('angemeldet') })),

    info.liveSession
      ? h('div.notice.notice--ok.mb', null,
          h('span.notice__icon', { text: '●' }),
          h('div', null,
            h('div.strong.text-sm', { text: t('Stream läuft – Zuschauerzahlen werden mitgeschrieben') }),
            h('div.text-sm.muted', { text: t('{samples} · gestartet {when}', { samples: fmt.plural(info.liveSession.samples, 'Stichprobe', 'Stichproben'), when: fmt.relative(info.liveSession.startedAt) }) })))
      : null,

    info.lastError || auth.lastError
      ? h('div.notice.notice--danger.mb', null,
          h('span.notice__icon', { text: '✕' }),
          h('div', null,
            h('div.strong.text-sm', { text: t('Letzter Abgleich schlug fehl') }),
            h('div.text-sm.muted', { text: info.lastError || auth.lastError })))
      : null,

    h('div.row.between.text-sm.muted.mb', null,
      h('span', { text: info.lastSync ? t('Zuletzt abgeglichen {when}', { when: fmt.relative(info.lastSync) }) : t('Noch nicht abgeglichen') }),
      h('span', { text: t('automatisch alle 20 Minuten') })),

    h('label.checkbox.mb', null,
      h('input', {
        type: 'checkbox',
        checked: info.createClipIdeas !== false,
        onChange: async (event) => {
          await window.ch.connectors.options('twitch', { createClipIdeas: event.target.checked });
          toast(event.target.checked ? t('Clips werden als Ideen übernommen.') : t('Clips werden nicht mehr übernommen.'), 'ok');
        },
      }),
      h('span.text-sm', { text: t('Aus starken Clips automatisch Kurzvideo-Ideen anlegen') })),

    h('div.row.wrap.gap-sm', null,
      h('button.btn.btn--sm.btn--primary', { text: t('Jetzt abgleichen'), onClick: () => runSync('twitch', refresh) }),
      h('button.btn.btn--sm', { text: t('Vorschau'), onClick: twitchPreview }),
      h('button.btn.btn--sm.btn--ghost', { text: t('Kanal öffnen'), onClick: () => window.ch.system.openExternal(`https://twitch.tv/${auth.login}`) }),
      h('button.btn.btn--sm.btn--danger', {
        text: t('Abmelden'),
        onClick: async () => {
          if (!(await confirm({
            title: t('Von Twitch abmelden?'),
            message: t('Der Zugriff wird bei Twitch zurückgezogen. Bereits übernommene Zahlen bleiben erhalten.'),
            confirmLabel: t('Abmelden'),
            tone: 'danger',
          }))) return;
          await window.ch.twitch.signOut();
          toast(t('Abgemeldet.'), 'ok');
          refresh();
        },
      })));
}

async function twitchPreview() {
  const result = await window.ch.connectors.preview('twitch');
  if (!result?.ok) return toast(result?.error || t('Abruf fehlgeschlagen.'), 'danger');
  const { live, broadcasts, clips } = result.data;

  modal({
    title: t('Was Twitch gerade hergibt'),
    body: h('div.col.gap-lg', null,
      live
        ? h('div.notice.notice--ok', null,
            h('span.notice__icon', { text: '◈' }),
            h('div', null,
              h('div.strong', { text: t('Stream läuft: {title}', { title: live.title }) }),
              h('div.text-sm.muted', {
                text: [
                  t('{count} Zuschauer', { count: fmt.num(live.viewers) }),
                  live.game || null,
                  t('gestartet {when}', { when: fmt.relative(live.startedAt) }),
                ].filter(Boolean).join(' · '),
              })))
        : h('p.text-sm.muted', { text: t('Gerade läuft kein Stream.') }),

      h('div', null,
        h('div.field__label.mb-sm', { text: t('Letzte Übertragungen') }),
        broadcasts.length
          ? h('table.table', null,
              h('tbody', null,
                ...broadcasts.map((item) =>
                  h('tr', null,
                    h('td.truncate', { text: item.title }),
                    h('td.text-sm.muted.nowrap', { text: fmt.date(item.createdAt, 'short') }),
                    h('td.num', { text: fmt.duration(item.durationSeconds) }),
                    h('td.num.strong', { text: t('{count} Aufrufe', { count: fmt.num(item.views, { compact: true }) }) })))))
          : h('p.text-sm.muted', { text: t('Keine Aufzeichnungen gefunden – Twitch bewahrt sie je nach Konto 7 bis 60 Tage auf.') })),

      h('div', null,
        h('div.field__label.mb-sm', { text: t('Stärkste Clips der Woche') }),
        clips.length
          ? h('div.col.gap-sm', null,
              ...clips.map((clip) =>
                h('div.row.between', null,
                  h('span.truncate.grow', { text: clip.title }),
                  h('span.text-sm.muted.nowrap', { text: `${fmt.num(clip.views)} · ${clip.durationSeconds}s` }))))
          : h('p.text-sm.muted', { text: t('Diese Woche wurden keine Clips erstellt.') }))),
  });
}

// ------------------------------------------------------------------ YouTube

/**
 * Kanal hinzufügen. Beliebig oft aufrufbar – jeder Aufruf nimmt einen weiteren
 * Kanal in die Liste auf.
 */
function youtubeSetup(refresh, { additional = false } = {}) {
  const input = h('input.input', { placeholder: t('@deinkanal, youtube.com/@deinkanal oder UC…') });

  modal({
    title: additional ? t('Weiteren YouTube-Kanal verbinden') : t('YouTube verbinden'),
    size: 'narrow',
    body: h('div.col.gap-lg', null,
      additional
        ? h('p.text-sm.muted', { text: t('Zweitkanal, Clipkanal, Nebenprojekt – jeder Kanal wird für sich abgeglichen und in der Auswertung getrennt geführt.') })
        : h('div.notice.notice--ok', null,
            h('span.notice__icon', { text: '✓' }),
            h('div', null,
              h('div.strong.text-sm', { text: t('Ohne Zugangsschlüssel') }),
              h('div.text-sm.muted', { text: t('YouTube veröffentlicht für jeden Kanal einen offenen Feed. Daraus liest die App Titel, Veröffentlichungszeitpunkt, Aufrufe und Likes der neuesten Videos – ohne Anmeldung, ohne registrierte Anwendung.') }))),
      h('label.field', null, h('span.field__label', { text: t('Kanal') }), input),
      h('p.text-xs.faint', { text: t('Name, @Handle oder die Adresse aus der Adresszeile – alles funktioniert.') })),
    actions: [
      {
        label: t('Verbinden'),
        primary: true,
        action: async ({ close }) => {
          if (!input.value.trim()) { toast(t('Bitte den Kanal angeben.'), 'warn'); return false; }
          toast(t('Suche den Kanal …'), 'info', 1600);
          const result = await window.ch.connectors.connect('youtube', { channel: input.value });
          if (!result?.ok) { toast(result?.error || t('Kanal nicht gefunden.'), 'danger', 8000); return false; }

          const channel = result.data.channel;
          close();

          // Leerer Kanal: verbunden, nur noch nichts zu holen.
          if (channel.note) {
            toast(t('Verbunden mit „{name}“ – {note}', { name: channel.name, note: channel.note }), 'ok', 10000);
            refresh();
            return true;
          }

          // Der Kanal steht, aber YouTube gibt den Feed gerade nicht heraus.
          // Dann waere ein sofortiger Abgleich sinnlos – der Takt holt ihn nach.
          if (channel.warning) {
            toast(t('Verbunden mit „{name}“ – {note}', { name: channel.name, note: channel.warning }), 'warn', 12000);
            refresh();
            return true;
          }

          toast(t('Verbunden mit „{name}“.', { name: channel.name }), 'ok');
          await syncChannel(channel.channelId, channel.name, refresh);
          return true;
        },
      },
    ],
  });
}

/** Gleicht einen einzelnen Kanal ab. */
async function syncChannel(accountId, name, refresh) {
  toast(t('Hole die neuesten Videos von „{name}“ …', { name }), 'info', 1600);
  const result = await window.ch.youtube.syncChannel(accountId);
  if (!result?.ok) return toast(result?.error || t('Abgleich fehlgeschlagen.'), 'danger', 7000);
  await store.reload();
  const outcome = result.data;
  toast(
    `${name}: ${describeSync(outcome)}${outcome.source === 'seite' ? ` ${t('(von der Kanalseite, Zahlen gerundet)')}` : ''}`,
    'ok',
    6000
  );
  refresh();
}

async function youtubePreview(accountId, name) {
  const result = await window.ch.connectors.preview('youtube', accountId);
  if (!result?.ok) return toast(result?.error || t('Abruf fehlgeschlagen.'), 'danger');

  modal({
    title: t('Neueste Videos · {name}', { name }),
    body: h('div.col.gap-sm', null,
      result.data.source === 'seite'
        ? h('p.text-xs.faint', { text: t('Gelesen von der Kanalseite, weil YouTube den Feed gerade nicht herausgibt. Aufrufe sind gerundet, das Datum ist ungefähr.') })
        : null,
      h('table.table', null,
        h('thead', null, h('tr', null,
          h('th', { text: t('Titel') }), h('th', { text: t('Veröffentlicht') }), h('th.num', { text: t('Aufrufe') }), h('th.num', { text: t('Likes') }))),
        h('tbody', null,
          ...result.data.videos.map((video) =>
            h('tr', null,
              h('td.truncate', { text: video.title }),
              h('td.text-sm.muted.nowrap', { text: fmt.date(video.published, 'short') }),
              h('td.num', { text: video.views === null ? '–' : fmt.num(video.views, { compact: true }) }),
              h('td.num', { text: video.likes === null ? '–' : fmt.num(video.likes, { compact: true }) })))))),
  });
}

/** Eine Zeile je verbundenem Kanal. */
function channelRow(channel, refresh) {
  return h('div.channel-row', null,
    h('div.row.between', null,
      h('div.row.gap-sm', { style: { minWidth: '0' } },
        glyph('youtube', 22),
        h('div', { style: { minWidth: '0' } },
          h('div.strong.truncate', { text: channel.name || t('YouTube-Kanal') }),
          h('div.text-xs.faint', {
            text: [
              channel.lastSync ? t('abgeglichen {when}', { when: fmt.relative(channel.lastSync) }) : t('noch nicht abgeglichen'),
              `${fmt.plural(channel.entries, 'Messwert', 'Messwerte')}`,
              channel.lastSource === 'seite' ? t('über die Kanalseite') : null,
            ].filter(Boolean).join(' · '),
          }))),
      h('span', { class: `badge ${channel.lastError ? 'badge--warn' : 'badge--ok'}`, text: channel.lastError ? t('Hinweis') : t('verbunden') })),

    channel.lastError ? h('div.text-xs.mt-sm', { style: { color: 'var(--warn)' }, text: channel.lastError }) : null,
    // Ein leerer Kanal ist kein Fehler und wird deshalb auch nicht so dargestellt.
    channel.lastNote && !channel.lastError ? h('div.text-xs.faint.mt-sm', { text: channel.lastNote }) : null,

    h('div.row.wrap.between.gap-sm.mt-sm', null,
      h('label.checkbox', null,
        h('input', {
          type: 'checkbox',
          checked: channel.createPosts,
          onChange: async (event) => {
            await window.ch.connectors.options('youtube', { createPosts: event.target.checked }, channel.channelId);
            toast(event.target.checked ? t('Videos werden als Beiträge übernommen.') : t('Es werden nur noch Zahlen übernommen.'), 'ok');
          },
        }),
        h('span.text-xs', { text: t('als Beiträge übernehmen') })),
      h('div.row.gap-xs', null,
        h('button.btn.btn--sm', { text: t('Abgleichen'), onClick: () => syncChannel(channel.channelId, channel.name, refresh) }),
        h('button.btn.btn--sm.btn--ghost', { text: t('Vorschau'), onClick: () => youtubePreview(channel.channelId, channel.name) }),
        h('button.btn.btn--sm.btn--ghost', {
          text: t('Kanal öffnen'),
          onClick: () => window.ch.system.openExternal(`https://www.youtube.com/channel/${channel.channelId}`),
        }),
        h('button.btn.btn--sm.btn--ghost', {
          text: '✕',
          title: t('Diesen Kanal trennen'),
          onClick: async () => {
            if (!(await confirm({
              title: t('„{name}“ trennen?', { name: channel.name }),
              message: t('Der Kanal wird nicht mehr abgeglichen. Bereits übernommene Zahlen und Beiträge bleiben erhalten.'),
              confirmLabel: t('Trennen'),
              tone: 'danger',
            }))) return;
            await window.ch.connectors.disconnect('youtube', channel.channelId);
            toast(t('„{name}“ getrennt.', { name: channel.name }), 'ok');
            refresh();
          },
        }))));
}

function youtubeCard(state, refresh) {
  const channels = state.youtube.channels || [];

  if (!channels.length) {
    return card(null, {},
      h('div.row.gap-sm.mb', null, glyph('youtube', 26), h('h3', { text: 'YouTube' }), h('span.badge.badge--ok', { text: t('ohne Schlüssel') })),
      h('p.text-sm.muted.mb', { text: t('Liest die neuesten Videos deiner Kanäle mit Titel, Datum, Aufrufen und Likes – und legt sie als veröffentlichte Beiträge an, damit Kalender und Coach deinen tatsächlichen Rhythmus kennen. Es genügt der Kanalname, und du kannst beliebig viele Kanäle verbinden.') }),
      h('button.btn.btn--primary', { text: t('YouTube verbinden'), onClick: () => youtubeSetup(refresh) }));
  }

  return card(null, {},
    h('div.row.between.mb', null,
      h('div.row.gap-sm', null,
        glyph('youtube', 26),
        h('div', null,
          h('h3', { text: 'YouTube' }),
          h('div.text-xs.faint', { text: t('{channels} verbunden · automatisch alle 20 Minuten', { channels: fmt.plural(channels.length, 'Kanal', 'Kanäle') }) }))), // i18n-ignore – plural() übersetzt
      h('button.btn.btn--sm', { text: t('＋ Weiterer Kanal'), onClick: () => youtubeSetup(refresh, { additional: true }) })),

    h('div.col.gap-sm', null, ...channels.map((channel) => channelRow(channel, refresh))),

    channels.length > 1
      ? h('p.text-xs.faint.mt', { text: t('Die Kanäle werden in Analytics und im Assistenten getrennt ausgewertet. Ein kleiner und ein grosser Kanal im selben Topf würden jede Empfehlung verfälschen.') })
      : null);
}

// ------------------------------------------------------------------ Ansicht

export async function render({ setActions, refresh, goto }) {
  const state = await status();
  const auth = await twitchAuthStatus();
  const connected = [auth.signedIn, state.youtube.configured].filter(Boolean).length;

  setActions(
    connected
      ? h('button.btn.btn--sm.btn--primary', {
          text: t('Alle abgleichen'),
          onClick: async () => {
            toast(t('Gleiche alle Verbindungen ab …'), 'info', 1600);
            const result = await window.ch.connectors.sync(null);
            if (!result?.ok) return toast(result?.error || t('Abgleich fehlgeschlagen.'), 'danger');
            await store.reload();
            const lines = Object.entries(result.data)
              .map(([name, value]) => `${name}: ${value.error ? value.error : describeSync(value)}`);
            toast(lines.join(' | ') || t('Nichts zu tun.'), 'ok', 6000);
            refresh();
          },
        })
      : null
  );

  const automatic = store.all('analytics').filter((entry) => ['twitch', 'youtube'].includes(entry.source)).length;

  return h('div.col.gap-lg', null,
    h('div.grid.grid-3', null,
      card(null, {}, h('div.stat', null,
        h('div.stat__label', { text: t('Verbunden') }),
        h('div.stat__value', { text: `${connected} / 2` }),
        h('div.stat__meta', { text: connected ? t('wird automatisch abgeglichen') : t('noch nichts verbunden') }))),
      card(null, {}, h('div.stat', null,
        h('div.stat__label', { text: t('Automatisch erfasst') }),
        h('div.stat__value', { text: fmt.num(automatic) }),
        h('div.stat__meta', { text: t('Messwerte ohne Handarbeit') }))),
      card(null, {}, h('div.stat', null,
        h('div.stat__label', { text: t('Takt') }),
        h('div.stat__value', { text: t('20 Min') }),
        h('div.stat__meta', { text: t('während eines Streams alle 2 Minuten') })))),

    h('div.grid.grid-2', null,
      twitchCard(state, auth, refresh),
      youtubeCard(state, refresh)),

    // ---------------------------------------------------------------- X
    card(null, { class: 'card--quiet' },
      h('div.row.gap-sm.mb', null, glyph('x', 26), h('h3', { text: 'X (Twitter)' }), h('span.badge.badge--warn', { text: t('nicht möglich') })),
      h('p.text-sm.muted.mb', { text: t('X verlangt seit 2023 für jeden lesenden Zugriff auf Beiträge und Kennzahlen ein kostenpflichtiges Abonnement, das bei mehreren hundert Dollar im Monat beginnt. Einen kostenlosen oder schlüsselfreien Weg gibt es nicht – das ist eine Entscheidung von X, keine technische Hürde.') }),
      h('div.row.wrap.gap-sm', null,
        h('button.btn.btn--sm', { text: t('Zahlen per CSV einlesen'), onClick: () => goto('analytics') }),
        h('button.btn.btn--sm.btn--ghost', { text: t('X-Analytics öffnen'), onClick: () => window.ch.system.openExternal('https://analytics.x.com') })),
      h('p.text-xs.faint.mt-sm', { text: t('Mit X Premium lässt sich die Auswertung als CSV herunterladen und hier in zwei Klicks einlesen – das kommt dem automatischen Abgleich am nächsten.') })),

    h('div.notice', null,
      h('span.notice__icon', { text: 'ℹ' }),
      h('div', null,
        h('div.strong.text-sm', { text: t('Was mit den Daten passiert') }),
        h('div.text-sm.muted', { text: t('Abgerufen wird ausschliesslich dein eigener Kanal. Alles landet unverändert im lokalen Datenordner, nichts wird weitergegeben. Bei der Anmeldung bekommt die App dein Passwort nie zu sehen – sie erhält von Twitch nur ein widerrufbares Merkmal, das du hier oder in deinen Twitch-Einstellungen jederzeit zurückziehen kannst.') }))));
}
