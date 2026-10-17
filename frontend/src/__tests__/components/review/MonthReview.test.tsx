/**
 * The month review's cards, at the level a reader meets them.
 *
 * `lib/review` is already covered arithmetic-first in `lib/review.test.ts`;
 * what these add is the part that arithmetic cannot check — that a rise in
 * spending and a rise in income are not coloured the same, that a figure with
 * no comparison says so instead of showing a full-size gain, and that "no
 * balances recorded" is not what a reader sees while balances are still
 * loading.
 *
 * i18next is initialised for real, from the shipped bundles, rather than
 * stubbed to echo keys: half of what is asserted here is interpolated copy
 * ("Day 10 — the month is still running"), a stub returns the options object
 * for those, and a renamed key should fail a test rather than pass silently.
 */

import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import i18next from 'i18next';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import en from '@/locales/en/common.json';
import { PrivacyProvider } from '@/contexts/PrivacyContext';
import { ChangeChip } from '@/components/review/ChangeChip';
import { MonthPicker } from '@/components/review/MonthPicker';
import { ReviewHero } from '@/components/review/ReviewHero';
import { IncomeBreakdown, SpendingBreakdown } from '@/components/review/SpendingBreakdown';
import { WealthMoveCard } from '@/components/review/WealthMoveCard';
import { GoalsTodayCard } from '@/components/review/GoalsTodayCard';
import { MonthContextCard } from '@/components/review/MonthContextCard';
import { buildMonthContext, buildMonthReview, monthRange, type SpendingLike } from '@/lib/review';
import type { GoalsReport } from '@/services/reportsService';

const i18n = i18next.createInstance();
i18n.use(initReactI18next).init({
    lng: 'en',
    fallbackLng: 'en',
    ns: ['common'],
    defaultNS: 'common',
    resources: { en: { common: en } },
    interpolation: { escapeValue: false },
    react: { useSuspense: false },
});

// PrivacyProvider persists its state, so a test that renders with values
// visible leaves 'visible' in localStorage for the next one — which is how the
// masking test failed while the component was working.
beforeEach(() => localStorage.clear());

function show(ui: React.ReactElement, { visible = true } = {}) {
    return render(
        <I18nextProvider i18n={i18n}>
            <PrivacyProvider defaultVisible={visible}>{ui}</PrivacyProvider>
        </I18nextProvider>,
    );
}

const NOW = new Date(2026, 8, 10, 12); // 10 September 2026, local

const spending = (income: number, categories: Array<[string, number, number?]>): SpendingLike => ({
    totalIncome: income,
    totalExpenses: categories.reduce((sum, [, amount]) => sum + amount, 0),
    categoryBreakdown: categories.map(([category, amount, count]) => ({
        category,
        amount,
        transactionCount: count ?? 1,
    })),
});

describe('ChangeChip', () => {
    // The brand scale, not raw Tailwind colours: `prosperity-*` is this app's
    // green and `error-*` its red. Colour is the only thing distinguishing a
    // welcome rise from an unwelcome one, which is exactly why it is asserted.
    const toneOf = (node: HTMLElement) =>
        node.className.includes('prosperity') ? 'good' : node.className.includes('error') ? 'bad' : 'neutral';

    it('reads a rise as good news for income and bad news for spending', () => {
        const change = { amount: 900, percent: 4 };

        const income = show(<ChangeChip change={change} moreIsBetter />);
        expect(toneOf(income.container.firstChild as HTMLElement)).toBe('good');

        const outgoing = show(<ChangeChip change={change} moreIsBetter={false} />);
        expect(toneOf(outgoing.container.firstChild as HTMLElement)).toBe('bad');
    });

    it('spells the direction out for a reader who cannot see the colour', () => {
        const { container } = show(<ChangeChip change={{ amount: 900, percent: 4 }} moreIsBetter />);
        expect(container.textContent).toContain('up');

        const fell = show(<ChangeChip change={{ amount: -900, percent: -4 }} moreIsBetter />);
        expect(fell.container.textContent).toContain('down');
    });

    it('drops a percentage that rounds away to nothing', () => {
        // NT$6,266 on a NT$2M balance is 0.3%; "(0%)" beside a real amount
        // reads as "no change".
        const { container } = show(<ChangeChip change={{ amount: 6_266, percent: 0.31 }} moreIsBetter />);
        expect(container.textContent).toContain('NT$6,266');
        expect(container.textContent).not.toContain('%');
    });

    it('says flat rather than drawing an arrow at nothing', () => {
        show(<ChangeChip change={{ amount: 0, percent: 0 }} moreIsBetter />);
        expect(screen.getByText('flat')).toBeInTheDocument();
    });

    it('says there is nothing to compare rather than claiming a full-size gain', () => {
        show(<ChangeChip change={{ amount: 10_000, percent: undefined }} moreIsBetter unavailable />);
        // Neutral on purpose: from here, "the account is new" and "last month
        // failed to load" are the same fact, and only one of them is known.
        expect(screen.getByText('no comparison')).toBeInTheDocument();
        expect(screen.queryByText(/NT\$10,000/)).not.toBeInTheDocument();
    });
});

