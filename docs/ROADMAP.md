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

## Stufe 5 – Komfort
- [ ] Windows-Installer und Auto-Update
- [ ] Freigabe-Workflow (Entwurf → Review → geplant)
- [ ] Globale Suche über alle Inhalte, Ideen und Notizen

## Grundsatz: ohne API-Schlüssel
Die App ist bewusst so gebaut, dass sie **keine API-Keys, keine Developer-Apps und keine
OAuth-Anmeldungen** benötigt. Jede Plattform würde dafür eine eigene, oft verifizierungs-
pflichtige Anwendung verlangen (YouTube Data API, Meta Graph API, TikTok Content Posting API,
X API, Twitch Helix …) – mit Kosten, Wartezeiten und Schlüsselverwaltung.

Stattdessen arbeitet der Content Helper als **präzise Übergabemaschine**:

- **Veröffentlichen:** Der Scheduler legt zum Termin Text, Tags, Hashtags und Checkliste
  fertig bereit, kopiert alles auf Wunsch in die Zwischenablage, öffnet die passende
  Upload-Seite und markiert den Beitrag nach Bestätigung als veröffentlicht.
- **Kennzahlen:** Import per CSV aus den offiziellen Studios (YouTube Studio, TikTok Studio,
  Meta Business Suite, Twitch Insights) oder schnelle manuelle Erfassung.
- **Ideen und Texte:** regelbasierte, lokal laufende Generatoren – keine Modell-Anbindung nötig.

Damit funktioniert die Software sofort nach dem Start, dauerhaft kostenlos und ohne dass
Inhalte den Rechner verlassen.
