/**
 * PCs verbinden: dieselben Daten auf mehreren Rechnern, auch an verschiedenen Orten.
 *
 * Transportweg ist ein Cloud-Ordner, den der Nutzer ohnehin hat – OneDrive,
 * Dropbox, Google Drive oder iCloud. Der erste PC legt einen Sync-Raum an und
 * erhält einen Code; jeder weitere PC tritt mit diesem Code bei. Der Code ist
 * zugleich der Schlüssel: Was im Cloud-Ordner liegt, ist verschlüsselt.
 */

import { h, card, fill } from '../lib/dom.js';
import * as fmt from '../lib/format.js';
import * as store from '../lib/store.js';
import { toast, confirm, modal, copy, toggle } from '../lib/ui.js';
import { t, mark } from '../lib/i18n.js';

export const title = mark('PCs verbinden');
export const lead = mark('Dieselben Daten auf mehreren PCs – verschlüsselt über deinen Cloud-Ordner.');

const unwrap = (result) => {
  if (!result?.ok) throw new Error(result?.error || t('Unbekannter Fehler'));
  return result.data;
};

// ------------------------------------------------------------------ Ordnerwahl

/**
 * Auswahl des Cloud-Ordners: erkannte Ordner als Knöpfe, dazu „anderer Ordner“.
 * Liefert ein Element und eine Funktion, die den gewählten Pfad zurückgibt.
 */
async function folderPicker() {
  const detected = unwrap(await window.ch.sync.folders());
  let chosen = detected[0]?.path || null;

  const list = h('div.chips');
  const shown = h('div.mono.text-xs.faint.mt-sm');

  const render = () => {
    fill(list,
      ...detected.map((entry) =>
        h(`span.chip${chosen === entry.path ? '.is-active' : ''}`, {
          title: entry.path,
          onClick: () => { chosen = entry.path; render(); },
        }, h('span', { text: entry.label }))),
      h(`span.chip${chosen && !detected.some((entry) => entry.path === chosen) ? '.is-active' : ''}`, {
        text: t('📁 Anderer Ordner …'),
        onClick: async () => {
          const picked = unwrap(await window.ch.sync.pickFolder());
          if (picked.canceled) return;
          chosen = picked.path;
          render();
        },
      }));
    shown.textContent = chosen || t('Noch kein Ordner gewählt.');
  };
  render();

  const element = h('div', null,
    detected.length
      ? null
      : h('p.text-sm.muted.mb-sm', { text: t('Auf diesem PC wurde kein Cloud-Ordner gefunden. Wähle den Ordner von OneDrive, Dropbox, Google Drive oder iCloud von Hand.') }),
    list,
    shown);

  return { element, value: () => chosen };
}

/** Zeigt den Code groß, zum Abtippen oder Weiterschicken. */
function showCodeDialog(code, { fresh = false } = {}) {
  modal({
    title: fresh ? t('Sync-Raum angelegt') : t('Code für einen weiteren PC'),
    size: 'narrow',
    body: h('div.col.gap-lg', null,
      h('p.text-sm.muted', { text: t('Auf dem anderen PC: Content Helper öffnen → „PCs verbinden“ → „Mit Code beitreten“, denselben Cloud-Ordner wählen und diesen Code eingeben.') }),
      h('div', {
        style: {
          fontFamily: 'var(--font-mono)',
          fontSize: '22px',
          letterSpacing: '0.08em',
          textAlign: 'center',
          padding: '18px 10px',
          borderRadius: 'var(--radius)',
          background: 'var(--surface-2)',
          border: '1px solid var(--border)',
          wordBreak: 'break-all',
        },
        text: code,
      }),
      h('button.btn.btn--primary', { text: t('Code kopieren'), onClick: () => copy(code, t('Code kopiert.')) }),
      h('div.notice.notice--warn', null,
        h('span.notice__icon', { text: '!' }),
        h('div.text-sm', { text: t('Behandle den Code wie ein Passwort: Wer ihn hat und Zugriff auf deinen Cloud-Ordner, kann deine Daten lesen. Schick ihn nur an dich selbst.') }))),
  });
}

// ------------------------------------------------------------------ Einrichten

