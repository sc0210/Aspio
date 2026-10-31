/**
 * Cloudflare Web Analytics: the beacon loads only with a configured token AND the
 * visitor's consent, and never when the browser asks not to be tracked. The token
 * is read when the module loads (Next inlines NEXT_PUBLIC_* at build time), so each
 * case loads a fresh copy of the analytics modules under its own environment.
 */

const ORIGINAL_ENV = process.env;

type Analytics = {
  analyticsProvider: { initialize: () => Promise<void> };
  CLOUDFLARE_BEACON_SRC: string;
  isAnalyticsAvailable: () => boolean;
};

function load(env: Record<string, string | undefined>): Analytics {
  process.env = { ...ORIGINAL_ENV, ...env };
  let mods: Analytics | undefined;
  jest.isolateModules(() => {
    const provider = jest.requireActual('@/lib/analytics/provider');
    const config = jest.requireActual('@/lib/analytics/config');
    mods = {
      analyticsProvider: provider.analyticsProvider,
      CLOUDFLARE_BEACON_SRC: provider.CLOUDFLARE_BEACON_SRC,
      isAnalyticsAvailable: config.isAnalyticsAvailable,
    };
  });
  return mods!;
}

const beacon = () => document.querySelector<HTMLScriptElement>('script[data-cf-beacon]');

function setDoNotTrack(value: string | null) {
  Object.defineProperty(navigator, 'doNotTrack', { value, configurable: true });
}

beforeEach(() => {
  localStorage.clear();
  beacon()?.remove();
  setDoNotTrack(null);
});

afterAll(() => {
  process.env = ORIGINAL_ENV;
});

describe('Cloudflare Web Analytics', () => {
  it('loads the beacon with the token, counting in-app navigation, once consent is given', async () => {
    const { analyticsProvider, CLOUDFLARE_BEACON_SRC } = load({ NEXT_PUBLIC_CF_ANALYTICS_TOKEN: 'abc123' });
    localStorage.setItem('aspiro_analytics_consent', 'granted');

    await analyticsProvider.initialize();

    expect(beacon()?.src).toBe(CLOUDFLARE_BEACON_SRC);
    expect(JSON.parse(beacon()!.dataset.cfBeacon!)).toEqual({ token: 'abc123', spa: true });
  });

  it('loads nothing before the visitor has agreed', async () => {
    const { analyticsProvider } = load({ NEXT_PUBLIC_CF_ANALYTICS_TOKEN: 'abc123' });
    await analyticsProvider.initialize();
    expect(beacon()).toBeNull();
  });

  it('loads nothing when the visitor declined', async () => {
    const { analyticsProvider } = load({ NEXT_PUBLIC_CF_ANALYTICS_TOKEN: 'abc123' });
    localStorage.setItem('aspiro_analytics_consent', 'denied');
    await analyticsProvider.initialize();
    expect(beacon()).toBeNull();
  });

  it('loads nothing, and asks nothing, when the browser sends Do Not Track', async () => {
    const { analyticsProvider, isAnalyticsAvailable } = load({ NEXT_PUBLIC_CF_ANALYTICS_TOKEN: 'abc123' });
    setDoNotTrack('1');
    localStorage.setItem('aspiro_analytics_consent', 'granted');
    expect(isAnalyticsAvailable()).toBe(false);
    await analyticsProvider.initialize();
    expect(beacon()).toBeNull();
  });

  it('is unavailable with no token, so there is no banner to show', () => {
    const { isAnalyticsAvailable } = load({ NEXT_PUBLIC_CF_ANALYTICS_TOKEN: '' });
    expect(isAnalyticsAvailable()).toBe(false);
  });

  it('can be switched off with NEXT_PUBLIC_ANALYTICS_ENABLED=false even with a token', () => {
    const { isAnalyticsAvailable } = load({ NEXT_PUBLIC_CF_ANALYTICS_TOKEN: 'abc123', NEXT_PUBLIC_ANALYTICS_ENABLED: 'false' });
    expect(isAnalyticsAvailable()).toBe(false);
  });
});
