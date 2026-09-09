'use strict';

/**
 * YouTube-Verbindung – ganz ohne Zugangsschlüssel.
 *
 * YouTube veröffentlicht für jeden Kanal einen offenen Feed mit den neuesten
 * Videos. Darin stehen Titel, Beschreibung, Veröffentlichungszeitpunkt und
 * sogar Aufrufe und Bewertungen. Das reicht, um den Verlauf automatisch zu
 * führen, ohne dass eine Anwendung registriert oder ein Konto verbunden werden
 * muss.
 *
 * Was der Feed nicht enthält: Klickrate, Wiedergabedauer und Wiedergabezeit.
 * Diese Werte gibt YouTube nur dem Kanalinhaber im Studio – dafür bleibt der
 * CSV-Import der richtige Weg.
 */

const http = require('./http');
const { upsertAnalytics, upsertPublishedPost, linkAnalyticsToPost } = require('./shared');

const FEED = 'https://www.youtube.com/feeds/videos.xml?channel_id=';

class YouTubeConnector {
  constructor(store) {
    this.store = store;
  }

  config() {
    return this.store.settings().connections?.youtube || {};
  }

  saveConfig(patch) {
    const connections = { ...(this.store.settings().connections || {}) };
    connections.youtube = { ...(connections.youtube || {}), ...patch };
    this.store.saveSettings({ connections });
    return connections.youtube;
  }

  isConfigured() {
    return Boolean(this.config().channelId);
  }

  // ---------------------------------------------------------------- Kanal finden

  /**
   * Nimmt entgegen, was Nutzer üblicherweise zur Hand haben: eine Kanal-Kennung,
   * ein @-Handle oder irgendeine Adresse des Kanals.
   */
  async resolve(input) {
    const value = String(input || '').trim();
    if (!value) throw new Error('Bitte Kanal-Adresse, @Handle oder Kanal-Kennung angeben.');

    // Direkte Kanal-Kennung
    const direct = /(UC[\w-]{22})/.exec(value);
    if (direct) return this.verifyChannelId(direct[1]);

    // Aus einer Adresse oder einem Handle die Kanalseite ableiten
    let url;
    if (/^https?:\/\//i.test(value)) {
      url = value;
    } else if (value.startsWith('@')) {
      url = `https://www.youtube.com/${value}`;
    } else {
      url = `https://www.youtube.com/@${value.replace(/^@/, '')}`;
    }

    const page = await http.text(url).catch(() => {
      throw new Error('Die Kanalseite war nicht erreichbar. Stimmt der Name?');
    });

    const channelId = extractChannelId(page);
    if (!channelId) throw new Error('Auf dieser Seite war keine Kanal-Kennung zu finden.');
    return this.verifyChannelId(channelId);
  }

  /** Prüft, ob der Feed zu dieser Kennung existiert, und merkt sich den Kanal. */
  async verifyChannelId(channelId) {
    const xml = await http.text(`${FEED}${channelId}`).catch(() => {
      throw new Error('Zu dieser Kanal-Kennung gibt es keinen Feed.');
    });

    const name = tagText(xml, 'title') || channelId;
    this.saveConfig({ channelId, name, verifiedAt: new Date().toISOString() });
    return { channelId, name, videos: parseFeed(xml).length };
  }

  // ---------------------------------------------------------------- Abfragen

  /** Die neuesten Videos des Kanals, wie sie im Feed stehen. */
  async recentVideos() {
    const { channelId } = this.config();
    if (!channelId) throw new Error('Es ist kein YouTube-Kanal verbunden.');
    const xml = await http.text(`${FEED}${channelId}`);
    return parseFeed(xml);
  }

  // ---------------------------------------------------------------- Abgleich

