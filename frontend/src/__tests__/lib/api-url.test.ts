/**
 * Where the backend lives, from the browser's side and from the server's.
 *
 * The browser default is the same-origin path `/api/v1` so ONE prebuilt image
 * works behind any domain; NEXT_PUBLIC_API_URL is an opt-in override. The
 * server must always get an absolute URL — Node's fetch cannot resolve a
 * relative one.
 *
 * This file runs in jsdom (jest.setup.js needs `window`), so the server rules
 * are asserted directly through getServerApiUrl().
 */
import {
  getPublicApiUrl,
  getServerApiUrl,
  getServerBackendOrigin,
  isAbsoluteUrl,
  LOCAL_DEV_API_URL,
  SAME_ORIGIN_API_PATH,
} from '@/lib/api-url';

const ORIGINAL_ENV = process.env;

function setEnv(vars: Record<string, string | undefined>) {
  for (const [key, value] of Object.entries(vars)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

beforeEach(() => {
  process.env = { ...ORIGINAL_ENV };
  setEnv({ NEXT_PUBLIC_API_URL: undefined, INTERNAL_API_URL: undefined, NODE_ENV: 'production' });
});

afterAll(() => {
  process.env = ORIGINAL_ENV;
});

describe('getPublicApiUrl', () => {
  it('defaults to the same-origin path when nothing is configured', () => {
    expect(getPublicApiUrl()).toBe('/api/v1');
    expect(SAME_ORIGIN_API_PATH).toBe('/api/v1');
  });

  it('treats an empty or blank build arg as unset', () => {
    // The Dockerfile's ARG defaults to "" — that must not become a base URL of "".
    setEnv({ NEXT_PUBLIC_API_URL: '' });
    expect(getPublicApiUrl()).toBe('/api/v1');
    setEnv({ NEXT_PUBLIC_API_URL: '   ' });
    expect(getPublicApiUrl()).toBe('/api/v1');
  });

  it('uses NEXT_PUBLIC_API_URL as an override for split deployments', () => {
    setEnv({ NEXT_PUBLIC_API_URL: 'https://api.example.com/api/v1' });
    expect(getPublicApiUrl()).toBe('https://api.example.com/api/v1');
  });

  it('strips a trailing slash so `${base}/path` never doubles it', () => {
    setEnv({ NEXT_PUBLIC_API_URL: 'http://localhost:8000/api/v1/' });
    expect(getPublicApiUrl()).toBe('http://localhost:8000/api/v1');
  });

  it('keeps a bare `next dev` talking to the local backend on :8000', () => {
    setEnv({ NODE_ENV: 'development' });
    expect(getPublicApiUrl()).toBe(LOCAL_DEV_API_URL);
  });

  it('lets the override win in dev too', () => {
    setEnv({ NODE_ENV: 'development', NEXT_PUBLIC_API_URL: 'http://192.168.0.5:8000/api/v1' });
    expect(getPublicApiUrl()).toBe('http://192.168.0.5:8000/api/v1');
  });

  it('never returns the server-only INTERNAL_API_URL', () => {
    setEnv({ INTERNAL_API_URL: 'http://backend:8000/api/v1' });
    expect(getPublicApiUrl()).toBe('/api/v1');
  });
});

describe('getServerApiUrl', () => {
  it('prefers INTERNAL_API_URL (container-to-container)', () => {
    setEnv({
      INTERNAL_API_URL: 'http://backend:8000/api/v1',
      NEXT_PUBLIC_API_URL: 'https://home.example.com/api/v1',
    });
    expect(getServerApiUrl()).toBe('http://backend:8000/api/v1');
  });

  it('falls back to an absolute NEXT_PUBLIC_API_URL', () => {
    setEnv({ NEXT_PUBLIC_API_URL: 'https://api.example.com/api/v1' });
    expect(getServerApiUrl()).toBe('https://api.example.com/api/v1');
  });

  it('ignores a relative NEXT_PUBLIC_API_URL — the server cannot fetch a path', () => {
    setEnv({ NEXT_PUBLIC_API_URL: '/api/v1' });
    expect(getServerApiUrl()).toBe(LOCAL_DEV_API_URL);
  });

  it('defaults to the local backend, never to a relative path', () => {
    expect(getServerApiUrl()).toBe('http://localhost:8000/api/v1');
    expect(isAbsoluteUrl(getServerApiUrl())).toBe(true);
  });

  it('treats an empty INTERNAL_API_URL as unset', () => {
    setEnv({ INTERNAL_API_URL: '' });
    expect(getServerApiUrl()).toBe(LOCAL_DEV_API_URL);
  });
});

describe('getServerBackendOrigin', () => {
  it('drops the /api/v1 suffix to reach root-mounted routes like /health', () => {
    setEnv({ INTERNAL_API_URL: 'http://backend:8000/api/v1' });
    expect(getServerBackendOrigin()).toBe('http://backend:8000');
  });

  it('leaves a URL without the suffix alone', () => {
    setEnv({ INTERNAL_API_URL: 'http://backend:8000' });
    expect(getServerBackendOrigin()).toBe('http://backend:8000');
  });
});

describe('next.config bakes no domain into the image', () => {
  // next.config.js is CommonJS and has no types.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const nextConfig = require('../../../next.config.js');

  it('does not inline an API URL through the env block', () => {
    expect(nextConfig.env ?? {}).not.toHaveProperty('API_BASE_URL');
    expect(nextConfig.env ?? {}).not.toHaveProperty('NEXT_PUBLIC_API_URL');
  });

  it('sends no Access-Control-Allow-Origin in production', async () => {
    // headers() runs at build time; a named origin there would pin the image.
    const rules: Array<{ headers: Array<{ key: string }> }> = await nextConfig.headers();
    const keys = rules.flatMap((rule) => rule.headers.map((h) => h.key));
    expect(keys).not.toContain('Access-Control-Allow-Origin');
  });
});

describe('isAbsoluteUrl', () => {
  it.each([
    ['https://a.b/c', true],
    ['http://localhost:8000', true],
    ['/api/v1', false],
    ['api/v1', false],
    ['', false],
  ])('%s → %s', (url, expected) => {
    expect(isAbsoluteUrl(url)).toBe(expected);
  });
});
