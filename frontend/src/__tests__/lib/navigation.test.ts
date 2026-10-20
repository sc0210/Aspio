/**
 * The rules that keep the sidebar scannable as pages keep being added.
 *
 * Both of these had already broken once by the time they were written: /chat
 * and /groups shared ChatBubbleLeftRightIcon — indistinguishable in the
 * collapsed rail, where the icon is all there is — and two of five sections
 * held a single item each, which is what makes "add a section" the cheapest way
 * to ship a feature.
 */

import { getNavigationItems, getNavigationSections, getSecondaryNavItems, primaryNavItems } from '@/lib/navigation';
import { ALL_FEATURES } from '@/lib/features';
import en from '@/locales/en/common.json';
import zhTW from '@/locales/zh-TW/common.json';

describe('navigation structure', () => {
    // Every combination, since dropping an add-on's row must not leave a
    // heading above a single item.
    it.each([
        ['a reader', false, ALL_FEATURES],
        ['an admin', true, ALL_FEATURES],
        ['a reader without the LINE bot', false, { lineBot: false }],
        ['an admin without the LINE bot', true, { lineBot: false }],
    ])('gives %s 2–5 items in every titled section', (_who, isAdmin, features) => {
        for (const section of getNavigationSections(isAdmin, features)) {
            if (!section.titleKey) {
                // Standalone rows carry no heading, so they are exempt — but a
                // heading-less group of several would be an unlabelled pile.
                expect(section.items).toHaveLength(1);
                continue;
            }
            expect(section.items.length).toBeGreaterThanOrEqual(2);
            expect(section.items.length).toBeLessThanOrEqual(5);
        }
    });

    it('gives every destination its own icon', () => {
        const items = getNavigationItems(true, ALL_FEATURES);
        const outline = items.map((item) => item.icon);
        const solid = items.map((item) => item.iconSolid);

        expect(new Set(outline).size).toBe(items.length);
        expect(new Set(solid).size).toBe(items.length);
    });

    it('lists every destination once', () => {
        const hrefs = getNavigationItems(true, ALL_FEATURES).map((item) => item.href);
        expect(new Set(hrefs).size).toBe(hrefs.length);
    });

    it('gates /groups on the LINE bot, and nothing else on any add-on', () => {
        const on = getNavigationItems(true, ALL_FEATURES).map((i) => i.href);
        const off = getNavigationItems(true, { lineBot: false }).map((i) => i.href);
        expect(on.filter((href) => !off.includes(href))).toEqual(['/groups']);
    });

    it('shows /admin only to admins', () => {
        expect(getNavigationItems(false, ALL_FEATURES).map((i) => i.href)).not.toContain('/admin');
        expect(getNavigationItems(true, ALL_FEATURES).map((i) => i.href)).toContain('/admin');
    });

    it('fills the mobile bar with four tabs and the sheet with the rest', () => {
        // Five tabs is the most a thumb reach affords, and the fifth is More.
        expect(primaryNavItems).toHaveLength(4);
        expect(primaryNavItems.map((i) => i.href)).toEqual([
            '/dashboard', '/transactions', '/portfolio', '/goals',
        ]);

        // Nothing may fall between the two: the hand-written sheet used to omit
        // loans, groups, housing, lifecycle and achievements outright.
        const all = getNavigationItems(false, ALL_FEATURES).map((i) => i.href);
        expect([...primaryNavItems, ...getSecondaryNavItems(ALL_FEATURES)].map((i) => i.href).sort())
            .toEqual([...all].sort());
    });

    it('keeps add-on pages out of the tabs, which are not filtered', () => {
        expect(primaryNavItems.every((i) => !i.feature)).toBe(true);
        expect(getSecondaryNavItems({ lineBot: false }).map((i) => i.href)).not.toContain('/groups');
    });
});

/**
 * Every label the navigation asks for has to exist in both bundles.
 *
 * A route ships in one commit and its translation in another, and nothing
 * downstream complains: `t()` returns the key, so the More sheet renders the
 * literal string "navigation.housing" to a reader.
 */
describe('navigation labels', () => {
    const lookup = (bundle: Record<string, unknown>, key: string) =>
        key
            .replace(/^navigation\./, '')
            .split('.')
            .reduce<unknown>(
                (node, part) => (node as Record<string, unknown> | undefined)?.[part],
                (bundle as { navigation: Record<string, unknown> }).navigation,
            );

    it.each([
        ['en', en as unknown as Record<string, unknown>],
        ['zh-TW', zhTW as unknown as Record<string, unknown>],
    ])('resolves every item and section name in %s', (_locale, bundle) => {
        for (const section of getNavigationSections(true, ALL_FEATURES)) {
            if (section.titleKey) {
                expect(typeof lookup(bundle, section.titleKey)).toBe('string');
            }
            for (const item of section.items) {
                expect(typeof lookup(bundle, item.nameKey)).toBe('string');
            }
        }
    });

    // Both bundles: zh-TW is the one nobody re-reads, so it is where a stale
    // heading would sit unnoticed.
    it.each([
        ['en', en as unknown as { navigation: { sections: Record<string, string> } }],
        ['zh-TW', zhTW as unknown as { navigation: { sections: Record<string, string> } }],
    ])('leaves no orphaned section headings behind in %s', (_locale, bundle) => {
        const used = new Set(
            getNavigationSections(true, ALL_FEATURES)
                .map((section) => section.titleKey?.replace('navigation.sections.', ''))
                .filter(Boolean),
        );
        expect(Object.keys(bundle.navigation.sections).sort()).toEqual([...used].sort());
    });
});