  /**
   * Holt die neuesten Videos und schreibt daraus Messwerte und – auf Wunsch –
   * veröffentlichte Beiträge, damit Kalender und Coach den echten Rhythmus
   * kennen.
   */
  async sync() {
    const result = { added: 0, updated: 0, posts: 0, newest: null };
    const videos = await this.recentVideos();
    const createPosts = this.config().createPosts !== false;

    for (const video of videos) {
      const externalId = `youtube:video:${video.id}`;
      const metrics = {};
      if (video.views !== null) metrics.views = video.views;
      if (video.likes !== null) metrics.likes = video.likes;

      const outcome = upsertAnalytics(this.store, {
        externalId,
        platformId: 'youtube',
        date: video.published.slice(0, 10),
        title: video.title,
        url: video.url,
        metrics,
        source: 'youtube',
      });
      result[outcome === 'added' ? 'added' : 'updated'] += 1;

      if (createPosts) {
        const postId = upsertPublishedPost(this.store, {
          externalId,
          title: video.title,
          body: video.description || '',
          platforms: ['youtube'],
          publishedAt: video.published,
          url: video.url,
        });
        if (postId) {
          linkAnalyticsToPost(this.store, externalId, postId);
          result.posts += 1;
        }
      }
    }

    result.newest = videos[0] || null;
    this.saveConfig({ lastSync: new Date().toISOString(), lastError: null });
    return result;
  }

  status() {
    const config = this.config();
    return {
      configured: this.isConfigured(),
      channelId: config.channelId || null,
      name: config.name || null,
      lastSync: config.lastSync || null,
      lastError: config.lastError || null,
      createPosts: config.createPosts !== false,
    };
  }

  disconnect() {
    const connections = { ...(this.store.settings().connections || {}) };
    delete connections.youtube;
    this.store.saveSettings({ connections });
  }
}

// ------------------------------------------------------------------ Kanal-Kennung

/**
 * Liest die Kanal-Kennung aus dem Quelltext einer Kanalseite.
 *
 * Die Reihenfolge ist wichtig: Auf einer Kanalseite stehen auch die Kennungen
 * empfohlener und verlinkter Kanäle. Das erste Vorkommen von "channelId" gehört
 * deshalb oft einem fremden Kanal. Verlässlich sind nur die Felder, die die
 * Seite über sich selbst aussagt – allen voran die kanonische Adresse.
 *
 * Lieber gar keine Kennung als eine falsche: wird keines dieser Felder
 * gefunden, liefert die Funktion null, statt zu raten.
 */
function extractChannelId(page) {
  const patterns = [
    /<link\s+rel="canonical"\s+href="https:\/\/www\.youtube\.com\/channel\/(UC[\w-]{22})"/,
    /<meta\s+property="og:url"\s+content="https:\/\/www\.youtube\.com\/channel\/(UC[\w-]{22})"/,
    /<meta\s+itemprop="identifier"\s+content="(UC[\w-]{22})"/,
    /"externalId":"(UC[\w-]{22})"/,
    /"browseId":"(UC[\w-]{22})"/,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(page);
    if (match) return match[1];
  }
  return null;
}

// ------------------------------------------------------------------ Feed lesen

/** Inhalt des ersten Vorkommens eines Elements. */
function tagText(xml, tag) {
  const match = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`).exec(xml);
  return match ? decode(match[1].trim()) : null;
}

/** Wandelt die üblichen Ersatzdarstellungen zurück in Zeichen. */
function decode(value) {
  return String(value)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&amp;/g, '&');
}

/**
 * Zerlegt den Kanal-Feed.
 * Bewusst mit Mustern statt mit einem XML-Programmpaket: der Feed hat ein
 * festes, einfaches Format, und das Projekt bleibt ohne Abhängigkeiten.
 *
 * @returns {Array<{id, title, description, published, url, views, likes}>}
 */
function parseFeed(xml) {
  const entries = String(xml).match(/<entry>[\s\S]*?<\/entry>/g) || [];

  return entries.map((entry) => {
    const id = (/<yt:videoId>(.*?)<\/yt:videoId>/.exec(entry) || [])[1] || null;
    const statistics = /<media:statistics[^>]*views="(\d+)"/.exec(entry);
    const rating = /<media:starRating[^>]*count="(\d+)"/.exec(entry);

    return {
      id,
      title: tagText(entry, 'title') || 'Ohne Titel',
      description: tagText(entry, 'media:description') || '',
      published: (/<published>(.*?)<\/published>/.exec(entry) || [])[1] || new Date().toISOString(),
      url: id ? `https://www.youtube.com/watch?v=${id}` : null,
      views: statistics ? Number(statistics[1]) : null,
      likes: rating ? Number(rating[1]) : null,
    };
  }).filter((video) => video.id);
}

module.exports = { YouTubeConnector, parseFeed, decode, extractChannelId };
