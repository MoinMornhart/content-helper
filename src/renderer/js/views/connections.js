/**
 * Verbindungen: Kanäle anbinden, damit Zahlen von selbst hereinkommen.
 *
 * YouTube läuft über den offenen Kanal-Feed und braucht gar nichts weiter.
 * Twitch braucht eine eigene, kostenlose Anwendung – dafür liefert es dann
 * vergangene Übertragungen, Clips und, während des Streams, Zuschauerzahlen im
 * Zwei-Minuten-Takt.
 */

import { h, card, fill } from '../lib/dom.js';
import * as fmt from '../lib/format.js';
import * as store from '../lib/store.js';
import { glyph } from '../lib/platforms.js';
import { toast, confirm, modal } from '../lib/ui.js';

export const title = 'Verbindungen';
export const lead = 'Automatisch statt abtippen – so weit die Plattformen es zulassen.';

async function status() {
  const result = await window.ch.connectors.status();
  return result?.ok ? result.data : { twitch: {}, youtube: {} };
}

/** Ergebnis eines Abgleichs in einen Satz fassen. */
function describeSync(result) {
  const parts = [];
  if (result.added) parts.push(`${fmt.plural(result.added, 'neuer Eintrag', 'neue Einträge')}`);
  if (result.updated) parts.push(`${result.updated} aufgefrischt`);
  if (result.posts) parts.push(`${fmt.plural(result.posts, 'Beitrag', 'Beiträge')} übernommen`);
  if (result.ideas) parts.push(`${fmt.plural(result.ideas, 'Clip-Idee', 'Clip-Ideen')}`);
  if (result.live?.live) parts.push('Stream läuft gerade');
  return parts.length ? parts.join(' · ') : 'Nichts Neues gefunden.';
}

async function runSync(name, refresh) {
  toast('Hole die neuesten Daten …', 'info', 1600);
  const result = await window.ch.connectors.sync(name);
  if (!result?.ok) return toast(result?.error || 'Abgleich fehlgeschlagen.', 'danger', 6000);
  await store.reload();
  toast(describeSync(result.data[name] || result.data), 'ok', 5000);
  refresh();
}

// ------------------------------------------------------------------ Twitch

function twitchSetup(refresh) {
  const clientId = h('input.input', { placeholder: 'Client-ID aus deiner Twitch-Anwendung' });
  const clientSecret = h('input.input', { type: 'password', placeholder: 'Client-Secret' });
  const login = h('input.input', { placeholder: 'Dein Kanalname, z. B. moinmornhart' });

  const step = (number, title, body) => h('div.row.gap-sm', { style: { alignItems: 'flex-start' } },
    h('span.badge.badge--accent', { text: String(number) }),
    h('div', null,
      h('div.strong.text-sm', { text: title }),
      h('div.text-sm.muted', { text: body })));

  modal({
    title: 'Twitch verbinden',
    body: h('div.col.gap-lg', null,
      h('div.notice.notice--warn', null,
        h('span.notice__icon', { text: '!' }),
        h('div', null,
          h('div.strong.text-sm', { text: 'Hierfür braucht es eine eigene Twitch-Anwendung' }),
          h('div.text-sm.muted', { text: 'Sie ist kostenlos, in zwei Minuten angelegt und verursacht keine laufenden Kosten. Twitch gibt Kennzahlen grundsätzlich nur an registrierte Anwendungen heraus – ohne diesen Schritt geht es nicht. Beide Werte bleiben ausschliesslich auf diesem Rechner.' }))),

      h('div.col.gap-lg', null,
        step(1, 'Anwendung anlegen', 'Öffne dev.twitch.tv/console/apps und klicke auf „Anwendung registrieren“.'),
        step(2, 'Felder ausfüllen', 'Name frei wählbar (z. B. „Content Helper“), als OAuth-Weiterleitung http://localhost eintragen, Kategorie „Application Integration“, Clienttyp „Vertraulich“.'),
        step(3, 'Werte kopieren', 'Nach dem Anlegen zeigt Twitch die Client-ID. Das Client-Secret erscheint einmalig über „Neues Secret“ – kopiere es sofort.')),

      h('button.btn.btn--sm', {
        text: 'dev.twitch.tv öffnen',
        onClick: () => window.ch.system.openExternal('https://dev.twitch.tv/console/apps'),
      }),

      h('hr.divider'),
      h('label.field', null, h('span.field__label', { text: 'Client-ID' }), clientId),
      h('label.field', null, h('span.field__label', { text: 'Client-Secret' }), clientSecret),
      h('label.field', null, h('span.field__label', { text: 'Kanalname' }), login),
      h('p.text-xs.faint', { text: 'Eine Anmeldung mit deinem Twitch-Konto ist nicht nötig: abgefragt werden nur Daten, die auf deiner Kanalseite ohnehin öffentlich stehen.' })),

    actions: [
      {
        label: 'Verbinden',
        primary: true,
        action: async ({ close }) => {
          if (!clientId.value.trim() || !clientSecret.value.trim() || !login.value.trim()) {
            toast('Bitte alle drei Felder ausfüllen.', 'warn');
            return false;
          }
          toast('Prüfe die Zugangsdaten …', 'info', 1600);
          const result = await window.ch.connectors.connect('twitch', {
            clientId: clientId.value,
            clientSecret: clientSecret.value,
            login: login.value,
          });
          if (!result?.ok) {
            toast(result?.error || 'Verbindung fehlgeschlagen.', 'danger', 7000);
            return false;
          }
          toast(`Verbunden mit ${result.data.channel.displayName}.`, 'ok');
          close();
          await runSync('twitch', refresh);
          return true;
        },
      },
    ],
  });
}

