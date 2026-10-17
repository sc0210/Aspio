import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import i18next from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { AssetTrendChart, AssetTrendDataPoint } from '@/components/portfolio/AssetTrendChart';
import en from '@/locales/en/portfolio.json';
import zhTW from '@/locales/zh-TW/portfolio.json';

// Load the namespace synchronously. Left to i18next's async load, the first
// test in the file renders raw keys while later ones render real text, so the
// assertions silently depend on test order.
//
// This instance is handed to the component through I18nextProvider rather than
// react-i18next's module global. Calling initReactI18next here would make the
// file's correctness depend on being the LAST module to call setI18n — and
// @/lib/i18n already calls it at import time, reached via
// @/utils/formatters, which this component imports. That only worked because
// ES module bodies run after imports resolve; one new import below would flip
// the global back and break every assertion here. The sibling portfolio suites
// use the provider for the same reason.
const i18n = i18next.createInstance();
i18n.init({
    lng: 'en',
    fallbackLng: 'en',
    ns: ['portfolio'],
    defaultNS: 'portfolio',
    resources: { en: { portfolio: en }, 'zh-TW': { portfolio: zhTW } },
    interpolation: { escapeValue: false },
    react: { useSuspense: false },
});

// Recharts renders SVG which jsdom doesn't support fully — mock it at the module level
jest.mock('recharts', () => {
    const Actual = jest.requireActual('recharts');
    return {
        ...Actual,
        ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
            <div data-testid="responsive-container">{children}</div>
        ),
        ComposedChart: ({ children, data }: { children: React.ReactNode; data: unknown[] }) => (
            <div data-testid="composed-chart" data-points={data?.length}>{children}</div>
        ),
        Area: ({ dataKey, name }: { dataKey: string; name: string }) => (
            <div data-testid={`area-${dataKey}`} data-name={name} />
        ),
        Line: ({ dataKey, name }: { dataKey: string; name: string }) => (
            <div data-testid={`line-${dataKey}`} data-name={name} />
        ),
        XAxis: () => <div data-testid="x-axis" />,
        YAxis: ({ domain }: { domain: unknown }) => (
            <div data-testid="y-axis" data-domain={JSON.stringify(domain)} />
        ),
        CartesianGrid: () => <div data-testid="cartesian-grid" />,
        // CustomTooltip lives behind <Tooltip content={…}>. Stubbing this out
        // unconditionally — as it used to be — means none of the six strings
        // inside CustomTooltip is ever resolved by any test: mistype one key and
        // the raw key ships to users while all 121 suites stay green. Tests opt
        // in by setting __trendTooltipPayload, so the other tests keep a chart
        // with no duplicate tooltip text in it.
        Tooltip: ({ content }: { content: React.ReactElement }) => {
            const ReactActual = jest.requireActual('react') as typeof React;
            const payload = (globalThis as Record<string, unknown>).__trendTooltipPayload;
            if (!payload || !ReactActual.isValidElement(content)) {
                return <div data-testid="tooltip" />;
            }
            return (
                <div data-testid="tooltip">
                    {ReactActual.cloneElement(
                        content as React.ReactElement<Record<string, unknown>>,
                        { active: true, payload }
                    )}
                </div>
            );
        },
        ReferenceDot: ({ x, y }: { x: string; y: number }) => (
            <div data-testid="reference-dot" data-x={x} data-y={y} />
        ),
        Brush: () => <div data-testid="brush" />,
    };
});

// ─── fixtures ────────────────────────────────────────────────────────────────

const makePoint = (
    date: string,
    value: number,
    opts: Partial<AssetTrendDataPoint> = {}
): AssetTrendDataPoint => ({
    date,
    value,
    change: 0,
    changePercent: 0,
    costBasis: value * 0.8,
    capitalAdded: 0,
    ...opts,
});

const FLAT_DATA: AssetTrendDataPoint[] = [
    makePoint('2026-04-01', 1_000_000),
    makePoint('2026-04-02', 1_010_000),
    makePoint('2026-04-03', 1_020_000),
    makePoint('2026-04-04', 1_030_000),
    makePoint('2026-04-05', 1_040_000),
];

const GROWING_DATA: AssetTrendDataPoint[] = [
    makePoint('2026-04-01', 2_000_000, { costBasis: 1_800_000 }),
    makePoint('2026-04-02', 2_100_000, { costBasis: 1_800_000 }),
    makePoint('2026-04-03', 2_200_000, { costBasis: 1_800_000 }),
    makePoint('2026-04-04', 2_300_000, { costBasis: 1_800_000, capitalAdded: 100_000 }),
    makePoint('2026-04-05', 2_500_000, { costBasis: 1_900_000 }),
];

