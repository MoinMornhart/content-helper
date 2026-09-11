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
- [ ] Echtes Hochladen zu YouTube (Anmeldung vorhanden, Upload in Arbeit)

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
- [ ] Mehrere PCs miteinander koppeln ([#2](https://github.com/MoinMornhart/content-helper/issues/2))
- [ ] Freigabe-Workflow (Entwurf → Review → geplant)
- [ ] Globale Suche über alle Inhalte, Ideen und Notizen

## Grundsatz: so wenig Schlüssel wie möglich
Wo es geht, braucht die App **keine API-Schlüssel und keine Developer-Apps**. YouTube kommt ganz
ohne aus. Twitch gibt Daten nur an registrierte Anwendungen heraus – dort genügt eine Anmeldung
mit dem eigenen Konto und einmalig eine Client-ID.

Wo eine Plattform gar nichts freiwillig herausgibt, arbeitet die App als **Übergabemaschine**:

- **Veröffentlichen:** Zum Termin liegen Text, Hashtags und Checkliste bereit, der Text wandert auf
  Wunsch in die Zwischenablage, die passende Upload-Seite öffnet sich.
- **Kennzahlen:** Import per CSV aus den offiziellen Studios oder schnelle Handeingabe.
- **Ideen und Texte:** regelbasierte, lokal laufende Generatoren – kein KI-Dienst nötig.
