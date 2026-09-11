'use strict';

/**
 * Hintergrund-Scheduler.
 *
 * Prueft im Minutentakt alle geplanten Beitraege und loest zwei Ereignisse aus:
 * eine Vorwarnung (Standard: 15 Minuten vorher) und die Faelligkeit selbst.
 * Faellige Beitraege wechseln in den Status "due" und werden als
 * Desktop-Benachrichtigung gemeldet; auf Wunsch landet der fertige Text direkt
 * in der Zwischenablage und die Upload-Seite oeffnet sich.
 *
 * Kanäle mit Anmeldung zum Veröffentlichen übernimmt der Publisher – dort
 * geht der Beitrag von selbst raus. Der Scheduler kümmert sich nur noch um die
 * Kanäle, bei denen die Plattform kein automatisches Posten zulässt.
 */

const { Notification, clipboard, shell } = require('electron');
const { t } = require('./i18n');

const TICK_MS = 30_000;
const MISSED_AFTER_MS = 6 * 60 * 60 * 1000;

class Scheduler {
  /**
   * @param {import('./store').Store} store
   * @param {() => Electron.BrowserWindow|null} getWindow
   */
  constructor(store, getWindow) {
    this.store = store;
    this.getWindow = getWindow;
    this.timer = null;
    this.publisher = null;
    this.platforms = new Map(
      require('../shared/platforms.json').map((platform) => [platform.id, platform])
    );
  }

  /** @param {import('./publish/publisher').Publisher} publisher */
  setPublisher(publisher) {
    this.publisher = publisher;
  }

  /** Kanäle, bei denen der Nutzer selbst posten muss. */
  manualTargets(post) {
    return this.publisher ? this.publisher.manualTargets(post) : (post.platforms || []);
  }

  automaticTargets(post) {
    return this.publisher ? this.publisher.automaticTargets(post) : [];
  }

  start() {
    if (this.timer) return;
    this.tick();
    this.timer = setInterval(() => this.tick(), TICK_MS);
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
  }

  /** Ein Durchlauf: Vorwarnungen, Faelligkeiten und verpasste Termine. */
  tick() {
    const settings = this.store.settings();
    const now = Date.now();
    const lead = (settings.leadTimeMinutes ?? 15) * 60_000;
    const changed = [];

    for (const post of this.store.list('posts')) {
      if (!post.scheduledAt) continue;
      const due = new Date(post.scheduledAt).getTime();
      if (Number.isNaN(due)) continue;

      // Geht komplett von selbst raus: nur vorwarnen, den Rest macht der Publisher.
      if (this.automaticTargets(post).length && !this.manualTargets(post).length) {
        if (post.status === 'scheduled' && due > now && due - now <= lead && !post.preNotifiedAt) {
          this.store.update('posts', post.id, { preNotifiedAt: new Date().toISOString() });
          this.notify(
            t('Geht gleich raus: {title}', { title: this.titleOf(post) }),
            t('In {minutes} Minuten automatisch auf {channels}.', {
              minutes: Math.max(1, Math.round((due - now) / 60000)),
              channels: this.platformNames(post),
            }),
            settings
          );
          changed.push(post.id);
        }
        continue;
      }

      if (post.status === 'scheduled') {
        if (due <= now) {
          this.store.update('posts', post.id, { status: 'due', dueNotifiedAt: new Date().toISOString() });
          this.onDue(post, settings);
          changed.push(post.id);
        } else if (due - now <= lead && !post.preNotifiedAt) {
          this.store.update('posts', post.id, { preNotifiedAt: new Date().toISOString() });
          this.notify(
            t('Gleich faellig: {title}', { title: this.titleOf(post) }),
            t('In {minutes} Minuten fuer {channels}.', {
              minutes: Math.max(1, Math.round((due - now) / 60000)),
              channels: this.platformNames(post),
            }),
            settings
          );
          changed.push(post.id);
        }
      } else if (post.status === 'due' && now - due > MISSED_AFTER_MS) {
        this.store.update('posts', post.id, { status: 'missed' });
        changed.push(post.id);
      }
    }

    if (changed.length) this.send('scheduler:changed', { ids: changed });
    return changed;
  }

