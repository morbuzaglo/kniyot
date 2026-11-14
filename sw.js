// Service Worker: מטמון למעטפת האפליקציה ולקטלוג, כדי לעבוד ללא אינטרנט.
// המידע האישי (רשימות ותמונות שלהן) נשמר ב-IndexedDB ולא כאן.
const VERSION = 'v1.0.0';
const SHELL = `shell-${VERSION}`;
const CATALOG = 'catalog-data';
const IMAGES = 'catalog-images';
const MAX_IMAGES = 300; // מטמון מוגבל לתמונות קטלוג (תמונות של פריטים ברשימות שמורות בנפרד ב-IndexedDB)

const SHELL_FILES = [
  './', 'index.html', 'manifest.webmanifest', 'css/app.css',
  'js/main.js', 'js/ui.js', 'js/store.js', 'js/db.js', 'js/catalog.js', 'js/hebrew.js',
  'js/categories.js', 'js/share.js', 'js/pdf.js', 'js/backup.js',
  'icons/icon-192.png', 'icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(SHELL_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('shell-') && k !== SHELL) await caches.delete(k);
    await self.clients.claim();
  })());
});

async function trimImages() {
  const c = await caches.open(IMAGES);
  const keys = await c.keys();
  for (let i = 0; i < keys.length - MAX_IMAGES; i++) await c.delete(keys[i]); // הוותיקים ראשונים
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  const path = url.pathname;

  // מעטפת: ניווט → index.html מהמטמון, עדכון ברקע
  if (req.mode === 'navigate') {
    e.respondWith((async () => {
      const cache = await caches.open(SHELL);
      const cached = await cache.match('index.html');
      const net = fetch(req).then((r) => { if (r.ok) cache.put('index.html', r.clone()); return r; }).catch(() => null);
      return cached || (await net) || new Response('אין חיבור', { status: 503, headers: { 'content-type': 'text/plain; charset=utf-8' } });
    })());
    return;
  }

  // קובץ הקטלוג הראשי: רשת קודם (כדי לקבל ייבוא חדש), מטמון כשאין חיבור
  if (path.endsWith('/catalog/manifest.json')) {
    e.respondWith((async () => {
      const cache = await caches.open(CATALOG);
      try {
        const r = await fetch(req, { cache: 'no-cache' });
        if (r.ok) await cache.put(req, r.clone());
        return r;
      } catch {
        return (await cache.match(req)) || Response.error();
      }
    })());
    return;
  }

  // מקטעי קטלוג (שמות עם hash): מטמון קודם
  if (path.includes('/catalog/') && path.endsWith('.json')) {
    e.respondWith((async () => {
      const cache = await caches.open(CATALOG);
      const hit = await cache.match(req);
      if (hit) return hit;
      const r = await fetch(req);
      if (r.ok) {
        await cache.put(req, r.clone());
        // ניקוי מקטעים ישנים שאינם בשימוש
        const keys = await cache.keys();
        const m = await cache.match(new URL('catalog/manifest.json', self.registration.scope).href);
        if (m) {
          const shards = new Set((await m.clone().json()).shards);
          for (const k of keys) {
            const n = k.url.split('/catalog/')[1];
            if (n && n !== 'manifest.json' && !shards.has(n)) await cache.delete(k);
          }
        }
      }
      return r;
    })());
    return;
  }

  // תמונות קטלוג: מטמון קודם, מוגבל בגודל
  if (path.includes('/catalog/img/')) {
    e.respondWith((async () => {
      const cache = await caches.open(IMAGES);
      const hit = await cache.match(req);
      if (hit) return hit;
      const r = await fetch(req);
      if (r.ok) { await cache.put(req, r.clone()); trimImages(); }
      return r;
    })());
    return;
  }

  // שאר קבצי המעטפת: מהמטמון מיד, ועדכון ברקע (stale-while-revalidate) — גרסה חדשה נטענת בפתיחה הבאה
  e.respondWith((async () => {
    const cache = await caches.open(SHELL);
    const hit = await cache.match(req, { ignoreSearch: true });
    const net = fetch(req).then((r) => { if (r.ok && SHELL_FILES.some((f) => path.endsWith('/' + f))) cache.put(req, r.clone()); return r; });
    if (hit) { e.waitUntil(net.catch(() => {})); return hit; }
    return net;
  })());
});
