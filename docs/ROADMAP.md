# Roadmap

Der Ausbau erfolgt in Stufen. Jede Stufe ist für sich benutzbar – die App ist nie „halb kaputt“.

## Stufe 1 – Fundament
- [x] Electron-Grundgerüst, Fenster, abgesicherte Brücke zwischen Oberfläche und Hauptprozess
- [x] Lokaler JSON-Datenspeicher mit Migrationen und täglichem Schnappschuss
- [x] Plattform-Katalog mit 20 Kanälen (Limits, Formate, Best Practices) inklusive Twitch
- [x] Navigation, Design-System, Hell und Dunkel

## Stufe 2 – Planen und Veröffentlichen
- [x] Composer: ein Text für alle Kanäle, mit Live-Limits und Vorschauen
- [x] Kalender (Monat und Woche) und Warteschlange mit festen Zeitfenstern
- [x] Termine im Hintergrund: Vorwarnung, Fälligkeit, Tray, Text in der Zwischenablage
- [x] Kalender-Abo für Apple Kalender und Outlook, Export als .ics-Datei
- [ ] Wiederkehrende Beiträge und Serien
- [x] Automatisch veröffentlichen wie bei Buffer: YouTube, TikTok, Instagram, Facebook, LinkedIn, X
- [x] Fortsetzbare Uploads, Wiederholen nach Fehlern, nie doppelt – auch mit mehreren PCs
- [ ] Prüfung der Anwendungen durch YouTube, TikTok und Meta (bis dahin landen Uploads auf „privat“)
- [ ] Threads, Bluesky und Mastodon automatisch

## Stufe 3 – Material und Ideen
- [x] Medienbibliothek mit Schlagwörtern und Verwendungsnachweis
- [x] Ideenmaschine: Blickwinkel, Titel-Varianten, Einstiegssätze, Ideenbrett
- [x] Skript-Werkstatt mit Abschnitten, Zielzeiten und mitlaufender Sprechdauer

## Stufe 4 – Verstehen und Verbessern
- [x] Analytics: Handeingabe und CSV-Import aus den Studios
- [x] Verlauf, Vergleich mit dem Vorzeitraum, Auswertung nach Wochentag, Uhrzeit und Format
- [x] Coach: 19 Regeln, die aus den eigenen Zahlen konkrete Schritte ableiten
- [x] Assistent: erkennt tragende Themen und schlägt die nächsten Inhalte vor
- [x] Neuauflagen: der Coach meldet alte Erfolge, die sich erneut lohnen

## Stufe 5 – Automatischer Abgleich
- [x] YouTube über den offenen Kanal-Feed, ganz ohne Zugangsschlüssel
- [x] Beliebig viele YouTube-Kanäle, getrennt ausgewertet
- [x] Rückfallebene über die Kanalseite, wenn YouTube den Feed nicht herausgibt
- [x] Twitch per Anmeldung mit dem eigenen Konto: Übertragungen, Clips, Follower, Live-Zuschauer
- [x] Abtastung laufender Streams für Durchschnitt und Spitzenwert
- [x] Abgleich ohne Dubletten, Handeingaben bleiben erhalten
- [ ] Instagram und TikTok – beide geben ohne geschäftliches Konto und Prüfverfahren nichts heraus
- [ ] X – erst wieder, wenn es einen bezahlbaren Lesezugang gibt

## Stufe 6 – Komfort
- [x] Windows-Installer und Selbstaktualisierung
- [x] Handy-Begleiter für iPhone und Android über das eigene WLAN
- [x] Eigenes Erscheinungsbild: Akzentfarben, Hintergründe, eigenes Bild
- [x] Mehrere PCs per Code verbinden, verschlüsselt über den eigenen Cloud-Ordner ([#2](https://github.com/MoinMornhart/content-helper/issues/2))
- [x] Englische Oberfläche, umschaltbar, dazu README auf Englisch ([#3](https://github.com/MoinMornhart/content-helper/issues/3))
- [ ] Freigabe-Workflow (Entwurf → Review → geplant)
- [ ] Globale Suche über alle Inhalte, Ideen und Notizen

## Grundsatz: so wenig Schlüssel wie möglich
Wo es geht, braucht die App **keine API-Schlüssel und keine Developer-Apps**. YouTube kommt ganz
ohne aus. Bei Twitch gibt es keine Schlüssel zum Hantieren mehr: Man meldet sich mit dem eigenen
Konto an. Nur einmalig ist eine Client-ID nötig, weil Twitch Daten ausschließlich an registrierte
Anwendungen herausgibt – sie ist kein Passwort und steht in jeder öffentlichen App im Klartext.
Auch der Abgleich zwischen mehreren PCs kommt ohne Schlüssel und ohne Server aus.

Wo eine Plattform gar nichts freiwillig herausgibt, arbeitet die App als **Übergabemaschine**:

- **Veröffentlichen:** Zum Termin liegen Text, Hashtags und Checkliste bereit, der Text wandert auf
  Wunsch in die Zwischenablage, die passende Upload-Seite öffnet sich.
- **Kennzahlen:** Import per CSV aus den offiziellen Studios oder schnelle Handeingabe.
- **Ideen und Texte:** regelbasierte, lokal laufende Generatoren – kein KI-Dienst nötig.
