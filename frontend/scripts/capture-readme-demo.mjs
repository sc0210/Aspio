#!/usr/bin/env node
/**
 * Records the animated walkthrough at the top of the root README.
 *
 *   node scripts/capture-readme-demo.mjs [baseUrl]   # default http://localhost:3000
 *
 * Drives a short tour of the app in demo mode (the `demo-mode` cookie, fixture data, never a real
 * account), records it in light and dark at the full 1440×900 viewport and encodes each with ffmpeg, to
 * docs/images/demo.gif and docs/images/demo-dark.gif; the README serves whichever matches the
 * reader's GitHub theme.
 * Needs a running frontend and ffmpeg on PATH. Re-run it when the pages in the tour change enough
 * that the GIF no longer matches the screenshots below it.
 *
 * A screen recording has no mouse pointer, so the tour draws its own and moves it before each
 * click; a reader can then follow where the next page came from.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const here = dirname(fileURLToPath(import.meta.url));
const IMAGES = resolve(here, '../../docs/images');
const THEMES = ['light', 'dark'];
const gifName = (theme) => (theme === 'dark' ? 'demo-dark.gif' : 'demo.gif');
const BASE_URL = process.argv.slice(2).find((a) => !a.startsWith('--')) ?? 'http://localhost:3000';
const VIEWPORT = { width: 1440, height: 900 };
const GIF_FPS = 12;

// Pages the tour visits, also compiled once up front so the recording never shows a cold
// dev-server compile.
const TOUR_PATHS = ['/dashboard', '/transactions', '/portfolio', '/rebalancing', '/goals', '/review'];

// Same chrome the screenshot script hides, plus the pointer drawn for the video.
const PAGE_CSS = `
  nextjs-portal { display: none !important; }
  [role="banner"].bg-primary-50 { display: none !important; }
  #demo-cursor {
    position: fixed; z-index: 2147483647; pointer-events: none; width: 22px; height: 22px;
    margin: -11px 0 0 -11px; border-radius: 50%; background: rgba(15, 23, 42, 0.35);
    border: 2px solid #fff; box-shadow: 0 1px 4px rgba(0, 0, 0, 0.4); transition: transform 0.15s;
  }
  #demo-cursor.down { transform: scale(0.7); }
`;

async function newDemoContext(browser, theme, extra = {}) {
  const context = await browser.newContext({ viewport: VIEWPORT, colorScheme: theme, ...extra });
  await context.addCookies([{ name: 'demo-mode', value: 'true', domain: new URL(BASE_URL).hostname, path: '/' }]);
  await context.addInitScript(({ css, theme }) => {
    localStorage.setItem('aspiro-whatsnew-seen', '9999');
    localStorage.setItem('aspiro-language', 'en');
    localStorage.setItem('aspiro_analytics_consent', 'denied');
    localStorage.setItem('aspiro-theme', theme);
    localStorage.setItem(
      'aspiro-nav-sections',
      JSON.stringify({ 'navigation.sections.finance': true, 'navigation.sections.goals_growth': true }),
    );
    // Survives client-side navigation, since the layout never remounts <head>.
    addEventListener('DOMContentLoaded', () => {
      const style = document.createElement('style');
      style.textContent = css;
      document.head.appendChild(style);
      const cursor = document.createElement('div');
      cursor.id = 'demo-cursor';
      cursor.style.left = `${innerWidth / 2}px`;
      cursor.style.top = `${innerHeight / 2}px`;
      document.body.appendChild(cursor);
      addEventListener('mousemove', (e) => {
        cursor.style.left = `${e.clientX}px`;
        cursor.style.top = `${e.clientY}px`;
      });
      addEventListener('mousedown', () => cursor.classList.add('down'));
      addEventListener('mouseup', () => cursor.classList.remove('down'));
    });
  }, { css: PAGE_CSS, theme });
  return context;
}

async function waitForContent(page) {
  await page
    .waitForFunction(() => (document.querySelector('main')?.textContent ?? '').trim().length > 80, null, {
      timeout: 60_000,
    })
    .catch(() => {});
  await page.waitForLoadState('networkidle').catch(() => {});
}

async function warmUp(browser) {
  const context = await newDemoContext(browser, 'light');
  const page = await context.newPage();
  for (const path of TOUR_PATHS) {
    await page.goto(`${BASE_URL}${path}`, { waitUntil: 'networkidle' });
    await waitForContent(page);
  }
  await context.close();
}

/** Glide the pointer onto `locator`, then click it. */
async function clickLike(page, locator) {
  const box = await locator.boundingBox();
  if (!box) throw new Error(`Nothing to click for ${locator}`);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 25 });
  await page.waitForTimeout(250);
  await locator.click();
}

