/**
 * Analytics Provider Integration
 * Handles actual tracking to analytics services
 */

import { defaultAnalyticsConfig, shouldTrackAnalytics, anonymizeEventData, getOrCreateSessionId, hasAnalyticsConsent } from './config';
import { log } from '@/utils/logger';

interface AnalyticsEvent {
    event: string;
    properties?: Record<string, unknown>;
    timestamp?: Date;
}

/** Allowed in the CSP's script-src (next.config.js); change both together. */
export const CLOUDFLARE_BEACON_SRC = 'https://static.cloudflareinsights.com/beacon.min.js';

class AnalyticsProvider {
    private isInitialized = false;
    private eventQueue: AnalyticsEvent[] = [];

    /**
     * Initialize analytics providers
     */
    async initialize() {
        if (this.isInitialized) {
            return;
        }

        // Check if tracking is allowed
        if (!shouldTrackAnalytics() || !hasAnalyticsConsent()) {
            log.info('Analytics tracking disabled', undefined, 'Analytics');
            return;
        }

        try {
            // Initialize Cloudflare Web Analytics
            if (defaultAnalyticsConfig.providers.cloudflare?.enabled) {
                this.initializeCloudflare();
            }

            // Initialize Plausible
            if (defaultAnalyticsConfig.providers.plausible?.enabled) {
                await this.initializePlausible();
            }

            // Initialize Mixpanel
            if (defaultAnalyticsConfig.providers.mixpanel?.enabled) {
                await this.initializeMixpanel();
            }

            // Initialize custom events endpoint
            if (defaultAnalyticsConfig.providers.customEvents?.enabled) {
                await this.initializeCustomEvents();
            }

            this.isInitialized = true;

            // Flush any queued events
            this.flushQueue();

            log.info('Analytics providers initialized', undefined, 'Analytics');
        } catch (error) {
            log.error('Failed to initialize analytics', error, 'Analytics');
        }
    }

    /**
     * Track an event
     */
    track(event: string, properties?: Record<string, unknown>) {
        // Check if tracking is allowed
        if (!shouldTrackAnalytics() || !hasAnalyticsConsent()) {
            return;
        }

        // Anonymize sensitive data
        const anonymizedProperties = properties ? anonymizeEventData(properties) : {};

        // Add session ID
        anonymizedProperties.sessionId = getOrCreateSessionId();
        anonymizedProperties.timestamp = new Date().toISOString();

        const analyticsEvent: AnalyticsEvent = {
            event,
            properties: anonymizedProperties,
            timestamp: new Date(),
        };

        // If not initialized, queue the event
        if (!this.isInitialized) {
            this.eventQueue.push(analyticsEvent);
            return;
        }

        // Send to all enabled providers
        this.sendToProviders(analyticsEvent);
    }

    /**
     * Track a page view
     */
    pageView(page: string, properties?: Record<string, unknown>) {
        this.track('page_view', {
            page,
            ...properties,
        });
    }

    /**
     * Identify a user (anonymously)
     */
    identify(userId: string, traits?: Record<string, unknown>) {
        // Don't send actual user ID, use hashed version
        const hashedUserId = this.hashUserId(userId);

        this.track('user_identified', {
            userId: hashedUserId,
            ...traits,
        });
    }

    /**
     * Load the Cloudflare Web Analytics beacon. It counts page views (with `spa`,
     * in-app navigations too) and Core Web Vitals by itself, and takes no custom
     * events, so `track` sends nothing to it. Not awaited: the beacon need not
     * block the app. Once loaded it cannot be unloaded; withdrawing consent in
     * Settings reloads the page to stop it.
     */
    private initializeCloudflare() {
        const { token } = defaultAnalyticsConfig.providers.cloudflare!;
        if (typeof document === 'undefined' || document.querySelector('script[data-cf-beacon]')) {
            return;
        }
        const script = document.createElement('script');
        script.defer = true;
        script.src = CLOUDFLARE_BEACON_SRC;
        script.dataset.cfBeacon = JSON.stringify({ token, spa: true });
        document.head.appendChild(script);
    }

