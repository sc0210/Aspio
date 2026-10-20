#!/usr/bin/env node
/**
 * Records the animated walkthrough at the top of the root README.
 *
 *   node scripts/capture-readme-demo.mjs [baseUrl]   # default http://localhost:3000
 *
 * Drives a short tour of the app in demo mode (the `demo-mode` cookie, fixture data, never a real
 * account), records it in light and dark with Playwright and converts each video with ffmpeg, to
 * docs/images/demo.gif and docs/images/demo-dark.gif; the README serves whichever matches the
 * reader's GitHub theme.
 * Needs a running frontend and ffmpeg on PATH. Re-run it when the pages in the tour change enough
 * that the GIF no longer matches the screenshots below it.
 *
 * Playwright's video has no mouse pointer, so the tour draws its own and moves it before each
 * click; a reader can then follow where the next page came from.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
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
const GIF_WIDTH = 960;
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
      cursor.style.left = `${window.__cursor?.x ?? innerWidth / 2}px`;
      cursor.style.top = `${window.__cursor?.y ?? innerHeight / 2}px`;
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

async function record(browser, videoDir, theme) {
  const context = await newDemoContext(browser, theme, { recordVideo: { dir: videoDir, size: VIEWPORT } });
  const page = await context.newPage();
  const recordingStarted = Date.now();
  await page.goto(`${BASE_URL}/dashboard`, { waitUntil: 'networkidle' });
  await waitForContent(page);
  await page.mouse.move(VIEWPORT.width / 2, VIEWPORT.height / 2);
  // Everything before this point is the blank first load; it is cut from the GIF.
  const trimStart = (Date.now() - recordingStarted) / 1000 + 0.5;
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

  const video = page.video();
  await context.close();
  return { videoPath: await video.path(), trimStart };
}

function toGif(videoPath, trimStart, out) {
  const filters =
    `fps=${GIF_FPS},scale=${GIF_WIDTH}:-1:flags=lanczos,split[a][b];` +
    '[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle';
  execFileSync(
    'ffmpeg',
    ['-y', '-loglevel', 'error', '-ss', trimStart.toFixed(2), '-i', videoPath, '-vf', filters, '-loop', '0', out],
    { stdio: 'inherit' },
  );
}

const videoDir = mkdtempSync(join(tmpdir(), 'aspiro-demo-'));
const browser = await chromium.launch();
try {
  console.log('Warming up pages…');
  await warmUp(browser);
  for (const theme of THEMES) {
    console.log(`Recording ${theme} tour…`);
    const { videoPath, trimStart } = await record(browser, videoDir, theme);
    const out = resolve(IMAGES, gifName(theme));
    toGif(videoPath, trimStart, out);
    console.log(`  ✓ docs/images/${gifName(theme)} (${(statSync(out).size / 1024 / 1024).toFixed(1)} MB)`);
  }
} finally {
  await browser.close();
  rmSync(videoDir, { recursive: true, force: true });
}
