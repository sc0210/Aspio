/**
 * public/sw.js, run as written against a fake network and cache. Page HTML was
 * stale-while-revalidate: the first visit after a deploy got the previous build's
 * HTML, whose chunks the deploy had deleted, and rendered a blank page.
 */
import fs from 'fs';
import path from 'path';
import vm from 'vm';

type SwEvent = {
  request?: FakeRequest;
  respondWith?: (p: Promise<unknown>) => void;
  waitUntil: (p: Promise<unknown>) => void;
};
type Handler = (event: SwEvent) => void;
interface FakeRequest { url: string; method: string; mode: string; destination: string }

const source = fs.readFileSync(path.join(__dirname, '../../../public/sw.js'), 'utf8');

function boot(
  fetchImpl: (req: FakeRequest) => Promise<unknown>,
  { put, existing = [] }: { put?: (req: FakeRequest, res: unknown) => Promise<void>; existing?: string[] } = {},
) {
  const stored = new Map<string, unknown>();
  const background: Promise<unknown>[] = [];
  const handlers: Record<string, Handler> = {};
  const cache = {
    put: jest.fn(put ?? (async (req: FakeRequest, res: unknown) => { stored.set(req.url, res); })),
    addAll: jest.fn(async () => {}),
  };
  const sandbox = {
    self: {
      location: { origin: 'https://home.aspiro.dev' },
      addEventListener: (type: string, fn: Handler) => { handlers[type] = fn; },
      skipWaiting: () => {}, clients: { claim: () => {} },
    },
    caches: {
      open: async () => cache,
      match: async (req: FakeRequest) => stored.get(req.url),
      keys: async () => existing, delete: jest.fn(async () => true),
    },
    fetch: fetchImpl,
    Response: { error: () => 'network-error' },
    URL, console: { log: () => {} },
  };
  vm.runInNewContext(source, sandbox);

  // Resolves with the response; the background cache writes settle separately.
  const navigate = async (url: string) => {
    let responded: Promise<unknown> | undefined;
    handlers.fetch({
      request: { url, method: 'GET', mode: 'navigate', destination: 'document' },
      respondWith: (p) => { responded = p; },
      waitUntil: (p) => { background.push(p); },
    });
    return responded!;
  };
  const settle = () => Promise.all(background);
  const activate = async () => {
    const work: Promise<unknown>[] = [];
    handlers.activate({ waitUntil: (p) => { work.push(p); } });
    await Promise.all(work);
  };
  return { navigate, settle, activate, stored, cache, caches: sandbox.caches };
}

const page = (build: string) => ({ ok: true, status: 200, build, clone() { return this; } });

it('serves a page from the network even when an older build is cached', async () => {
  let build = 'old';
  const sw = boot(async () => page(build));
  await sw.navigate('https://home.aspiro.dev/rebalancing');   // cached: old
  await sw.settle();
  build = 'new';                                               // a deploy

  const res = await sw.navigate('https://home.aspiro.dev/rebalancing');
  expect(res).toMatchObject({ build: 'new' });
});

it('keeps the latest page as the offline copy and serves it with no network', async () => {
  let online = true;
  const sw = boot(async () => { if (!online) throw new Error('offline'); return page('new'); });
  await sw.navigate('https://home.aspiro.dev/portfolio');
  await sw.settle();
  online = false;

  expect(await sw.navigate('https://home.aspiro.dev/portfolio')).toMatchObject({ build: 'new' });
  expect(await sw.navigate('https://home.aspiro.dev/never-visited')).toBe('network-error');
});

it('does not cache an error page as the offline copy', async () => {
  const sw = boot(async () => ({ ok: false, status: 502, clone() { return this; } }));
  await sw.navigate('https://home.aspiro.dev/goals');
  await sw.settle();
  expect(sw.cache.put).not.toHaveBeenCalled();
});

it('answers before the page is stored, so caching never holds the page back', async () => {
  // cache.put settles only once the whole body is read; a put that never settles
  // stands in for a slow body.
  const sw = boot(async () => page('new'), { put: () => new Promise<void>(() => {}) });
  await expect(sw.navigate('https://home.aspiro.dev/dashboard')).resolves.toMatchObject({ build: 'new' });
});

it('purges the v4 caches the old strategy filled, and keeps its own', async () => {
  const v4 = ['aspiro-fire-tracker-v4', 'aspiro-static-v4', 'aspiro-dynamic-v4'];
  const v5 = ['aspiro-fire-tracker-v5', 'aspiro-static-v5', 'aspiro-dynamic-v5'];
  const sw = boot(async () => page('new'), { existing: [...v4, ...v5] });
  await sw.activate();

  const deleted = (sw.caches.delete as jest.Mock).mock.calls.map(([name]) => name);
  expect(deleted.sort()).toEqual([...v4].sort());
});
