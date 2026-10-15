// ใช้เน็ตก่อน (ได้เวอร์ชันล่าสุดเสมอ) ถ้าออฟไลน์ค่อยใช้ไฟล์ที่เก็บไว้
// cache: 'no-cache' = ถามเซิร์ฟเวอร์ทุกครั้ง ไม่ใช้สำเนาเก่าในเบราว์เซอร์ (GitHub Pages เก็บไว้ 10 นาที)
const CACHE = 'inkmark-v5';
const SHELL = [
  './', 'index.html', 'css/style.css', 'manifest.json',
  'js/app.js', 'js/crop.js', 'js/tone.js', 'js/watermark.js', 'js/render.js', 'js/zip.js',
  'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(
    fetch(e.request.url, { cache: 'no-cache', credentials: 'same-origin' })
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true })),
  );
});