describe('MonthPicker', () => {
    const range = (key: string) => monthRange(key, NOW);

    it('walks back a month', () => {
        const onChange = jest.fn();
        show(<MonthPicker range={range('2026-09')} onChange={onChange} />);

        fireEvent.click(screen.getByRole('button', { name: 'Previous month' }));
        expect(onChange).toHaveBeenCalledWith('2026-08');
    });

    it('refuses to walk into a month that has not happened', () => {
        show(<MonthPicker range={range('2026-09')} onChange={jest.fn()} />);
        expect(screen.getByRole('button', { name: 'Next month' })).toBeDisabled();
    });

    it('still walks forward from a month that is not the latest', () => {
        // The other half of the gate. Without this, a comparison that disabled Next
        // unconditionally would pass every other test in this block — which is what
        // the deleted isFutureMonth unit test used to cover.
        show(<MonthPicker range={range('2026-06')} onChange={jest.fn()} />);
        expect(screen.getByRole('button', { name: 'Next month' })).toBeEnabled();
    });

    it('says how far into a running month the figures go', () => {
        show(<MonthPicker range={range('2026-09')} onChange={jest.fn()} />);
        expect(screen.getByText('Day 10 — the month is still running')).toBeInTheDocument();
    });

    it('offers the way back only from a month that is not this one', () => {
        const { unmount } = show(<MonthPicker range={range('2026-09')} onChange={jest.fn()} />);
        expect(screen.queryByText('Back to this month')).not.toBeInTheDocument();
        unmount();

        const onChange = jest.fn();
        show(<MonthPicker range={range('2026-06')} onChange={onChange} />);
        fireEvent.click(screen.getByText('Back to this month'));
        expect(onChange).toHaveBeenCalledWith('2026-09');
    });
});

describe('ReviewHero', () => {
    const august = monthRange('2026-08', NOW);
    const review = (current: SpendingLike, previous?: SpendingLike) =>
        buildMonthReview(august, current, previous);

    it('leads with what was kept, and how that compares', () => {
        show(
            <ReviewHero
                review={review(
                    spending(80_000, [['Rent', 20_000]]),
                    spending(80_000, [['Rent', 24_000]]),
                )}
            />,
        );

        expect(screen.getByText('NT$60,000')).toBeInTheDocument();
        expect(screen.getByText('kept')).toBeInTheDocument();
        expect(screen.getByText('75% of income kept')).toBeInTheDocument();
        expect(screen.getByText('A strong month.')).toBeInTheDocument();
    });

    it('does not call a month that ate into savings a good one', () => {
        show(<ReviewHero review={review(spending(10_000, [['Rent', 20_000]]))} />);

        expect(screen.getByText('You spent more than you earned.')).toBeInTheDocument();
        expect(screen.getByText('over what came in')).toBeInTheDocument();
    });

    it('refuses to state a savings rate against no income', () => {
        show(<ReviewHero review={review(spending(0, [['Rent', 20_000]]))} />);

        expect(screen.getByText('No income recorded this month')).toBeInTheDocument();
        expect(screen.queryByText(/% of income kept/)).not.toBeInTheDocument();
    });

    it('divides the daily figure by the days that have happened', () => {
        // Ten days into September, not thirty — the same NT$31,000 is NT$3,100
        // a day, not NT$1,033.
        const partial = monthRange('2026-09', NOW);
        show(<ReviewHero review={buildMonthReview(partial, spending(0, [['Food', 31_000, 42]]), undefined)} />);

        expect(screen.getByText('NT$3,100 a day · 42 transactions')).toBeInTheDocument();
    });

    it('names the month the changes are measured against, and only when there is one', () => {
        // The comparison is the whole month before, even while this one is
        // still running, so a part-month change must not read as a full one.
        const { unmount } = show(
            <ReviewHero review={review(spending(80_000, [['Rent', 20_000]]), spending(80_000, [['Rent', 24_000]]))} />,
        );
        expect(screen.getByText('Changes are against July 2026, the whole month')).toBeInTheDocument();
        unmount();

        show(<ReviewHero review={review(spending(80_000, [['Rent', 20_000]]))} />);
        expect(screen.queryByText(/Changes are against/)).not.toBeInTheDocument();
    });

    it('hides the money when privacy mode is on', () => {
        show(<ReviewHero review={review(spending(80_000, [['Rent', 20_000]]))} />, { visible: false });

        expect(screen.queryByText('NT$60,000')).not.toBeInTheDocument();
        expect(screen.getAllByText('•••••').length).toBeGreaterThan(0);
        // The verdict is not a number, so it survives masking — a page of dots
        // with no sentence would say nothing at all.
        expect(screen.getByText('A strong month.')).toBeInTheDocument();
    });
});

