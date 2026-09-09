# Roadmap

Der Ausbau erfolgt in Stufen. Jede Stufe ist für sich benutzbar – die App ist nie „halb kaputt“.

## Stufe 1 – Fundament
- [x] Electron-Grundgerüst, Fenster, sicherer Preload-Bridge
- [x] Lokaler JSON-Datenspeicher mit Migrationen und Auto-Backup
- [x] Plattform-Katalog (Limits, Formate, Best Practices) inkl. Twitch
- [x] Navigation, Design-System, Dark/Light

## Stufe 2 – Planen & Veröffentlichen
- [x] Composer: Multi-Plattform-Editor mit Live-Limits und Vorschauen
- [x] Kalender (Monat/Woche) und Queue mit Zeitfenstern
- [x] Scheduler im Hintergrund: Statuswechsel, Desktop-Benachrichtigungen, Tray
- [x] Wiederholungen, Serien, Content-Recycling

## Stufe 3 – Material & Ideen
- [x] Medienbibliothek mit Tags und Verwendungsnachweis
- [x] Ideenmaschine: Formate, Hooks, Titel-Varianten, Ideen-Pipeline
- [x] Skript-/Storyboard-Helfer mit Struktur-Vorlagen

## Stufe 4 – Verstehen & Verbessern
- [x] Analytics: manuelle Erfassung + CSV-Import aus YouTube/TikTok/Instagram Studios
- [x] Trendkurven, Format- und Zeitfenster-Vergleich
- [x] Coach: regelbasierte, konkrete Verbesserungsvorschläge aus den eigenen Zahlen

## Stufe 5 – Echte Anbindung
- [ ] OAuth-Verbindungen je Plattform (eigene Developer-Apps erforderlich)
- [ ] Automatisches Veröffentlichen statt Erinnerung
- [ ] Automatischer Kennzahlen-Abruf über die offiziellen APIs

## Stufe 6 – Komfort
- [ ] Windows-Installer und Auto-Update
- [ ] Team-/Freigabe-Workflow (Entwurf → Review → geplant)
- [ ] Optionale KI-Anbindung für Titel-, Hook- und Beschreibungsvorschläge

## Bewusste Grenzen
Auto-Publishing braucht pro Plattform eine eigene, verifizierte Developer-App
(YouTube Data API, Meta Graph API, TikTok Content Posting API, X API v2, LinkedIn,
Twitch Helix …). Bis diese Zugänge stehen, arbeitet der Scheduler als **präzise
Erinnerungs- und Übergabe-Maschine**: er legt Text, Tags, Thumbnail und Checkliste
zur Sekunde bereit und öffnet den passenden Upload-Dialog.
