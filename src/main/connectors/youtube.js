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
   * ein @-Handle, einen blossen Namen oder irgendeine Adresse des Kanals.
   *
   * Ein blosser Name kann drei verschiedene Adressen bedeuten – das heutige
   * @Handle, die ältere /c/-Form und die noch ältere /user/-Form. Es wird der
   * Reihe nach probiert, statt den Nutzer raten zu lassen, welche Schreibweise
   * seine ist.
   */
  async resolve(input) {
    const value = String(input || '').trim();
    if (!value) throw new Error('Bitte Kanalname, @Handle, Adresse oder Kanal-Kennung angeben.');

    // Eine vollständige Kanal-Kennung braucht keine Suche.
    const direct = /(UC[\w-]{22})/.exec(value);
    if (direct) return this.verifyChannelId(direct[1]);

    const name = value.replace(/^@/, '').trim();
    const candidates = /^https?:\/\//i.test(value)
      ? [value]
      : [
          `https://www.youtube.com/@${encodeURIComponent(name)}`,
          `https://www.youtube.com/c/${encodeURIComponent(name)}`,
          `https://www.youtube.com/user/${encodeURIComponent(name)}`,
        ];

    let lastError = null;
    for (const url of candidates) {
      let page;
      try {
        page = await http.text(url);
      } catch (error) {
        lastError = error;
        continue;
      }
      const channelId = extractChannelId(page);
      if (channelId) return this.verifyChannelId(channelId, { name: channelTitle(page) });
      lastError = new Error('Auf dieser Seite war keine Kanal-Kennung zu finden.');
    }

    throw new Error(
      /Status 404/.test(lastError?.message || '')
        ? `Unter „${name}“ war kein Kanal zu finden. Versuche es mit dem @Handle aus der Adresszeile deines Kanals oder mit der vollständigen Adresse.`
        : `Die Kanalseite war nicht erreichbar: ${lastError?.message || 'unbekannter Fehler'}`
    );
  }

  /**
   * Merkt sich den Kanal und holt zur Bestätigung den Feed.
   *
   * Wichtig: Ist die Kennung einmal gefunden, existiert der Kanal auch. Wenn
   * der Feed dann nicht antwortet, liegt das an YouTube – etwa weil von dieser
   * Leitung kurz zuvor viele Abfragen kamen und vorübergehend mit 404 geantwortet
   * wird. Das darf nicht als „Kanal gibt es nicht“ ausgegeben werden, und die
   * Verbindung darf daran auch nicht scheitern: Der Abgleich versucht es später
   * ohnehin erneut.
   */
  async verifyChannelId(channelId, { name = null } = {}) {
    let xml = null;
    let warning = null;

    try {
      xml = await this.fetchFeed(channelId);
    } catch (error) {
      warning = `Der Kanal wurde gefunden, aber YouTube gibt den Feed gerade nicht heraus (${error.message}). Die Verbindung steht trotzdem – der nächste Abgleich holt die Videos nach.`;
    }

    const title = (xml && tagText(xml, 'title')) || name || channelId;
    this.saveConfig({ channelId, name: title, verifiedAt: new Date().toISOString(), lastError: warning });

    return {
      channelId,
      name: title,
      videos: xml ? parseFeed(xml).length : 0,
      warning,
    };
  }

  /**
   * Holt den Feed und versucht es bei Ablehnung noch zweimal.
   *
   * YouTube antwortet bei zu vielen Abfragen von derselben Leitung mit 404
   * statt mit einer Sperrmeldung. Ein kurzes Warten reicht meist.
   */
  async fetchFeed(channelId, attempts = 3) {
    let lastError = null;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        return await http.text(`${FEED}${channelId}`);
      } catch (error) {
        lastError = error;
        if (!/Status 404|Status 429|Zeit/i.test(error.message)) break;
        if (attempt < attempts) await wait(attempt * 2500);
      }
    }
    throw lastError;
  }

  // ---------------------------------------------------------------- Abfragen

  /**
   * Die neuesten Videos des Kanals.
   *
   * Erste Wahl ist der Feed: er ist knapp, stabil aufgebaut und enthält genaue
   * Zeitpunkte. Gibt YouTube ihn nicht heraus – das kommt vor, wenn von einer
   * Leitung viele Abfragen kamen –, wird die Kanalseite selbst gelesen. Die
   * liefert dieselben Videos, allerdings mit gerundeten Aufrufen und nur
   * ungefährem Datum („vor drei Tagen“). Besser ungefähr als gar nicht.
   */
  async recentVideos() {
    const { channelId } = this.config();
    if (!channelId) throw new Error('Es ist kein YouTube-Kanal verbunden.');

    try {
      return parseFeed(await this.fetchFeed(channelId));
    } catch (feedError) {
      const videos = await this.videosFromChannelPage(channelId).catch(() => []);
      if (videos.length) {
        this.saveConfig({ lastSource: 'seite' });
        return videos;
      }
      throw new Error(
        /Status 404/.test(feedError.message)
          ? 'YouTube gibt gerade weder den Feed noch die Kanalseite heraus. Das passiert bei vielen Abfragen kurz hintereinander und legt sich nach einigen Minuten von selbst.'
          : feedError.message
      );
    }
  }

  /** Rückfallebene: die Videoliste direkt von der Kanalseite lesen. */
  async videosFromChannelPage(channelId) {
    const html = await http.text(`https://www.youtube.com/channel/${channelId}/videos`);
    return parseChannelVideos(html);
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

/**
 * Kanalname aus dem Quelltext der Kanalseite – als Rückfalloption, wenn der
 * Feed gerade nicht antwortet.
 */
function channelTitle(page) {
  const match =
    /<meta\s+property="og:title"\s+content="([^"]+)"/.exec(page) ||
    /<title>([^<]+)<\/title>/.exec(page);
  if (!match) return null;
  return decode(match[1]).replace(/\s*-\s*YouTube\s*$/i, '').trim() || null;
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ------------------------------------------------------------------ Kanalseite lesen

