/**
 * The transactions day grid sizes its columns from the list's own width.
 *
 * A viewport breakpoint got both ends wrong: `lg:grid-cols-2` gave ~300px cards
 * beside the filter panel at 1280px (descriptions cut to one character), and
 * `2xl:grid-cols-2` left a wide list one stretched row per line. jsdom applies
 * no layout, so only a real browser can hold this.
 *
 * Demo mode: client fixtures, nothing written, no sign-in needed.
 *   npx playwright test tests/responsive/transaction-grid.spec.ts --project=chromium --no-deps
 */
import { test, expect } from '@playwright/test';

const CARD_FLOOR = 416; // 26rem, the grid's minmax floor
const GAP = 8; // gap-2

// The expected count comes from the measured list width, so a few pixels of padding
// can't flip it; each old rule still fails a width: lg:grid-cols-2 shows 2 at 1280
// (where ~630px fits 1) and 2xl:grid-cols-2 shows 1 at 1520 (where ~870px fits 2).
for (const width of [1280, 1520, 1920]) {
  test(`at ${width}px every day grid fits as many >=416px cards as the list holds`, async ({ browser, baseURL }) => {
    const context = await browser.newContext({ viewport: { width, height: 900 }, timezoneId: 'Asia/Taipei' });
    await context.addInitScript(() => {
      localStorage.setItem('aspiro-language', 'en');
      localStorage.setItem('aspiro-tour', JSON.stringify({ prompted: true, done: [] }));
    });
    await context.addCookies([{ name: 'demo-mode', value: 'true', url: baseURL ?? 'http://localhost:3000' }]);
    const page = await context.newPage();

    await page.goto('/transactions');
    const grids = page.locator('[class*="auto-fill"]');
    await expect(grids.first()).toBeVisible({ timeout: 60_000 });

    const layouts = await grids.evaluateAll((els) =>
      els.map((el) => ({
        listWidth: el.clientWidth,
        template: getComputedStyle(el).gridTemplateColumns,
        cardWidths: [...el.children].map((c) => c.getBoundingClientRect().width),
      })),
    );
    // auto-fill keeps card widths equal across days.
    expect(new Set(layouts.map((l) => l.template)).size).toBe(1);
    for (const { listWidth, template, cardWidths } of layouts) {
      const expected = Math.max(1, Math.floor((listWidth + GAP) / (CARD_FLOOR + GAP)));
      expect(template.split(' ').length).toBe(expected);
      for (const w of cardWidths) expect(w).toBeGreaterThanOrEqual(Math.min(CARD_FLOOR, listWidth));
    }

    // No description on the page is cut off.
    const clipped = await page
      .locator('[class*="auto-fill"] p.truncate')
      .evaluateAll((els) => els.filter((e) => e.scrollWidth > e.clientWidth).map((e) => e.textContent));
    expect(clipped).toEqual([]);

    await context.close();
  });
}