async function setupView(refresh) {
  const create = await folderPicker();
  const join = await folderPicker();
  const codeInput = h('input.input', {
    placeholder: 'CH-XXXXX-XXXXX-XXXXX-XXXXX',
    style: { fontFamily: 'var(--font-mono)', letterSpacing: '0.05em' },
  });

  const step = (number, text) => h('div.row.gap-sm', { style: { alignItems: 'flex-start' } },
    h('span.badge.badge--accent', { text: String(number) }),
    h('div.text-sm.muted', { text }));

  return h('div.col.gap-lg', null,
    h('div.notice.notice--accent', null,
      h('span.notice__icon', { text: '⧉' }),
      h('div', null,
        h('div.strong', { text: t('So funktioniert es') }),
        h('div.text-sm.muted', { text: t('Deine PCs gleichen sich über einen Ordner ab, den du ohnehin mit OneDrive, Dropbox, Google Drive oder iCloud synchronisierst. Es gibt kein Konto und keinen Server von uns – das Cloud-Programm trägt die Dateien hin und her. Alles, was dort liegt, ist verschlüsselt; der Anbieter sieht nur unlesbare Dateien.') }))),

    h('div.grid.grid-2', null,
      card(t('Erster PC: Sync-Raum anlegen'), {},
        h('div.col.gap-lg', null,
          step(1, t('Den Cloud-Ordner wählen, der auf all deinen PCs synchronisiert wird.')),
          create.element,
          step(2, t('Anlegen. Du bekommst einen Code, den du auf dem anderen PC eingibst.')),
          h('button.btn.btn--primary', {
            text: t('Sync-Raum anlegen'),
            onClick: async (event) => {
              const folder = create.value();
              if (!folder) return toast(t('Bitte zuerst einen Cloud-Ordner wählen.'), 'warn');
              event.target.disabled = true;
              try {
                const result = unwrap(await window.ch.sync.create(folder));
                showCodeDialog(result.code, { fresh: true });
                refresh();
              } catch (error) {
                toast(error.message, 'danger', 8000);
              } finally {
                event.target.disabled = false;
              }
            },
          }))),

      card(t('Weiterer PC: mit Code beitreten'), {},
        h('div.col.gap-lg', null,
          step(1, t('Denselben Cloud-Ordner wählen – auf diesem PC kann er anders heißen oder woanders liegen.')),
          join.element,
          step(2, t('Den Code vom ersten PC eingeben.')),
          codeInput,
          h('button.btn.btn--primary', {
            text: t('Beitreten'),
            onClick: async (event) => {
              const folder = join.value();
              if (!folder) return toast(t('Bitte zuerst einen Cloud-Ordner wählen.'), 'warn');
              if (!codeInput.value.trim()) return toast(t('Bitte den Code eingeben.'), 'warn');
              event.target.disabled = true;
              event.target.textContent = t('Verbinde …');
              try {
                const result = unwrap(await window.ch.sync.join(folder, codeInput.value));
                await store.reload();
                toast(t('Verbunden – {entries} übernommen.', { entries: fmt.plural(result.applied, 'Eintrag', 'Einträge') }), 'ok', 7000); // i18n-ignore
                refresh();
              } catch (error) {
                toast(error.message, 'danger', 9000);
              } finally {
                event.target.disabled = false;
                event.target.textContent = t('Beitreten');
              }
            },
          })))),

    card(t('Gut zu wissen'), {},
      h('ul.text-sm.muted', { style: { margin: 0, paddingLeft: '18px', lineHeight: '1.8' } },
        h('li', { text: t('Übertragen werden Beiträge, Ideen, Skripte, Zahlen und die gemeinsamen Einstellungen wie aktive Kanäle, Zeitfenster und Wochenziele.') }),
        h('li', { text: t('Das Aussehen bleibt je PC – der Laptop darf hell sein, während der Streaming-PC dunkel bleibt.') }),
        h('li', { text: t('Medien werden als Einträge übertragen, die Video- und Bilddateien selbst nicht. Die liegen dort, wo dein Schnittprogramm sie erwartet.') }),
        h('li', { text: t('YouTube und Twitch holt nur ein PC ab – sonst machten sich die Twitch-Anmeldungen gegenseitig ungültig. Die Zahlen kommen trotzdem auf allen PCs an.') }),
        h('li', { text: t('Wie schnell Änderungen drüben ankommen, hängt vom Cloud-Programm ab – meist Sekunden, manchmal eine Minute.') }))));
}

// ------------------------------------------------------------------ Verbunden