async function twitchPreview() {
  const result = await window.ch.connectors.preview('twitch');
  if (!result?.ok) return toast(result?.error || 'Abruf fehlgeschlagen.', 'danger');
  const { live, broadcasts, clips } = result.data;

  modal({
    title: 'Was Twitch gerade hergibt',
    body: h('div.col.gap-lg', null,
      live
        ? h('div.notice.notice--ok', null,
            h('span.notice__icon', { text: '◈' }),
            h('div', null,
              h('div.strong', { text: `Stream läuft: ${live.title}` }),
              h('div.text-sm.muted', { text: `${fmt.num(live.viewers)} Zuschauer${live.game ? ` · ${live.game}` : ''} · seit ${fmt.relative(live.startedAt)}` })))
        : h('p.text-sm.muted', { text: 'Gerade läuft kein Stream.' }),

      h('div', null,
        h('div.field__label.mb-sm', { text: 'Letzte Übertragungen' }),
        broadcasts.length
          ? h('table.table', null,
              h('tbody', null,
                ...broadcasts.map((item) =>
                  h('tr', null,
                    h('td.truncate', { text: item.title }),
                    h('td.text-sm.muted.nowrap', { text: fmt.date(item.createdAt, 'short') }),
                    h('td.num', { text: fmt.duration(item.durationSeconds) }),
                    h('td.num.strong', { text: `${fmt.num(item.views, { compact: true })} Aufrufe` })))))
          : h('p.text-sm.muted', { text: 'Keine Aufzeichnungen gefunden – Twitch bewahrt sie je nach Konto 7 bis 60 Tage auf.' })),

      h('div', null,
        h('div.field__label.mb-sm', { text: 'Stärkste Clips der Woche' }),
        clips.length
          ? h('div.col.gap-sm', null,
              ...clips.map((clip) =>
                h('div.row.between', null,
                  h('span.truncate.grow', { text: clip.title }),
                  h('span.text-sm.muted.nowrap', { text: `${fmt.num(clip.views)} · ${clip.durationSeconds}s` }))))
          : h('p.text-sm.muted', { text: 'Diese Woche wurden keine Clips erstellt.' }))),
  });
}

