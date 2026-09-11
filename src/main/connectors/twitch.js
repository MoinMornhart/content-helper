'use strict';

/**
 * Twitch-Verbindung.
 *
 * Holt automatisch, was Twitch über die offizielle Schnittstelle für einen
 * Kanal herausgibt: laufender Stream, vergangene Übertragungen mit Aufrufen und
 * Dauer sowie die stärksten Clips.
 *
 * Dafür ist eine eigene Twitch-Anwendung nötig (kostenlos, einmalig angelegt
 * unter dev.twitch.tv). Sie liefert Kennung und Geheimnis, aus denen die App
 * selbstständig ein Zugriffsmerkmal zieht – eine Anmeldung mit deinem
 * Twitch-Konto ist nicht erforderlich, weil ausschliesslich öffentlich
 * einsehbare Daten abgefragt werden.
 *
 * Beide Werte liegen ausschliesslich im lokalen Datenordner und werden
 * niemals weitergegeben oder protokolliert.
 */

const http = require('./http');
const { TwitchAuth } = require('./twitch-auth');
const { upsertAnalytics, upsertPublishedPost, linkAnalyticsToPost } = require('./shared');
const { t } = require('../i18n');

const TOKEN_URL = 'https://id.twitch.tv/oauth2/token';
const API = 'https://api.twitch.tv/helix';

/** Wie oft der laufende Stream abgetastet wird, um Durchschnitt und Spitze zu ermitteln. */
const LIVE_SAMPLE_MS = 2 * 60 * 1000;

class TwitchConnector {
  constructor(store) {
    this.store = store;
    this.token = null;
    this.tokenExpires = 0;
    /** Laufende Sitzung: Stichproben der Zuschauerzahl während eines Streams. */
    this.session = null;
    /** Anmeldung mit dem Twitch-Konto – der bevorzugte Weg. */
    this.auth = new TwitchAuth(store);
  }

  config() {
    return this.store.settings().connections?.twitch || {};
  }

  saveConfig(patch) {
    const connections = { ...(this.store.settings().connections || {}) };
    connections.twitch = { ...(connections.twitch || {}), ...patch };
    this.store.saveSettings({ connections });
    return connections.twitch;
  }

  /**
   * Nutzbar ist die Verbindung auf zwei Wegen: angemeldet mit dem eigenen
   * Twitch-Konto (bevorzugt, liefert mehr Zahlen) oder mit hinterlegter Kennung
   * und Geheimnis für rein öffentliche Daten.
   */
  isConfigured() {
    if (this.auth.isSignedIn() && this.config().userId) return true;
    const config = this.config();
    return Boolean(config.clientId && config.clientSecret && config.login);
  }

  /** Welcher Weg wird gerade genutzt? */
  get mode() {
    return this.auth.isSignedIn() ? 'login' : 'app';
  }

  // ---------------------------------------------------------------- Zugang

