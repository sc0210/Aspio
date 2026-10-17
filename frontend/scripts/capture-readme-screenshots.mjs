#!/usr/bin/env node
/**
 * Captures the page screenshots shown in the root README, one folder per app version.
 *
 *   node scripts/capture-readme-screenshots.mjs [baseUrl]   # default http://localhost:3000
 *   node scripts/capture-readme-screenshots.mjs http://localhost:3010 --version=2026.07 \
 *     --api=http://localhost:8000
 *
 * The version is the newest entry in src/data/changelog.ts. `--version` files the shots under
 * another one instead, for backfilling an older build running at baseUrl; only the newest version
 * repoints the README. The backend's CORS allowlist only admits :3000, so a build on any other
 * port needs `--api=<backend origin>`: its calls are then relayed through Playwright with the
 * CORS headers added. Shots land in
 * docs/images/screenshots/<version>/; other versions' folders are never touched, so the set
 * builds up into a visual history. The script then points the README at the new folder and
 * rewrites docs/images/screenshots/README.md, the index of every version.
 *
 * Pages are captured in demo mode (the `demo-mode` cookie), so they show fixture data and never
 * a real account. Needs a running frontend; the backend is optional.
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const here = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(here, '../..');
const SHOTS_ROOT = resolve(REPO_ROOT, 'docs/images/screenshots');
const README = resolve(REPO_ROOT, 'README.md');
const args = process.argv.slice(2);
const BASE_URL = args.find((a) => !a.startsWith('--')) ?? 'http://localhost:3000';
const flag = (name) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const VERSION_ARG = flag('version');
const API_ORIGIN = flag('api');

// Newest entry first. Its version is also what the What's New modal compares against: the
// modal opens over every page in a fresh context unless the stored value equals it exactly.
const changelog = readFileSync(resolve(here, '../src/data/changelog.ts'), 'utf8');
const RELEASES = [
  ...changelog.matchAll(
    /version:\s*'([^']+)',\s*date:\s*'([^']+)',\s*title:\s*\{[^}]*en:\s*'((?:[^'\\]|\\.)*)'/g,
  ),
].map(([, version, date, title]) => ({ version, date, title: title.replace(/\\'/g, "'") }));
const LATEST_VERSION = RELEASES[0].version;
const CURRENT_VERSION = VERSION_ARG ?? LATEST_VERSION;
const OUT_DIR = resolve(SHOTS_ROOT, CURRENT_VERSION);

const PAGES = [
  { name: 'dashboard', path: '/dashboard', label: 'Dashboard' },
  { name: 'transactions', path: '/transactions', label: 'Transactions' },
  { name: 'portfolio', path: '/portfolio', label: 'Portfolio' },
  { name: 'rebalancing', path: '/rebalancing', label: 'Rebalancing' },
  { name: 'goals', path: '/goals', label: 'Goals' },
  { name: 'review', path: '/review', label: 'Month in Review' },
  { name: 'lifecycle', path: '/lifecycle', label: 'Lifecycle' },
];
const MOBILE_PAGES = [{ name: 'dashboard-mobile', path: '/dashboard', label: 'Mobile dashboard' }];

// Dev-only and demo-only chrome that isn't part of the page being shown.
const HIDE_CHROME_CSS = `
  nextjs-portal { display: none !important; }
  [role="banner"].bg-primary-50 { display: none !important; }
`;

async function capture(browser, pages, contextOptions) {
  const context = await browser.newContext({ ...contextOptions, colorScheme: 'light' });
  const host = new URL(BASE_URL).hostname;
  await context.addCookies([{ name: 'demo-mode', value: 'true', domain: host, path: '/' }]);
  await context.addInitScript((version) => {
    localStorage.setItem('aspiro-whatsnew-seen', version);
    localStorage.setItem('aspiro-language', 'en');
    localStorage.setItem('aspiro_analytics_consent', 'denied');
  }, CURRENT_VERSION);
  if (API_ORIGIN) await relayApiWithCors(context);

  const page = await context.newPage();
  for (const { name, path } of pages) {
    // The demo cookie can lose a race against a page's sign-in guard on a cold compile; the
    // second visit is warm.
    let response;
    for (let attempt = 0; attempt < 2; attempt++) {
      response = await page.goto(`${BASE_URL}${path}`, { waitUntil: 'networkidle' });
      // Let charts finish their entry animation and demo fixtures settle.
      await page.waitForTimeout(2500);
      // A cold dev-server compile can outlast networkidle; wait until the page has content.
      await page
        .waitForFunction(() => (document.querySelector('main')?.textContent ?? '').trim().length > 80, null, {
          timeout: 60_000,
        })
        .catch(() => {});
      if (page.url().includes(path)) break;
    }
    await page.addStyleTag({ content: HIDE_CHROME_CSS });
    if (!page.url().includes(path)) {
      console.warn(`  ! ${path} redirected to ${page.url()} — skipped`);
      continue;
    }
    // An older version may not have the page yet.
    if (response?.status() === 404) {
      console.warn(`  ! ${path} does not exist in ${CURRENT_VERSION} — skipped`);
      continue;
    }
    await page.screenshot({ path: resolve(OUT_DIR, `${name}.png`) });
    console.log(`  ✓ ${CURRENT_VERSION}/${name}.png`);
  }
  await context.close();
}

async function relayApiWithCors(context) {
  const pageOrigin = new URL(BASE_URL).origin;
  const cors = {
    'access-control-allow-origin': pageOrigin,
    'access-control-allow-credentials': 'true',
    'access-control-allow-methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'access-control-allow-headers': '*',
  };
  await context.route(`${API_ORIGIN}/**`, async (route) => {
    if (route.request().method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: cors });
      return;
    }
    const response = await route.fetch({ headers: { ...route.request().headers(), origin: 'http://localhost:3000' } });
    await route.fulfill({ response, headers: { ...response.headers(), ...cors } });
  });
}

function pointReadmeAtCurrentVersion() {
  const readme = readFileSync(README, 'utf8');
  writeFileSync(
    README,
    readme.replace(
      /docs\/images\/screenshots\/(?:[^/"]+\/)?([\w-]+\.png)/g,
      `docs/images/screenshots/${CURRENT_VERSION}/$1`,
    ),
  );
}

function writeIndex() {
  const releaseOrder = (version) => {
    const i = RELEASES.findIndex((r) => r.version === version);
    return i === -1 ? Infinity : i;
  };
  // Newest first, in changelog order; a folder the changelog doesn't know sorts last.
  const versions = readdirSync(SHOTS_ROOT, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort((a, b) => releaseOrder(a) - releaseOrder(b) || b.localeCompare(a));

  const sections = versions.map((version) => {
    const release = RELEASES.find((r) => r.version === version);
    const heading = release ? `## ${version} · ${release.date} · ${release.title}` : `## ${version}`;
    const images = [...PAGES, ...MOBILE_PAGES]
      .filter(({ name }) => existsSync(resolve(SHOTS_ROOT, version, `${name}.png`)))
      .map(({ name, label }) => {
        const width = name.endsWith('-mobile') ? 90 : 240;
        return `<a href="${version}/${name}.png"><img src="${version}/${name}.png" alt="${label}, ${version}" width="${width}"></a>`;
      });
    return `${heading}\n\n${images.join('\n')}\n`;
  });

  writeFileSync(
    resolve(SHOTS_ROOT, 'README.md'),
    `# Screenshot history

One folder per app version: the newest entry in \`frontend/src/data/changelog.ts\`, the same
version the What's New modal shows. All captured in demo mode. The root README shows the newest.

Generated by \`frontend/scripts/capture-readme-screenshots.mjs\`. Run it once per release, after
bumping the changelog, and commit the new folder. Don't edit this file by hand.

Versions before 2026.09.2 were backfilled on 2026-09-24. Each one's frontend ran from the commit of
its release, but it ran against the backend of that day, so layout and features match the version
while a few figures may differ from what it showed at the time. A page that did not exist yet is
simply missing from that version.

${sections.join('\n')}`,
  );
}

mkdirSync(OUT_DIR, { recursive: true });
const browser = await chromium.launch();
try {
  // <main> is the scroll container, not window, so fullPage would grab only one viewport;
  // a fixed viewport keeps every shot the same size instead.
  await capture(browser, PAGES, { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  await capture(browser, MOBILE_PAGES, {
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
} finally {
  await browser.close();
}
if (CURRENT_VERSION === LATEST_VERSION) pointReadmeAtCurrentVersion();
writeIndex();
console.log(`Saved ${CURRENT_VERSION}; index at docs/images/screenshots/README.md`);