  /** Faelliger Beitrag: benachrichtigen, vorbereiten, Fenster nach vorn holen. */
  onDue(post, settings) {
    // Nur für die Kanäle, die nicht ohnehin von selbst rausgehen.
    const manual = this.manualTargets(post);
    const automatic = this.automaticTargets(post);
    const platform = this.platforms.get(manual[0]);

    if (settings.copyToClipboardOnDue) {
      const text = this.renderForClipboard(post, manual[0]);
      if (text) clipboard.writeText(text);
    }
    if (settings.autoOpenUploadPage && platform?.uploadUrl) {
      shell.openExternal(platform.uploadUrl).catch(() => {});
    }

    const names = (ids) => ids.map((id) => this.platforms.get(id)?.name || id).join(', ');
    this.notify(
      t('Jetzt faellig: {title}', { title: this.titleOf(post) }),
      [
        automatic.length ? t('{channels} geht automatisch raus.', { channels: names(automatic) }) : null,
        manual.length
          ? t('Selbst posten: {channels}', { channels: names(manual) })
            + (settings.copyToClipboardOnDue ? t(' – Text liegt in der Zwischenablage.') : '')
          : null,
      ].filter(Boolean).join(' '),
      settings
    );

    this.store.insert('activity', {
      type: 'due',
      postId: post.id,
      title: this.titleOf(post),
      at: new Date().toISOString(),
    });

    const win = this.getWindow();
    if (win && !win.isDestroyed()) {
      win.show();
      win.flashFrame(true);
    }
  }

  /**
   * Baut den fertigen Veroeffentlichungstext fuer eine Plattform:
   * plattformspezifische Fassung, sonst der gemeinsame Text, plus Hashtags.
   */
  renderForClipboard(post, platformId) {
    const variant = post.perPlatform?.[platformId] || {};
    const parts = [];
    const title = variant.title ?? post.title;
    const body = variant.body ?? post.body;
    if (title && this.platforms.get(platformId)?.limits?.title) parts.push(title);
    if (body) parts.push(body);
    const tags = variant.hashtags?.length ? variant.hashtags : post.hashtags;
    if (tags?.length) parts.push(tags.map((tag) => (tag.startsWith('#') ? tag : `#${tag}`)).join(' '));
    return parts.filter(Boolean).join('\n\n');
  }

  titleOf(post) {
    return post.title?.trim() || post.body?.slice(0, 60).trim() || t('Beitrag ohne Titel');
  }

  platformNames(post) {
    const names = (post.platforms || []).map((id) => this.platforms.get(id)?.name || id);
    if (!names.length) return t('ohne Kanal');
    if (names.length <= 3) return names.join(', ');
    return t('{names} und {count} weitere', { names: names.slice(0, 3).join(', '), count: names.length - 3 });
  }

  notify(title, body, settings = this.store.settings()) {
    if (!settings.notifications || !Notification.isSupported()) return;
    const notification = new Notification({ title, body, silent: false });
    notification.on('click', () => {
      const win = this.getWindow();
      if (win && !win.isDestroyed()) {
        win.show();
        win.focus();
      }
    });
    notification.show();
  }

  send(channel, payload) {
    const win = this.getWindow();
    if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
  }

  /** Kompakter Ueberblick fuer Tray-Menue und Dashboard. */
  summary() {
    const now = Date.now();
    const posts = this.store.list('posts');
    const upcoming = posts
      .filter((post) => post.status === 'scheduled' && new Date(post.scheduledAt).getTime() > now)
      .sort((a, b) => new Date(a.scheduledAt) - new Date(b.scheduledAt));
    return {
      dueCount: posts.filter((post) => post.status === 'due').length,
      missedCount: posts.filter((post) => post.status === 'missed').length,
      scheduledCount: upcoming.length,
      next: upcoming[0]
        ? { id: upcoming[0].id, title: this.titleOf(upcoming[0]), at: upcoming[0].scheduledAt }
        : null,
    };
  }
}

module.exports = { Scheduler };
