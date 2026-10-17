import { CHANGELOG, CURRENT_VERSION } from '@/data/changelog';

/**
 * The What's New modal opens when a user's last-seen version differs from
 * CURRENT_VERSION, which is simply the first entry. An entry added anywhere but
 * the top would notify nobody, or re-notify everyone with an old release.
 */
describe('changelog', () => {
    it('lists releases newest first, so the newest is the one users are told about', () => {
        const versions = CHANGELOG.map((entry) => entry.version);
        expect(versions).toEqual([...versions].sort().reverse());
        expect(new Set(versions).size).toBe(versions.length);
        expect(CURRENT_VERSION).toBe(versions[0]);
    });

    it('says every title and highlight in both languages', () => {
        for (const entry of CHANGELOG) {
            expect(entry.title.zh && entry.title.en).toBeTruthy();
            expect(entry.highlights.length).toBeGreaterThan(0);
            for (const { emoji, text } of entry.highlights) {
                expect(emoji).toBeTruthy();
                expect(text.zh.trim()).not.toBe('');
                expect(text.en.trim()).not.toBe('');
            }
        }
    });
});