// ─── helpers ─────────────────────────────────────────────────────────────────

const renderWithI18n = (ui: React.ReactElement) =>
    render(<I18nextProvider i18n={i18n}>{ui}</I18nextProvider>);

const renderChart = (props: Partial<React.ComponentProps<typeof AssetTrendChart>> = {}) =>
    renderWithI18n(<AssetTrendChart data={FLAT_DATA} {...props} />);

// ─── empty state ─────────────────────────────────────────────────────────────

describe('AssetTrendChart — empty state', () => {
    it('shows no-data message when data is empty', () => {
        renderWithI18n(<AssetTrendChart data={[]} />);
        expect(screen.getByText(/no trend data available/i)).toBeInTheDocument();
    });

    it('does not render the chart when data is empty', () => {
        renderWithI18n(<AssetTrendChart data={[]} />);
        expect(screen.queryByTestId('composed-chart')).not.toBeInTheDocument();
    });
});

// ─── stats cards ─────────────────────────────────────────────────────────────

describe('AssetTrendChart — stats cards', () => {
    it('renders all four stat cards', () => {
        renderChart();
        // "Portfolio Value" is now "Period End Value": the card shows the last
        // plotted point, while PortfolioStats shows today's live total a few
        // inches above, and the two legitimately differ. The label says which.
        // One node per label — there is a single summary grid, so getByText is
        // the right assertion and a duplicate label is a regression worth failing
        // on. (The previous getAllByText(...).length > 0 asserted strictly less
        // and was justified by a mobile/desktop dual layout this component has
        // never had.)
        ['Period End Value', 'Invested Capital', 'Period Return', 'Capital Added'].forEach((label) => {
            expect(screen.getByText(label)).toBeInTheDocument();
        });
    });

    it('displays current value from last data point', () => {
        renderChart({ data: FLAT_DATA });
        // Last point value = 1,040,000 — formatted currency should be visible
        expect(screen.getByText(/1,040,000|1\.04M|104萬/)).toBeInTheDocument();
    });

    it('hides values when isValueVisible is false', () => {
        renderChart({ isValueVisible: false });
        const hidden = screen.getAllByText('•••••');
        expect(hidden.length).toBeGreaterThan(0);
    });

    it('shows positive period return styling', () => {
        const { container } = renderChart({ data: GROWING_DATA });
        // Period change = 2,500,000 - 2,000,000 = +500,000 (positive)
        expect(container.querySelector('.text-success-900, .bg-success-50\\/80')).toBeInTheDocument();
    });

    it('shows capital added from buy events', () => {
        renderChart({ data: GROWING_DATA });
        // GROWING_DATA has capitalAdded=100,000 on Apr 4
        expect(screen.getByText(/1 purchase/i)).toBeInTheDocument();
    });
});

// ─── Y-axis domain ────────────────────────────────────────────────────────────

describe('AssetTrendChart — Y-axis domain', () => {
    it('sets domain below trough and above peak (value mode)', () => {
        renderChart({ data: GROWING_DATA });
        const yAxis = screen.getByTestId('y-axis');
        const domain = JSON.parse(yAxis.getAttribute('data-domain') || '[]') as number[];

        // trough = 2,000,000 → min = floor(2,000,000 * 0.97) = 1,940,000
        // peak   = 2,500,000 → max = ceil(2,500,000 * 1.02)  = 2,550,000
        expect(domain[0]).toBeLessThan(2_000_000);
        expect(domain[1]).toBeGreaterThan(2_500_000);
    });

    it('domain excludes zero so line fills chart height', () => {
        renderChart({ data: GROWING_DATA });
        const yAxis = screen.getByTestId('y-axis');
        const domain = JSON.parse(yAxis.getAttribute('data-domain') || '[]') as number[];
        expect(domain[0]).toBeGreaterThan(0);
    });

    it('uses auto domain in return % mode', () => {
        renderChart({ data: GROWING_DATA });
        fireEvent.click(screen.getByRole('button', { name: /return %/i }));
        const yAxis = screen.getByTestId('y-axis');
        const domain = JSON.parse(yAxis.getAttribute('data-domain') || '[]');
        expect(domain).toEqual(['auto', 'auto']);
    });
});

// ─── chart rendering ──────────────────────────────────────────────────────────

