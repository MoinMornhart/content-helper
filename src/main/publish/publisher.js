'use strict';

/**
 * Veröffentlichen wie bei Buffer: Video wählen, Zeit festlegen, fertig.
 *
 * Der Publisher schaut regelmäßig auf alle geplanten Beiträge und schickt sie
 * zur richtigen Zeit an jede Plattform, bei der eine Anmeldung besteht. Die
 * eigentliche Arbeit – Hochladen, Beschreibung setzen, Freischalten – erledigt
 * je Plattform ein „Anbieter“ (siehe providers/). Hier liegt alles, was für alle
 * gleich ist:
 *
 * - Zeitpunkt. Wo die Plattform selbst planen kann (YouTube), wird sofort
 *   hochgeladen und die Plattform schaltet zum Termin frei – dann darf der PC
 *   zum Termin sogar aus sein. Sonst geht der Beitrag genau zum Termin raus.
 * - Wiederholen. Bricht das Netz weg, wird es später erneut versucht, mit
 *   wachsendem Abstand. Anbieter können Upload-Sitzungen speichern, sodass ein
 *   abgebrochener Upload an derselben Stelle weiterläuft – auch nach Neustart.
 * - Nie doppelt. Jede Plattform eines Beitrags hat ihren eigenen Zustand im
 *   Beitrag selbst. Was einmal „veröffentlicht“ ist, fasst niemand mehr an. Und
 *   sind mehrere PCs verbunden, veröffentlicht nur einer.
 */

const fs = require('fs');
const path = require('path');

const TICK_MS = 15_000;
/** Wartezeiten zwischen Versuchen: 1, 5, 15, 30, 60 Minuten – dann aufgeben. */
const RETRY_DELAYS_MS = [60_000, 5 * 60_000, 15 * 60_000, 30 * 60_000, 60 * 60_000];
/** Nach so langer Verspätung wird ein Beitrag nicht mehr stillschweigend nachgeholt. */
const LATE_LIMIT_MS = 24 * 3600_000;

const VIDEO_EXT = ['mp4', 'mov', 'm4v', 'webm', 'mkv', 'avi'];
const IMAGE_EXT = ['jpg', 'jpeg', 'png', 'webp'];

/** Zustände je Plattform eines Beitrags. */
const STATES = {
  waiting: 'wartet',
  uploading: 'wird hochgeladen',
  processing: 'wird verarbeitet',
  scheduled: 'hochgeladen, geht zum Termin live',
  published: 'veröffentlicht',
  retry: 'neuer Versuch folgt',
  failed: 'fehlgeschlagen',
  cancelled: 'zurückgezogen',
};

/** Fehler, bei dem ein erneuter Versuch nichts ändert (Datei fehlt, Anmeldung entzogen …). */
class PermanentError extends Error {
  constructor(message) {
    super(message);
    this.permanent = true;
  }
}

class Publisher {
  /**
   * @param {import('../store').Store} store
   * @param {() => Electron.BrowserWindow|null} getWindow
   * @param {{isPrimary?: () => boolean, notify?: (title: string, body: string) => void, now?: () => number}} options
   */
  constructor(store, getWindow = () => null, options = {}) {
    this.store = store;
    this.getWindow = getWindow;
    this.isPrimary = options.isPrimary || (() => true);
    this.notify = options.notify || (() => {});
    this.now = options.now || (() => Date.now());
    this.providers = [];
    this.timer = null;
    this.running = false;
    this.current = null;
  }

  // ---------------------------------------------------------------- Anbieter

  register(provider) {
    this.providers.push(provider);
    return this;
  }

  /** Der Anbieter, der diese Plattform bedient – egal ob angemeldet. */
  providerOf(platformId) {
    return this.providers.find((provider) => provider.platformIds.includes(platformId)) || null;
  }

  /** Nur, wenn auch eine Anmeldung besteht. */
  connectedProvider(platformId) {
    const provider = this.providerOf(platformId);
    return provider && provider.isConnected(platformId) ? provider : null;
  }

  /** Plattformen dieses Beitrags, die von selbst veröffentlicht werden. */
  automaticTargets(post) {
    return (post.platforms || []).filter((id) => this.connectedProvider(id));
  }

  /** Plattformen, bei denen die App nur erinnern kann. */
  manualTargets(post) {
    return (post.platforms || []).filter((id) => !this.connectedProvider(id));
  }

