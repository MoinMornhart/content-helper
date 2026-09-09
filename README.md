# Content Helper

**XXL Desktop-Werkzeugkasten für Creator.** Eine native Windows-App (Electron), die Content-Planung,
Multi-Plattform-Veröffentlichung, Ideenfindung und Performance-Analyse an einem Ort bündelt –
und dabei **alle Daten lokal auf deinem PC** speichert.

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