describe('AssetTrendChart — chart rendering', () => {
    it('renders the ComposedChart with correct data length', () => {
        renderChart({ data: FLAT_DATA });
        const chart = screen.getByTestId('composed-chart');
        expect(chart.getAttribute('data-points')).toBe(String(FLAT_DATA.length));
    });

    it('always renders the value Area component', () => {
        renderChart();
        expect(screen.getByTestId('area-value')).toBeInTheDocument();
    });

    it('always renders the costBasis Area component', () => {
        renderChart();
        // dataKey switches between 'costBasis' and 'costBasis_hidden' but element is always present
        const costArea =
            screen.queryByTestId('area-costBasis') ||
            screen.queryByTestId('area-costBasis_hidden');
        expect(costArea).toBeInTheDocument();
    });

    it('renders buy marker ReferenceDots for capital events', () => {
        renderChart({ data: GROWING_DATA });
        // GROWING_DATA has one buy event (capitalAdded > 0 at index 3)
        const dots = screen.getAllByTestId('reference-dot');
        expect(dots.length).toBeGreaterThanOrEqual(1);
    });

    it('passes all data points to the chart', () => {
        renderChart({ data: GROWING_DATA });
        const chart = screen.getByTestId('composed-chart');
        expect(chart.getAttribute('data-points')).toBe(String(GROWING_DATA.length));
    });
});

// ─── view mode toggle ─────────────────────────────────────────────────────────

describe('AssetTrendChart — view mode toggle', () => {
    it('renders Value and Return % toggle buttons', () => {
        renderChart();
        expect(screen.getByRole('button', { name: /^value$/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /return %/i })).toBeInTheDocument();
    });

    it('Value button is active by default', () => {
        renderChart();
        const valueBtn = screen.getByRole('button', { name: /^value$/i });
        // Active state uses white/dark background class
        expect(valueBtn.className).toMatch(/bg-white|dark:bg-gray-700/);
    });

    it('toggles to return % mode on click', () => {
        renderChart({ data: GROWING_DATA });
        fireEvent.click(screen.getByRole('button', { name: /return %/i }));
        // In return mode the cost basis legend entry disappears
        expect(screen.queryByText('Cost Basis')).not.toBeInTheDocument();
    });

    it('shows Cost Basis legend in value mode', () => {
        renderChart();
        expect(screen.getByText('Cost Basis')).toBeInTheDocument();
    });

    it('shows My Portfolio legend in both modes', () => {
        renderChart();
        expect(screen.getByText('My Portfolio')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: /return %/i }));
        expect(screen.getByText('My Portfolio')).toBeInTheDocument();
    });
});

// ─── zoom toggle ──────────────────────────────────────────────────────────────

describe('AssetTrendChart — zoom toggle', () => {
    it('renders the Zoom button', () => {
        renderChart();
        expect(screen.getByRole('button', { name: /zoom/i })).toBeInTheDocument();
    });

    it('shows Brush component when zoom is enabled', () => {
        renderChart();
        expect(screen.queryByTestId('brush')).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: /zoom/i }));
        expect(screen.getByTestId('brush')).toBeInTheDocument();
    });
});

// ─── capital events legend ────────────────────────────────────────────────────

describe('AssetTrendChart — capital events legend', () => {
    it('shows buy count label when buys exist', () => {
        renderChart({ data: GROWING_DATA });
        expect(screen.getByText(/1 buy/i)).toBeInTheDocument();
    });

    it('does not show buy label when no capital events', () => {
        renderChart({ data: FLAT_DATA });
        expect(screen.queryByText(/buy/i)).not.toBeInTheDocument();
    });
});

// ─── data processing ──────────────────────────────────────────────────────────

describe('AssetTrendChart — data processing', () => {
    it('uses backend costBasis when provided', () => {
        // GROWING_DATA has explicit costBasis — the Period Return card should
        // reflect gain = last.value - last.costBasis = 2,500,000 - 1,900,000 = 600,000
        renderChart({ data: GROWING_DATA });
        // all-time return % is shown in the Period Return card
        expect(screen.getByText(/all-time/i)).toBeInTheDocument();
    });

    it('detects buy events from capitalAdded > 0', () => {
        const dataWithBuy: AssetTrendDataPoint[] = [
            makePoint('2026-04-01', 1_000_000),
            makePoint('2026-04-02', 1_100_000, { capitalAdded: 50_000 }),
            makePoint('2026-04-03', 1_150_000),
        ];
        renderWithI18n(<AssetTrendChart data={dataWithBuy} />);
        expect(screen.getByText(/1 buy/i)).toBeInTheDocument();
    });

    it('counts multiple buy events correctly', () => {
        const dataWithTwoBuys: AssetTrendDataPoint[] = [
            makePoint('2026-04-01', 1_000_000),
            makePoint('2026-04-02', 1_100_000, { capitalAdded: 50_000 }),
            makePoint('2026-04-03', 1_150_000),
            makePoint('2026-04-04', 1_250_000, { capitalAdded: 75_000 }),
            makePoint('2026-04-05', 1_300_000),
        ];
        renderWithI18n(<AssetTrendChart data={dataWithTwoBuys} />);
        expect(screen.getByText(/2 buys/i)).toBeInTheDocument();
    });
});

