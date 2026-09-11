# Automatisch veröffentlichen – einmalige Einrichtung

**Deutsch** · [English](PUBLISHING.md)

Der Content Helper veröffentlicht geplante Beiträge von selbst auf **YouTube, TikTok, Instagram,
Facebook, LinkedIn und X**. Damit das geht, verlangt jede Plattform eine bei ihr
**registrierte Anwendung**. Diese Anwendung legt der Herausgeber des Content Helpers **einmal** an.
Danach meldet sich jeder Nutzer nur noch mit seinem eigenen Konto an und sieht davon nichts.

Diese Anleitung ist für den Herausgeber. Wer die App nur benutzt, braucht sie nicht.

---

## So läuft es für Nutzer

1. **Einrichten → Veröffentlichen** öffnen und bei den gewünschten Plattformen **Anmelden** klicken.
2. Im **Composer** ein Video wählen, Kanäle ankreuzen, Termin setzen.
3. Fertig. Zum Termin geht der Beitrag raus.

| Plattform | Wann hochgeladen wird | PC muss zum Termin laufen? |
| --- | --- | :---: |
| YouTube, YouTube Shorts | sofort nach dem Einplanen, YouTube schaltet zum Termin frei | nein |
| Facebook (Seite) | sofort, wenn der Termin 15 Minuten bis 28 Tage entfernt ist | nein |
| TikTok | zum Termin | ja |
| Instagram-Reels | zum Termin | ja |
| LinkedIn | zum Termin | ja |
| X | zum Termin | ja |

TikTok, Instagram, LinkedIn und X bieten über ihre Schnittstellen **kein Vorausplanen** an. Dort
postet die App selbst. Beim Schließen bleibt sie im Infobereich aktiv, und unter
*Veröffentlichen* lässt sich „Mit Windows starten“ einschalten. War der PC aus, holt die App
Verpasstes beim nächsten Start nach – bis zu einem Tag später, danach fragt sie nach.

Sind mehrere PCs verbunden, veröffentlicht nur der PC, der auch YouTube und Twitch abholt. So geht
nichts doppelt raus.

---

## Rückleitungsadressen

Beim Anlegen der Anwendungen werden diese Adressen gebraucht:

| Plattform | Rückleitungsadresse (Redirect URI) |
| --- | --- |
| Google / YouTube | keine – Anwendungstyp **Desktop-App** |
| TikTok | `http://127.0.0.1:51789/callback/` |
| Meta (Instagram, Facebook) | `https://www.facebook.com/connect/login_success.html` |
| LinkedIn | `https://moinmornhart.github.io/content-helper/anmeldung/` |
| X | `https://moinmornhart.github.io/content-helper/anmeldung/` |

Die GitHub-Adresse muss nicht erreichbar sein: Das Anmeldefenster der App fängt die Rückleitung ab,
bevor sie irgendwo ankommt.

---

## 1. YouTube (Google)

