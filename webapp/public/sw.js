const CACHE = 'avenra-shell-v2'

// Vite gives assets content-hashed names, so every deploy adds a fresh set and
// the old ones are never requested again. Without a cap the cache grows
// without bound; trim oldest-first once past this many entries.
const MAX_CACHED_ASSETS = 60

async function trimCache() {
  const cache = await caches.open(CACHE)
  const keys = await cache.keys()
  if (keys.length <= MAX_CACHED_ASSETS) return
  // cache.keys() returns insertion order — drop the oldest overflow.
  await Promise.all(keys.slice(0, keys.length - MAX_CACHED_ASSETS).map(k => cache.delete(k)))
}

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE).then(cache => cache.add('/'))
  )
  self.skipWaiting()
})

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  )
  self.clients.claim()
})

self.addEventListener('fetch', event => {
  const { request } = event
  const url = new URL(request.url)

  // Never intercept non-GET or API requests
  if (request.method !== 'GET') return
  if (url.pathname.startsWith('/api/')) return

  // Navigation: network-first, fall back to cached shell
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => caches.match('/'))
    )
    return
  }

  // Static assets with content-hashed names: cache-first
  if (/\.(js|css|png|svg|ico|woff2?)$/.test(url.pathname)) {
    event.respondWith(
      caches.match(request).then(cached => {
        if (cached) return cached
        return fetch(request).then(response => {
          if (response.ok) {
            // Clone synchronously — by the time caches.open() resolves the
            // browser may already have consumed the original body.
            const copy = response.clone()
            caches.open(CACHE)
              .then(c => c.put(request, copy))
              .then(trimCache)
              .catch(() => {})
          }
          return response
        })
      })
    )
  }
})