describe('SpendingBreakdown', () => {
    const august = monthRange('2026-08', NOW);

    it('names the biggest mover above the list', () => {
        const review = buildMonthReview(
            august,
            spending(80_000, [['Rent', 20_000], ['Food', 12_000]]),
            spending(80_000, [['Rent', 20_000], ['Food', 6_000]]),
        );
        show(<SpendingBreakdown review={review} />);

        expect(screen.getByText(/Food rose the most against last month/)).toBeInTheDocument();
    });

    it('rolls the tail into a total instead of listing everything', () => {
        const categories: Array<[string, number]> = Array.from({ length: 9 }, (_, i) => [
            `Category ${i}`,
            9_000 - i * 100,
        ]);
        const review = buildMonthReview(august, spending(80_000, categories), undefined);
        show(<SpendingBreakdown review={review} />);

        expect(screen.getByRole('list').children).toHaveLength(6);
        expect(screen.getByText('3 more categories')).toBeInTheDocument();
    });

    it('counts one leftover category in the singular', () => {
        const categories: Array<[string, number]> = Array.from({ length: 7 }, (_, i) => [
            `Category ${i}`,
            9_000 - i * 100,
        ]);
        const review = buildMonthReview(august, spending(80_000, categories), undefined);
        show(<SpendingBreakdown review={review} />);

        expect(screen.getByText('1 more category')).toBeInTheDocument();
    });

    it('keeps a category with no spend this month out of the spend list', () => {
        // It is still in the model — a category that stopped is often the
        // month's real story, and the mover line above is where it belongs.
        const review = buildMonthReview(
            august,
            spending(80_000, [['Rent', 20_000]]),
            spending(80_000, [['Rent', 20_000], ['Travel', 30_000]]),
        );
        show(<SpendingBreakdown review={review} />);

        expect(screen.getByRole('list').children).toHaveLength(1);
        expect(screen.getByText(/Travel fell the most against last month/)).toBeInTheDocument();
    });

    it('says so when the month has no spending at all', () => {
        const review = buildMonthReview(august, spending(80_000, []), undefined);
        show(<SpendingBreakdown review={review} />);

        expect(screen.getByText('No spending recorded in this month.')).toBeInTheDocument();
    });
});

