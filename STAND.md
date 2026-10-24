# Stand: Content Helper (Übergabe 2026-10-24)

## Was es ist
Lokale Windows-Desktop-App (Electron) für Creator, „wie Buffer“: Beiträge für 20 Kanäle planen, automatisch
veröffentlichen, Ideen/Skripte schreiben und aus den eigenen Zahlen auswerten. Alles bleibt als Dateien auf dem PC.
Abgrenzung: Das ist **nicht** MoinStudio (Thumbnail/Schnitt/Planung mit Blender) und kein direkter Vorläufer davon –
der Vorläufer/Nachbau dazu ist `contentstudio`. Ideen und Texte laufen hier regelbasiert, ohne KI-Dienst.

## Aktueller Stand (v0.9.0, Release vom 11.09.2026)
- Dashboard, Composer mit Plattform-Vorschauen und Textprüfung, Kalender + Warteschlange, Kalender-Abo (.ics)
- Automatisch veröffentlichen: YouTube, TikTok, Instagram, Facebook, LinkedIn, X (fortsetzbar, nie doppelt)
- Ideenbrett, Skript-Werkstatt, Medienbibliothek mit Schlagwörtern
- Analytics (CSV-Import aus den Studios), Coach mit 19 Regeln, Assistent mit Themenvorschlägen
- Abgleich: YouTube ohne Schlüssel (mehrere Kanäle), Twitch per Anmeldung (Live-Zuschauer)
- Mehrere PCs per Code verbunden (verschlüsselt über eigenen Cloud-Ordner), Handy-Begleiter im WLAN
- Deutsch/Englisch, eigenes Erscheinungsbild, Windows-Installer + portable Fassung, Selbstaktualisierung
- Webseite auf GitHub Pages (moinmornhart.github.io/content-helper)

## Zuletzt gemacht
- 2026-10-24 SessionStart-Hook für Cloud-Sitzungen (`.claude/hooks/skills-cloud.sh`)
- 2026-09-28 bis 10-19 Dependabot: Electron schrittweise auf 44.7/44.8
- 2026-09-15/16 Actions + Node aktualisiert, Dependabot und VibeWorks-Repo-Check eingerichtet
- 2026-09-11 Webseite, Englisch (0.9.0), PCs verbinden (0.7.0), automatisch veröffentlichen (0.8.0)

## Offen / Nächste Schritte
- Roadmap (`docs/ROADMAP.md`), noch nicht erledigt:
  - Wiederkehrende Beiträge und Serien
  - Prüfung der Apps durch YouTube, TikTok, Meta (bis dahin landen Uploads auf „privat“)
  - Threads, Bluesky, Mastodon automatisch; Instagram/TikTok/X-Abgleich (Plattformen geben nichts heraus)
  - Freigabe-Workflow (Entwurf → Review → geplant), globale Suche
- 33 offene Issues, fast alle vom VibeWorks-Repo-Check: #41 (Sicherheitslücke electron), #37 (Repo-Check-Befunde),
  #34 (7 mögliche Geheimnisse in `scripts/test-providers.js` prüfen – vermutlich Testwerte, unklar), #5–#33 einzelne Befunde,
  #4 (electron-builder/electron-updater aktualisieren)
- Offener PR #35 (Dependabot Actions); Branch `sicherheit/fixes-2026-10-18` (nur package-lock, ohne PR, nicht gemergt)
- Seit 0.9.0 (11.09.) kein neues Release – Electron-Updates sind nur auf main

## Wichtige Infos
- Technik: Electron (Node ≥ 22), reines JavaScript ohne Framework, electron-updater; Daten als JSON lokal
- Start: `npm install && npm start` (Entwicklung `npm run dev`)
- Tests: `npm test` (vorher automatisch Syntaxprüfung + Einzeltests in `scripts/`, Rauchtest mit Electron)
- Build: `npm run dist` (NSIS-Installer + portable, x64); Veröffentlichen über Workflow `veroeffentlichung.yml` nach GitHub Releases
- Twitch braucht einmalig eine Client-ID; Einrichtung der Plattform-Apps in `docs/VEROEFFENTLICHEN.md` / `docs/PUBLISHING.md`
- Commit-Stil: Conventional Commits auf Deutsch (`feat:`, `fix:`, `release:`)

## Philips Vorgaben
- Repo **öffentlich** (MoinMornhart/content-helper), Lizenz MIT
- Update-Funktion: ja (lädt im Hintergrund, spielt sich beim Neustart ein)
- Git-Texte: Philip hat bei den Sicherheits-Fixes (18./19.10.2026) „Verfasst mit Claude 🤖“ in Commit-Texten festgelegt
- Keine Geheimnisse ins Repo; `C:\Projekte` und GitHub sollen gleich sein

---
Diese Datei wird beim Arbeiten aktuell gehalten: nach jedem größeren Schritt „Aktueller Stand“ und „Offen“ anpassen.
