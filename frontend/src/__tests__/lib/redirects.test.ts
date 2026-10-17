/**
 * Routes that were folded into another page keep answering, as redirects.
 *
 * They are served from next.config.js rather than from a page that navigates
 * on mount, so nothing renders first. Deleting an entry here would turn an old
 * link or bookmark into a 404 with no test noticing — the page it replaced is
 * already gone.
 */

// next.config.js is CommonJS and has no types.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const nextConfig = require('../../../next.config.js');

describe('next.config redirects', () => {
  it.each([
    ['/profile', '/settings'],
    ['/compare', '/savings?tab=compare'],
  ])('%s → %s', async (source, destination) => {
    const redirects: Array<{ source: string; destination: string; permanent: boolean }> =
      await nextConfig.redirects();

    expect(redirects).toContainEqual({ source, destination, permanent: false });
  });
});
