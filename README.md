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
| **Kanäle** | YouTube, TikTok, Instagram, X, LinkedIn, Threads, Bluesky, Mastodon, Pinterest, Facebook, Twitch, Reddit, Snapchat, Discord |

## Installation (Entwicklung)

```bash
npm install
npm start
```

Windows-Installer bauen:

```bash
npm run dist
```

## Datenspeicherung

Alle Inhalte liegen als lesbares JSON in deinem Benutzerprofil
(`%APPDATA%/Content Helper/data`). Kein Cloud-Zwang, kein Konto, keine Telemetrie.
Backups lassen sich in den Einstellungen als ZIP-freies JSON-Bundle exportieren.

## Lizenz

MIT – siehe [LICENSE](LICENSE).
