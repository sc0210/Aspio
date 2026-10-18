import { onCLS, onINP, onFCP, onLCP, onTTFB } from 'web-vitals';
import { analyticsProvider } from '@/lib/analytics/provider';
import { shouldTrackAnalytics, hasAnalyticsConsent } from '@/lib/analytics/config';

interface WebVitalsConfig {
  debug?: boolean;
}

interface PerformanceMetric {
  name: string;
  value: number;
  delta: number;
  id: string;
  rating?: 'good' | 'needs-improvement' | 'poor';
  entries?: PerformanceEntry[];
  navigationType?: string;
  timestamp?: number;
  context?: {
    page: string;
    userAgent: string;
    connection?: string;
    deviceMemory?: number;
  };
}

class WebVitalsReporter {
  private config: WebVitalsConfig;
  private metrics: PerformanceMetric[] = [];

  constructor(config: WebVitalsConfig = {}) {
    this.config = {
      debug: process.env.NODE_ENV === 'development',
      ...config,
    };
  }

  private getMetricRating(name: string, value: number): 'good' | 'needs-improvement' | 'poor' {
    const thresholds = {
      CLS: { good: 0.1, poor: 0.25 },
      INP: { good: 200, poor: 500 }, // INP replaces FID
      FCP: { good: 1800, poor: 3000 },
      LCP: { good: 2500, poor: 4000 },
      TTFB: { good: 800, poor: 1800 },
    };

    const threshold = thresholds[name as keyof typeof thresholds];
    if (!threshold) return 'good';

    if (value <= threshold.good) return 'good';
    if (value <= threshold.poor) return 'needs-improvement';
    return 'poor';
  }

  private getContext(): PerformanceMetric['context'] {
    if (typeof window === 'undefined') return undefined;

    return {
      page: window.location.pathname,
      // userAgent intentionally omitted — fingerprinting vector
      userAgent: '',
      connection: (navigator as Navigator & { connection?: { effectiveType?: string } }).connection?.effectiveType,
      deviceMemory: (navigator as Navigator & { deviceMemory?: number }).deviceMemory,
    };
  }

  private sendToAnalytics(metric: PerformanceMetric) {
    const { name, value, rating, context } = metric;

    // Respect user privacy preferences before emitting any data
    if (!shouldTrackAnalytics() || !hasAnalyticsConsent()) {
      if (this.config.debug) {
        console.log(`Web Vital skipped (consent/DNT): ${name}`);
      }
      return;
    }

    // Normalised integer value (CLS is unit-less 0-1, others are ms)
    const normalisedValue = Math.round(name === 'CLS' ? value * 1000 : value);

    // Send through the shared analytics provider so the same
    // consent checks, anonymisation, and provider routing apply.
    analyticsProvider.track('web_vital', {
      metric_name: name,
      metric_value: normalisedValue,
      metric_rating: rating,
      page: context?.page,
      connection: context?.connection,
      // deviceMemory is a coarse bucket (0.25, 0.5, 1, 2, 4, 8 GB)
      // — not PII, safe to include.
      device_memory_gb: context?.deviceMemory,
    });

    // Console logging in debug mode
    if (this.config.debug) {
      console.log(`Web Vital - ${name}:`, {
        value: normalisedValue,
        rating,
        context,
      });
    }
  }

  private reportMetric(metric: PerformanceMetric) {
    const enhancedMetric: PerformanceMetric = {
      ...metric,
      rating: this.getMetricRating(metric.name, metric.value),
      context: this.getContext(),
    };

    this.metrics.push(enhancedMetric);
    this.sendToAnalytics(enhancedMetric);

    // Check for performance issues
    if (enhancedMetric.rating === 'poor') {
      console.warn(`Poor ${metric.name} detected:`, {
        value: metric.value,
        page: enhancedMetric.context?.page,
      });
    }
  }

  init() {
    if (typeof window === 'undefined') return;

    // Core Web Vitals
    onCLS((metric) => this.reportMetric(metric as PerformanceMetric));
    onINP((metric) => this.reportMetric(metric as PerformanceMetric)); // INP replaces FID
    onFCP((metric) => this.reportMetric(metric as PerformanceMetric));
    onLCP((metric) => this.reportMetric(metric as PerformanceMetric));
    onTTFB((metric) => this.reportMetric(metric as PerformanceMetric));

    // Custom performance metrics
    this.trackCustomMetrics();
  }

