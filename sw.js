// Угол — Service Worker v1.0
const CACHE = 'ugol-v1';
const STATIC = [
  '/',
  '/index.html',
  '/a.png', '/b.png', '/c.png', '/d.png', '/f.png',
  '/wp.png', '/vp.png', '/wpp.png', '/wp2.png', '/wp3.png',
  'https://fonts.googleapis.com/css2?family=Geologica:wght@300;400;500;700;900&family=JetBrains+Mono:wght@400;600&display=swap'
];

// Установка — кэшируем статику
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => {
      return Promise.allSettled(STATIC.map(url => c.add(url).catch(() => {})));
    }).then(() => self.skipWaiting())
  );
});

// Активация — удаляем старый кэш
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Fetch — стратегия: API = network first, статика = cache first
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // API запросы — только network, без кэша (кэш делаем на уровне JS)
  if(url.pathname.startsWith('/api/')) {
    e.respondWith(
      fetch(e.request).catch(() =>
        new Response(JSON.stringify({ success: false, offline: true, error: 'Нет подключения' }), {
          headers: { 'Content-Type': 'application/json' }
        })
      )
    );
    return;
  }

  // Статика — cache first, потом network
  e.respondWith(
    caches.match(e.request).then(cached => {
      if(cached) return cached;
      return fetch(e.request).then(res => {
        // Кэшируем только успешные ответы
        if(res && res.status === 200 && res.type !== 'opaque') {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return res;
      }).catch(() => {
        // Офлайн — возвращаем заглушку для HTML
        if(e.request.headers.get('accept')?.includes('text/html')) {
          return caches.match('/index.html');
        }
      });
    })
  );
});