  // ---------------------------------------------------------------- Takt

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick().catch(() => {}), TICK_MS);
    setTimeout(() => this.tick().catch(() => {}), 5_000);
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
  }

  /**
   * Ein Durchlauf. Arbeitet die fälligen Aufgaben nacheinander ab – mehrere
   * Uploads gleichzeitig teilen sich nur die Leitung und dauern alle länger.
   */
  async tick() {
    if (this.running || !this.isPrimary()) return [];
    this.running = true;
    const done = [];
    try {
      for (const post of this.store.list('posts').slice()) {
        this.maintain(post);
      }
      for (const job of this.dueJobs()) {
        done.push(await this.run(job));
      }
      return done;
    } finally {
      this.running = false;
    }
  }

  /**
   * Pflege ohne Upload: Termin verschoben oder zurückgenommen, obwohl die
   * Plattform schon eingeplant hat? Dann dort nachziehen. Termin erreicht, den
   * die Plattform selbst freischaltet? Dann als veröffentlicht vermerken.
   */
  maintain(post) {
    for (const [platformId, delivery] of Object.entries(post.delivery || {})) {
      if (delivery.state !== 'scheduled') continue;
      const provider = this.connectedProvider(platformId);
      const stillPlanned = ['scheduled', 'publishing', 'due'].includes(post.status) && post.scheduledAt;

      if (!stillPlanned || !(post.platforms || []).includes(platformId)) {
        if (provider?.cancel) {
          provider.cancel({ remoteId: delivery.remoteId, platformId })
            .then(() => this.setDelivery(post.id, platformId, { state: 'cancelled', message: 'Termin zurückgenommen – bei der Plattform wieder auf privat gestellt.' }))
            .catch((error) => this.setDelivery(post.id, platformId, { message: `Zurückziehen fehlgeschlagen: ${error.message}` }));
        }
        continue;
      }

      if (delivery.scheduledFor !== post.scheduledAt && provider?.reschedule) {
        const when = post.scheduledAt;
        this.setDelivery(post.id, platformId, { scheduledFor: when });
        provider.reschedule({ remoteId: delivery.remoteId, platformId, scheduledFor: when })
          .catch((error) => this.setDelivery(post.id, platformId, { message: `Neuer Termin konnte nicht übertragen werden: ${error.message}` }));
        continue;
      }

      // Plattform kann den Termin nicht nachträglich ändern: dort zurückziehen
      // und zum neuen Termin frisch hochladen.
      if (delivery.scheduledFor !== post.scheduledAt && provider?.cancel) {
        this.setDelivery(post.id, platformId, { state: 'processing', message: 'Termin geändert – wird neu eingeplant.' });
        provider.cancel({ remoteId: delivery.remoteId, platformId })
          .then(() => this.setDelivery(post.id, platformId, { state: 'waiting', remoteId: null, scheduledFor: null, attempts: 0, message: null }))
          .catch((error) => this.setDelivery(post.id, platformId, { state: 'scheduled', message: `Neuer Termin konnte nicht übertragen werden: ${error.message}` }));
        continue;
      }

      if (Date.parse(post.scheduledAt) <= this.now()) {
        this.setDelivery(post.id, platformId, { state: 'published', finishedAt: new Date(this.now()).toISOString() });
        this.settle(post.id);
      }
    }
  }

  /** Alle Aufgaben, die jetzt drankommen. */
  dueJobs() {
    const now = this.now();
    const jobs = [];

    for (const post of this.store.list('posts')) {
      if (!['scheduled', 'publishing', 'due'].includes(post.status) || !post.scheduledAt) continue;
      const at = Date.parse(post.scheduledAt);
      if (Number.isNaN(at)) continue;

      for (const platformId of this.automaticTargets(post)) {
        const provider = this.connectedProvider(platformId);
        const delivery = post.delivery?.[platformId] || { state: 'waiting' };

        if (!['waiting', 'retry', 'cancelled'].includes(delivery.state)) {
          // Hängengeblieben (App mitten im Upload beendet): erneut aufnehmen.
          if (!['uploading', 'processing'].includes(delivery.state) || this.current) continue;
        }
        if (delivery.state === 'retry' && delivery.nextTryAt && Date.parse(delivery.nextTryAt) > now) continue;
        if (delivery.state === 'cancelled' && delivery.scheduledFor === post.scheduledAt) continue;

        // Selbst planende Plattformen haben ein Fenster: nicht zu knapp, nicht zu weit voraus.
        const early = Boolean(provider.nativeSchedule)
          && at - now >= (provider.minLeadMs || 0)
          && at - now <= (provider.maxLeadMs || Infinity);
        if (at > now && !early) continue;
        if (now - at > LATE_LIMIT_MS && delivery.state === 'waiting') {
          this.setDelivery(post.id, platformId, {
            state: 'failed',
            message: 'Der Termin ist über einen Tag her – der PC war zu der Zeit wohl aus. Neu einplanen, dann geht es raus.',
          });
          continue;
        }

        jobs.push({ postId: post.id, platformId, native: early });
      }
    }

    return jobs.sort((a, b) => Number(a.native) - Number(b.native));
  }

  // ---------------------------------------------------------------- Ausführen

  /** Führt eine Aufgabe aus und hält den Zustand im Beitrag fest. */
  async run({ postId, platformId, native }) {
    const post = this.store.get('posts', postId);
    const provider = this.connectedProvider(platformId);
    if (!post || !provider) return { postId, platformId, skipped: true };

    const previous = post.delivery?.[platformId] || {};
    const attempts = (previous.attempts || 0) + 1;
    this.current = { postId, platformId };

    if (!native && post.status === 'scheduled') this.store.update('posts', postId, { status: 'publishing' });
    this.setDelivery(postId, platformId, {
      state: 'uploading',
      progress: 0,
      attempts,
      startedAt: new Date(this.now()).toISOString(),
      message: null,
    });

    try {
      const content = this.contentFor(post, platformId);
      const problems = provider.check ? provider.check(content) : [];
      if (problems.length) throw new PermanentError(problems.join(' '));

      let lastShare = -1;
      const result = await provider.publish({
        ...content,
        scheduledFor: native ? post.scheduledAt : null,
        session: previous.session || null,
        saveSession: (session) => this.setDelivery(postId, platformId, { session }),
        onProgress: (fraction, state = 'uploading') => {
          const share = Math.floor(fraction * 100);
          this.send('publish:progress', { postId, platformId, progress: fraction, state });
          // Den Speicher nur in groben Schritten anfassen.
          if (share >= lastShare + 5 || state !== 'uploading') {
            lastShare = share;
            this.setDelivery(postId, platformId, { progress: fraction, state });
          }
        },
      });

      const scheduled = result.state === 'scheduled';
      this.setDelivery(postId, platformId, {
        state: scheduled ? 'scheduled' : 'published',
        progress: 1,
        remoteId: result.remoteId || null,
        url: result.url || null,
        scheduledFor: scheduled ? post.scheduledAt : null,
        finishedAt: new Date(this.now()).toISOString(),
        session: null,
        message: result.message || null,
      });
      this.store.insert('activity', {
        type: scheduled ? 'uploaded' : 'published',
        postId,
        platformId,
        title: post.title || 'Beitrag',
        url: result.url || null,
        at: new Date(this.now()).toISOString(),
      });
      if (!scheduled) {
        this.notify(`Veröffentlicht: ${post.title || 'Beitrag'}`, `Auf ${provider.nameFor ? provider.nameFor(platformId) : provider.name} ist er jetzt online.`);
      }
      this.settle(postId);
      return { postId, platformId, ok: true, state: scheduled ? 'scheduled' : 'published' };
    } catch (error) {
      // Nennt die Plattform selbst einen Zeitpunkt (Tageskontingent, Ratenlimit),
      // wird bis dahin gewartet – das zählt nicht als gescheiterter Versuch.
      const waitUntil = error.retryAt ? Date.parse(error.retryAt) : null;
      const permanent = error.permanent || (!waitUntil && attempts > RETRY_DELAYS_MS.length);
      const delay = waitUntil
        ? Math.max(60_000, waitUntil - this.now())
        : RETRY_DELAYS_MS[Math.min(attempts - 1, RETRY_DELAYS_MS.length - 1)];
      if (waitUntil) this.setDelivery(postId, platformId, { attempts: Math.max(0, attempts - 1) });
      this.setDelivery(postId, platformId, permanent
        ? { state: 'failed', message: error.message, session: error.keepSession ? undefined : null }
        : { state: 'retry', message: error.message, nextTryAt: new Date(this.now() + delay).toISOString() });

      if (permanent) {
        this.notify(`Nicht veröffentlicht: ${post.title || 'Beitrag'}`, error.message);
        this.settle(postId);
      }
      return { postId, platformId, ok: false, permanent, error: error.message };
    } finally {
      this.current = null;
    }
  }

  /**
   * Stellt zusammen, was die Plattform bekommt: Datei, Titel, Text.
   * Plattform-Fassungen aus dem Composer haben Vorrang vor dem gemeinsamen Text.
   */
  contentFor(post, platformId) {
    const variant = post.perPlatform?.[platformId] || {};
    const media = (post.mediaIds || []).map((id) => this.store.get('media', id)).filter(Boolean);
    const extOf = (entry) => (entry.ext || path.extname(entry.filePath || '').slice(1)).toLowerCase();

    const video = media.find((entry) => VIDEO_EXT.includes(extOf(entry))) || null;
    const thumbnailEntry = (post.thumbnailId && this.store.get('media', post.thumbnailId))
      || media.find((entry) => IMAGE_EXT.includes(extOf(entry)))
      || null;

    if (video && !fs.existsSync(video.filePath)) {
      throw new PermanentError(`Die Videodatei ist nicht mehr da: ${video.filePath}`);
    }

    const tags = (variant.hashtags?.length ? variant.hashtags : post.hashtags) || [];
    const hashtagLine = tags.map((tag) => (tag.startsWith('#') ? tag : `#${tag}`)).join(' ');
    const body = variant.body ?? post.body ?? '';

    return {
      post,
      platformId,
      title: (variant.title ?? post.title ?? '').trim(),
      body,
      hashtags: tags.map((tag) => tag.replace(/^#/, '')),
      text: [body, hashtagLine].filter(Boolean).join('\n\n'),
      video: video ? { path: video.filePath, name: video.name, size: fs.statSync(video.filePath).size, ext: extOf(video) } : null,
      thumbnail: thumbnailEntry && fs.existsSync(thumbnailEntry.filePath) ? { path: thumbnailEntry.filePath, ext: extOf(thumbnailEntry) } : null,
      options: post.publishOptions?.[platformId] || {},
    };
  }

  /**
   * Gesamtzustand des Beitrags nachführen: Sind alle automatischen Ziele durch
   * und gibt es keine Plattform, bei der der Nutzer selbst ran muss, ist der
   * Beitrag veröffentlicht.
   */
  settle(postId) {
    const post = this.store.get('posts', postId);
    if (!post) return;
    const automatic = this.automaticTargets(post);
    const deliveries = automatic.map((id) => post.delivery?.[id]?.state);
    const manual = this.manualTargets(post);

    if (deliveries.some((state) => state === 'failed')) {
      if (post.status !== 'failed') this.store.update('posts', postId, { status: 'failed' });
      return;
    }
    if (!manual.length && automatic.length && deliveries.every((state) => state === 'published')) {
      if (post.status !== 'published') {
        this.store.update('posts', postId, { status: 'published', publishedAt: new Date(this.now()).toISOString() });
      }
      this.send('scheduler:changed', { ids: [postId] });
    }
  }

  // ---------------------------------------------------------------- Bedienung

  /** „Jetzt veröffentlichen“ oder nach einem Fehler erneut versuchen. */
  retry(postId, platformId = null) {
    const post = this.store.get('posts', postId);
    if (!post) throw new Error('Diesen Beitrag gibt es nicht mehr.');
    for (const id of platformId ? [platformId] : this.automaticTargets(post)) {
      const state = post.delivery?.[id]?.state;
      if (['published', 'scheduled', 'uploading'].includes(state)) continue;
      this.setDelivery(postId, id, { state: 'waiting', attempts: 0, nextTryAt: null, message: null });
    }
    if (['failed', 'missed', 'due'].includes(post.status)) this.store.update('posts', postId, { status: 'scheduled' });
    setTimeout(() => this.tick().catch(() => {}), 200);
    return this.store.get('posts', postId);
  }

  /** Beitrag sofort veröffentlichen, ohne auf einen Termin zu warten. */
  publishNow(postId) {
    const post = this.store.get('posts', postId);
    if (!post) throw new Error('Diesen Beitrag gibt es nicht mehr.');
    if (!this.automaticTargets(post).length) throw new Error('Für keinen der gewählten Kanäle besteht eine Anmeldung zum Veröffentlichen.');
    this.store.update('posts', postId, { scheduledAt: new Date(this.now()).toISOString(), status: 'scheduled', preNotifiedAt: null });
    return this.retry(postId);
  }

  setDelivery(postId, platformId, patch) {
    const post = this.store.get('posts', postId);
    if (!post) return null;
    const clean = Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined));
    const delivery = { ...(post.delivery || {}) };
    delivery[platformId] = { ...(delivery[platformId] || { state: 'waiting' }), ...clean };
    const updated = this.store.update('posts', postId, { delivery });
    this.send('publish:changed', { postId, platformId, delivery: delivery[platformId] });
    return updated;
  }

  send(channel, payload) {
    const win = this.getWindow();
    if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
  }

  /** Überblick für die Oberfläche: welche Plattformen können von selbst posten? */
  status() {
    return {
      primary: this.isPrimary(),
      busy: this.current,
      providers: this.providers.map((provider) => ({
        id: provider.id,
        name: provider.name,
        platformIds: provider.platformIds,
        connected: provider.isConnected(),
        nativeSchedule: Boolean(provider.nativeSchedule),
        ...(provider.status ? provider.status() : {}),
      })),
    };
  }
}

module.exports = { Publisher, PermanentError, STATES, VIDEO_EXT, IMAGE_EXT, RETRY_DELAYS_MS };