    /**
     * Initialize Plausible Analytics
     */
    private async initializePlausible() {
        const config = defaultAnalyticsConfig.providers.plausible!;

        if (typeof window !== 'undefined' && !window.plausible) {
            const script = document.createElement('script');
            script.defer = true;
            script.dataset.domain = config.domain;
            script.src = config.apiHost
                ? `${config.apiHost}/js/script.js`
                : 'https://plausible.io/js/script.js';

            document.head.appendChild(script);

            // Wait for script to load
            await new Promise(resolve => {
                script.onload = resolve;
            });
        }
    }

    /**
     * Initialize Mixpanel
     */
    private async initializeMixpanel() {
        const config = defaultAnalyticsConfig.providers.mixpanel!;

        if (typeof window !== 'undefined' && !window.mixpanel) {
            // Load Mixpanel library
            const script = document.createElement('script');
            script.src = 'https://cdn.mxpnl.com/libs/mixpanel-2-latest.min.js';

            document.head.appendChild(script);

            await new Promise(resolve => {
                script.onload = () => {
                    window.mixpanel?.init?.(config.token, {
                        debug: defaultAnalyticsConfig.debug,
                        track_pageview: false, // We'll track manually
                        persistence: 'localStorage',
                        ip: !defaultAnalyticsConfig.privacy.anonymizeIPs,
                    });
                    resolve(true);
                };
            });
        }
    }

    /**
     * Initialize custom events endpoint
     */
    private async initializeCustomEvents() {
        // No initialization needed for custom endpoint
        log.info('Custom events endpoint configured', undefined, 'Analytics');
    }

    /**
     * Send event to all providers
     */
    private sendToProviders(event: AnalyticsEvent) {
        // Plausible
        if (defaultAnalyticsConfig.providers.plausible?.enabled && window.plausible) {
            try {
                window.plausible(event.event, { props: event.properties as Record<string, string | number | boolean | undefined> });
            } catch (error) {
                log.error('Failed to send to Plausible', error, 'Analytics');
            }
        }

        // Mixpanel
        if (defaultAnalyticsConfig.providers.mixpanel?.enabled && window.mixpanel) {
            try {
                window.mixpanel.track?.(event.event, event.properties);
            } catch (error) {
                log.error('Failed to send to Mixpanel', error, 'Analytics');
            }
        }

        // Custom endpoint
        if (defaultAnalyticsConfig.providers.customEvents?.enabled) {
            try {
                this.sendToCustomEndpoint(event);
            } catch (error) {
                log.error('Failed to send to custom endpoint', error, 'Analytics');
            }
        }

        // Debug logging
        if (defaultAnalyticsConfig.debug) {
            log.debug('Analytics event tracked', event, 'Analytics');
        }
    }

    /**
     * Send event to custom endpoint
     */
    private async sendToCustomEndpoint(event: AnalyticsEvent) {
        const endpoint = defaultAnalyticsConfig.providers.customEvents!.endpoint;

        await fetch(endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(event),
        });
    }

    /**
     * Flush queued events
     */
    private flushQueue() {
        while (this.eventQueue.length > 0) {
            const event = this.eventQueue.shift()!;
            this.sendToProviders(event);
        }
    }

    /**
     * Hash user ID for privacy
     */
    private hashUserId(userId: string): string {
        // Simple hash function (in production, use a proper hashing algorithm)
        let hash = 0;
        for (let i = 0; i < userId.length; i++) {
            const char = userId.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // Convert to 32bit integer
        }
        return `user_${Math.abs(hash).toString(36)}`;
    }
}

// Singleton instance
export const analyticsProvider = new AnalyticsProvider();

// Global type declarations
declare global {
    interface Window {
        plausible?: (event: string, options?: { props?: Record<string, string | number | boolean | undefined> }) => void;
        mixpanel?: Record<string, unknown> & { track?: (event: string, props?: Record<string, unknown>) => void; init?: (token: string, config?: Record<string, unknown>) => void };
    }
}
