/**
 * The edit page shows the type and sector a holding already has.
 *
 * Its pickers were a drifted copy of the add page's: no REIT, commodity or
 * cash type, and a different sector list. Saving kept the stored value, but the
 * page showed nothing selected for any of those holdings. Both pages now read
 * lib/portfolio/holdingFormOptions, and a stored value outside those lists (a
 * legacy type, a demo or inline-edited sector) is shown as its own choice and
 * saved back as it was, never rewritten.
 */


import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import i18next from 'i18next';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import en from '@/locales/en/portfolio.json';

const push = jest.fn();
// Both objects are hoisted, not rebuilt per call. The page's load effect depends on
// `router`, so a fresh object each render re-runs it and re-resets the form — wiping
// whatever the test just typed. next/navigation's real hooks are stable.
const router = { push };
const params = { id: 'holding-1' };
jest.mock('next/navigation', () => ({
    useRouter: () => router,
    useParams: () => params,
}));

jest.mock('react-hot-toast', () => ({
    __esModule: true,
    default: { success: jest.fn(), error: jest.fn() },
}));

jest.mock('@/hooks/useAppMode', () => ({
    useModeAwareUI: () => ({
        // Shape matters: the page reads .className and .text off this.
        getModeIndicator: () => ({ text: 'Live Data', className: 'bg-green-100' }),
        getModeMessage: () => '',
        getSuccessMessage: (m: string) => m,
        getErrorMessage: (m: string) => m,
        isDemo: false,
    }),
}));

jest.mock('@/components/layout/DashboardLayout', () => ({
    DashboardLayout: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));


let holdingType = 'etf';
let sector = '';
const makeHolding = () => ({
    id: 'holding-1',
    symbol: '0050',
    name: 'Yuanta Taiwan Top 50',
    type: holdingType,
    walletType: 'portfolio',
    quantity: 100,
    averageCost: 100,
    currency: 'TWD',
    exchange: 'TWSE',
    sector,
    purchaseDate: '2026-01-02T00:00:00Z',
});

const getHolding = jest.fn();
const updateHolding = jest.fn();
jest.mock('@/services/portfolioService', () => ({
    portfolioService: {
        getHolding: (...args: unknown[]) => getHolding(...args),
        updateHolding: (...args: unknown[]) => updateHolding(...args),
    },
}));

import EditHoldingPage from '@/app/portfolio/edit/[id]/page';

const i18n = i18next.createInstance();
i18n.use(initReactI18next).init({
    lng: 'en',
    ns: ['portfolio'],
    defaultNS: 'portfolio',
    resources: { en: { portfolio: en } },
    interpolation: { escapeValue: false },
    react: { useSuspense: false },
});

const renderPage = async () => {
    const holding = makeHolding();
    getHolding.mockResolvedValue({ success: true, data: holding });
    updateHolding.mockResolvedValue({ success: true, data: holding });
    const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });

    render(
        <QueryClientProvider client={queryClient}>
            <I18nextProvider i18n={i18n}>
                <EditHoldingPage />
            </I18nextProvider>
        </QueryClientProvider>,
    );

    // The form is populated from a promise in an effect.
    await waitFor(() =>
        expect(screen.getByLabelText(/Investment Name/)).toHaveValue(holding.name),
    );
};


describe('the holding edit page pickers', () => {
    beforeEach(() => {
        getHolding.mockReset();
        updateHolding.mockReset();
    });

    it.each(['reit', 'commodity', 'cash', 'lending', 'cryptocurrency'])('shows a %s holding\'s type as selected', async (type) => {
        holdingType = type;
        sector = '';
        await renderPage();
        const radio = document.querySelector(`input[type="radio"][value="${type}"]`) as HTMLInputElement | null;
        expect(radio).not.toBeNull();
        expect(radio).toBeChecked();
    });

    it.each(['Financial Services', 'Financials', 'Taiwan Market ETF'])('keeps sector %s selected', async (s) => {
        holdingType = 'etf';
        sector = s;
        await renderPage();
        expect(screen.getByLabelText(/Sector/)).toHaveValue(s);
    });

    it('saves a stored type and sector outside the lists back unchanged', async () => {
        holdingType = 'lending';
        sector = 'Taiwan Market ETF';
        await renderPage();
        fireEvent.change(screen.getByLabelText(/Investment Name/), { target: { value: 'Renamed' } });
        fireEvent.click(screen.getByRole('button', { name: /Update Holding/ }));

        await waitFor(() => expect(updateHolding).toHaveBeenCalledTimes(1));
        expect(updateHolding.mock.calls[0][0]).toMatchObject({
            name: 'Renamed',
            type: 'lending',
            sector: 'Taiwan Market ETF',
        });
    });
});
