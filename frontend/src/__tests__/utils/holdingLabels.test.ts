import type { TFunction } from 'i18next';
import { formatAssetTypeLabel, formatSectorLabel } from '@/utils/holdingLabels';

// Echo the fallback, as an untranslated key would render.
const t = ((_key: string, opts?: { defaultValue?: string }) => opts?.defaultValue ?? _key) as unknown as TFunction;
const tr = ((key: string) => ({ 'portfolio:typeBadge.etf': 'ETF', 'portfolio:sectors.broad_market': 'Broad market' } as Record<string, string>)[key] ?? key) as unknown as TFunction;

describe('holding labels', () => {
    it('never renders an ETF as "Etf"', () => {
        expect(formatAssetTypeLabel('etf', tr)).toBe('ETF');
    });

    it('maps an enum-like sector to a human label', () => {
        expect(formatSectorLabel('broad_market', tr)).toBe('Broad market');
        expect(formatSectorLabel('some_new_sector', t)).toBe('Some new sector');
    });

    it("leaves a user's own sector wording alone", () => {
        expect(formatSectorLabel('Taiwan Market ETF', t)).toBe('Taiwan Market ETF');
        expect(formatSectorLabel('', t)).toBe('');
    });
});