function connectedView(info, refresh) {
  const others = info.devices.filter((device) => !device.self);
  const fetcher = info.devices.find((device) => device.fetchHere);

  return h('div.col.gap-lg', null,
    h('div.grid.grid-3', null,
      card(null, {}, h('div.stat', null,
        h('div.stat__label', { text: t('Verbundene PCs') }),
        h('div.stat__value', { text: String(Math.max(1, info.devices.length)) }),
        h('div.stat__meta', { text: others.length ? t('dieser und {others}', { others: fmt.plural(others.length, 'weiterer', 'weitere') }) : t('noch kein zweiter PC') }))),
      card(null, {}, h('div.stat', null,
        h('div.stat__label', { text: t('Zuletzt abgeglichen') }),
        h('div.stat__value', { text: info.lastPull ? fmt.relative(info.lastPull) : '–', style: { fontSize: '21px' } }),
        h('div.stat__meta', { text: t('automatisch alle 15 Sekunden') }))),
      card(null, {}, h('div.stat', null,
        h('div.stat__label', { text: t('Noch nicht übertragen') }),
        h('div.stat__value', { text: String(info.pending) }),
        h('div.stat__meta', { text: info.pending ? t('geht beim nächsten Abgleich raus') : t('alles draußen') })))),

    info.lastError
      ? h('div.notice.notice--warn', null,
          h('span.notice__icon', { text: '!' }),
          h('div', null,
            h('div.strong.text-sm', { text: t('Hinweis vom letzten Abgleich') }),
            h('div.text-sm.muted', { text: info.lastError })))
      : null,

    h('div.split', null,
      card(t('Deine PCs'), { hint: t('aus dem Sync-Raum') },
        h('div.col.gap-sm', null,
          ...(info.devices.length ? info.devices : [{ name: info.deviceName, self: true, fetchHere: info.fetchHere }]).map((device) =>
            h('div.channel-row', null,
              h('div.row.between', null,
                h('div', null,
                  h('div.strong', { text: device.self ? `${device.name} ${t('(dieser PC)')}` : device.name }),
                  h('div.text-xs.faint', {
                    text: device.self ? t('hier geöffnet') : device.lastSeen ? t('zuletzt da {when}', { when: fmt.relative(device.lastSeen) }) : t('noch nicht gesehen'),
                  })),
                device.fetchHere ? h('span.badge.badge--accent', { text: t('holt YouTube & Twitch ab') }) : null)))),
        others.length
          ? null
          : h('p.text-sm.muted.mt', { text: t('Gib auf dem zweiten PC den Code ein – er erscheint hier, sobald das Cloud-Programm seine erste Meldung übertragen hat.') })),

      h('div.col.gap-lg', null,
        card(t('Weiteren PC hinzufügen'), {},
          h('p.text-sm.muted.mb', { text: t('Der Code ist zugleich der Schlüssel. Er wird erst angezeigt, wenn du ihn anforderst.') }),
          h('button.btn.btn--primary', {
            text: t('Code anzeigen'),
            onClick: async () => {
              try {
                showCodeDialog(unwrap(await window.ch.sync.code()));
              } catch (error) {
                toast(error.message, 'danger');
              }
            },
          })),

        card(t('YouTube und Twitch'), {},
          h('p.text-sm.muted.mb', {
            text: info.fetchHere
              ? t('Dieser PC holt die Zahlen ab und gibt sie an die anderen weiter.')
              : fetcher
                ? t('Die Zahlen holt „{name}“ ab – sie kommen hier über den Abgleich an.', { name: fetcher.name })
                : t('Die Zahlen holt ein anderer PC ab – sie kommen hier über den Abgleich an.'),
          }),
          toggle(t('Auf diesem PC abholen'), info.fetchHere, async (value) => {
            await window.ch.sync.fetchHere(value);
            toast(value
              ? t('Dieser PC holt ab. Schalte es auf dem anderen PC aus, sonst holen beide.')
              : t('Dieser PC holt nicht mehr selbst ab.'), 'ok', 7000);
            refresh();
          })))),

    card(t('Sync-Raum'), { hint: info.spaceId },
      h('div.mono.text-xs.faint.mb', { text: info.folder }),
      h('div.row.wrap.gap-sm', null,
        h('button.btn.btn--sm.btn--primary', {
          text: t('Jetzt abgleichen'),
          onClick: async () => {
            try {
              const result = unwrap(await window.ch.sync.now());
              await store.reload();
              toast(t('{sent} gesendet, {received} empfangen.', { sent: result.pushed, received: result.pulled }), 'ok');
              refresh();
            } catch (error) {
              toast(error.message, 'danger');
            }
          },
        }),
        h('button.btn.btn--sm.btn--danger', {
          text: t('Diesen PC trennen'),
          onClick: async () => {
            if (!(await confirm({
              title: t('Diesen PC vom Sync-Raum trennen?'),
              message: t('Die Daten bleiben auf diesem PC erhalten, werden aber nicht mehr abgeglichen. Die anderen PCs sind davon nicht betroffen. Zum erneuten Verbinden brauchst du den Code.'),
              confirmLabel: t('Trennen'),
              tone: 'danger',
            }))) return;
            await window.ch.sync.leave();
            toast(t('Getrennt.'), 'ok');
            refresh();
          },
        }))));
}

// ------------------------------------------------------------------ Ansicht

export async function render({ setActions, refresh }) {
  setActions();
  const info = unwrap(await window.ch.sync.status());
  return info.enabled ? connectedView(info, refresh) : setupView(refresh);
}
