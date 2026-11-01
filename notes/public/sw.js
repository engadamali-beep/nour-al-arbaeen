/* =========================================================
   ملاحظاتي — عامل الخدمة (PWA)
   يستخدم استراتيجية «الشبكة أولًا» مع نسخة مخبّئة تعمل دون إنترنت.
   لا يخزّن أي بيانات مستخدم: الملاحظات تعيش في IndexedDB فقط.
   ========================================================= */

const CACHE_NAME = 'malhazati-shell-v1';
const APP_SHELL = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './db.js',
  './manifest.webmanifest',
  './icon.svg',
  './icon-180.png',
  './icon-192.png',
  './icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    try {
      const response = await fetch(request);
      if (response && response.ok && response.type === 'basic') {
        cache.put(request, response.clone()).catch(() => {});
      }
      return response;
    } catch (error) {
      const cached = await cache.match(request, { ignoreSearch: true });
      if (cached) return cached;
      if (request.mode === 'navigate') {
        const shell = await cache.match(new URL('./index.html', self.registration.scope).href);
        if (shell) return shell;
      }
      return new Response('أنت غير متصل بالإنترنت، ولا تتوفر نسخة مخبّئة من هذه الصفحة.', {
        status: 503,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      });
    }
  })());
});
