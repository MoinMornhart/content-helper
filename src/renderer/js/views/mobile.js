/**
 * Handy: die Verbindung zwischen Rechner und Telefon.
 *
 * Die Desktop-App liefert im eigenen WLAN eine installierbare Web-App aus.
 * Das Telefon scannt den QR-Code und ist verbunden – ohne Konto, ohne
 * Zugangsschlüssel, ohne App Store und ohne dass Daten den Haushalt verlassen.
 */

import { h, card, fill } from '../lib/dom.js';
import * as fmt from '../lib/format.js';
import * as store from '../lib/store.js';
import { svg as qrSvg } from '../lib/qrcode.js';
import { toast, confirm, copy } from '../lib/ui.js';

export const title = 'Handy';
export const lead = 'iPhone und Android verbinden – im eigenen WLAN, ohne Cloud.';

async function status() {
  const result = await window.ch.companion.status();
  return result?.ok ? result.data : { running: false, addresses: [], devices: [] };
}

export async function render({ setActions, refresh }) {
  const info = await status();
  const settings = store.settings();

  setActions(
    info.running
      ? h('button.btn.btn--sm', {
          text: 'Verbindung beenden',
          onClick: async () => {
            await window.ch.companion.stop();
            toast('Der Zugang ist geschlossen.', 'ok');
            refresh();
          },
        })
      : h('button.btn.btn--sm.btn--primary', {
          text: 'Verbindung starten',
          onClick: async () => {
            const result = await window.ch.companion.start();
            if (!result?.ok) return toast(result?.error || 'Start fehlgeschlagen.', 'danger');
            toast('Der Zugang steht. Jetzt den QR-Code scannen.', 'ok');
            refresh();
          },
        })
  );

  // ---------------------------------------------------------------- Aus
  if (!info.running) {
    return h('div.col.gap-lg', null,
      h('div.notice.notice--accent', null,
        h('span.notice__icon', { text: '▯' }),
        h('div', null,
          h('div.strong', { text: 'So funktioniert die Handy-App' }),
          h('div.text-sm.muted', { text: 'Dein Rechner stellt die App im heimischen WLAN bereit. Das Telefon öffnet sie im Browser und legt sie auf den Startbildschirm – von da an sieht und startet sie sich wie eine gewöhnliche App. Das funktioniert auf iPhone und Android gleichermaßen, ohne App Store, ohne Entwicklerkonto und ohne dass Inhalte an einen fremden Server gehen.' }))),

      card('Verbindung ist aus', {},
        h('p.text-sm.muted.mb', { text: 'Solange sie aus ist, ist von aussen nichts erreichbar. Beim Start erzeugt die App einen Zufallsschlüssel, der ausschliesslich im QR-Code steckt.' }),
        h('button.btn.btn--primary', {
          text: 'Verbindung starten',
          onClick: async () => {
            const result = await window.ch.companion.start();
            if (!result?.ok) return toast(result?.error || 'Start fehlgeschlagen.', 'danger');
            refresh();
          },
        })),

      explainer());
  }

  // ---------------------------------------------------------------- An
  const qrHost = h('div', { style: { background: '#fff', padding: '12px', borderRadius: '14px', width: 'fit-content' } });
  try {
    qrHost.append(qrSvg(info.url, { size: 240 }));
  } catch (error) {
    fill(qrHost, h('div.text-sm', { style: { color: '#b00' }, text: `QR-Code nicht darstellbar: ${error.message}` }));
  }

  const alternatives = info.addresses.slice(1);

  return h('div.col.gap-lg', null,
    h('div.split', null,
      card('Mit dem Handy verbinden', { hint: 'Kamera öffnen und scannen' },
        h('div.row.gap-xl.wrap', null,
          qrHost,
          h('div.col.gap-sm.grow', null,
            h('div.strong', { text: '1. QR-Code scannen' }),
            h('div.text-sm.muted', { text: 'Mit der Kamera-App des Telefons. Der Link enthält den Schlüssel – er wird auf dem Gerät gespeichert und danach aus der Adresszeile entfernt.' }),
            h('div.strong.mt-sm', { text: '2. Zum Startbildschirm hinzufügen' }),
            h('div.text-sm.muted', { text: 'Auf dem iPhone über „Teilen“ → „Zum Home-Bildschirm“, auf Android über das Menü → „App installieren“. Danach startet sie im Vollbild wie eine normale App.' }),
            h('div.strong.mt-sm', { text: '3. Fertig' }),
            h('div.text-sm.muted', { text: 'Beiträge abhaken, Ideen festhalten, Zahlen eintragen – alles landet sofort hier.' }),
            h('div.row.gap-sm.mt', null,
              h('button.btn.btn--sm', { text: 'Adresse kopieren', onClick: () => copy(info.url, 'Adresse kopiert – am Handy einfügen.') }),
              h('button.btn.btn--sm.btn--ghost', {
                text: 'Neuen Schlüssel erzeugen',
                onClick: async () => {
                  if (!(await confirm({
                    title: 'Neuen Schlüssel erzeugen?',
                    message: 'Alle bisher verbundenen Geräte verlieren den Zugang und müssen den QR-Code erneut scannen.',
                    confirmLabel: 'Erzeugen',
                  }))) return;
                  await window.ch.companion.newToken();
                  toast('Neuer Schlüssel erzeugt.', 'ok');
                  refresh();
                },
              })))),

        h('hr.divider'),
        h('div.mono.text-sm.faint', { text: info.url }),
        alternatives.length
          ? h('div.text-xs.faint.mt-sm', { text: `Weitere Adressen dieses Rechners: ${alternatives.join(', ')} – falls die obere nicht erreichbar ist.` })
          : null),

      h('div.col.gap-lg', null,
        card('Status', {},
          h('div.col.gap-sm', null,
            h('div.row.between', null, h('span.muted', { text: 'Zugang' }), h('span.badge.badge--ok', { text: 'läuft' })),
            h('div.row.between', null, h('span.muted', { text: 'Anschluss' }), h('span.mono', { text: String(info.port) })),
            h('div.row.between', null, h('span.muted', { text: 'Erreichbar über' }), h('span.mono', { text: info.addresses[0] || '–' })))),

        card('Verbundene Geräte', { hint: `${info.devices.length}` },
          info.devices.length
            ? h('div.col.gap-sm', null,
                ...info.devices.map((device) =>
                  h('div.row.between', null,
                    h('span', { text: device.name }),
                    h('span.text-xs.faint', { text: fmt.relative(device.lastSeen) }))))
            : h('p.text-sm.muted', { text: 'Noch kein Gerät verbunden. Nach dem ersten Aufruf erscheint es hier.' })),

        card('Anschluss ändern', { hint: 'nur nötig, wenn belegt' },
          h('div.row.gap-sm', null,
            h('input.input', {
              type: 'number',
              value: settings.companionPort || 7788,
              min: 1024,
              max: 65535,
              onchange: async (event) => {
                const port = Number(event.target.value);
                await window.ch.companion.stop();
                const result = await window.ch.companion.start(port);
                if (!result?.ok) return toast(result.error, 'danger');
                toast(`Läuft jetzt auf Anschluss ${port}.`, 'ok');
                refresh();
              },
            }))))),

    explainer());
}

function explainer() {
  return card('Warum es so gebaut ist', {},
    h('div.grid.grid-3', null,
      h('div', null,
        h('div.strong.mb-sm', { text: 'Ohne App Store' }),
        h('p.text-sm.muted', { text: 'Eine App im Apple App Store setzt einen Mac und ein kostenpflichtiges Entwicklerkonto voraus. Die installierbare Web-App umgeht beides und verhält sich auf dem Startbildschirm praktisch identisch.' })),
      h('div', null,
        h('div.strong.mb-sm', { text: 'Ohne Cloud' }),
        h('p.text-sm.muted', { text: 'Telefon und Rechner sprechen direkt miteinander. Es gibt keinen Server dazwischen, keine Anmeldung und keine Kosten – und ausserhalb deines WLANs ist nichts erreichbar.' })),
      h('div', null,
        h('div.strong.mb-sm', { text: 'Auch ohne Empfang' }),
        h('p.text-sm.muted', { text: 'Ist der Rechner gerade aus, bleibt die Handy-App bedienbar. Eingaben werden gespeichert und beim nächsten Kontakt automatisch nachgereicht.' }))));
}
