'use strict';

/**
 * Baut den Publisher mit allen Plattform-Anbindungen zusammen.
 */

const { Publisher } = require('./publisher');
const { YouTubePublisher } = require('./providers/youtube');
const { TikTokPublisher } = require('./providers/tiktok');
const { MetaAuth, InstagramPublisher, FacebookPublisher } = require('./providers/meta');
const { LinkedInPublisher } = require('./providers/linkedin');
const { XPublisher } = require('./providers/x');

/**
 * @param {import('../store').Store} store
 * @param {{getWindow?: Function, isPrimary?: Function, notify?: Function, http?: object, sleep?: Function, openExternal?: Function}} deps
 */
function createPublisher(store, deps = {}) {
  const publisher = new Publisher(store, deps.getWindow, deps);
  const meta = new MetaAuth(store, deps);

  const providers = {
    youtube: new YouTubePublisher(store, deps),
    tiktok: new TikTokPublisher(store, deps),
    instagram: new InstagramPublisher(meta, deps),
    facebook: new FacebookPublisher(meta, deps),
    linkedin: new LinkedInPublisher(store, deps),
    x: new XPublisher(store, deps),
  };
  for (const provider of Object.values(providers)) publisher.register(provider);

  publisher.meta = meta;
  publisher.byId = providers;
  return publisher;
}

module.exports = { createPublisher };
