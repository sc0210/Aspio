/**
 * A ratchet: these files have had their strings extracted, and must stay that way.
 *
 * The defect this guards against is not "untranslated" — it is a screen that
 * speaks one language while the reader chose the other. These files each held
 * their text in Chinese, so an English reader met 買入總額, 可動用資金 and
 * 確認賣出 in the middle of an English UI. Nothing failed; it simply rendered.
 *
 * A CJK character reappearing in one of them means a string went in by hand
 * again. Add files to the list as they are converted — the list only grows.
 */

import fs from 'fs';
import path from 'path';

const SRC = path.join(__dirname, '../..');

const TRANSLATED = [
    'components/dashboard/AssetAllocationCard.tsx',
    'components/dashboard/FXTrackerCard.tsx',
    'components/dashboard/RebalancingPlanCard.tsx',
    'components/dashboard/WhatIfSimulator.tsx',
    'components/portfolio/AssetTrendChart.tsx',
    'components/portfolio/BuyHoldingModal.tsx',
    'components/portfolio/SellHoldingModal.tsx',
    'components/portfolio/WalletManagementModal.tsx',
    'components/transactions/ExpenseGroupSummary.tsx',
    'components/ui/LoadingOverlay.tsx',
    'app/rebalancing/page.tsx',
];

const CJK = /[一-鿿]/;

describe('translated components hold no literal text', () => {
    it.each(TRANSLATED)('%s', (file) => {
        const lines = fs.readFileSync(path.join(SRC, file), 'utf8').split('\n');
        const offenders = lines
            .map((line, i) => ({ line: i + 1, text: line.trim() }))
            .filter(({ text }) => CJK.test(text));

        expect(offenders).toEqual([]);
    });
});
