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

for (const { width, columns } of [
  { width: 1280, columns: 1 }, // filter panel open: the list is ~630px (lg:grid-cols-2 fails here)
  { width: 1520, columns: 2 }, // list ~870px, below 2xl (2xl:grid-cols-2 fails here)
  { width: 1920, columns: 2 },
]) {
  test(`at ${width}px the day grid shows ${columns} column(s) of unclipped cards`, async ({ browser, baseURL }) => {
    const context = await browser.newContext({ viewport: { width, height: 900 }, timezoneId: 'Asia/Taipei' });
    await context.addInitScript(() => {
      localStorage.setItem('aspiro-language', 'en');
      localStorage.setItem('aspiro-tour', JSON.stringify({ prompted: true, done: [] }));
    });
    await context.addCookies([{ name: 'demo-mode', value: 'true', url: baseURL ?? 'http://localhost:3000' }]);
    const page = await context.newPage();

    await page.goto('/transactions');
    const grid = page.locator('[class*="auto-fill"]').first();
    await expect(grid).toBeVisible({ timeout: 60_000 });

    const layout = await grid.evaluate((el) => ({
      columns: getComputedStyle(el).gridTemplateColumns.split(' ').length,
      cardWidths: [...el.children].map((c) => c.getBoundingClientRect().width),
    }));
    expect(layout.columns).toBe(columns);
    for (const w of layout.cardWidths) expect(w).toBeGreaterThanOrEqual(CARD_FLOOR);

    // No description on the page is cut off.
    const clipped = await page
      .locator('[class*="auto-fill"] p.truncate')
      .evaluateAll((els) => els.filter((e) => e.scrollWidth > e.clientWidth).map((e) => e.textContent));
    expect(clipped).toEqual([]);

    await context.close();
  });
}
