'use client';

import { useEffect } from 'react';
import { webVitalsReporter } from '@/lib/vitals';
import { getPublicApiUrl, isAbsoluteUrl } from '@/lib/api-url';
import {
  preloadCriticalResources,
  createImageLazyLoader,
  checkPerformanceBudget,
} from '@/utils/performance';

export function PerformanceOptimizer() {
  useEffect(() => {
    // Staggered initialization to avoid blocking
    const timeouts = [
      setTimeout(() => webVitalsReporter.init(), 0),
      setTimeout(() => preloadCriticalResources(), 50),
      setTimeout(() => createImageLazyLoader(), 100),
      setTimeout(() => setupResourceHints(), 150),
    ];

    // Development-only optimizations
    if (process.env.NODE_ENV === 'development') {
      timeouts.push(setTimeout(checkPerformanceBudget, 1000));
      timeouts.push(setTimeout(monitorMemoryUsage, 2000));
    } else {
      // In production, defer memory monitoring
      timeouts.push(setTimeout(monitorMemoryUsage, 5000));
    }

    return () => {
      // Clean up timeouts
      timeouts.forEach(clearTimeout);
    };
  }, []);

  return null; // This component doesn't render anything
}

// optimizeFontLoading() lived here: it rewrote fonts.googleapis.com stylesheet
// links to add display=swap. Inter is self-hosted now (src/app/fonts/), so no
// such link is ever emitted and the function only ever queried an empty list.
// next/font sets font-display: swap in the @font-face it generates.

function setupResourceHints() {
  if (typeof document === 'undefined') return;

  // Prefetch likely next pages
  const navigationHints = [
    '/transactions',
    '/portfolio',
    '/settings',
  ];

  navigationHints.forEach((path) => {
    const link = document.createElement('link');
    link.rel = 'prefetch';
    link.href = path;
    document.head.appendChild(link);
  });

  // Preconnect to the API — only when it lives on another origin. The default
  // same-origin `/api/v1` is already connected (it served this page).
  const apiUrl = getPublicApiUrl();
  const apiHints = isAbsoluteUrl(apiUrl) ? [new URL(apiUrl).origin] : [];

  apiHints.forEach((url) => {
    const link = document.createElement('link');
    link.rel = 'preconnect';
    link.href = url;
    document.head.appendChild(link);
  });
}

type MemoryInfo = { usedJSHeapSize: number; jsHeapSizeLimit: number; totalJSHeapSize: number };

function monitorMemoryUsage() {
  if (typeof window === 'undefined' || !(performance as Performance & { memory?: MemoryInfo }).memory) {
    return;
  }

  // Check memory usage every 30 seconds
  const memoryCheckInterval = setInterval(() => {
    const memory = (performance as Performance & { memory?: MemoryInfo }).memory;
    if (!memory) return;
    const usagePercentage = (memory.usedJSHeapSize / memory.jsHeapSizeLimit) * 100;

    if (usagePercentage > 80) {
      console.warn('High memory usage detected:', {
        used: Math.round(memory.usedJSHeapSize / 1024 / 1024) + 'MB',
        total: Math.round(memory.totalJSHeapSize / 1024 / 1024) + 'MB',
        limit: Math.round(memory.jsHeapSizeLimit / 1024 / 1024) + 'MB',
        percentage: Math.round(usagePercentage) + '%',
      });

      // Report to analytics
      webVitalsReporter.reportCustomMetric('memory_usage', usagePercentage);
    }
  }, 30000);

  // Cleanup on page unload
  window.addEventListener('beforeunload', () => {
    clearInterval(memoryCheckInterval);
  });
}