/**
 * The OTHER place a holding's purchase date is edited.
 *
 * `/portfolio/edit/[id]` and the lot editor in HoldingDetailModal both send
 * `purchaseDate`, and both had the same two faults: the date input was prefilled from
 * the UTC day of a stored instant, and the value was re-sent on every save whatever
 * the user had come to change.
 *
 * That only became destructive when the backend started following the date. It
 * re-dates the linked Life Wallet expense to match, comparing business days in
 * Asia/Taipei — so a save that edited nothing but the investment's name could move a
 * purchase stamped 2026-08-31T20:00Z (Sep 1 in Taipei, where its expense was booked)
 * back into August, and take the expense with it. The lot editor was fixed first and
 * this page was left behind, which is the whole reason for testing both.
 *
 * The suite runs pinned to Asia/Taipei (jest.global-setup.js), so the days here are
 * deterministic.
 */

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import i18next from 'i18next';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import en from '@/locales/en/portfolio.json';
import { QUERY_KEYS } from '@/hooks/useDataSynchronization';

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

// 2026-08-31T20:00Z is Sep 1 in Taipei: a stamp whose UTC day and business day fall
// in different months.
const PURCHASE = '2026-08-31T20:00:00Z';

const holding = {
    id: 'holding-1',
    symbol: '0050',
    name: 'Yuanta Taiwan Top 50',
    type: 'etf',
    walletType: 'portfolio',
    quantity: 100,
    averageCost: 100,
    currency: 'TWD',
    exchange: 'TWSE',
    sector: '',
    purchaseDate: PURCHASE,
};

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
    getHolding.mockResolvedValue({ success: true, data: holding });
    updateHolding.mockResolvedValue({ success: true, data: holding });
    const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const invalidated = jest.spyOn(queryClient, 'invalidateQueries');

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
    return { invalidated };
};

const invalidatedKeys = (spy: jest.SpyInstance) =>
    spy.mock.calls.flatMap(([arg]) => {
        const key = (arg as { queryKey?: unknown[] } | undefined)?.queryKey;
        return key ? [String(key[0])] : [];
    });

const save = () => fireEvent.click(screen.getByRole('button', { name: /Update Holding/ }));

describe('the holding edit page and the purchase date', () => {
    beforeEach(() => {
        getHolding.mockReset();
        updateHolding.mockReset();
        push.mockReset();
    });

    it('prefills the local day, not the UTC day', async () => {
        await renderPage();

        // en-CA formats as YYYY-MM-DD, and it is not the code under test — so this
        // expresses "the viewer's day" rather than a day that only holds at the
        // default pin. At Asia/Taipei it is 2026-09-01 against a UTC day of 08-31;
        // under JEST_TZ it follows the override instead of failing.
        const viewersDay = new Intl.DateTimeFormat('en-CA').format(new Date(PURCHASE));
        expect(screen.getByLabelText(/Purchase Date/)).toHaveValue(viewersDay);
        if (!process.env.JEST_TZ) {
            expect(viewersDay).toBe('2026-09-01');
            expect(new Date(PURCHASE).toISOString().slice(0, 10)).toBe('2026-08-31');
        }
    });

    it('sends no purchase date when the user edits only the name', async () => {
        await renderPage();

        fireEvent.change(screen.getByLabelText(/Investment Name/), {
            target: { value: 'Yuanta 0050' },
        });
        save();

        await waitFor(() => expect(updateHolding).toHaveBeenCalledTimes(1));
        const payload = updateHolding.mock.calls[0][0];
        expect(payload.name).toBe('Yuanta 0050');
        // The point of the whole file: an untouched date is not sent, so it cannot be
        // read as a date change and move the Life Wallet expense a month.
        expect(payload).not.toHaveProperty('purchaseDate');
    });

    it('sends the purchase date when the user changes it', async () => {
        await renderPage();

        fireEvent.change(screen.getByLabelText(/Purchase Date/), {
            target: { value: '2026-09-05' },
        });
        save();

        await waitFor(() => expect(updateHolding).toHaveBeenCalledTimes(1));
        expect(updateHolding.mock.calls[0][0].purchaseDate).toBe(
            new Date('2026-09-05').toISOString(),
        );
    });

    it('sends nothing when the user changes the date and puts it back', async () => {
        await renderPage();

        const input = screen.getByLabelText(/Purchase Date/) as HTMLInputElement;
        // Read the prefill rather than restating it: the day depends on the runner's
        // zone, and hardcoding it would make this case fail under
        // `JEST_TZ=America/Los_Angeles`, which is exactly the offset the knob exists
        // to reproduce.
        const original = input.value;
        expect(original).toMatch(/^\d{4}-\d{2}-\d{2}$/);

        fireEvent.change(input, { target: { value: '2026-09-05' } });
        fireEvent.change(input, { target: { value: original } });
        save();

        await waitFor(() => expect(updateHolding).toHaveBeenCalledTimes(1));
        // React Hook Form clears the dirty flag when a field returns to its reset
        // value, and that is the contract being relied on. Tracking dirtiness with a
        // sticky `touched` or a hand-rolled useState would resend the date here, and
        // at another offset that is a date change.
        expect(updateHolding.mock.calls[0][0]).not.toHaveProperty('purchaseDate');
    });

    it('invalidates what a moved ledger leg feeds, not just the portfolio', async () => {
        const { invalidated } = await renderPage();

        fireEvent.change(screen.getByLabelText(/Purchase Date/), {
            target: { value: '2026-09-05' },
        });
        save();

        await waitFor(() => expect(updateHolding).toHaveBeenCalledTimes(1));
        await waitFor(() => {
            const keys = invalidatedKeys(invalidated);
            // The transaction list and the month-in-review reports read the Life
            // Wallet leg this edit just moved. The hand-picked list this replaced had
            // neither, so /review kept showing the old month for the whole staleTime.
            expect(keys).toContain(QUERY_KEYS.TRANSACTIONS);
            expect(keys).toContain(QUERY_KEYS.REVIEW_SPENDING);
            // The four keys whose hand-written calls were deleted, on the claim that
            // the groups already cover them. Asserted rather than just claimed.
            expect(keys).toContain(QUERY_KEYS.PORTFOLIO);
            expect(keys).toContain(QUERY_KEYS.PORTFOLIO_ANALYTICS);
            expect(keys).toContain(QUERY_KEYS.PORTFOLIO_DAILY_PERFORMANCE);
            expect(keys).toContain(QUERY_KEYS.CASH_WALLET);
        });
    });
});
