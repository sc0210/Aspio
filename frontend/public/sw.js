// Bump these on any caching-behavior change: the activate handler deletes
// every cache whose name doesn't match, so renaming purges stale entries
// (e.g. the React 18 chunks poisoned before the React 19 upgrade).
// v4: /compare and /profile became next.config redirects. Page HTML is served
// cache-first and a redirect never overwrites it, so a returning visitor would
// otherwise keep getting the deleted pages, pointing at chunks that no longer exist.
// v5: page HTML is network-first (see networkFirstNavigation); the bump purges the
// HTML that stale-while-revalidate left behind from earlier builds.
const CACHE_NAME = 'aspiro-fire-tracker-v5';
const STATIC_CACHE_NAME = 'aspiro-static-v5';
const DYNAMIC_CACHE_NAME = 'aspiro-dynamic-v5';

// Cache static assets - only cache existing resources
const STATIC_ASSETS = [
  '/',
  '/manifest.json',
];

// API endpoints to cache for offline access
const API_CACHE_PATTERNS = [
  /\/api\/dashboard\/.*/,
  /\/api\/transactions\/.*/,
  /\/api\/goals\/.*/,
  /\/api\/portfolio\/.*/,
];

// Install event - cache static assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE_NAME)
      .then((cache) => {
        console.log('Caching static assets');
        return cache.addAll(STATIC_ASSETS);
      })
      .then(() => {
        return self.skipWaiting();
      })
  );
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames.map((cacheName) => {
            if (cacheName !== CACHE_NAME && cacheName !== STATIC_CACHE_NAME && cacheName !== DYNAMIC_CACHE_NAME) {
              console.log('Deleting old cache:', cacheName);
              return caches.delete(cacheName);
            }
          })
        );
      })
      .then(() => {
        return self.clients.claim();
      })
  );
});

// Fetch event - implement caching strategies
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests
  if (request.method !== 'GET') {
    return;
  }

  // Skip external domains (but allow same origin)
  if (!url.href.startsWith(self.location.origin)) {
    return;
  }

  // Never let the SW handle Next.js build output. Dev chunks reuse stable
  // filenames (e.g. app/page.js) even when their contents change, so any
  // cache-first handling pins stale JS and can boot a mismatched React
  // runtime — the "Cannot read properties of undefined (reading
  // 'ReactCurrentDispatcher')" crash. Hashed prod chunks are already
  // immutably cached by the browser, so bypassing them here is safe too.
  if (url.pathname.startsWith('/_next/') ||
      url.pathname.includes('/__nextjs_')) {
    return;
  }

  // Handle API requests with network-first strategy
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(networkFirstStrategy(request));
    return;
  }

  // Handle static assets with cache-first strategy
  if (request.destination === 'script' ||
      request.destination === 'style' ||
      request.destination === 'image') {
    event.respondWith(cacheFirstStrategy(request));
    return;
  }

  // Page HTML: network first, the cache only when offline. Stale-while-revalidate
  // served the previous build's HTML on the first visit after every deploy, and
  // its hashed chunks are deleted with the old image, so the page came up blank
  // (404 + "MIME type text/plain") until a reload.
  if (request.mode === 'navigate') {
    event.respondWith(networkFirstNavigation(event, request));
    return;
  }

  // Default: try network first, fallback to cache
  event.respondWith(networkFirstStrategy(request));
});