function twitchCard(state, refresh) {
  const info = state.twitch;

  if (!info.configured) {
    return card(null, { class: 'card--accent' },
      h('div.row.gap-sm.mb', null, glyph('twitch', 26), h('h3', { text: 'Twitch' }), h('span.badge', { text: 'nicht verbunden' })),
      h('p.text-sm.muted.mb', { text: 'Verbunden holt die App automatisch: vergangene Übertragungen mit Aufrufen und Dauer, die stärksten Clips der Woche als Kurzvideo-Ideen – und während du live bist, alle zwei Minuten die Zuschauerzahl. Daraus entstehen Durchschnitt und Spitzenwert je Stream.' }),
      h('button.btn.btn--primary', { text: 'Twitch verbinden', onClick: () => twitchSetup(refresh) }));
  }

  return card(null, { class: 'card--accent' },
    h('div.row.between.mb', null,
      h('div.row.gap-sm', null,
        glyph('twitch', 26),
        h('div', null,
          h('h3', { text: info.displayName || info.login }),
          h('div.text-xs.faint', { text: `twitch.tv/${info.login}` }))),
      h('span.badge.badge--ok', { text: 'verbunden' })),

    info.liveSession
      ? h('div.notice.notice--ok.mb', null,
          h('span.notice__icon', { text: '●' }),
          h('div', null,
            h('div.strong.text-sm', { text: 'Stream läuft – Zuschauerzahlen werden mitgeschrieben' }),
            h('div.text-sm.muted', { text: `${fmt.plural(info.liveSession.samples, 'Stichprobe', 'Stichproben')} seit ${fmt.relative(info.liveSession.startedAt)}` })))
      : null,

    info.lastError
      ? h('div.notice.notice--danger.mb', null,
          h('span.notice__icon', { text: '✕' }),
          h('div', null,
            h('div.strong.text-sm', { text: 'Letzter Abgleich schlug fehl' }),
            h('div.text-sm.muted', { text: info.lastError })))
      : null,

    h('div.row.between.text-sm.muted.mb', null,
      h('span', { text: info.lastSync ? `Zuletzt abgeglichen ${fmt.relative(info.lastSync)}` : 'Noch nie abgeglichen' }),
      h('span', { text: 'automatisch alle 20 Minuten' })),

    h('label.checkbox.mb', null,
      h('input', {
        type: 'checkbox',
        checked: info.createClipIdeas,
        onChange: async (event) => {
          await window.ch.connectors.options('twitch', { createClipIdeas: event.target.checked });
          toast(event.target.checked ? 'Clips werden als Ideen übernommen.' : 'Clips werden nicht mehr übernommen.', 'ok');
        },
      }),
      h('span.text-sm', { text: 'Aus starken Clips automatisch Kurzvideo-Ideen anlegen' })),

    h('div.row.wrap.gap-sm', null,
      h('button.btn.btn--sm.btn--primary', { text: 'Jetzt abgleichen', onClick: () => runSync('twitch', refresh) }),
      h('button.btn.btn--sm', { text: 'Vorschau', onClick: twitchPreview }),
      h('button.btn.btn--sm.btn--ghost', { text: 'Kanal öffnen', onClick: () => window.ch.system.openExternal(`https://twitch.tv/${info.login}`) }),
      h('button.btn.btn--sm.btn--danger', {
        text: 'Trennen',
        onClick: async () => {
          if (!(await confirm({
            title: 'Twitch trennen?',
            message: 'Zugangsdaten und Kanalzuordnung werden gelöscht. Bereits übernommene Zahlen bleiben erhalten.',
            confirmLabel: 'Trennen',
            tone: 'danger',
          }))) return;
          await window.ch.connectors.disconnect('twitch');
          toast('Twitch getrennt.', 'ok');
          refresh();
        },
      })));
}

// ------------------------------------------------------------------ YouTube

function youtubeSetup(refresh) {
  const input = h('input.input', { placeholder: '@deinkanal, youtube.com/@deinkanal oder UC…' });

  modal({
    title: 'YouTube verbinden',
    size: 'narrow',
    body: h('div.col.gap-lg', null,
      h('div.notice.notice--ok', null,
        h('span.notice__icon', { text: '✓' }),
        h('div', null,
          h('div.strong.text-sm', { text: 'Ohne Zugangsschlüssel' }),
          h('div.text-sm.muted', { text: 'YouTube veröffentlicht für jeden Kanal einen offenen Feed. Daraus liest die App Titel, Veröffentlichungszeitpunkt, Aufrufe und Likes der neuesten Videos – ohne Anmeldung, ohne registrierte Anwendung.' }))),
      h('label.field', null, h('span.field__label', { text: 'Kanal' }), input),
      h('p.text-xs.faint', { text: 'Klickrate, Wiedergabedauer und Wiedergabezeit stehen nicht im Feed – die gibt YouTube nur dir im Studio. Dafür bleibt der CSV-Import der Weg.' })),
    actions: [
      {
        label: 'Verbinden',
        primary: true,
        action: async ({ close }) => {
          if (!input.value.trim()) { toast('Bitte den Kanal angeben.', 'warn'); return false; }
          toast('Suche den Kanal …', 'info', 1600);
          const result = await window.ch.connectors.connect('youtube', { channel: input.value });
          if (!result?.ok) { toast(result?.error || 'Kanal nicht gefunden.', 'danger', 6000); return false; }
          toast(`Verbunden mit „${result.data.channel.name}“.`, 'ok');
          close();
          await runSync('youtube', refresh);
          return true;
        },
      },
    ],
  });
}

