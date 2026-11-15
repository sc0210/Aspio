/**
 * A premium page is hidden in two places: its nav item (`premium: true`) and
 * its route's layout.tsx, which mounts PremiumGate so a typed URL is gated too.
 * Setting the flag without the layout leaves the page open by bookmark; this
 * holds the two together.
 */
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { getNavigationItems } from '@/lib/navigation';
import { ALL_FEATURES } from '@/lib/features';

const APP = join(__dirname, '..', '..', 'app');
const items = getNavigationItems({ isAdmin: true, isPremium: true, features: ALL_FEATURES });

describe('premium routes', () => {
  it.each(items.filter((i) => i.premium).map((i) => i.href))('%s mounts PremiumGate from its layout', (href) => {
    const layout = join(APP, href, 'layout.tsx');
    expect(existsSync(layout)).toBe(true);
    expect(readFileSync(layout, 'utf8')).toContain('<PremiumGate>');
  });

  it.each(items.filter((i) => !i.premium).map((i) => i.href))('%s has no PremiumGate', (href) => {
    const layout = join(APP, href, 'layout.tsx');
    expect(existsSync(layout) && readFileSync(layout, 'utf8').includes('PremiumGate')).toBe(false);
  });
});
