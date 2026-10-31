/**
 * Analytics Provider Configuration
 * Privacy-compliant analytics setup for Aspiro
 */

interface AnalyticsConfig {
    enabled: boolean;
    debug: boolean;
    providers: {
        cloudflare?: {
            enabled: boolean;
            token: string;
        };
        plausible?: {
            enabled: boolean;
            domain: string;
            apiHost?: string;
        };
        mixpanel?: {
            enabled: boolean;
            token: string;
        };
        customEvents?: {
            enabled: boolean;
            endpoint: string;
        };
    };
    privacy: {
        respectDoNotTrack: boolean;
        anonymizeIPs: boolean;
        cookieConsent: boolean;
        dataRetentionDays: number;
    };
    sampling?: {
        enabled: boolean;
        rate: number; // 0.0 to 1.0
    };
}

// NEXT_PUBLIC_* are inlined at build time, so each must be read by its literal name.
const cloudflareToken = process.env.NEXT_PUBLIC_CF_ANALYTICS_TOKEN || '';
const anyProviderConfigured = !!(
    cloudflareToken ||
    process.env.NEXT_PUBLIC_PLAUSIBLE_DOMAIN ||
    process.env.NEXT_PUBLIC_MIXPANEL_TOKEN ||
    process.env.NEXT_PUBLIC_ANALYTICS_ENDPOINT
);

// Default configuration
export const defaultAnalyticsConfig: AnalyticsConfig = {
    // On once a provider is configured (still only with the visitor's consent);
    // NEXT_PUBLIC_ANALYTICS_ENABLED=false switches it off regardless. With no
    // provider there is nothing to send, so there is nothing to ask consent for.
    enabled: anyProviderConfigured && process.env.NEXT_PUBLIC_ANALYTICS_ENABLED !== 'false',
    debug: process.env.NODE_ENV === 'development',
    providers: {
        // Cloudflare Web Analytics: cookieless, page views and Core Web Vitals.
        // The token is the one in the site's JS snippet in the Cloudflare dashboard.
        cloudflare: {
            enabled: !!cloudflareToken,
            token: cloudflareToken,
        },
        plausible: {
            enabled: !!process.env.NEXT_PUBLIC_PLAUSIBLE_DOMAIN,
            domain: process.env.NEXT_PUBLIC_PLAUSIBLE_DOMAIN || '',
            apiHost: process.env.NEXT_PUBLIC_PLAUSIBLE_API_HOST,
        },
        mixpanel: {
            enabled: !!process.env.NEXT_PUBLIC_MIXPANEL_TOKEN,
            token: process.env.NEXT_PUBLIC_MIXPANEL_TOKEN || '',
        },
        customEvents: {
            enabled: !!process.env.NEXT_PUBLIC_ANALYTICS_ENDPOINT,
            endpoint: process.env.NEXT_PUBLIC_ANALYTICS_ENDPOINT || '',
        },
    },
    privacy: {
        respectDoNotTrack: true,
        anonymizeIPs: true,
        cookieConsent: true,
        dataRetentionDays: 365,
    },
    sampling: {
        enabled: false,
        rate: 1.0, // Track 100% of events by default
    },
};

/**
 * Whether analytics can run here at all, consent aside: a provider is configured,
 * this is a browser, and Do Not Track is off. The consent banner and the Settings
 * switch show only when this is true; asking otherwise would be for nothing.
 */
export function isAnalyticsAvailable(): boolean {
    // Guard: must be in a browser context
    if (typeof window === 'undefined' || typeof navigator === 'undefined') {
        return false;
    }

    // Check Do Not Track browser setting
    if (defaultAnalyticsConfig.privacy.respectDoNotTrack) {
        const dnt =
            navigator.doNotTrack ||
            (navigator as Navigator & { msDoNotTrack?: string }).msDoNotTrack;
        if (dnt === '1' || dnt === 'yes') {
            return false;
        }
    }

    return defaultAnalyticsConfig.enabled;
}

// Check if analytics should be enabled
export function shouldTrackAnalytics(): boolean {
    if (!isAnalyticsAvailable()) {
        return false;
    }

    // Check sampling rate
    if (defaultAnalyticsConfig.sampling?.enabled) {
        return Math.random() < (defaultAnalyticsConfig.sampling.rate || 1.0);
    }

    return true;
}

// Anonymize sensitive data
export function anonymizeEventData(data: Record<string, unknown>): Record<string, unknown> {
    const anonymized = { ...data };

    // Remove or anonymize PII and sensitive financial fields
    const sensitiveFields = [
        'email', 'userId', 'user_id', 'amount', 'balance', 'accountNumber',
        'account_number', 'name', 'fullName', 'full_name', 'displayName',
        'display_name', 'username', 'phone', 'phoneNumber', 'phone_number',
        'address', 'ip', 'ipAddress', 'ip_address',
    ];

    sensitiveFields.forEach(field => {
        if (field in anonymized) {
            delete anonymized[field];
        }
    });

    // Convert specific amounts to ranges
    if (data.amount !== undefined) {
        anonymized.amountRange = getAmountRange(data.amount as number);
    }

    return anonymized;
}

// Convert amounts to privacy-safe ranges
function getAmountRange(amount: number): string {
    if (amount < 100) return '0-100';
    if (amount < 500) return '100-500';
    if (amount < 1000) return '500-1k';
    if (amount < 5000) return '1k-5k';
    if (amount < 10000) return '5k-10k';
    if (amount < 50000) return '10k-50k';
    if (amount < 100000) return '50k-100k';
    return '100k+';
}

// Session management
export function getOrCreateSessionId(): string {
    const sessionKey = 'aspiro_session_id';
    let sessionId = sessionStorage.getItem(sessionKey);

    if (!sessionId) {
        // getRandomValues, not randomUUID: the latter needs a secure context, and a
        // self-hosted instance may be opened over plain http on the LAN.
        const random = Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) =>
            b.toString(16).padStart(2, '0'),
        ).join('');
        sessionId = `session_${Date.now()}_${random}`;
        sessionStorage.setItem(sessionKey, sessionId);
    }

    return sessionId;
}

// User consent management
export function hasAnalyticsConsent(): boolean {
    const consentKey = 'aspiro_analytics_consent';
    const consent = localStorage.getItem(consentKey);

    // If consent is required but not given, return false
    if (defaultAnalyticsConfig.privacy.cookieConsent && !consent) {
        return false;
    }

    return consent === 'granted';
}

export function setAnalyticsConsent(granted: boolean): void {
    const consentKey = 'aspiro_analytics_consent';
    localStorage.setItem(consentKey, granted ? 'granted' : 'denied');

    // If consent is withdrawn, clear any stored analytics data
    if (!granted) {
        sessionStorage.removeItem('aspiro_session_id');
    }

    // Same-tab notice (the `storage` event fires only in other tabs), so a banner
    // still on screen steps aside once the choice is made in Settings.
    window.dispatchEvent(new Event(ANALYTICS_CONSENT_EVENT));
}

export const ANALYTICS_CONSENT_EVENT = 'aspiro:analytics-consent';