async function scrollMain(page, top) {
  await page.evaluate((y) => document.querySelector('main')?.scrollTo({ top: y, behavior: 'smooth' }), top);
  await page.waitForTimeout(1600);
}

async function visit(page, href, { dwell = 2500, scroll = 0 } = {}) {
  await clickLike(page, page.locator(`nav a[href="${href}"]`).first());
  await page.waitForURL(`**${href}`);
  await waitForContent(page);
  await page.waitForTimeout(dwell);
  if (scroll) {
    await scrollMain(page, scroll);
    await page.waitForTimeout(800);
  }
}

/**
 * Records the tour as lossless PNG frames from Chrome's screencast, not Playwright's video:
 * that video is lossy, so every frame carries compression noise and the GIF can't reuse a single
 * unchanged pixel between frames, which made a full-resolution GIF too big for GitHub. Chrome only
 * sends a frame when something changed; each one is kept with its timestamp so the GIF replays at
 * the real pace.
 */
async function record(browser, frameDir, theme) {
  const context = await newDemoContext(browser, theme);
  const page = await context.newPage();
  await page.goto(`${BASE_URL}/dashboard`, { waitUntil: 'networkidle' });
  await waitForContent(page);
  await page.mouse.move(VIEWPORT.width / 2, VIEWPORT.height / 2);

  const frames = [];
  const cdp = await context.newCDPSession(page);
  cdp.on('Page.screencastFrame', ({ data, metadata, sessionId }) => {
    const file = join(frameDir, `${theme}-${String(frames.length).padStart(5, '0')}.png`);
    writeFileSync(file, Buffer.from(data, 'base64'));
    frames.push({ file, at: metadata.timestamp });
    cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
  });
  await cdp.send('Page.startScreencast', { format: 'png', maxWidth: VIEWPORT.width, maxHeight: VIEWPORT.height });

  await page.waitForTimeout(2500);
  await scrollMain(page, 520);
  await page.waitForTimeout(800);

  await visit(page, '/transactions', { scroll: 400 });
  await visit(page, '/portfolio', { scroll: 450 });
  // Rebalancing has no sidebar row; it is reached from the portfolio page.
  await scrollMain(page, 0);
  const rebalance = page.locator('main a[href="/rebalancing"]').first();
  if (await rebalance.isVisible().catch(() => false)) {
    await clickLike(page, rebalance);
  } else {
    await page.goto(`${BASE_URL}/rebalancing`);
  }
  await page.waitForURL('**/rebalancing');
  await waitForContent(page);
  await page.waitForTimeout(3000);
  await visit(page, '/goals');
  await visit(page, '/review', { dwell: 3000, scroll: 500 });

  await cdp.send('Page.stopScreencast');
  await context.close();
  return frames;
}

function toGif(frames, frameDir, theme, out) {
  // An ffconcat list holds each frame for as long as it stayed on screen.
  const lines = ['ffconcat version 1.0'];
  frames.forEach(({ file, at }, i) => {
    const next = frames[i + 1]?.at ?? at + 1;
    lines.push(`file '${file}'`, `duration ${(next - at).toFixed(3)}`);
  });
  // The concat demuxer ignores the last entry's duration unless the file is listed again.
  lines.push(`file '${frames.at(-1).file}'`);
  const list = join(frameDir, `${theme}.ffconcat`);
  writeFileSync(list, lines.join('\n'));

  const filters =
    `fps=${GIF_FPS},split[a][b];` +
    '[a]palettegen=max_colors=256:stats_mode=diff[p];[b][p]paletteuse=dither=none:diff_mode=rectangle';
  execFileSync(
    'ffmpeg',
    ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', list, '-vf', filters, '-loop', '0', out],
    { stdio: 'inherit' },
  );
}

const frameDir = mkdtempSync(join(tmpdir(), 'aspiro-demo-'));
const browser = await chromium.launch();
try {
  console.log('Warming up pages…');
  await warmUp(browser);
  for (const theme of THEMES) {
    console.log(`Recording ${theme} tour…`);
    const frames = await record(browser, frameDir, theme);
    const out = resolve(IMAGES, gifName(theme));
    toGif(frames, frameDir, theme, out);
    console.log(`  ✓ docs/images/${gifName(theme)} (${(statSync(out).size / 1024 / 1024).toFixed(1)} MB)`);
  }
} finally {
  await browser.close();
  rmSync(frameDir, { recursive: true, force: true });
}
