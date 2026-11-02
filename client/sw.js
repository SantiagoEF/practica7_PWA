'use strict';

const VERSION = 'v1';
const CACHE_ESTATICO = `hub-estatico-${VERSION}`;
const CACHE_DINAMICO = `hub-dinamico-${VERSION}`;

const RECURSOS_ESTATICOS = [
  '/',
  '/index.html',
  '/style.css',
  '/app.js',
  '/manifest.json',
  '/socket.io/socket.io.js'
];

const RUTAS_ESTATICAS = new Set(RECURSOS_ESTATICOS);

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_ESTATICO)
      .then((cache) => cache.addAll(RECURSOS_ESTATICOS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((nombres) =>
        Promise.all(
          nombres
            .filter((n) => n !== CACHE_ESTATICO && n !== CACHE_DINAMICO)
            .map((n) => caches.delete(n))
        )
      )
      .then(() => self.clients.claim())
  );
});

async function cacheFirst(request) {
  const enCache = await caches.match(request, { ignoreSearch: true });
  if (enCache) return enCache;

  try {
    const respuesta = await fetch(request);
    if (respuesta && respuesta.ok) {
      const cache = await caches.open(CACHE_ESTATICO);
      cache.put(request, respuesta.clone());
    }
    return respuesta;
  } catch (err) {
    const fallback = await caches.match('/index.html');
    return (
      fallback ||
      new Response('Recurso no disponible sin conexión.', {
        status: 503,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' }
      })
    );
  }
}

async function networkFirst(request) {
  try {
    const respuesta = await fetch(request);
    if (respuesta && respuesta.ok) {
      const cache = await caches.open(CACHE_DINAMICO);
      cache.put(request, respuesta.clone());
    }
    return respuesta;
  } catch (err) {
    const enCache = await caches.match(request);
    if (enCache) return enCache;

    if (request.mode === 'navigate') {
      const index = await caches.match('/index.html');
      if (index) return index;
    }

    return new Response(
      JSON.stringify({
        ok: false,
        offline: true,
        mensaje: 'Sin conexión con el Hub. Verifica tu red e inténtalo de nuevo.'
      }),
      {
        status: 503,
        headers: { 'Content-Type': 'application/json; charset=utf-8' }
      }
    );
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;

  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.startsWith('/socket.io/') && url.pathname !== '/socket.io/socket.io.js') {
    return;
  }

  if (RUTAS_ESTATICAS.has(url.pathname)) {
    event.respondWith(cacheFirst(request));
    return;
  }

  event.respondWith(networkFirst(request));
});