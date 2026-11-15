/*
 * Service worker: офлайн-режим.
 * При каждом релизе увеличивайте версию CACHE, чтобы старые файлы удалились.
 * Стратегия: отдаём из кэша сразу, а в фоне обновляем кэш из сети.
 */
var CACHE = 'stroy-roadmap-v3';
var ASSETS = [
  './',
  'index.html',
  'css/style.css',
  'js/data.js',
  'js/i18n.js',
  'js/app.js',
  'manifest.webmanifest',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png'
];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(ASSETS); }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(
    caches.open(CACHE).then(function (cache) {
      return cache.match(req, { ignoreSearch: true }).then(function (cached) {
        var network = fetch(req).then(function (res) {
          if (res && res.ok) cache.put(req, res.clone());
          return res;
        }).catch(function () {
          // офлайн и в кэше нет — для страниц отдаём главную
          return cached || (req.mode === 'navigate' ? cache.match('index.html') : undefined);
        });
        return cached || network;
      });
    })
  );
});
