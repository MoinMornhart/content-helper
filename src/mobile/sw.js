/**
 * Offline-Puffer der Handy-App.
 *
 * Zwischengespeichert wird nur das Gerüst - Oberflächendateien und Symbole.
 * Inhalte kommen immer frisch vom PC; ist er nicht erreichbar, greift die App
 * auf ihren eigenen Zwischenspeicher zurück und reicht Eingaben später nach.
 */

const CACHE = 'content-helper-v2';
const SHELL = ['./', 'index.html', 'style.css', 'app.js', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Daten nie aus dem Zwischenspeicher beantworten - veraltete Zahlen waeren schlimmer als gar keine.
  if (url.pathname.startsWith('/api/')) return;

  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request).then((response) => {
      if (response.ok && event.request.method === 'GET') {
        const copy = response.clone();
        caches.open(CACHE).then((cache) => cache.put(event.request, copy));
      }
      return response;
    }).catch(() => caches.match('index.html')))
  );
});