// ─── hover tooltip ───────────────────────────────────────────────────────────

// CustomTooltip is the component's largest block of copy and had no coverage at
// all: the recharts mock stubbed <Tooltip> out, so a typo in any of its keys
// rendered the raw key on screen with every suite green.
describe('AssetTrendChart — hover tooltip', () => {
    const POINT: AssetTrendDataPoint = {
        ...makePoint('2026-04-04', 2_300_000, { costBasis: 1_800_000, capitalAdded: 100_000 }),
        change: 12_000,
        changePercent: 0.52,
        returnAmount: 500_000,
        returnPercent: 27.78,
        fullDate: new Date(2026, 3, 4),
        fullDateStr: '2026-04-04',
        _sellAmount: 40_000,
        topHoldings: [{ symbol: '2330', change: 12_400, value: 900_000 }],
    };

    beforeEach(() => {
        (globalThis as Record<string, unknown>).__trendTooltipPayload = [{ payload: POINT }];
    });

    afterEach(() => {
        delete (globalThis as Record<string, unknown>).__trendTooltipPayload;
    });

    it('resolves every tooltip label instead of rendering raw keys', () => {
        renderChart({ data: GROWING_DATA });
        ['Value on This Day', 'Day Change', 'Bought', 'Sold', 'Top Movers'].forEach((label) => {
            expect(screen.getByText(label)).toBeInTheDocument();
        });
    });

    it('does not label the hover value with the page headline wording', () => {
        // The headline card on /portfolio is "Portfolio Value". The commit
        // renamed the summary card away from that collision but left the hover
        // row still reading "Portfolio Value" for a different number — the day's
        // snapshot, not the live total.
        renderChart({ data: GROWING_DATA });
        expect(screen.queryByText('Portfolio Value')).not.toBeInTheDocument();
    });
});

// ─── card explanations ───────────────────────────────────────────────────────

// The sentence explaining why these numbers differ from the page headline IS
// the fix this component shipped, so it has to be reachable — a native `title`
// reaches only desktop mouse users.
describe('AssetTrendChart — card explanations', () => {
    it('exposes the period-end explanation to keyboard and touch users', () => {
        renderChart();
        const hint = screen.getByRole('button', { name: 'About Period End Value' });
        fireEvent.click(hint);
        expect(screen.getByRole('tooltip')).toHaveTextContent(
            /not today's live portfolio total/i
        );
    });

    it('explains that period return is not all-time gain/loss', () => {
        renderChart();
        fireEvent.click(screen.getByRole('button', { name: 'About Period Return' }));
        expect(screen.getByRole('tooltip')).toHaveTextContent(/all-time Total Gain\/Loss/i);
    });

    // A single open/close boolean toggled on click looks fine under an isolated
    // fireEvent.click, and is broken in every real browser: mouseenter and focus
    // both land before the click, so the click inverts the true they just set.
    // These drive the full sequence instead of the click alone.
    it('opens on hover alone, and closes when the pointer leaves', () => {
        renderChart();
        const hint = screen.getByRole('button', { name: 'About Period End Value' });
        fireEvent.mouseEnter(hint);
        expect(screen.getByRole('tooltip')).toBeInTheDocument();
        fireEvent.mouseLeave(hint);
        expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    });

    it('stays open when a mouse user hovers and then clicks', () => {
        renderChart();
        const hint = screen.getByRole('button', { name: 'About Period End Value' });
        fireEvent.mouseEnter(hint);
        fireEvent.click(hint);
        expect(screen.getByRole('tooltip')).toBeInTheDocument();
    });

    it('stays open when a keyboard user focuses and then presses Enter', () => {
        renderChart();
        const hint = screen.getByRole('button', { name: 'About Period End Value' });
        fireEvent.focus(hint);
        fireEvent.click(hint); // Enter on a focused button dispatches click
        expect(screen.getByRole('tooltip')).toBeInTheDocument();
    });

    it('opens on a touch tap and closes when the user taps elsewhere', () => {
        renderChart();
        const hint = screen.getByRole('button', { name: 'About Period End Value' });
        // A tap synthesises mouseenter then click. This is the sequence the
        // native `title` it replaced produced nothing at all for.
        fireEvent.mouseEnter(hint);
        fireEvent.click(hint);
        expect(screen.getByRole('tooltip')).toBeInTheDocument();

        // Dismissal goes through an outside pointerdown, not mouseleave —
        // mobile browsers often never fire mouseleave on the element they just
        // left, which would strand the hint open with no way to close it.
        fireEvent.pointerDown(document.body);
        expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    });

    it('stays open when the pointerdown lands inside the hint itself', () => {
        renderChart();
        const hint = screen.getByRole('button', { name: 'About Period End Value' });
        fireEvent.mouseEnter(hint);
        fireEvent.click(hint);
        fireEvent.pointerDown(hint);
        expect(screen.getByRole('tooltip')).toBeInTheDocument();
    });

    it('points a screen reader at the explanation, not just the card name', () => {
        renderChart();
        const hint = screen.getByRole('button', { name: 'About Period End Value' });
        expect(hint).not.toHaveAttribute('aria-describedby');

        fireEvent.focus(hint);
        const describedBy = hint.getAttribute('aria-describedby');
        expect(describedBy).toBeTruthy();
        // aria-label carries only "About Period End Value"; without this wiring
        // the sentence itself never reaches assistive tech.
        expect(document.getElementById(describedBy as string)).toHaveTextContent(
            /not today's live portfolio total/i
        );
    });

    it('closes when focus leaves', () => {
        renderChart();
        const hint = screen.getByRole('button', { name: 'About Period Return' });
        fireEvent.focus(hint);
        fireEvent.click(hint);
        fireEvent.blur(hint);
        expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    });

    it('does not claim a headline that the caller may not render', () => {
        // /portfolio/trend renders this chart with showSummary defaulted on and
        // no PortfolioStats anywhere on the page, so a tooltip naming "the
        // headline above" describes something that isn't there.
        renderChart();
        fireEvent.click(screen.getByRole('button', { name: 'About Period End Value' }));
        expect(screen.getByRole('tooltip')).not.toHaveTextContent(/above/i);
    });
});