  private trackCustomMetrics() {
    // Track dashboard-specific metrics
    this.trackRenderTimes();
    this.trackResourceLoading();
    this.trackUserInteractions();
  }

  private trackRenderTimes() {
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.name.startsWith('dashboard-')) {
          this.reportMetric({
            name: entry.name,
            value: entry.duration,
            delta: entry.duration,
            id: `${entry.name}-${Date.now()}`,
            rating: this.getMetricRating('FID', entry.duration),
          });
        }
      }
    });

    observer.observe({ entryTypes: ['measure'] });
  }

  private trackResourceLoading() {
    // Resource size/timing warnings are only actionable in production, where
    // assets are gzipped and code-split. In development the dev server serves
    // uncompressed bundles and compiles routes on-demand, so these fire
    // constantly on legitimate lazy-loaded libraries (Recharts ~386 KB
    // uncompressed) and first-time route compiles — pure console noise. Skip
    // resource logging entirely outside production.
    if (process.env.NODE_ENV !== 'production') return;

    const LARGE_RESOURCE_THRESHOLD = 250_000; // 250 KB gzipped — catches genuinely oversized chunks
    const SLOW_RESOURCE_THRESHOLD = 2_000;    // 2 s — actionable (good LCP target is 2.5 s)

    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const resource = entry as PerformanceResourceTiming;

        // Track large resources (skip 0-byte cached responses)
        if (resource.transferSize > LARGE_RESOURCE_THRESHOLD) {
          console.warn('Large resource detected:', {
            name: resource.name,
            size: Math.round(resource.transferSize / 1024) + 'KB',
            loadTime: Math.round(resource.responseEnd - resource.requestStart) + 'ms',
          });
        }

        // Track slow resources (skip cached/instant responses)
        const loadTime = resource.responseEnd - resource.requestStart;
        if (loadTime > SLOW_RESOURCE_THRESHOLD) {
          console.warn('Slow resource detected:', {
            name: resource.name,
            loadTime: Math.round(loadTime) + 'ms',
          });
        }
      }
    });

    observer.observe({ entryTypes: ['resource'] });
  }

  private trackUserInteractions() {
    // Use the PerformanceObserver event-timing API instead of manual rAF timing.
    // The rAF approach measures frame scheduling latency (always ~16 ms at 60 fps)
    // rather than actual interaction delay, producing a warning on virtually every
    // click/touch.  The 'event' entry type gives us the real presentation delay.
    // Only available in Chromium-based browsers; gracefully skip elsewhere.
    if (!('PerformanceEventTiming' in window)) return;

    // INP threshold: 200 ms good / 500 ms poor (same as web-vitals INP definition).
    // Only warn on genuinely slow interactions to avoid analytics noise.
    const SLOW_INTERACTION_MS = process.env.NODE_ENV === 'production' ? 200 : 300;

    try {
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          const event = entry as PerformanceEventTiming;
          // processingStart - startTime = input delay; duration = full interaction latency
          const interactionTime = event.duration;
          if (interactionTime > SLOW_INTERACTION_MS) {
            this.reportMetric({
              name: `interaction-${event.name}`,
              value: interactionTime,
              delta: interactionTime,
              id: `interaction-${event.name}-${Date.now()}`,
              rating: this.getMetricRating('INP', interactionTime),
            });
          }
        }
      });
      observer.observe({ type: 'event', buffered: true, durationThreshold: SLOW_INTERACTION_MS } as PerformanceObserverInit);
    } catch {
      // PerformanceObserver with event type not supported — skip silently.
    }
  }

  getMetrics(): PerformanceMetric[] {
    return this.metrics;
  }

  getSummary() {
    const summary = {
      total: this.metrics.length,
      good: 0,
      needsImprovement: 0,
      poor: 0,
      coreWebVitals: {} as Record<string, PerformanceMetric>,
    };

    this.metrics.forEach((metric) => {
      // Count ratings
      if (metric.rating === 'good') summary.good++;
      else if (metric.rating === 'needs-improvement') summary.needsImprovement++;
      else if (metric.rating === 'poor') summary.poor++;

      // Store core web vitals
      if (['CLS', 'INP', 'FCP', 'LCP', 'TTFB'].includes(metric.name)) {
        summary.coreWebVitals[metric.name] = metric;
      }
    });

    return summary;
  }
}

// Create singleton instance
export const webVitalsReporter = new WebVitalsReporter({
  debug: process.env.NODE_ENV === 'development',
});