/**
 * Wandelt „1,2 Mio. Aufrufe“, „123.456 Aufrufe“ oder „1,234,567 views“ in eine Zahl.
 *
 * Punkt und Komma bedeuten je nach Sprache Gegensätzliches: „123.456“ sind im
 * Deutschen hundertdreiundzwanzigtausend, im Englischen hundertdreiundzwanzig
 * Komma vier. Entscheidend ist deshalb nicht die Sprache, sondern ob eine
 * Größenangabe dabeisteht: Nur mit „Mio.“, „Tsd.“, „K“ oder „M“ ist das Zeichen
 * ein Dezimaltrenner. Ohne Größenangabe trennt es immer Tausender – YouTube
 * zeigt Aufrufe nie mit Nachkommastelle an.
 */
function parseViewCount(text) {
  const match = /([\d.,]+)\s*(Tsd\.?|Mio\.?|Mrd\.?|K|M|B)?\s*(Aufrufe|views|Mal angesehen)/i.exec(text || '');
  if (!match) return null;

  const raw = match[1];
  const unit = (match[2] || '').toLowerCase().replace('.', '');
  const factor = { tsd: 1e3, k: 1e3, mio: 1e6, m: 1e6, mrd: 1e9, b: 1e9 }[unit] || 1;

  let normalized;
  if (factor === 1) {
    normalized = raw.replace(/[.,]/g, '');          // reine Tausendertrenner
  } else {
    normalized = raw.replace(/[.,]/, '.').replace(/[.,](?=.*[.,])/g, '');
    // Bei „1.234,5 Mio.“ bleibt nach dem Ersetzen genau ein Trenner stehen.
    const parts = raw.split(/[.,]/);
    if (parts.length > 2) normalized = `${parts.slice(0, -1).join('')}.${parts.at(-1)}`;
  }

  const value = Number(normalized);
  if (!Number.isFinite(value)) return null;
  return Math.round(value * factor);
}

/** Wandelt „vor 3 Tagen“ oder „3 days ago“ in einen ungefähren Zeitpunkt. */
function parseRelativeDate(text, now = Date.now()) {
  const match = /(?:vor\s+)?(\d+)\s*(Sekunde|Minute|Stunde|Tag|Woche|Monat|Jahr|second|minute|hour|day|week|month|year)/i.exec(text || '');
  if (!match) return null;

  const amount = Number(match[1]);
  const unit = match[2].toLowerCase();
  const ms = {
    sekunde: 1000, second: 1000,
    minute: 60_000,
    stunde: 3_600_000, hour: 3_600_000,
    tag: 86_400_000, day: 86_400_000,
    woche: 604_800_000, week: 604_800_000,
    monat: 2_592_000_000, month: 2_592_000_000,
    jahr: 31_536_000_000, year: 31_536_000_000,
  }[unit];
  if (!ms) return null;
  return new Date(now - amount * ms).toISOString();
}

/**
 * Liest die Videoliste aus dem Quelltext einer Kanalseite.
 *
 * YouTube legt jedes Video als eigenen Block ab. Ausgewertet wird immer nur
 * innerhalb eines Blocks, damit Beschriftungen der Bedienoberfläche – die im
 * selben Quelltext stehen – nicht versehentlich als Videotitel gelesen werden.
 */
const BLOCK_KEY = '"lockupViewModel":{';

function parseChannelVideos(html) {
  const blocks = String(html).split(BLOCK_KEY).slice(1);
  const videos = [];
  const seen = new Set();

  for (const block of blocks) {
    const window = block.slice(0, 40000);
    const id = (/"contentId":"([\w-]{11})"/.exec(window) || [])[1];
    if (!id || seen.has(id)) continue;

    const rawTitle = (/"title":\{"content":"((?:[^"\\]|\\.)*)"/.exec(window) || [])[1];
    if (!rawTitle) continue;
    seen.add(id);

    // Aufrufe und Alter stehen als kurze Textstuecke im selben Block.
    const parts = [...window.matchAll(/"content":"([^"\\]{2,60})"/g)].map((match) => match[1]);
    const views = parts.map(parseViewCount).find((value) => value !== null) ?? null;
    const published = parts.map((part) => parseRelativeDate(part)).find(Boolean) || new Date().toISOString();

    videos.push({
      id,
      title: decode(rawTitle.replace(/\\u0026/g, '&').replace(/\\"/g, '"')),
      description: '',
      published,
      url: `https://www.youtube.com/watch?v=${id}`,
      views,
      likes: null,
      approximate: true,
    });
  }

  return videos;
}

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

module.exports = {
  YouTubeConnector, parseFeed, decode, extractChannelId, channelTitle,
  parseChannelVideos, parseViewCount, parseRelativeDate,
};
