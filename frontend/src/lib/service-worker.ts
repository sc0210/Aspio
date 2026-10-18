/**
 * Service worker lifecycle, run once when this module is first imported
 * (app/providers.tsx imports it for that side effect): register /sw.js in
 * production, and in development remove any worker an earlier production
 * build left behind.
 */

/**
 * Register service worker for PWA
 */
async function registerServiceWorker() {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
    return false;
  }

  try {
    const registration = await navigator.serviceWorker.register('/sw.js', {
      scope: '/',
      updateViaCache: 'none'
    });

    registration.addEventListener('updatefound', () => {
      const newWorker = registration.installing;
      if (newWorker) {
        newWorker.addEventListener('statechange', () => {
          if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
            // Show update available notification
            console.log('New version available! Please refresh.');
          }
        });
      }
    });

    if (process.env.NODE_ENV === 'development') {
      console.log('Service Worker registered successfully');
    }
    return true;
  } catch (error) {
    console.error('Service Worker registration failed:', error);
    return false;
  }
}

/**
 * Tear down any service worker still controlling this origin, plus its caches.
 *
 * Registration is production-only, but a registration made by an earlier
 * production-mode visit keeps controlling localhost forever — skipping
 * registration in dev is not enough to get rid of it. A stale worker breaks dev
 * in two ways: cache-first asset handling pins chunks from an older build, and
 * stale-while-revalidate on navigations serves a previous build's HTML whose
 * asset stamps no longer match the dev server, which the Next dev client
 * "fixes" by reloading — into the same stale HTML, once per second, forever.
 *
 * Returns true if anything was actually removed.
 */
async function unregisterServiceWorkers(): Promise<boolean> {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
    return false;
  }

  try {
    const registrations = await navigator.serviceWorker.getRegistrations();
    if (registrations.length === 0) {
      return false;
    }

    await Promise.all(registrations.map((registration) => registration.unregister()));

    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((key) => caches.delete(key)));
    }

    console.warn(
      `Removed ${registrations.length} stale service worker registration(s) and their caches. ` +
      'Service workers are production-only; this one was left over from an earlier build.'
    );
    return true;
  } catch (error) {
    console.error('Failed to unregister service workers:', error);
    return false;
  }
}

/**
 * Dev-only recovery: drop leftover workers, then reload once if this document
 * is still being served by one. The reload is capped at one per tab session,
 * so a failure to clean up can never itself become a reload loop.
 */
async function cleanUpDevServiceWorkers() {
  // Capture this before unregistering — an already-open document keeps its
  // controller until it is reloaded, so this is what decides whether the page
  // in front of the user right now is still coming from the stale worker.
  const wasControlled = !!navigator.serviceWorker.controller;
  const removed = await unregisterServiceWorkers();

  if (!removed || !wasControlled) {
    return;
  }

  const reloadKey = 'sw_cleanup_reload';
  if (sessionStorage.getItem(reloadKey)) {
    return;
  }
  // Set the flag and never clear it for the life of this tab: one reload only.
  sessionStorage.setItem(reloadKey, '1');
  window.location.reload();
}

// Auto-register service worker immediately for faster caching
if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
  // Only register in production or when explicitly enabled
  if (process.env.NODE_ENV === 'production' ||
      process.env.NEXT_PUBLIC_ENABLE_SW === 'true') {
    // Use requestIdleCallback to avoid blocking initial render
    if ('requestIdleCallback' in window) {
      requestIdleCallback(() => {
        registerServiceWorker();
      });
    } else {
      setTimeout(() => {
        registerServiceWorker();
      }, 100);
    }
  } else {
    // In development, actively tear down any leftover worker rather than just
    // declining to register a new one. This runs eagerly instead of inside
    // requestIdleCallback: when a stale worker has the page in a reload loop
    // the tab never goes idle, so an idle-scheduled cleanup would never fire.
    cleanUpDevServiceWorkers();
  }
}
