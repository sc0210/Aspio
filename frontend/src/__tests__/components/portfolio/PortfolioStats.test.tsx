/**
 * What the portfolio page puts in front of you before you have asked anything.
 *
 * These nine figures used to share a carousel four wide, so which five you
 * could not see depended on your window width and which arrow you had last
 * pressed — and nothing on screen said anything was off to the right. The
 * split asserted here is the point of that change: three figures are read
 * every visit, and the rest are a question you ask occasionally.
 */

import React from 'react';
import { render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import i18next from 'i18next';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import en from '@/locales/en/portfolio.json';
import { PortfolioStats } from '@/components/portfolio/PortfolioStats';

jest.mock('@/contexts/SidebarContext', () => ({
    useSidebar: () => ({ sidebarCollapsed: false }),
}));

const i18n = i18next.createInstance();
i18n.use(initReactI18next).init({
    lng: 'en',
    fallbackLng: 'en',
    ns: ['portfolio'],
    defaultNS: 'portfolio',
    resources: { en: { portfolio: en } },
    interpolation: { escapeValue: false },
    react: { useSuspense: false },
});

const portfolio = {
    totalValue: 2_000_000,
    totalCost: 1_925_000,
    totalGainLoss: 75_000,
    gainLossPercentage: 3.9,
    currency: 'TWD',
    lastUpdated: new Date('2026-09-10T00:00:00Z'),
    todayGainLoss: 1_200,
    todayGainLossPercentage: 0.06,
};

const performance = {
    oneDay: 0.06,
    oneWeek: 0.4,
    oneMonth: 1.2,
    threeMonths: 3.1,
    sixMonths: 5.2,
    oneYear: 9.8,
};

/** Everything the analysis disclosure can hold, so it renders in full. */
const analysis = {
    riskMetrics: {
        sharpeRatio: 1.4,
        beta: 0.92,
        cagr: 8.1,
        maxDrawdown: 12.3,
        annualizedVolatility: 14.7,
        alpha: 1.8,
        benchmarkSymbol: 'SPY',
    },
    dividendIncome: {
        projectedAnnual: 42_000,
        yieldOnCost: 2.18,
        yieldOnValue: 2.1,
        currency: 'TWD',
    },
    realizedPnl: { realizedGainLoss: 18_000, realizedCount: 3, currency: 'TWD' },
};

const show = (props: Partial<React.ComponentProps<typeof PortfolioStats>> = {}) =>
    render(
        <I18nextProvider i18n={i18n}>
            <PortfolioStats
                portfolio={portfolio}
                performance={performance}
                isValueVisible
                {...props}
            />
        </I18nextProvider>,
    );

describe('PortfolioStats', () => {
    it('puts the three figures read every visit on the page itself', () => {
        show(analysis);

        expect(screen.getByText('NT$2,000,000')).toBeInTheDocument();
        expect(screen.getByText('+NT$75,000')).toBeInTheDocument();
        expect(screen.getByText('+NT$1,200')).toBeInTheDocument();
    });

    it('keeps the analysis closed until it is asked for', () => {
        const { container } = show(analysis);
        const details = container.querySelector('details');

        expect(details).toBeInTheDocument();
        expect(details).not.toHaveAttribute('open');
        // Labelled, unlike the carousel's arrows: a reader can tell what is in
        // there without opening it.
        expect(within(details!).getByText('Analysis')).toBeInTheDocument();
    });

    it('puts every occasional figure inside it', () => {
        const { container } = show(analysis);
        const details = container.querySelector('details')!;

        for (const label of ['Sharpe', 'Beta', 'Annual return', 'Max DD', 'Volatility']) {
            // getAllBy: each label also appears in its card's tooltip copy.
            expect(within(details).getAllByText(label, { exact: false }).length).toBeGreaterThan(0);
        }
        // Realised gains and dividend income live there too.
        expect(within(details).getByText('+NT$18,000')).toBeInTheDocument();
        expect(within(details).getByText('NT$42,000')).toBeInTheDocument();
    });

    it('does not offer an empty disclosure', () => {
        // A new account has no risk metrics, no dividends and nothing sold —
        // an "Analysis" row that opens onto nothing is worse than no row.
        const { container } = show();
        expect(container.querySelector('details')).not.toBeInTheDocument();
    });

    it('drops the analysis a new account cannot answer, and keeps the rest', () => {
        const { container } = show({ realizedPnl: analysis.realizedPnl });
        const details = container.querySelector('details')!;

        expect(details).toBeInTheDocument();
        expect(within(details).getByText('+NT$18,000')).toBeInTheDocument();
        expect(within(details).queryAllByText('Sharpe', { exact: false })).toHaveLength(0);
    });

    it('masks every figure under privacy mode, on the page and behind the disclosure', () => {
        const { container } = show({ ...analysis, isValueVisible: false });

        expect(screen.queryByText('NT$2,000,000')).not.toBeInTheDocument();
        expect(container.querySelector('details')).toBeInTheDocument();
        expect(screen.getAllByText('•••••••').length).toBeGreaterThan(0);
    });
});