1. [console.cloud.google.com](https://console.cloud.google.com/) → neues Projekt „Content Helper“.
2. **APIs & Dienste → Bibliothek** → „YouTube Data API v3“ aktivieren.
3. **OAuth-Zustimmungsbildschirm** (Google Auth Platform): Typ *Extern*, App-Name, Support-Adresse,
   Bereiche `youtube.upload` und `youtube.readonly`.
4. **Wichtig:** Veröffentlichungsstatus auf **In Produktion** stellen. Im Testmodus laufen
   Anmeldungen nach **7 Tagen** ab – für geplante Uploads unbrauchbar.
5. **Anmeldedaten → OAuth-Client-ID erstellen → Desktop-App**. Client-ID und Client-Secret notieren.
6. **YouTube-Prüfung beantragen:** Uploads von ungeprüften Projekten stellt YouTube dauerhaft auf
   *privat*. Das [Formular für die YouTube API Services](https://support.google.com/youtube/contact/yt_api_form)
   hebt das auf und erhöht das Tageskontingent (anfangs 100 Uploads pro Tag – für alle Nutzer
   zusammen). Die Prüfung ist kostenlos und dauert meist einige Wochen.
7. Für mehr als 100 Nutzer verlangt Google außerdem die Bestätigung des OAuth-Zustimmungsbildschirms
   (Datenschutzerklärung, kurzes Vorführvideo).

## 2. TikTok

1. [developers.tiktok.com](https://developers.tiktok.com/) → **Manage apps → Connect an app**.
2. Plattform **Desktop** wählen.
3. Produkte **Login Kit** und **Content Posting API** hinzufügen, bei Content Posting **Direct Post**
   einschalten.
4. Rückleitungsadresse `http://127.0.0.1:51789/callback/` eintragen.
5. Bereiche: `user.info.basic`, `video.publish`, `video.upload`.
6. Zur Prüfung einreichen. **Client Key** und **Client Secret** notieren.
7. **Audit für öffentliche Posts:** Bis TikTok die Anwendung geprüft hat, sind nur private Posts
   („Nur ich“) möglich. Der Composer erfüllt bereits TikToks Vorgaben (Kontoname, Sichtbarkeit ohne
   Vorauswahl, Interaktionsschalter, Kennzeichnung werblicher Inhalte, Zustimmungstext).

## 3. Instagram und Facebook (Meta)

1. [developers.facebook.com](https://developers.facebook.com/apps/) → **App erstellen**, Typ **Business**.
2. Produkte **Facebook Login** (bzw. *Facebook Login for Business*) und **Instagram** (*API mit
   Facebook-Login*) hinzufügen.
3. Bei Facebook Login: **Embedded Browser OAuth Login** einschalten und
   `https://www.facebook.com/connect/login_success.html` als gültige Rückleitungsadresse eintragen.
4. Berechtigungen: `pages_show_list`, `pages_read_engagement`, `pages_manage_posts`,
   `business_management`, `instagram_basic`, `instagram_content_publish`.
5. **App-ID** und **App-Geheimcode** notieren. Wer *Facebook Login for Business* nutzt, legt dort
   eine Konfiguration mit diesen Berechtigungen an und notiert die **Konfigurations-ID**.
6. Für fremde Konten: **App Review** (erweiterter Zugriff) und **Unternehmensverifizierung**.
   Bis dahin funktioniert es für alle, die in der App als Tester oder Entwickler eingetragen sind.

Voraussetzung bei Nutzern: ein Instagram-**Profikonto** (Business oder Creator), das mit einer
Facebook-Seite verbunden ist. Facebook-Reels über die Schnittstelle dürfen höchstens 90 Sekunden
lang sein; Instagram erlaubt 100 Posts in 24 Stunden.

## 4. LinkedIn

1. [linkedin.com/developers](https://www.linkedin.com/developers/apps) → **Create app** (verlangt
   eine LinkedIn-Unternehmensseite).
2. Unter **Products**: *Share on LinkedIn* und *Sign In with LinkedIn using OpenID Connect*.
3. Unter **Auth**: Rückleitungsadresse `https://moinmornhart.github.io/content-helper/anmeldung/`.
4. **Client ID** und **Client Secret** notieren.

LinkedIn-Anmeldungen gelten 60 Tage. Die App erinnert eine Woche vorher; neu anmelden ist ein Klick.

## 5. X

1. [developer.x.com](https://developer.x.com/) → Projekt und App anlegen.
2. **User authentication settings**: OAuth 2.0, Typ **Native App** (öffentliche Anwendung),
   Berechtigung **Read and write**.
3. Callback-Adresse `https://moinmornhart.github.io/content-helper/anmeldung/`, dazu eine Website.
4. **Client ID** notieren (ein Secret gibt es für Native Apps nicht).
5. **Guthaben aufladen:** X rechnet jeden Post über die Schnittstelle einzeln ab (derzeit 1,5 Cent,
   mit Link 20 Cent) – bezahlt vom Entwicklerkonto, dem die Anwendung gehört.

---

## Kennungen in die App bringen

**Zum Ausprobieren:** In der App unter *Einrichten → Veröffentlichen* auf **Einrichten** klicken. Die
richtige Seite der Plattform öffnet sich, und was du dort kopierst, erkennt die App an seiner Form
und trägt es selbst ein – bei Google geht auch die heruntergeladene JSON-Datei. Sobald alles da ist,
startet direkt die Anmeldung. Die Werte bleiben auf diesem PC.

**Für alle Nutzer:** Als Repository-Geheimnisse hinterlegen. Die Veröffentlichung auf GitHub schreibt
sie ins Installationspaket (`scripts/write-credentials.js`); im öffentlichen Quelltext stehen sie nicht.

```bash
gh secret set CH_GOOGLE_CLIENT_ID
gh secret set CH_GOOGLE_CLIENT_SECRET
gh secret set CH_TIKTOK_CLIENT_KEY
gh secret set CH_TIKTOK_CLIENT_SECRET
gh secret set CH_META_APP_ID
gh secret set CH_META_APP_SECRET
gh secret set CH_META_CONFIG_ID        # nur bei Facebook Login for Business
gh secret set CH_LINKEDIN_CLIENT_ID
gh secret set CH_LINKEDIN_CLIENT_SECRET
gh secret set CH_X_CLIENT_ID
```

Ab der nächsten Version melden sich Nutzer nur noch an.

> Ehrlich gesagt: Was in einer Desktop-App steckt, lässt sich auslesen. Google sagt ausdrücklich,
> dass das „Secret“ einer Desktop-Anwendung kein Geheimnis ist. Die eigentliche Absicherung ist die
> Anmeldung jedes Nutzers mit PKCE – ohne sie nützt eine ausgelesene Kennung niemandem etwas.
