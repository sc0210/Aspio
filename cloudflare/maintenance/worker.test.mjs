// node --test cloudflare/maintenance/worker.test.mjs   (no dependencies)
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import worker, { isOriginDown, isPageLoad } from './worker.js';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function originReturns(status, body = 'origin body') {
  globalThis.fetch = async () => new Response(body, { status });
}

const page = (path = '/dashboard', headers = {}) =>
  new Request(`https://home.example.com${path}`, {
    headers: { accept: 'text/html,application/xhtml+xml', 'sec-fetch-mode': 'navigate', ...headers },
  });

test('a healthy origin passes through untouched', async () => {
  originReturns(200, 'the app');
  const res = await worker.fetch(page());
  assert.equal(res.status, 200);
  assert.equal(await res.text(), 'the app');
});

test('tunnel down (530) on a page load serves the maintenance page as 503', async () => {
  originReturns(530, 'error code: 1033');
  const res = await worker.fetch(page());
  assert.equal(res.status, 503);
  assert.equal(res.headers.get('retry-after'), '60');
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.equal(res.headers.get('x-aspiro-maintenance'), '530');
  const html = await res.text();
  assert.match(html, /down for maintenance/);
  assert.match(html, /維護中/);
  assert.match(html, /origin status 530/);
});

test('every origin-down status is caught; app errors are not', () => {
  for (const s of [502, 503, 504, 520, 521, 522, 523, 524, 525, 526, 527, 530]) {
    assert.ok(isOriginDown(s), `${s} should count as down`);
  }
  for (const s of [200, 301, 400, 401, 403, 404, 429, 500]) {
    assert.ok(!isOriginDown(s), `${s} is the app answering`);
  }
});

test('a 500 from the app reaches the browser as-is (the app rendered its own error)', async () => {
  originReturns(500, 'app error page');
  const res = await worker.fetch(page());
  assert.equal(res.status, 500);
  assert.equal(await res.text(), 'app error page');
});

test('API calls, the LINE webhook and the uptime probe keep the real status', async () => {
  originReturns(530, 'error code: 1033');
  const cases = [
    new Request('https://home.example.com/api/v1/transactions', { headers: { accept: 'application/json' } }),
    new Request('https://home.example.com/api/v1/line-bot/webhook', { method: 'POST', body: '{}' }),
    new Request('https://home.example.com/api/health'),
    // A browser fetch() that happens to accept HTML is still not a page load under /api/.
    new Request('https://home.example.com/api/auth/session', { headers: { accept: 'text/html,*/*' } }),
    new Request('https://home.example.com/_next/static/chunks/app.js', { headers: { accept: '*/*' } }),
    // The uptime probe: plain curl on the page root. Not under /api/, so only the */* Accept keeps it out.
    new Request('https://home.example.com/', { headers: { accept: '*/*' } }),
  ];
  for (const req of cases) {
    const res = await worker.fetch(req);
    assert.equal(res.status, 530, `${req.method} ${req.url}`);
  }
});

test('non-GET methods are never a page load', () => {
  const post = new Request('https://home.example.com/auth/signin', {
    method: 'POST',
    headers: { accept: 'text/html' },
    body: 'x',
  });
  assert.equal(isPageLoad(post), false);
});

test('HEAD gets the maintenance status with no body', async () => {
  originReturns(530);
  const res = await worker.fetch(new Request('https://home.example.com/', { method: 'HEAD', headers: { accept: 'text/html' } }));
  assert.equal(res.status, 503);
  assert.equal(await res.text(), '');
});

test('a thrown subrequest serves the page on a load, a plain 502 elsewhere', async () => {
  globalThis.fetch = async () => {
    throw new TypeError('network connection lost');
  };
  const res = await worker.fetch(page());
  assert.equal(res.status, 503);
  assert.equal(res.headers.get('x-aspiro-maintenance'), '0');
  const api = await worker.fetch(new Request('https://home.example.com/api/v1/me'));
  assert.equal(api.status, 502);
});