describe('IncomeBreakdown', () => {
    const august = monthRange('2026-08', NOW);
    const withIncome = (income: Array<[string, number]>): SpendingLike => ({
        ...spending(income.reduce((sum, [, amount]) => sum + amount, 0), [['Rent', 10_000]]),
        incomeBreakdown: income.map(([category, amount]) => ({ category, amount, transactionCount: 1 })),
    });

    it('shows where the money came from, beneath where it went', () => {
        const review = buildMonthReview(
            august,
            withIncome([['Salary', 68_000], ['Bonus', 6_000]]),
            withIncome([['Salary', 68_000], ['Freelance', 9_000]]),
        );
        show(<IncomeBreakdown review={review} />);

        expect(screen.getByText('Where it came from')).toBeInTheDocument();
        expect(screen.getByText('Salary')).toBeInTheDocument();
        expect(screen.getByText('Bonus')).toBeInTheDocument();
    });

    it('reads a rise in income as good news, where spending reads it as bad', () => {
        const review = buildMonthReview(
            august,
            withIncome([['Salary', 60_000], ['Bonus', 20_000]]),
            withIncome([['Salary', 60_000], ['Bonus', 2_000]]),
        );
        show(<IncomeBreakdown review={review} />);

        expect(screen.getByText(/Bonus rose the most against last month/)).toBeInTheDocument();
        // The mover sentence's chip, then Salary (flat, no tone) and Bonus.
        const tones = [...document.querySelectorAll('[data-tone]')].map((el) => el.getAttribute('data-tone'));
        expect(tones.every((tone) => tone === 'good')).toBe(true);
        expect(tones.length).toBeGreaterThan(0);
    });

    it('says so when the month has no income at all', () => {
        const review = buildMonthReview(august, withIncome([]), undefined);
        show(<IncomeBreakdown review={review} />);

        expect(screen.getByText('No income recorded in this month.')).toBeInTheDocument();
    });
});