async function youtubePreview() {
  const result = await window.ch.connectors.preview('youtube');
  if (!result?.ok) return toast(result?.error || 'Abruf fehlgeschlagen.', 'danger');

  modal({
    title: 'Neueste Videos im Feed',
    body: h('table.table', null,
      h('thead', null, h('tr', null,
        h('th', { text: 'Titel' }), h('th', { text: 'Veröffentlicht' }), h('th.num', { text: 'Aufrufe' }), h('th.num', { text: 'Likes' }))),
      h('tbody', null,
        ...result.data.videos.map((video) =>
          h('tr', null,
            h('td.truncate', { text: video.title }),
            h('td.text-sm.muted.nowrap', { text: fmt.date(video.published, 'short') }),
            h('td.num', { text: video.views === null ? '–' : fmt.num(video.views, { compact: true }) }),
            h('td.num', { text: video.likes === null ? '–' : fmt.num(video.likes, { compact: true }) }))))),
  });
}

function youtubeCard(state, refresh) {
  const info = state.youtube;

  if (!info.configured) {
    return card(null, {},
      h('div.row.gap-sm.mb', null, glyph('youtube', 26), h('h3', { text: 'YouTube' }), h('span.badge.badge--ok', { text: 'ohne Schlüssel' })),
      h('p.text-sm.muted.mb', { text: 'Liest die neuesten Videos deines Kanals mit Titel, Datum, Aufrufen und Likes – und legt sie als veröffentlichte Beiträge an, damit Kalender und Coach deinen tatsächlichen Rhythmus kennen. Es genügt der Kanalname.' }),
      h('button.btn.btn--primary', { text: 'YouTube verbinden', onClick: () => youtubeSetup(refresh) }));
  }

  return card(null, {},
    h('div.row.between.mb', null,
      h('div.row.gap-sm', null,
        glyph('youtube', 26),
        h('div', null,
          h('h3', { text: info.name || 'YouTube-Kanal' }),
          h('div.text-xs.faint.mono', { text: info.channelId }))),
      h('span.badge.badge--ok', { text: 'verbunden' })),

    info.lastError
      ? h('div.notice.notice--danger.mb', null,
          h('span.notice__icon', { text: '✕' }),
          h('div.text-sm', { text: info.lastError }))
      : null,

    h('div.row.between.text-sm.muted.mb', null,
      h('span', { text: info.lastSync ? `Zuletzt abgeglichen ${fmt.relative(info.lastSync)}` : 'Noch nie abgeglichen' }),
      h('span', { text: 'automatisch alle 20 Minuten' })),

    h('label.checkbox.mb', null,
      h('input', {
        type: 'checkbox',
        checked: info.createPosts,
        onChange: async (event) => {
          await window.ch.connectors.options('youtube', { createPosts: event.target.checked });
          toast(event.target.checked ? 'Videos werden als Beiträge übernommen.' : 'Es werden nur noch Zahlen übernommen.', 'ok');
        },
      }),
      h('span.text-sm', { text: 'Videos als veröffentlichte Beiträge übernehmen' })),

    h('div.row.wrap.gap-sm', null,
      h('button.btn.btn--sm.btn--primary', { text: 'Jetzt abgleichen', onClick: () => runSync('youtube', refresh) }),
      h('button.btn.btn--sm', { text: 'Vorschau', onClick: youtubePreview }),
      h('button.btn.btn--sm.btn--danger', {
        text: 'Trennen',
        onClick: async () => {
          if (!(await confirm({
            title: 'YouTube trennen?',
            message: 'Die Kanalzuordnung wird gelöscht. Bereits übernommene Zahlen und Beiträge bleiben erhalten.',
            confirmLabel: 'Trennen',
            tone: 'danger',
          }))) return;
          await window.ch.connectors.disconnect('youtube');
          toast('YouTube getrennt.', 'ok');
          refresh();
        },
      })));
}

