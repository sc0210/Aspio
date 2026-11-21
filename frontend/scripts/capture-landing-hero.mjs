#!/usr/bin/env node
/**
 * Captures the landing page's hero shots into public/screenshots/:
 * dashboard-{en,zh}.jpg (1440×900) and dashboard-mobile-{en,zh}.jpg (390×844 at 2×).
 *
 *   node scripts/capture-landing-hero.mjs [baseUrl]   # default http://localhost:3000
 *
 * Always in demo mode (the `demo-mode` cookie, no session), so the public page shows fixture
 * data and never a real account. An earlier shot taken signed in greeted the owner by name.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const here = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(here, '../public/screenshots');
const BASE_URL = process.argv[2] ?? 'http://localhost:3000';
const changelog = readFileSync(resolve(here, '../src/data/changelog.ts'), 'utf8');
const LATEST_VERSION = changelog.match(/version:\s*'([^']+)'/)[1];

const LAYOUTS = [
  { file: 'dashboard', options: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 } },
  {
    file: 'dashboard-mobile',
    options: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  },
];
const LANGUAGES = [
  { suffix: 'en', lng: 'en' },
  { suffix: 'zh', lng: 'zh-TW' },
];

const browser = await chromium.launch();
try {
  for (const { file, options } of LAYOUTS) {
    for (const { suffix, lng } of LANGUAGES) {
      const context = await browser.newContext({ ...options, colorScheme: 'light', timezoneId: 'Asia/Taipei' });
      await context.addCookies([{ name: 'demo-mode', value: 'true', domain: new URL(BASE_URL).hostname, path: '/' }]);
      await context.addInitScript(
        ({ version, lng }) => {
          localStorage.setItem('aspiro-whatsnew-seen', version);
          localStorage.setItem('aspiro-language', lng);
          localStorage.setItem('aspiro_analytics_consent', 'denied');
          localStorage.setItem('aspiro-theme', 'light');
          localStorage.setItem('aspiro-tour', JSON.stringify({ prompted: true, done: [] }));
        },
        { version: LATEST_VERSION, lng },
      );
      const page = await context.newPage();
      // A cold dev compile can lose the demo cookie's race with the sign-in guard; retry once.
      for (let attempt = 0; attempt < 2 && !page.url().includes('/dashboard'); attempt++) {
        await page.goto(`${BASE_URL}/dashboard`, { waitUntil: 'networkidle' });
      }
      if (!page.url().includes('/dashboard')) throw new Error(`/dashboard redirected to ${page.url()}`);
      await page.waitForFunction(() => (document.querySelector('main')?.textContent ?? '').trim().length > 80, null, {
        timeout: 60_000,
      });
      await page.waitForTimeout(2500); // chart entry animations
      // Dev overlay and the demo banner are not part of the product being shown.
      await page.addStyleTag({
        content: 'nextjs-portal { display: none !important; } [role="banner"].bg-primary-50 { display: none !important; }',
      });
      const path = resolve(OUT_DIR, `${file}-${suffix}.jpg`);
      await page.screenshot({ path, type: 'jpeg', quality: 85 });
      console.log(`✓ ${path}`);
      await context.close();
    }
  }
} finally {
  await browser.close();
}