describe('WealthMoveCard', () => {
    const move = (open: number, close: number, openedInside = false) => ({
        open,
        close,
        change: close - open,
        percent: open > 0 ? ((close - open) / open) * 100 : undefined,
        openedInside,
        openedOn: openedInside ? '2026-08-05' : '2026-07-31',
    });

    it('shows both ends of the month', () => {
        show(<WealthMoveCard netWorth={move(1_211_332, 1_245_039)} portfolio={undefined} life={undefined} emergency={undefined} />);

        expect(screen.getByText('NT$1,245,039')).toBeInTheDocument();
        expect(screen.getByText('opened at NT$1,211,332')).toBeInTheDocument();
    });

    it('shows all three wallets beside net worth, so each delta can be read at once', () => {
        show(
            <WealthMoveCard
                netWorth={move(4_239_302, 4_452_253)}
                portfolio={move(4_918_438, 7_054_683)}
                life={move(900_000, 733_990)}
                emergency={move(270_000, 560_000)}
            />,
        );

        expect(screen.getByText('Portfolio')).toBeInTheDocument();
        expect(screen.getByText('Life Wallet')).toBeInTheDocument();
        expect(screen.getByText('Emergency Fund')).toBeInTheDocument();
        expect(screen.getByText('NT$733,990')).toBeInTheDocument();
        expect(screen.getByText('opened at NT$270,000')).toBeInTheDocument();
    });

    it('colours the cash wallets neutrally: a Life wallet that fell because money was invested is not bad news', () => {
        show(
            <WealthMoveCard
                netWorth={move(100, 200)}
                portfolio={move(1_000, 1_200)}
                life={move(500, 300)}
                emergency={move(50, 30)}
            />,
        );

        const tones = [...document.querySelectorAll('[data-tone]')].map((el) => el.getAttribute('data-tone'));
        // Net worth and portfolio keep their verdict; Life and Emergency, down
        // or not, carry none.
        expect(tones).toEqual(['good', 'good', 'neutral', 'neutral']);
    });

    it('renders from a single wallet rather than claiming no balances', () => {
        show(<WealthMoveCard netWorth={undefined} portfolio={undefined} life={undefined} emergency={move(100, 50)} />);

        expect(screen.getByText('Emergency Fund')).toBeInTheDocument();
        expect(screen.queryByText(/No daily balances were recorded/)).not.toBeInTheDocument();
    });

    it('calls the change a balance, not a return', () => {
        show(<WealthMoveCard netWorth={move(100, 200)} portfolio={undefined} life={undefined} emergency={undefined} />);
        expect(
            screen.getByText(/These are balances, not returns/),
        ).toBeInTheDocument();
    });

    it('admits when the window it measured was shorter than the month', () => {
        show(<WealthMoveCard netWorth={move(100, 200, true)} portfolio={undefined} life={undefined} emergency={undefined} />);
        expect(screen.getByText(/Measured from 2026-08-05/)).toBeInTheDocument();
    });

    it('waits rather than reporting no balances while they are still loading', () => {
        // "No daily balances were recorded" is a statement about the account,
        // and it was on screen for a second every time the page opened.
        show(<WealthMoveCard netWorth={undefined} portfolio={undefined} life={undefined} emergency={undefined} loading />);

        expect(screen.queryByText(/No daily balances were recorded/)).not.toBeInTheDocument();
        expect(screen.getByText('Loading...')).toBeInTheDocument();
    });

    it('reports no balances once it knows there are none', () => {
        show(<WealthMoveCard netWorth={undefined} portfolio={undefined} life={undefined} emergency={undefined} loading={false} />);
        expect(screen.getByText(/No daily balances were recorded/)).toBeInTheDocument();
    });

    it('separates a failed fetch from an account with nothing on record', () => {
        show(<WealthMoveCard netWorth={undefined} portfolio={undefined} life={undefined} emergency={undefined} error />);

        expect(screen.queryByText(/No daily balances were recorded/)).not.toBeInTheDocument();
        expect(screen.getByText(/balances couldn't be loaded/)).toBeInTheDocument();
    });

    it('does not blame the account for a month it never fetched', () => {
        // Stepping back past the year of balances the page asks for is not the
        // same as an account that never had any.
        show(<WealthMoveCard netWorth={undefined} portfolio={undefined} life={undefined} emergency={undefined} outOfRange />);

        expect(screen.queryByText(/No daily balances were recorded/)).not.toBeInTheDocument();
        expect(screen.getByText(/keeps a year of daily balances/)).toBeInTheDocument();
    });
});

describe('GoalsTodayCard', () => {
    const goals = (overrides: Partial<GoalsReport> = {}): GoalsReport =>
        ({
            totalGoals: 3,
            activeGoals: 3,
            completedGoals: 0,
            totalTargetAmount: 133_000,
            totalCurrentAmount: 63_200,
            overallProgress: 47.5,
            goalsOnTrack: 2,
            goalsBehind: 1,
            goalProgress: [],
            categorySummary: [],
            insights: [],
            ...overrides,
        }) as GoalsReport;

    it('dates itself, because the figures are current and the month may not be', () => {
        show(<GoalsTodayCard goals={goals()} />);

        expect(screen.getByText('as of today')).toBeInTheDocument();
        expect(screen.getByText('48%')).toBeInTheDocument();
        expect(screen.getByText('NT$63,200 of NT$133,000 saved')).toBeInTheDocument();
    });

    it('points somewhere useful when there are no goals', () => {
        show(<GoalsTodayCard goals={goals({ totalGoals: 0 })} />);

        expect(screen.getByText('No goals set yet.')).toBeInTheDocument();
        expect(screen.getByRole('link', { name: 'Set one' })).toHaveAttribute('href', '/goals');
    });

    it('survives the report never arriving', () => {
        show(<GoalsTodayCard goals={undefined} />);
        expect(screen.getByText('No goals set yet.')).toBeInTheDocument();
    });

    it('waits instead of announcing no goals to someone who has three', () => {
        show(<GoalsTodayCard goals={undefined} loading />);

        expect(screen.queryByText('No goals set yet.')).not.toBeInTheDocument();
        expect(screen.getByText('Loading...')).toBeInTheDocument();
    });

    it('separates a failed fetch from an empty one', () => {
        show(<GoalsTodayCard goals={undefined} error />);

        expect(screen.queryByText('No goals set yet.')).not.toBeInTheDocument();
        expect(screen.getByText(/couldn't be loaded/)).toBeInTheDocument();
    });
});

describe('the cards together', () => {
    it('name the page in one voice', () => {
        // Every card heading comes from the same bundle; a key added to the page
        // and not to the bundle renders as "review.balances" to a reader.
        const august = monthRange('2026-08', NOW);
        const review = buildMonthReview(august, spending(80_000, [['Rent', 20_000]]), undefined);

        const { container } = show(
            <div>
                <ReviewHero review={review} />
                <SpendingBreakdown review={review} />
                <WealthMoveCard netWorth={undefined} portfolio={undefined} life={undefined} emergency={undefined} />
                <GoalsTodayCard goals={undefined} />
            </div>,
        );

        expect(container.textContent).not.toMatch(/review\.[a-zA-Z]/);
        const headings = within(container).getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
        expect(headings).toEqual(['Where it went', 'Balances', 'Goals']);
    });
});

describe('MonthContextCard', () => {
    const NOW_CONTEXT = new Date(2026, 8, 10, 12);
    const trend = (month: string, expenses: number) => ({
        month,
        income: 80_000,
        expenses,
        net: 80_000 - expenses,
    });

    const year = [
        trend('2025-10', 30_000), trend('2025-11', 28_000), trend('2025-12', 60_000),
        trend('2026-01', 25_000), trend('2026-02', 26_000), trend('2026-03', 24_000),
        trend('2026-04', 27_000), trend('2026-05', 31_000), trend('2026-06', 29_000),
        trend('2026-07', 26_000), trend('2026-08', 20_000), trend('2026-09', 9_000),
    ];

    const contextFor = (month: string) =>
        buildMonthContext(year, monthRange(month, NOW_CONTEXT), NOW_CONTEXT);

    it('places the month in words, not only in bars', () => {
        show(<MonthContextCard context={contextFor('2026-07')} />);

        expect(screen.getByText(/best saving month of the last 11/)).toBeInTheDocument();
        expect(screen.getByText(/above the average month|below the average month/)).toBeInTheDocument();
    });

    it('does not rank a month that is still running', () => {
        show(<MonthContextCard context={contextFor('2026-09')} />);

        expect(screen.getByText(/joins the comparison when the month closes/)).toBeInTheDocument();
        expect(screen.queryByText(/best saving month/)).not.toBeInTheDocument();
    });

    it('states the series for a reader who cannot see the bars', () => {
        // The bars are aria-hidden; without this the card says "3rd best" and
        // gives a screen reader nothing to check it against.
        const { container } = show(<MonthContextCard context={contextFor('2026-08')} />);

        const series = container.querySelector('ul.sr-only');
        expect(series?.children).toHaveLength(12);
        expect(series?.textContent).toContain('NT$60,000');
    });

    it('says a month is out of range rather than placing it against a window it is not in', () => {
        show(<MonthContextCard context={contextFor('2024-03')} />);

        expect(screen.getByText(/further back than that/)).toBeInTheDocument();
        expect(screen.queryByText(/best saving month/)).not.toBeInTheDocument();
    });

    it.each([
        ['still loading', { loading: true }],
        ['failed', { error: true }],
    ])('says a month is out of range even while the series is %s', (_state, props) => {
        // Whether the month falls inside the window is settled by the calendar,
        // not by the fetch — so this answer cannot be waiting on one. The series
        // is empty here on purpose: with data present the other branches decline
        // anyway, and the test would pass whatever the order.
        const outOfRange = buildMonthContext([], monthRange('2024-03', NOW_CONTEXT), NOW_CONTEXT);
        show(<MonthContextCard context={outOfRange} {...props} />);

        expect(screen.getByText(/further back than that/)).toBeInTheDocument();
        expect(screen.queryByText(/couldn't be loaded/)).not.toBeInTheDocument();
        expect(screen.queryByText('Loading...')).not.toBeInTheDocument();
    });

    it('waits instead of telling a new account it has no history', () => {
        const empty = buildMonthContext([], monthRange('2026-08', NOW_CONTEXT), NOW_CONTEXT);
        show(<MonthContextCard context={empty} loading />);

        expect(screen.queryByText(/second month on record/)).not.toBeInTheDocument();
        expect(screen.getByText('Loading...')).toBeInTheDocument();
    });

    it('separates a failed fetch from an account with no history', () => {
        const empty = buildMonthContext([], monthRange('2026-08', NOW_CONTEXT), NOW_CONTEXT);
        show(<MonthContextCard context={empty} error />);

        expect(screen.queryByText(/second month on record/)).not.toBeInTheDocument();
        expect(screen.getByText(/couldn't be loaded/)).toBeInTheDocument();
    });

    it('invites a one-month-old account to come back', () => {
        const empty = buildMonthContext([], monthRange('2026-08', NOW_CONTEXT), NOW_CONTEXT);
        show(<MonthContextCard context={empty} />);

        expect(screen.getByText(/second month on record/)).toBeInTheDocument();
    });
});
