// Performance optimization utilities for Aspiro FIRE tracker

interface PerformanceBudget {
  maxBundleSize: number; // KB
  maxImageSize: number; // KB
  maxLCPTime: number; // ms
  maxFIDTime: number; // ms
  maxCLSScore: number;
}

const PERFORMANCE_BUDGET: PerformanceBudget = {
  maxBundleSize: 250, // 250KB for main bundle
  maxImageSize: 100, // 100KB per image
  maxLCPTime: 2500, // 2.5 seconds
  maxFIDTime: 100, // 100ms
  maxCLSScore: 0.1, // CLS < 0.1
};
/**
 * Lazy load images with intersection observer
 */
export function createImageLazyLoader() {
  if (typeof window === 'undefined' || !('IntersectionObserver' in window)) {
    return;
  }

  const imageObserver = new IntersectionObserver((entries, observer) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        const img = entry.target as HTMLImageElement;
        const src = img.dataset.src;

        if (src) {
          img.src = src;
          img.removeAttribute('data-src');
          observer.unobserve(img);
        }
      }
    });
  });

  const images = document.querySelectorAll('img[data-src]');
  images.forEach((img) => imageObserver.observe(img));

  return imageObserver;
}

/**
 * Preload critical resources
 */
export function preloadCriticalResources() {
  if (typeof window === 'undefined') return;

  // Critical resources that improve loading performance.
  //
  // NOTE: /manifest.json is intentionally excluded from this list.
  // The browser fetches the PWA manifest with credentials (same-origin cookies),
  // but <link rel="preload" as="fetch" crossOrigin="anonymous"> uses the
  // CORS-anonymous cache partition — a different cache key — so the preload is
  // never reused and the browser emits a "preload credentials mismatch" warning.
  // The manifest is tiny (<2 KB) and non-blocking, so preloading it has no
  // measurable LCP benefit anyway.
  const criticalResources = [
    '/icons/icon-192x192.png',
    '/avatars/default.png',
  ];

  // Preload API endpoints that are likely to be called
  const apiEndpoints = [
    '/api/auth/session',
    '/health'
  ];

  // Preload static resources
  criticalResources.forEach((resource) => {
    const link = document.createElement('link');
    link.rel = 'preload';
    link.href = resource;

    if (resource.endsWith('.js')) {
      link.as = 'script';
    } else if (resource.endsWith('.css')) {
      link.as = 'style';
    } else if (resource.endsWith('.png') || resource.endsWith('.jpg') || resource.endsWith('.webp')) {
      link.as = 'image';
    } else {
      link.as = 'fetch';
      link.crossOrigin = 'anonymous';
    }

    document.head.appendChild(link);
  });

  // Prefetch API endpoints using fetch (with delay to avoid blocking)
  setTimeout(() => {
    apiEndpoints.forEach(async (endpoint) => {
      try {
        // Skip auth endpoints as they don't support HEAD requests
        if (endpoint.includes('/auth/')) {
          return;
        }

        await fetch(endpoint, {
          method: 'HEAD',
          mode: 'no-cors' // Avoid CORS issues
        });
        // Cache the response in browser
      } catch {
        // Silently ignore network errors
      }
    });
  }, 1000);
}
/**
 * Monitor and report performance budgets
 */
export function checkPerformanceBudget() {
  if (typeof window === 'undefined') return;

  // Check bundle size
  const scriptTags = document.querySelectorAll('script[src]');
  let totalBundleSize = 0;

  scriptTags.forEach((script) => {
    const src = (script as HTMLScriptElement).src;
    if (src.includes('/_next/static/')) {
      // More accurate size estimation based on common Next.js chunks
      if (src.includes('pages/_app')) {
        totalBundleSize += 80; // Main app bundle
      } else if (src.includes('webpack')) {
        totalBundleSize += 30; // Webpack runtime
      } else if (src.includes('framework')) {
        totalBundleSize += 40; // React framework
      } else if (src.includes('main')) {
        totalBundleSize += 60; // Main bundle
      } else {
        totalBundleSize += 20; // Other chunks
      }
    }
  });

  if (totalBundleSize > PERFORMANCE_BUDGET.maxBundleSize) {
    console.warn(`Bundle size budget exceeded: ${totalBundleSize}KB > ${PERFORMANCE_BUDGET.maxBundleSize}KB`);
  }

  // Monitor Core Web Vitals against budget using the installed web-vitals library.
  // The previous code checked `'web-vitals' in window` which is always false because
  // web-vitals is a JS module, not a global. Import it dynamically instead.
  import('web-vitals').then(({ onCLS, onLCP, onINP }) => {
    onCLS((metric) => {
      if (metric.value > PERFORMANCE_BUDGET.maxCLSScore) {
        console.warn(`CLS budget exceeded: ${metric.value} > ${PERFORMANCE_BUDGET.maxCLSScore}`);
      }
    });

    onLCP((metric) => {
      if (metric.value > PERFORMANCE_BUDGET.maxLCPTime) {
        console.warn(`LCP budget exceeded: ${metric.value}ms > ${PERFORMANCE_BUDGET.maxLCPTime}ms`);
      }
    });

    // INP (Interaction to Next Paint) replaces the deprecated FID metric.
    onINP((metric) => {
      if (metric.value > PERFORMANCE_BUDGET.maxFIDTime) {
        console.warn(`INP budget exceeded: ${metric.value}ms > ${PERFORMANCE_BUDGET.maxFIDTime}ms`);
      }
    });
  }).catch(() => {
    // web-vitals not available — skip budget checks silently
  });
}
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
        preloadCriticalResources();
      });
    } else {
      setTimeout(() => {
        registerServiceWorker();
        preloadCriticalResources();
      }, 100);
    }
  } else {
    // In development, actively tear down any leftover worker rather than just
    // declining to register a new one. This runs eagerly instead of inside
    // requestIdleCallback: when a stale worker has the page in a reload loop
    // the tab never goes idle, so an idle-scheduled cleanup would never fire.
    cleanUpDevServiceWorkers();

    // Preloading is not urgent, so it keeps the idle slot.
    if ('requestIdleCallback' in window) {
      requestIdleCallback(() => {
        preloadCriticalResources();
      });
    } else {
      setTimeout(() => {
        preloadCriticalResources();
      }, 100);
    }
  }
}
