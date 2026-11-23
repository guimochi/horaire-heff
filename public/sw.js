// Plain JS, copied as-is by Vite. The build id arrives as ?v= on the registration URL (see main.tsx).
const CACHE = 'horaire-' + (new URL(self.location.href).searchParams.get('v') || 'dev');

// Cache the shell and the same-origin files it references (Vite's hashed bundles, icons) so offline works from the first load.
async function precache() {
  const cache = await caches.open(CACHE);
  const res = await fetch('/', { cache: 'no-store' });
  if (!res.ok) return;
  const html = await res.clone().text();
  await cache.put('/', res);
  const files = [...html.matchAll(/(?:src|href)="(\/[^/"][^"]*)"/g)].map((m) => m[1]);
  await cache.addAll(files);
  // The self-hosted fonts are referenced from the CSS bundle, not the HTML (woff2 only: every target browser reads it).
  for (const css of files.filter((f) => f.endsWith('.css'))) {
    const text = await (await cache.match(css, { ignoreVary: true })).text();
    await cache.addAll([...text.matchAll(/url\(["']?(\/[^)"']+\.woff2)["']?\)/g)].map((m) => m[1]));
  }
}

self.addEventListener('install', (e) => {
  e.waitUntil(precache().catch(() => {}).then(() => self.skipWaiting()));
});

// API data outlives deploys ("offline with the last known version"), so it gets its own unversioned cache.
const DATA = 'horaire-data';

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k.startsWith('horaire-') && k !== CACHE && k !== DATA).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// keep(res) decides what may be stored; the write is kept alive by waitUntil and never fails the response.
async function networkFirst(e, cacheName, key, keep) {
  const cache = await caches.open(cacheName);
  try {
    const res = await fetch(e.request);
    if (keep(res)) { e.waitUntil(cache.put(key, res.clone()).catch(() => {})); return res; }
    // 5xx or other non-ok answer: the last good copy beats an error; without one, pass the network answer through.
    if (!res.ok) return (await cache.match(key, { ignoreVary: true })) || res;
    return res;
  } catch (err) {
    const hit = await cache.match(key, { ignoreVary: true });
    if (hit) return hit;
    throw err;
  }
}

async function cacheFirst(e) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(e.request, { ignoreVary: true }); // precached without the Origin header some hosts Vary on
  if (hit) return hit;
  const res = await fetch(e.request);
  if (res.ok) e.waitUntil(cache.put(e.request, res.clone()).catch(() => {}));
  return res;
}

const isHtml = (res) => res.ok && (res.headers.get('content-type') || '').includes('text/html');

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  // POST/DELETE /api/subscribe and cross-origin requests go straight to the network.
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  // Single-page app: every navigation is the same shell, cached under '/' (HTML only, so opening /api/... can't replace it).
  if (req.mode === 'navigate') e.respondWith(networkFirst(e, CACHE, '/', isHtml));
  else if (url.pathname.startsWith('/api/')) e.respondWith(networkFirst(e, DATA, req, (res) => res.ok));
  else e.respondWith(cacheFirst(e));
});

self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { /* malformed payload: still show something */ }
  // iOS revokes subscriptions that receive pushes without a visible notification.
  e.waitUntil(self.registration.showNotification(d.title || 'Horaire HEFF', {
    body: d.body || 'Ton horaire a changé.',
    data: { url: d.url || '/#/changements' },
    icon: '/icon-192.png',
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  let url = new URL((e.notification.data && e.notification.data.url) || '/#/changements', self.location.origin);
  // Never open another site from a push payload, whoever signed it.
  if (url.origin !== self.location.origin) url = new URL('/#/changements', self.location.origin);
  url = url.href;
  e.waitUntil((async () => {
    const [client] = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (client) {
      try { await client.focus(); await client.navigate(url); return; } catch { /* uncontrolled client: open instead */ }
    }
    await self.clients.openWindow(url);
  })());
});