  /** Zugriffsmerkmal für die Anwendung, wird zwischengespeichert. */
  async accessToken() {
    if (this.token && Date.now() < this.tokenExpires - 60_000) return this.token;

    const { clientId, clientSecret } = this.config();
    if (!clientId || !clientSecret) throw new Error(t('Kennung und Geheimnis der Twitch-Anwendung fehlen.'));

    const body = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'client_credentials',
    }).toString();

    const payload = await http.json(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    }).catch((error) => {
      throw new Error(
        /invalid client/i.test(error.message)
          ? t('Kennung oder Geheimnis stimmen nicht. Beides steht in deiner Anwendung auf dev.twitch.tv.')
          : t('Twitch meldet: {message}', { message: error.message })
      );
    });

    this.token = payload.access_token;
    this.tokenExpires = Date.now() + (payload.expires_in || 3600) * 1000;
    return this.token;
  }

  /**
   * Ruft einen Helix-Endpunkt auf. Ist der Nutzer angemeldet, wird sein
   * Merkmal verwendet – damit stehen auch Follower- und Abonnentenzahlen offen.
   */
  async call(path, params = {}) {
    if (this.auth.isSignedIn()) return this.auth.call(path, params);

    const token = await this.accessToken();
    const query = new URLSearchParams(
      Object.entries(params).filter(([, value]) => value !== null && value !== undefined)
    ).toString();

    return http.json(`${API}/${path}${query ? `?${query}` : ''}`, {
      headers: {
        'Client-Id': this.config().clientId,
        Authorization: `Bearer ${token}`,
      },
    });
  }

  // ---------------------------------------------------------------- Abfragen

  /** Prüft die Zugangsdaten und liefert den gefundenen Kanal zurück. */
  async verify(login = this.config().login) {
    const name = String(login || '').trim().replace(/^@/, '').toLowerCase();
    if (!name) throw new Error(t('Bitte den Twitch-Kanalnamen angeben.'));

    const payload = await this.call('users', { login: name });
    const user = payload.data?.[0];
    if (!user) throw new Error(t('Den Kanal „{name}“ gibt es auf Twitch nicht.', { name }));

    this.saveConfig({
      login: user.login,
      userId: user.id,
      displayName: user.display_name,
      avatar: user.profile_image_url,
      verifiedAt: new Date().toISOString(),
    });

    return {
      login: user.login,
      displayName: user.display_name,
      userId: user.id,
      avatar: user.profile_image_url,
      description: user.description,
    };
  }

  /** Läuft gerade ein Stream? Liefert null, wenn nicht. */
  async currentStream() {
    const { userId } = this.config();
    if (!userId) return null;
    const payload = await this.call('streams', { user_id: userId });
    const stream = payload.data?.[0];
    if (!stream) return null;
    return {
      id: stream.id,
      title: stream.title,
      game: stream.game_name,
      viewers: stream.viewer_count,
      startedAt: stream.started_at,
      language: stream.language,
    };
  }

  /** Die letzten Aufzeichnungen vergangener Übertragungen. */
  async recentBroadcasts(limit = 20) {
    const { userId } = this.config();
    if (!userId) return [];
    const payload = await this.call('videos', { user_id: userId, type: 'archive', first: Math.min(100, limit) });
    return (payload.data || []).map((video) => ({
      id: video.id,
      title: video.title,
      url: video.url,
      views: video.view_count,
      createdAt: video.created_at,
      durationSeconds: parseDuration(video.duration),
    }));
  }

  /** Die stärksten Clips eines Zeitraums – Nachschub für Kurzvideos. */
  async topClips({ days = 7, limit = 10 } = {}) {
    const { userId } = this.config();
    if (!userId) return [];
    const startedAt = new Date(Date.now() - days * 86400000).toISOString();
    const payload = await this.call('clips', { broadcaster_id: userId, first: Math.min(100, limit), started_at: startedAt });
    return (payload.data || []).map((clip) => ({
      id: clip.id,
      title: clip.title,
      url: clip.url,
      views: clip.view_count,
      createdAt: clip.created_at,
      durationSeconds: Math.round(clip.duration || 0),
      creator: clip.creator_name,
    }));
  }

  // ---------------------------------------------------------------- Abgleich

  /**
   * Holt alles und schreibt daraus Messwerte in den Datenbestand.
   * Bereits bekannte Einträge werden aktualisiert statt verdoppelt.
   *
   * @returns {Promise<{added: number, updated: number, live: object|null, clips: number}>}
   */
  async sync() {
    if (!this.isConfigured()) throw new Error(t('Die Twitch-Verbindung ist noch nicht eingerichtet.'));

    const result = { added: 0, updated: 0, live: null, clips: 0, ideas: 0, posts: 0 };
    const createPosts = this.config().createPosts !== false;

    // --- Vergangene Übertragungen
    for (const broadcast of await this.recentBroadcasts(20)) {
      const externalId = `twitch:video:${broadcast.id}`;

      const outcome = upsertAnalytics(this.store, {
        externalId,
        platformId: 'twitch',
        date: broadcast.createdAt.slice(0, 10),
        title: broadcast.title,
        url: broadcast.url,
        metrics: {
          views: broadcast.views,
          streamMinutes: Math.round(broadcast.durationSeconds / 60),
        },
        source: 'twitch',
      });
      result[outcome === 'added' ? 'added' : 'updated'] += 1;

      if (createPosts) {
        const postId = upsertPublishedPost(this.store, {
          externalId,
          title: broadcast.title,
          platforms: ['twitch'],
          publishedAt: broadcast.createdAt,
          url: broadcast.url,
          format: 'Gameplay-Stream',
        });
        if (postId) {
          linkAnalyticsToPost(this.store, externalId, postId);
          result.posts += 1;
        }
      }
    }

    // --- Laufender Stream
    result.live = await this.sampleLive();

    // --- Clips als Ideen für Kurzvideos
    if (this.config().createClipIdeas !== false) {
      const clips = await this.topClips({ days: 7, limit: 5 });
      result.clips = clips.length;
      const knownIdeas = new Set(this.store.list('ideas').map((idea) => idea.externalId).filter(Boolean));

      for (const clip of clips) {
        const externalId = `twitch:clip:${clip.id}`;
        if (knownIdeas.has(externalId)) continue;
        // Nur Clips, die tatsächlich Zuspruch hatten, werden zur Idee.
        if (clip.views < 20) continue;
        this.store.insert('ideas', {
          title: t('Kurzvideo aus Clip: {title}', { title: clip.title }),
          notes: [
            t('Clip mit {views} Aufrufen, {seconds} Sekunden.', { views: clip.views, seconds: clip.durationSeconds }),
            clip.url,
            '',
            t('Zuschnitt auf 9:16, Untertitel einbrennen, Hook in Sekunde 1 prüfen.'),
          ].join('\n'),
          status: 'inbox',
          score: clip.views >= 200 ? 4 : 3,
          platforms: ['youtube_shorts', 'tiktok', 'instagram_reels'],
          externalId,
          source: 'Twitch-Clip',
        });
        result.ideas += 1;
      }
    }

    // --- Kanalstand: Zahlen, die Twitch nur dem angemeldeten Inhaber zeigt
    if (this.auth.isSignedIn()) {
      result.channel = await this.snapshotChannel().catch(() => null);
    }

    this.saveConfig({ lastSync: new Date().toISOString(), lastError: null });
    return result;
  }

  /**
   * Hält Follower- und Abonnentenzahl als Tagesstand fest und berechnet den
   * Zuwachs gegenüber dem letzten Stand.
   *
   * Wichtig ist die Trennung: Der Gesamtstand ist eine andere Aussage als der
   * Zuwachs. Beides in dieselbe Kennzahl zu schreiben würde jede Auswertung
   * verfälschen – ein Kanal mit 5000 Followern hätte sonst jeden Tag "5000 neue
   * Follower".
   */
  async snapshotChannel() {
    const followers = await this.auth.followerCount();
    const subs = await this.auth.subscriberCount();
    if (followers === null && subs === null) return null;

    const today = new Date().toISOString().slice(0, 10);
    const externalId = `twitch:channel:${today}`;

    // Letzter Stand vor heute, um den Zuwachs zu bestimmen.
    const previous = this.store.list('analytics')
      .filter((entry) => entry.externalId?.startsWith('twitch:channel:') && entry.date < today)
      .sort((a, b) => b.date.localeCompare(a.date))[0];

    const metrics = {};
    if (followers !== null) {
      metrics.followersTotal = followers;
      if (previous?.metrics?.followersTotal !== undefined) {
        metrics.followersGained = followers - previous.metrics.followersTotal;
      }
    }
    if (subs !== null) {
      metrics.subsTotal = subs;
      if (previous?.metrics?.subsTotal !== undefined) {
        metrics.subsGained = subs - previous.metrics.subsTotal;
      }
    }

    upsertAnalytics(this.store, {
      externalId,
      platformId: 'twitch',
      date: today,
      title: t('Kanalstand {name}', { name: this.config().displayName || this.config().login || '' }).trim(),
      metrics,
      source: 'twitch',
      note: previous ? t('Zuwachs gegenüber {date}.', { date: previous.date }) : t('Erster erfasster Stand.'),
    });

    return { followers, subs };
  }

  /**
   * Tastet den laufenden Stream ab. Aus den Stichproben entstehen am Ende
   * Durchschnitt und Spitzenwert – Zahlen, die Twitch selbst nur im Nachhinein
   * und nur dem Kanalinhaber zeigt.
   */
  async sampleLive() {
    const stream = await this.currentStream();

    if (!stream) {
      if (this.session) {
        const finished = this.finishSession();
        return { ended: true, ...finished };
      }
      return null;
    }

    if (!this.session || this.session.streamId !== stream.id) {
      this.session = {
        streamId: stream.id,
        title: stream.title,
        game: stream.game,
        startedAt: stream.startedAt,
        samples: [],
      };
    }

    const last = this.session.samples.at(-1);
    if (!last || Date.now() - last.at >= LIVE_SAMPLE_MS - 5_000) {
      this.session.samples.push({ at: Date.now(), viewers: stream.viewers });
    }
    this.session.title = stream.title;
    this.session.game = stream.game;

    return {
      live: true,
      title: stream.title,
      game: stream.game,
      viewers: stream.viewers,
      startedAt: stream.startedAt,
      samples: this.session.samples.length,
    };
  }

  /** Schliesst eine Sitzung ab und schreibt das Ergebnis als Messwert. */
  finishSession() {
    const session = this.session;
    this.session = null;
    if (!session || !session.samples.length) return { saved: false };

    const viewers = session.samples.map((sample) => sample.viewers);
    const minutes = Math.max(1, Math.round((Date.now() - new Date(session.startedAt).getTime()) / 60000));
    const average = viewers.reduce((sum, value) => sum + value, 0) / viewers.length;

    const externalId = `twitch:session:${session.streamId}`;
    if (this.store.list('analytics').some((entry) => entry.externalId === externalId)) return { saved: false };

    this.store.insert('analytics', {
      platformId: 'twitch',
      date: new Date(session.startedAt).toISOString().slice(0, 10),
      title: session.title || 'Stream',
      externalId,
      metrics: {
        avgViewers: Math.round(average * 10) / 10,
        peakViewers: Math.max(...viewers),
        streamMinutes: minutes,
        hoursWatched: Math.round((average * minutes / 60) * 10) / 10,
      },
      source: 'twitch',
      note: t('Aus {count} Stichproben während des Streams{game}.', {
        count: session.samples.length,
        game: session.game ? ` · ${session.game}` : '',
      }),
    });

    return { saved: true, minutes, average: Math.round(average), peak: Math.max(...viewers) };
  }

  status() {
    const config = this.config();
    return {
      configured: this.isConfigured(),
      login: config.login || null,
      displayName: config.displayName || null,
      userId: config.userId || null,
      lastSync: config.lastSync || null,
      lastError: config.lastError || null,
      liveSession: this.session
        ? { title: this.session.title, samples: this.session.samples.length, startedAt: this.session.startedAt }
        : null,
      createClipIdeas: config.createClipIdeas !== false,
    };
  }

  disconnect() {
    this.token = null;
    this.session = null;
    const connections = { ...(this.store.settings().connections || {}) };
    delete connections.twitch;
    this.store.saveSettings({ connections });
  }
}

/** Wandelt Twitchs Dauerangabe "3h21m5s" in Sekunden. */
function parseDuration(value) {
  const match = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(String(value || '').trim());
  if (!match) return 0;
  return (Number(match[1] || 0) * 3600) + (Number(match[2] || 0) * 60) + Number(match[3] || 0);
}

module.exports = { TwitchConnector, parseDuration };
