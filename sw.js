const CACHE = 'prs-assetverify-2-0-2-scanner';
const CORE = [
  './',
  './index.html',
  './app.js',
  './styles.css',
  './manifest.webmanifest',
  './icon.svg'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(cache => cache.addAll(CORE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

async function cacheResponse(request, response) {
  if (!response) return response;
  try {
    const cache = await caches.open(CACHE);
    await cache.put(request, response.clone());
  } catch (_) {}
  return response;
}

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  const sameOrigin = url.origin === self.location.origin;
  const trustedRuntimeAsset = url.hostname === 'unpkg.com' || url.hostname === 'cdn.jsdelivr.net';

  // Never cache Cloudflare API / Worker responses. The app must know when the
  // network is unavailable so it can queue verification actions in IndexedDB.
  if (!sameOrigin && !trustedRuntimeAsset) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(response => cacheResponse(request, response))
        .catch(async () => (await caches.match('./index.html')) || (await caches.match('./')))
    );
    return;
  }

  event.respondWith((async () => {
    const cached = await caches.match(request);
    if (cached) {
      // Refresh in the background while immediately serving the cached copy.
      event.waitUntil(fetch(request).then(r => cacheResponse(request, r)).catch(() => {}));
      return cached;
    }
    try {
      return await cacheResponse(request, await fetch(request));
    } catch (_) {
      return Response.error();
    }
  })());
});
