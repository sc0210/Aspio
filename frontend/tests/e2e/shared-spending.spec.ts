/**
 * Shared spending between two real accounts, end to end: split → accept →
 * pay back → confirm → square.
 *
 * Needs the Docker dev stack (frontend :3000, backend container). Each run asks
 * `backend/scripts/e2e_split_users.py` for two fresh partner accounts (random
 * passwords, wiped ledgers) and locks them again afterwards. Opt-in, and on one
 * project only: parallel projects would reset the same two accounts under each
 * other, and a machine without the stack would just fail.
 *
 *   E2E_SPLITS=1 npx playwright test tests/e2e/shared-spending.spec.ts --project=chromium
 *
 * E2E_BACKEND_CONTAINER names the backend container (default aspiro-backend).
 */
import { execFileSync } from 'node:child_process';
import { test, expect, type Browser, type Page } from '@playwright/test';

interface Account { email: string; password: string; name: string }

const CONTAINER = process.env.E2E_BACKEND_CONTAINER ?? 'aspiro-backend';

function seed(action: 'setup' | 'ledger' | 'teardown'): string {
  return execFileSync('docker', ['exec', '-w', '/app', '-e', 'ASPIRO_E2E=1', CONTAINER,
    'python', 'scripts/e2e_split_users.py', action], { encoding: 'utf8' });
}

/** Signed in, English, What's New already seen: a page ready to use. */
async function signIn(browser: Browser, account: Account): Promise<Page> {
  const context = await browser.newContext({ storageState: undefined });
  await context.addInitScript(() => {
    localStorage.setItem('aspiro-language', 'en');
    localStorage.setItem('aspiro-whatsnew-seen', '9999');
  });
  const page = await context.newPage();
  // Straight to Shared spending: the dashboard's many requests would eat into
  // the per-IP rate limit both accounts share.
  await page.goto(`/auth/signin?callbackUrl=${encodeURIComponent('/savings?tab=splits')}`);
  await page.locator('input[type="email"]').first().fill(account.email);
  await page.locator('input[type="password"]').first().fill(account.password);
  await page.locator('form button[type="submit"]').first().click();
  await page.waitForURL((url) => !url.pathname.startsWith('/auth'), { timeout: 60_000 });
  return page;
}

async function openSharedSpending(page: Page) {
  if (!page.url().includes('tab=splits')) await page.goto('/savings?tab=splits');
  await expect(page.getByRole('tab', { name: 'Shared spending', selected: true })).toBeVisible({ timeout: 60_000 });
}

/**
 * Wait for `text`, reloading if it doesn't come. Both accounts reach the
 * backend through the Next proxy, so they share one per-IP rate limit, and the
 * dev stack's is tight (RATE_LIMIT_BURST=10 per endpoint per 10 s in .env).
 * Writes are POSTs with their own buckets and land; the page's refresh after
 * one can be refused with a 429. Waiting out the burst window and reloading
 * shows what the server holds.
 */
async function see(page: Page, text: string) {
  let first = true;
  await expect(async () => {
    if (!first) await page.reload();
    first = false;
    await expect(page.getByText(text).first()).toBeVisible({ timeout: 5_000 });
  }).toPass({ timeout: 120_000, intervals: [11_000] });
}

test.describe.configure({ mode: 'serial' });

let alice: Account;
let bob: Account;
let seeded = false;

/** The script's one JSON line (the app's startup logs share stdout). */
function json<T>(action: 'setup' | 'ledger'): T {
  const line = seed(action).split('\n').reverse().find((l) => l.startsWith('{'));
  if (!line) throw new Error(`e2e_split_users.py ${action} printed no JSON`);
  return JSON.parse(line) as T;
}

test.beforeAll(({}, testInfo) => {
  test.skip(process.env.E2E_SPLITS !== '1', 'Two-account flow against the Docker stack: opt in with E2E_SPLITS=1');
  test.skip(testInfo.project.name !== 'chromium', 'Runs on chromium only: projects would share the two accounts');
  ({ alice, bob } = json<{ alice: Account; bob: Account }>('setup'));
  seeded = true;
});

test.afterAll(() => {
  if (seeded) seed('teardown');
});

test('split a bill, accept it, pay it back, confirm, and end square', async ({ browser }) => {
  test.setTimeout(600_000);
  const bill = `Dinner ${Date.now()}`;
  const [a, b] = [await signIn(browser, alice), await signIn(browser, bob)];

  // Alice paid 1,000 and splits it 50/50. Nothing is owed until Bob accepts.
  await openSharedSpending(a);
  await a.getByRole('button', { name: 'Split a bill' }).click();
  await a.getByLabel('What was it?').fill(bill);
  await a.getByLabel('Total').fill('1000');
  await a.getByRole('button', { name: 'Split the bill' }).click();
  await see(a, bill);
  await see(a, 'All square');

  // Bob accepts: he owes Alice his half. (His page opened before the bill existed.)
  await see(b, bill);
  const proposal = b.locator('section[aria-label="Waiting for you"]').filter({ hasText: bill });
  await proposal.getByRole('button', { name: 'Accept' }).click();
  await see(b, `You owe ${alice.name} NT$500`);
  await see(a, `${bob.name} owes you NT$500`);

  // Bob pays it back; it counts only once Alice confirms it arrived.
  await b.getByRole('button', { name: 'Settle up' }).click();
  await expect(b.getByLabel(/Amount/)).toHaveValue('500.00');
  await b.getByRole('button', { name: 'Send for confirmation' }).click();
  await see(b, `You paid ${alice.name} NT$500`);
  // Still owed: a repayment counts only once confirmed.
  await expect(b.getByText('Waiting', { exact: true })).toBeVisible();
  await see(b, `You owe ${alice.name} NT$500`);

  await see(a, `${bob.name} says they paid you back NT$500`);
  await a.getByRole('button', { name: 'It arrived' }).click();
  await see(a, 'All square');
  await see(b, 'All square');
  await see(b, `You paid ${alice.name} NT$500`);
  await expect(b.getByText('Confirmed', { exact: true })).toBeVisible();

  // Each ledger holds only its owner's half; paying back added no row to either.
  expect(json<{ alice: number[]; bob: number[] }>('ledger')).toEqual({ alice: [500], bob: [500] });
});
