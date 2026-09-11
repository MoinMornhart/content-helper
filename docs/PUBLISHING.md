# Publishing automatically – one-time setup

[Deutsch](VEROEFFENTLICHEN.md) · **English**

Content Helper publishes scheduled posts by itself on **YouTube, TikTok, Instagram, Facebook,
LinkedIn and X**. For that, every platform requires a **registered app**. The publisher of Content
Helper creates this app **once**. After that every user simply signs in with their own account and
never sees any of it.

This guide is for the publisher. If you only use the app, you don't need it.

---

## How it works for users

1. Open **Setup → Publishing** and click **Sign in** for the platforms you want.
2. In the **Composer**, pick a video, tick the channels, set a time.
3. Done. The post goes out at the scheduled time.

| Platform | When the upload happens | PC must be running at the scheduled time? |
| --- | --- | :---: |
| YouTube, YouTube Shorts | right after scheduling, YouTube releases it at the scheduled time | no |
| Facebook (Page) | right away, if the time is 15 minutes to 28 days ahead | no |
| TikTok | at the scheduled time | yes |
| Instagram Reels | at the scheduled time | yes |
| LinkedIn | at the scheduled time | yes |
| X | at the scheduled time | yes |

TikTok, Instagram, LinkedIn and X offer **no scheduling** through their APIs, so the app posts itself.
When you close the window it keeps running in the system tray, and under *Publishing* you can turn on
"Start with Windows". If the PC was off, the app catches up on the next start – up to one day late,
after that it asks you first.

If several PCs are linked, only the PC that also fetches YouTube and Twitch publishes. That way nothing
goes out twice.

---

## The quick way: Set up in the app

Under *Setup → Publishing*, click **Set up** for a platform. The right developer page opens in your
browser, and whatever you copy there – client ID, secret – the app recognizes by its format and fills
in by itself (for Google the downloaded JSON file works too). As soon as everything is there, the
sign-in starts right away. The steps below describe the same thing in detail.

## Redirect addresses

These addresses are needed when creating the apps:

| Platform | Redirect URI |
| --- | --- |
| Google / YouTube | none – app type **Desktop app** |
| TikTok | `http://127.0.0.1:51789/callback/` |
| Meta (Instagram, Facebook) | `https://www.facebook.com/connect/login_success.html` |
| LinkedIn | `https://moinmornhart.github.io/content-helper/anmeldung/` |
| X | `https://moinmornhart.github.io/content-helper/anmeldung/` |

The GitHub address doesn't need to be reachable: the app's sign-in window intercepts the redirect
before it arrives anywhere.

---

## 1. YouTube (Google)

1. [console.cloud.google.com](https://console.cloud.google.com/) → new project "Content Helper".
2. **APIs & Services → Library** → enable "YouTube Data API v3".
3. **OAuth consent screen** (Google Auth Platform): type *External*, app name, support email, scopes
   `youtube.upload` and `youtube.readonly`.
4. **Important:** set the publishing status to **In production**. In testing mode sign-ins expire
   after **7 days** – useless for scheduled uploads.
5. **Credentials → Create OAuth client ID → Desktop app**. Copy the client ID and client secret.
6. **Request the YouTube review:** YouTube permanently sets uploads from unreviewed projects to
   *private*. The [YouTube API Services form](https://support.google.com/youtube/contact/yt_api_form)
   lifts this and raises the daily quota (initially 100 uploads a day – for all users together). The
   review is free and usually takes a few weeks.
7. For more than 100 users Google also requires verification of the OAuth consent screen (privacy
   policy, a short demo video).

## 2. TikTok

1. [developers.tiktok.com](https://developers.tiktok.com/) → **Manage apps → Connect an app**.
2. Choose platform **Desktop**.
3. Add the products **Login Kit** and **Content Posting API**, and enable **Direct Post**.
4. Enter the redirect address `http://127.0.0.1:51789/callback/`.
5. Scopes: `user.info.basic`, `video.publish`, `video.upload`.
6. Submit for review. Copy the **Client Key** and **Client Secret**.
7. **Audit for public posts:** until TikTok has audited the app, only private posts ("Only me") are
   possible. The Composer already meets TikTok's requirements (account name, visibility without a
   preselection, interaction toggles, commercial content disclosure, consent text).

## 3. Instagram and Facebook (Meta)

1. [developers.facebook.com](https://developers.facebook.com/apps/) → **Create app**, type **Business**.
2. Add the products **Facebook Login** (or *Facebook Login for Business*) and **Instagram** (*API with
   Facebook Login*).
3. In Facebook Login: enable **Embedded Browser OAuth Login** and add
   `https://www.facebook.com/connect/login_success.html` as a valid redirect address.
4. Permissions: `pages_show_list`, `pages_read_engagement`, `pages_manage_posts`,
   `business_management`, `instagram_basic`, `instagram_content_publish`.
5. Copy the **App ID** and **App Secret**. If you use *Facebook Login for Business*, create a
   configuration with these permissions there and copy its **Configuration ID**.
6. For other people's accounts: **App Review** (advanced access) and **business verification**.
   Until then it works for everyone listed in the app as a tester or developer.

Requirement for users: an Instagram **professional account** (business or creator) linked to a
Facebook Page. Facebook Reels via the API may be at most 90 seconds long; Instagram allows 100 posts
in 24 hours.

## 4. LinkedIn

1. [linkedin.com/developers](https://www.linkedin.com/developers/apps) → **Create app** (requires a
   LinkedIn company page).
2. Under **Products**: *Share on LinkedIn* and *Sign In with LinkedIn using OpenID Connect*.
3. Under **Auth**: redirect address `https://moinmornhart.github.io/content-helper/anmeldung/`.
4. Copy the **Client ID** and **Client Secret**.

LinkedIn sign-ins last 60 days. The app reminds you a week ahead; signing in again is one click.

## 5. X

1. [developer.x.com](https://developer.x.com/) → create a project and an app.
2. **User authentication settings**: OAuth 2.0, type **Native App** (public client), permission
   **Read and write**.
3. Callback address `https://moinmornhart.github.io/content-helper/anmeldung/`, plus a website.
4. Copy the **Client ID** (native apps have no secret).
5. **Top up credits:** X bills every post made through the API individually (currently 1.5 cents,
   20 cents with a link) – paid by the developer account that owns the app.

---

## Getting the IDs into the app

**To try it out:** click **Set up** in the app as described above. The values stay on this PC.

**For all users:** store them as repository secrets. The GitHub release writes them into the
installer (`scripts/write-credentials.js`); they never appear in the public source code.

```bash
gh secret set CH_GOOGLE_CLIENT_ID
gh secret set CH_GOOGLE_CLIENT_SECRET
gh secret set CH_TIKTOK_CLIENT_KEY
gh secret set CH_TIKTOK_CLIENT_SECRET
gh secret set CH_META_APP_ID
gh secret set CH_META_APP_SECRET
gh secret set CH_META_CONFIG_ID        # only with Facebook Login for Business
gh secret set CH_LINKEDIN_CLIENT_ID
gh secret set CH_LINKEDIN_CLIENT_SECRET
gh secret set CH_X_CLIENT_ID
```

From the next version on, users only sign in.

> To be honest: whatever ships inside a desktop app can be extracted. Google explicitly says that the
> "secret" of a desktop app is not a secret. The real protection is every user's own sign-in with
> PKCE – without it, an extracted ID is useless to anyone.