// ─── localisation ────────────────────────────────────────────────────────────

describe('AssetTrendChart — zh-TW', () => {
    // changeLanguage re-renders every mounted consumer, and this hook runs
    // before RTL's auto-cleanup unmounts them — so it needs act() or React
    // warns about a state update outside one.
    const setLanguage = (lng: string) => act(async () => { await i18n.changeLanguage(lng); });

    afterEach(async () => {
        await setLanguage('en');
    });

    it('renders the empty state entirely in Chinese', async () => {
        await setLanguage('zh-TW');
        renderWithI18n(<AssetTrendChart data={[]} />);
        expect(screen.getByText('無趨勢資料')).toBeInTheDocument();
        // The headline was translated while the hint below it was not, so one
        // card spoke two languages.
        expect(screen.queryByText(/Add holdings and sync/i)).not.toBeInTheDocument();
    });

    it('translates the summary cards and the chart legend', async () => {
        await setLanguage('zh-TW');
        renderChart({ data: GROWING_DATA });
        expect(screen.getByText('期末價值')).toBeInTheDocument();
        expect(screen.getByText('我的投資組合')).toBeInTheDocument();
        expect(screen.queryByText('My Portfolio')).not.toBeInTheDocument();
    });

    it('translates the hover tooltip labels too', async () => {
        (globalThis as Record<string, unknown>).__trendTooltipPayload = [{
            payload: {
                ...makePoint('2026-04-04', 2_300_000, { capitalAdded: 100_000 }),
                change: 12_000,
                changePercent: 0.52,
                returnAmount: 500_000,
                returnPercent: 27.78,
                fullDate: new Date(2026, 3, 4),
                fullDateStr: '2026-04-04',
                _sellAmount: 40_000,
                topHoldings: [{ symbol: '2330', change: 12_400, value: 900_000 }],
            },
        }];
        try {
            await setLanguage('zh-TW');
            renderChart({ data: GROWING_DATA });
            // 漲跌幅最大 read as "largest % change" over rows showing absolute
            // currency amounts; 變動最大 is scale-neutral like "Top Movers".
            expect(screen.getByText('變動最大')).toBeInTheDocument();
            expect(screen.getByText('當日價值')).toBeInTheDocument();
            expect(screen.queryByText('Value on This Day')).not.toBeInTheDocument();
        } finally {
            delete (globalThis as Record<string, unknown>).__trendTooltipPayload;
        }
    });
});
