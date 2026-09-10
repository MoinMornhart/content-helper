# Content Helper

[![Prüfung](https://github.com/MoinMornhart/content-helper/actions/workflows/pruefung.yml/badge.svg)](https://github.com/MoinMornhart/content-helper/actions/workflows/pruefung.yml)
[![Neueste Version](https://img.shields.io/github/v/release/MoinMornhart/content-helper?label=Download&color=8b5cf6)](https://github.com/MoinMornhart/content-helper/releases/latest)
[![Lizenz](https://img.shields.io/badge/Lizenz-MIT-10b981)](LICENSE)

**XXL Desktop-Werkzeugkasten für Creator.** Eine native Windows-App (Electron), die Content-Planung,
Multi-Plattform-Veröffentlichung, Ideenfindung und Performance-Analyse an einem Ort bündelt –
und dabei **alle Daten lokal auf deinem PC** speichert.

**→ [Fertige Version herunterladen](https://github.com/MoinMornhart/content-helper/releases/latest)**
(Installer oder portable Einzeldatei, kein Konto nötig)

> Status: aktive Entwicklung. Siehe [docs/ROADMAP.md](docs/ROADMAP.md) für den Stand der Ausbaustufen.

## Warum

Buffer plant. YouTube Studio analysiert. Notion sammelt Ideen. Content Helper macht alles drei –
offline, ohne Abo, ohne dass deine Inhalte auf fremden Servern landen.

## Kernfunktionen

| Bereich | Was es kann |
| --- | --- |
| **Dashboard** | Tagesüberblick, anstehende Posts, offene Aufgaben, Streaks, Coach-Hinweise |
| **Composer** | Ein Text, alle Plattformen: Live-Zeichenlimits, Vorschauen, Hashtag-Sets, Varianten pro Kanal |
| **Kalender & Queue** | Buffer-artige Zeitfenster, Drag-Planung, Wiederholungen, beste Posting-Zeiten |
| **Scheduler** | Läuft im Hintergrund (Tray), erinnert punktgenau, führt Veröffentlichungen aus |
| **Medienbibliothek** | Videos, Thumbnails, Assets mit Tags, Verwendungsnachweis und Dubletten-Check |
| **Ideenmaschine** | Formate, Hooks, Titel-Generator, Serien-Planer, Content-Recycling-Vorschläge |
| **Analytics** | Kennzahlen je Kanal, Trendkurven, Format-Vergleich, CSV-Import aus den Studios |
| **Coach** | Konkrete Verbesserungsvorschläge auf Basis deiner echten Zahlen |
| **Kanäle** | 20 Plattformen von YouTube über TikTok, Instagram und Twitch bis Newsletter und Blog |
| **Verbindungen** | Twitch und YouTube holen ihre Zahlen selbst – neue Videos, Streams und Clips landen automatisch im Verlauf |
| **Handy** | Installierbare Begleit-App fürs iPhone und Android – verbunden über dein eigenes WLAN |

## Ohne API-Schlüssel

Content Helper braucht **kein Konto, keine Developer-App und keinen API-Schlüssel**.
Jede Plattform würde dafür eine eigene, oft verifizierungspflichtige Anwendung verlangen.
Stattdessen arbeitet die App als präzise Übergabemaschine:

- **Veröffentlichen** – zum Termin liegen Text, Hashtags und Checkliste fertig bereit,
  der Text wandert auf Wunsch in die Zwischenablage und die Upload-Seite öffnet sich.
- **Kennzahlen** – per CSV-Export aus YouTube Studio, TikTok Studio, Meta Business Suite
  und Twitch Insights oder per schneller Handeingabe.
- **Ideen und Texte** – regelbasierte Generatoren, die lokal laufen.

## Verbindungen: Zahlen kommen von selbst

Alle 20 Minuten holt die App ab, was die Plattformen freiwillig herausgeben.

**YouTube – ohne jeden Schlüssel.** Es genügt der Kanalname oder das @Handle. YouTube
veröffentlicht für jeden Kanal einen offenen Feed; daraus liest die App die neuesten
Videos mit Titel, Datum, Aufrufen und Likes und legt sie als veröffentlichte Beiträge an,
damit Kalender und Coach den tatsächlichen Rhythmus kennen.

Es lassen sich **beliebig viele Kanäle** verbinden – Hauptkanal, Clipkanal, Nebenprojekt.
Jede Zahl trägt die Kennung ihres Kanals, und Analytics wie Assistent werten die Kanäle
getrennt aus. Das ist nicht nur Ordnung: Ein Kanal mit 200 Aufrufen je Video und einer
mit 200 000 im selben Topf würden jede Empfehlung verfälschen. Hat ein Kanal noch keine
öffentlichen Videos, bleibt er verbunden und meldet das als Hinweis, nicht als Fehler.
Gibt YouTube den Feed zeitweise nicht heraus, liest die App die Videoliste direkt von der
Kanalseite.

**Twitch – per Anmeldung mit dem eigenen Konto.** Knopf drücken, Browser geht auf,
bestätigen, fertig – kein Secret, kein Kanalname. Twitch gibt Daten nur an registrierte
Anwendungen heraus; übrig bleibt deshalb genau ein Wert, die Client-ID, die einmalig
hinterlegt oder fest eingebaut wird. Danach kommen automatisch:

- vergangene Übertragungen mit Aufrufen und Dauer,
- die stärksten Clips der Woche, auf Wunsch direkt als Kurzvideo-Ideen,
- und während du live bist, alle zwei Minuten die Zuschauerzahl – daraus entstehen
  Durchschnitt, Spitzenwert und geschaute Stunden je Stream.

Eine Anmeldung mit dem Twitch-Konto ist nicht nötig, weil ausschliesslich öffentlich
einsehbare Kanaldaten abgefragt werden. Kennung und Geheimnis liegen im lokalen
Datenordner.

**X (Twitter) – nicht möglich.** X verlangt seit 2023 für jeden lesenden Zugriff ein
kostenpflichtiges Abonnement ab mehreren hundert Dollar im Monat. Einen kostenlosen oder
schlüsselfreien Weg gibt es nicht. Für X bleibt der CSV-Import aus X Analytics.

Von Hand eingetragene Werte überleben jeden Abgleich: automatisch geholte Zahlen werden
aufgefrischt, eigene Ergänzungen bleiben unangetastet.

## Handy-Begleiter

Die Desktop-App liefert im Heimnetz eine installierbare Web-App aus. QR-Code scannen,
zum Startbildschirm hinzufügen – fertig. Funktioniert auf **iOS und Android**, ohne
App Store, ohne Entwicklerkonto, ohne Cloud. Unterwegs Ideen festhalten, Beiträge
abhaken und Zahlen eintragen; ist der Rechner aus, werden Eingaben zwischengespeichert
und später nachgereicht.

## Aktualisierung

Bei jedem Start prüft die App, ob auf der Projektseite eine neuere Version veröffentlicht
wurde, und meldet sich, wenn es etwas Neues gibt. Heruntergeladen wird nichts von allein.

## Installation (Entwicklung)

```bash
npm install     # Electron holen
npm start       # App starten
npm run dev     # mit Entwicklerwerkzeugen
npm test        # Syntaxprüfung und Rauchtest über alle Ansichten
npm run dist    # Windows-Installer bauen
npm run icons   # App-Symbole neu erzeugen
```

Voraussetzung ist Node.js 20 oder neuer. Weitere Abhängigkeiten gibt es nicht:
kein Build-Schritt, kein Framework, keine Laufzeitpakete.

## Neue Version veröffentlichen

```bash
npm version minor            # hebt die Nummer und setzt den Versionsstempel
git push origin main --tags  # GitHub baut und veröffentlicht automatisch
```

Der Arbeitsablauf unter `.github/workflows/` baut daraufhin Installer und portable
Fassung und hängt beide an die Veröffentlichung. Genau von dort liest die App beim
Start ihre Update-Prüfung – alle Nutzer bekommen die neue Fassung also automatisch
gemeldet.

## Datenspeicherung

Alle Inhalte liegen als lesbares JSON in deinem Benutzerprofil
(`%APPDATA%/Content Helper/data`). Kein Cloud-Zwang, kein Konto, keine Telemetrie.
Täglich wird automatisch ein Schnappschuss abgelegt, dazu lässt sich jederzeit ein
vollständiges Backup exportieren und wieder einlesen.

## Aufbau

```
src/
├── main/        Hauptprozess: Fenster, Datenspeicher, Scheduler, Update, WLAN-Server
├── renderer/    Desktop-Oberfläche: Ansichten, Bibliotheken, Design-System
├── mobile/      Handy-App (installierbare Web-App)
└── shared/      Plattform-Katalog und Kennzahlen-Wörterbuch
```

## Lizenz

MIT – siehe [LICENSE](LICENSE).