// ------------------------------------------------------------------ Ansicht

export async function render({ setActions, refresh, goto }) {
  const state = await status();
  const connected = [state.twitch.configured, state.youtube.configured].filter(Boolean).length;

  setActions(
    connected
      ? h('button.btn.btn--sm.btn--primary', {
          text: 'Alle abgleichen',
          onClick: async () => {
            toast('Gleiche alle Verbindungen ab …', 'info', 1600);
            const result = await window.ch.connectors.sync(null);
            if (!result?.ok) return toast(result?.error || 'Abgleich fehlgeschlagen.', 'danger');
            await store.reload();
            const lines = Object.entries(result.data)
              .map(([name, value]) => `${name}: ${value.error ? value.error : describeSync(value)}`);
            toast(lines.join(' | ') || 'Nichts zu tun.', 'ok', 6000);
            refresh();
          },
        })
      : null
  );

  const automatic = store.all('analytics').filter((entry) => ['twitch', 'youtube'].includes(entry.source)).length;

  return h('div.col.gap-lg', null,
    h('div.grid.grid-3', null,
      card(null, {}, h('div.stat', null,
        h('div.stat__label', { text: 'Verbunden' }),
        h('div.stat__value', { text: `${connected} / 2` }),
        h('div.stat__meta', { text: connected ? 'wird automatisch abgeglichen' : 'noch nichts verbunden' }))),
      card(null, {}, h('div.stat', null,
        h('div.stat__label', { text: 'Automatisch erfasst' }),
        h('div.stat__value', { text: fmt.num(automatic) }),
        h('div.stat__meta', { text: 'Messwerte ohne Handarbeit' }))),
      card(null, {}, h('div.stat', null,
        h('div.stat__label', { text: 'Takt' }),
        h('div.stat__value', { text: '20 Min' }),
        h('div.stat__meta', { text: 'während eines Streams alle 2 Minuten' })))),

    h('div.grid.grid-2', null,
      twitchCard(state, refresh),
      youtubeCard(state, refresh)),

    // ---------------------------------------------------------------- X
    card(null, { class: 'card--quiet' },
      h('div.row.gap-sm.mb', null, glyph('x', 26), h('h3', { text: 'X (Twitter)' }), h('span.badge.badge--warn', { text: 'nicht möglich' })),
      h('p.text-sm.muted.mb', { text: 'X verlangt seit 2023 für jeden lesenden Zugriff auf Beiträge und Kennzahlen ein kostenpflichtiges Abonnement, das bei mehreren hundert Dollar im Monat beginnt. Einen kostenlosen oder schlüsselfreien Weg gibt es nicht – das ist eine Entscheidung von X, keine technische Hürde.' }),
      h('div.row.wrap.gap-sm', null,
        h('button.btn.btn--sm', { text: 'Zahlen per CSV einlesen', onClick: () => goto('analytics') }),
        h('button.btn.btn--sm.btn--ghost', { text: 'X-Analytics öffnen', onClick: () => window.ch.system.openExternal('https://analytics.x.com') })),
      h('p.text-xs.faint.mt-sm', { text: 'Mit X Premium lässt sich die Auswertung als CSV herunterladen und hier in zwei Klicks einlesen – das kommt dem automatischen Abgleich am nächsten.' })),

    h('div.notice', null,
      h('span.notice__icon', { text: 'ℹ' }),
      h('div', null,
        h('div.strong.text-sm', { text: 'Was mit den Daten passiert' }),
        h('div.text-sm.muted', { text: 'Abgerufen wird ausschliesslich dein eigener Kanal. Alles landet unverändert im lokalen Datenordner, nichts wird weitergegeben. Zugangsdaten der Twitch-Anwendung liegen in derselben Datei wie deine Einstellungen und verlassen den Rechner nur, um sich bei Twitch selbst auszuweisen.' }))));
}