// Network-first strategy (good for API calls)
async function networkFirstStrategy(request) {
  try {
    const networkResponse = await fetch(request);

    if (networkResponse.ok) {
      // Cache successful API responses
      if (shouldCacheApiResponse(request)) {
        try {
          const cache = await caches.open(DYNAMIC_CACHE_NAME);
          // Clone before using the response
          const responseToCache = networkResponse.clone();
          cache.put(request, responseToCache);
        } catch (cacheError) {
          console.log('Failed to cache response:', request.url, cacheError.message);
        }
      }
    }

    return networkResponse;
  } catch (error) {
    console.log('Network failed, trying cache:', request.url, error.message);

    try {
      const cachedResponse = await caches.match(request);

      if (cachedResponse) {
        return cachedResponse;
      }
    } catch (cacheError) {
      console.log('Cache lookup failed:', request.url, cacheError.message);
    }

    // Return offline fallback for API requests
    if (request.url.includes('/api/')) {
      return new Response(JSON.stringify({
        error: 'Offline',
        message: 'You are currently offline. Some data may be outdated.',
        data: null
      }), {
        status: 503,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Network failed and nothing is cached — fail gracefully instead of leaving
    // an unhandled rejection in respondWith (e.g. an aborted Next.js prefetch).
    return Response.error();
  }
}

// Cache-first strategy (good for static assets)
async function cacheFirstStrategy(request) {
  const cachedResponse = await caches.match(request);

  if (cachedResponse) {
    return cachedResponse;
  }

  try {
    const networkResponse = await fetch(request);

    if (networkResponse.ok) {
      const cache = await caches.open(STATIC_CACHE_NAME);
      // Only cache successful responses and avoid caching large files
      if (networkResponse.status === 200 &&
          request.url.startsWith(self.location.origin)) {
        // Clone before using the response
        const responseToCache = networkResponse.clone();
        cache.put(request, responseToCache);
      }
    }

    return networkResponse;
  } catch (error) {
    console.log('Failed to fetch asset:', request.url, error.message);

    // Return a fallback for images
    if (request.destination === 'image') {
      return new Response('', {
        status: 200,
        statusText: 'OK',
        headers: { 'Content-Type': 'image/svg+xml' }
      });
    }

    // For other assets, let the request fail naturally
    throw error;
  }
}

// Network-first for page HTML; the cached copy is only the offline fallback.
// No timeout falls back to the cache on a slow network: that copy is the previous
// build's HTML, the very page that rendered blank.
async function networkFirstNavigation(event, request) {
  try {
    const networkResponse = await fetch(request);
    if (networkResponse.ok) {
      // Stored in the background: cache.put settles only once the whole body is
      // read, and awaiting it held every page (and Next's streaming) until then.
      const copy = networkResponse.clone();
      event.waitUntil(
        caches.open(DYNAMIC_CACHE_NAME)
          .then((cache) => cache.put(request, copy))
          .catch((cacheError) => console.log('Failed to cache page:', request.url, cacheError.message))
      );
    }
    return networkResponse;
  } catch (error) {
    console.log('Network failed for page, trying cache:', request.url, error.message);
    const cachedResponse = await caches.match(request);
    return cachedResponse || Response.error();
  }
}

// Check if API response should be cached
function shouldCacheApiResponse(request) {
  const url = new URL(request.url);

  // Cache dashboard and portfolio data for offline access
  return API_CACHE_PATTERNS.some(pattern => pattern.test(url.pathname));
}

// Background sync for financial data updates
self.addEventListener('sync', (event) => {
  if (event.tag === 'background-sync-transactions') {
    event.waitUntil(doBackgroundSync());
  }
});

async function doBackgroundSync() {
  try {
    // Sync pending transactions when back online
    const cache = await caches.open(DYNAMIC_CACHE_NAME);
    const cachedRequests = await cache.keys();

    for (const request of cachedRequests) {
      if (request.url.includes('/api/transactions')) {
        try {
          const freshResponse = await fetch(request);
          if (freshResponse.ok) {
            await cache.put(request, freshResponse.clone());
          }
        } catch (error) {
          console.log('Background sync failed for:', request.url);
        }
      }
    }
  } catch (error) {
    console.log('Background sync error:', error);
  }
}

// Push notifications for FIRE goal milestones
self.addEventListener('push', (event) => {
  if (event.data) {
    const data = event.data.json();

    const options = {
      body: data.body,
      icon: '/icons/icon-192x192.png',
      badge: '/icons/badge-72x72.png',
      data: {
        url: data.url || '/dashboard'
      },
      actions: [
        {
          action: 'view',
          title: 'View Dashboard'
        },
        {
          action: 'dismiss',
          title: 'Dismiss'
        }
      ]
    };

    event.waitUntil(
      self.registration.showNotification(data.title, options)
    );
  }
});

// Handle notification clicks
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  if (event.action === 'view' || !event.action) {
    const url = event.notification.data.url || '/dashboard';

    event.waitUntil(
      clients.openWindow(url)
    );
  }
});

// Periodic background sync for financial data (if supported)
self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'financial-data-sync') {
    event.waitUntil(syncFinancialData());
  }
});

async function syncFinancialData() {
  try {
    // Sync critical financial data in the background
    const endpoints = [
      '/api/dashboard/stats',
      '/api/portfolio/overview',
      '/api/goals/active'
    ];

    const cache = await caches.open(DYNAMIC_CACHE_NAME);

    for (const endpoint of endpoints) {
      try {
        const response = await fetch(endpoint);
        if (response.ok) {
          await cache.put(endpoint, response.clone());
        }
      } catch (error) {
        console.log('Failed to sync:', endpoint);
      }
    }
  } catch (error) {
    console.log('Periodic sync error:', error);
  }
}