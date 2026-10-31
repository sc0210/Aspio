import { Transaction, PortfolioHolding, User, PeerConnectionOut, SharedGoalOut, SavingRecord, CompareDataResponse, PeerStatCard } from '@/shared/types';
import type { DebtAccount } from '@/services/loanService';
import { minimumsOnly } from '@/lib/finance/payoffPlan';
import { businessToday } from '@/lib/portfolio/businessDate';

export const demoUser: User = {
  id: 'demo-user-1',
  email: 'demo@aspiro.app',
  name: 'Alex Chen',
  avatar_url: '/avatars/default.png',
  is_active: true,
  is_verified: true,
  role: 'USER',
  experience_points: 1250,
  level: 3,
  created_at: new Date('2024-01-15'),
  updated_at: new Date(),
  preferences: {
    currency: 'TWD',
    language: 'zh-TW',
    locale: 'zh-TW',
    timezone: 'Asia/Taipei',
    dateFormat: 'western',
    numberFormat: 'western',
    notifications: {
      email: true,
      push: true,
      goalReminders: true,
      transactionAlerts: true,
    },
  },
  profile: {
    date_of_birth: new Date('1990-05-15'),
    occupation: 'Software Engineer',
    monthly_income: 63000,      // 月薪（稅後、扣勞退）from cur_investment_plan.md
    risk_tolerance: 'moderate' as const,
  },
};
// Monthly income/expense summary for the demo `/transactions/monthly-summary`
// page. Mirrors the backend shape (housing/eat/investment/others + total + income)
// where `total` = housing + eat + investment + debt + others (every expense counts toward
// the total, matching the real endpoint). Deterministic per-month variation so the
// bar/line/pie charts look realistic without any backend call.
interface DemoMonthlySummary {
  month: string; // YYYY-MM
  housing: number;
  eat: number;
  investment: number;
  /** Loan repayments — their own column, so servicing debt does not read as
   *  discretionary spending in Others. */
  debt: number;
  others: number;
  total: number;
  income: number;
}

export function getDemoMonthlySummaries(year: number): DemoMonthlySummary[] {
  const now = new Date();
  // Current year → up to and including the current month (no fabricated future
  // months); a past year → all twelve months.
  const lastMonth = year < now.getFullYear() ? 12 : now.getMonth() + 1;
  const summaries: DemoMonthlySummary[] = [];
  for (let m = 1; m <= lastMonth; m++) {
    const f = ((m * 37) % 100) / 100; // 0–1 deterministic
    const g = ((m * 53) % 100) / 100;
    const housing = 10_000; // rent — flat each month
    const eat = Math.round(6_000 + f * 3_500); // 6.0k–9.5k
    const investment = Math.round(15_000 + g * 8_000); // 15k–23k regular investing
    const others = Math.round(5_000 + f * 6_000); // 5k–11k shopping/transport/etc.
    // A flat personal-loan instalment, so the Debt column is populated in demo mode
    // rather than rendering an always-empty column.
    const debt = 12_500;
    const total = housing + eat + investment + debt + others;
    // Salary every month, with a mid-year and a larger year-end bonus.
    const bonus = m === 6 ? 20_000 : m === 12 ? 60_000 : f > 0.7 ? 8_000 : 0;
    const income = 63_000 + bonus;
    summaries.push({
      month: `${year}-${String(m).padStart(2, '0')}`,
      housing,
      eat,
      investment,
      debt,
      others,
      total,
      income,
    });
  }
  return summaries;
}

// Historical price series for the demo holding-detail page
// (`/portfolio/holdings/[symbol]`). The backend serves the demo portfolio
// (AAPL / BTC-USD / GOOGL) for unauthenticated requests but returns NO per-symbol
// price history, so the chart is generated client-side here. The series is a
// deterministic seeded walk from `start` → `end`, and the final close is pinned to
// `end` so it matches the holding's current price shown elsewhere.
interface DemoPricePoint {
  date: string; // YYYY-MM-DD
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  currency: string;
}

// Anchors mirror the backend demo portfolio's averageCost → currentPrice so the
// chart's cost-basis line and the holding header stay coherent. 0050 and VT are
// the demo holdings today (DEMO_HOLDINGS in backend/.../routers/_shared.py and
// DEMO_PORTFOLIO in DemoContext); without an anchor they fell back to the hash
// walk, so 0050 charted around NT$400 against its NT$150 price. VT is priced in
// TWD there (NT$3,800 → NT$4,000), so its anchor is too.
const DEMO_PRICE_ANCHORS: Record<string, { start: number; end: number; currency: string; vol: number }> = {
  '0050': { start: 145, end: 150, currency: 'TWD', vol: 0.01 },
  VT: { start: 3800, end: 4000, currency: 'TWD', vol: 0.01 },
  AAPL: { start: 168, end: 185.5, currency: 'USD', vol: 0.012 },
  GOOGL: { start: 258, end: 275.25, currency: 'USD', vol: 0.014 },
  'BTC-USD': { start: 43000, end: 48500, currency: 'USD', vol: 0.03 },
};

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

export function getDemoHistoricalPrices(symbol: string, days: number): DemoPricePoint[] {
  const sym = (symbol || '').toUpperCase();
  const anchor = DEMO_PRICE_ANCHORS[sym] ?? (() => {
    const base = 20 + (hashString(sym) % 380); // 20–400 deterministic per symbol
    return { start: base, end: base * 1.09, currency: 'USD', vol: 0.015 };
  })();

  const n = Math.max(2, Math.min(Math.round(days), 3650));
  const round2 = (v: number) => Math.round(v * 100) / 100;
  const today = new Date();
  let seed = hashString(sym) || 1;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff; // 0–1 deterministic
  };

  const points: DemoPricePoint[] = [];
  for (let i = 0; i < n; i++) {
    const t = n > 1 ? i / (n - 1) : 1; // 0 → 1
    const trend = anchor.start + (anchor.end - anchor.start) * t;
    const close = Math.max(0.01, trend + (rand() - 0.5) * 2 * anchor.vol * trend);
    const open = Math.max(0.01, close * (1 + (rand() - 0.5) * anchor.vol));
    const high = Math.max(open, close) * (1 + rand() * anchor.vol * 0.6);
    const low = Math.min(open, close) * (1 - rand() * anchor.vol * 0.6);
    const d = new Date(today.getTime() - (n - 1 - i) * 86_400_000);
    points.push({
      date: d.toISOString().slice(0, 10),
      open: round2(open),
      high: round2(high),
      low: round2(low),
      close: round2(close),
      volume: Math.round(100_000 + rand() * 900_000),
      currency: anchor.currency,
    });
  }
  // Pin the last close to the anchor so it matches the holding's current price,
  // and widen high/low so the final candle stays valid (high ≥ close ≥ low).
  const last = points[points.length - 1];
  last.close = anchor.end;
  last.high = Math.max(last.high, anchor.end);
  last.low = Math.min(last.low, anchor.end);
  return points;
}

// The backend serves the demo portfolio with one lot per symbol and
// purchase_date=null, so the holding-detail chart has no buy markers in demo.
// Split each such holding into two dated lots (26 and 12 days ago — inside the
// default 1M window) so the "Buys" markers actually render in demo.
export function withDemoPurchaseLots(holding: PortfolioHolding): PortfolioHolding[] {
  const today = new Date();
  const daysAgoIso = (days: number) => new Date(today.getTime() - days * 86_400_000).toISOString();
  const qty = Number(holding.quantity) || 0;
  const cost = Number(holding.totalCost) || 0;
  const value = Number(holding.totalValue) || 0;
  const gain = Number(holding.gainLoss) || 0;
  const splits = [
    { frac: 0.6, days: 26 },
    { frac: 0.4, days: 12 },
  ];
  return splits.map((s, i) => ({
    ...holding,
    id: `${holding.id}-demo-lot-${i}`,
    quantity: qty * s.frac,
    totalCost: cost * s.frac,
    totalValue: value * s.frac,
    gainLoss: gain * s.frac,
    purchaseDate: daysAgoIso(s.days),
  }));
}
// Savings Groups demo data
export const demoPeerConnections: PeerConnectionOut[] = [
  {
    id: 'demo-conn-1',
    other_user: {
      id: 'demo-peer-1',
      username: 'minglin',
      name: '小明',
      avatar_url: null,
    },
    status: 'accepted',
    direction: 'sent',
    created_at: '2026-01-10T08:00:00Z',
  },
  {
    id: 'demo-conn-2',
    other_user: {
      id: 'demo-peer-2',
      username: 'meiwang',
      name: '小美',
      avatar_url: null,
    },
    status: 'accepted',
    direction: 'received',
    created_at: '2026-02-14T10:00:00Z',
  },
];

export const demoSharedGoals: SharedGoalOut[] = [
  {
    id: 'demo-goal-1',
    connection_id: 'demo-conn-1',
    title: '日本旅遊基金',
    target_amount: 50000,
    target_date: '2026-12-01',
    status: 'active',
    your_amount: 18000,
    peer_amount: 12000,
    your_name: 'Alex Chen',
    peer_name: '小明',
    your_user_id: 'demo-user-1',
    peer_user_id: 'demo-peer-1',
    total_amount: 30000,
    progress_pct: 60,
    is_creator: true,
    created_at: '2026-01-15T09:00:00Z',
  },
  {
    id: 'demo-goal-2',
    connection_id: 'demo-conn-2',
    title: '緊急備用金擴充',
    target_amount: 100000,
    target_date: null,
    status: 'active',
    your_amount: 30000,
    peer_amount: 25000,
    your_name: 'Alex Chen',
    peer_name: '小美',
    your_user_id: 'demo-user-1',
    peer_user_id: 'demo-peer-2',
    total_amount: 55000,
    progress_pct: 55,
    is_creator: false,
    created_at: '2026-02-20T14:00:00Z',
  },
  {
    id: 'demo-goal-3',
    connection_id: 'demo-conn-1',
    title: '新年禮物基金',
    target_amount: 10000,
    target_date: '2026-02-01',
    status: 'completed',
    your_amount: 5500,
    peer_amount: 4500,
    your_name: 'Alex Chen',
    peer_name: '小明',
    your_user_id: 'demo-user-1',
    peer_user_id: 'demo-peer-1',
    total_amount: 10000,
    progress_pct: 100,
    is_creator: true,
    created_at: '2026-01-01T00:00:00Z',
  },
];

// Peer-comparison payload for the demo /savings Compare tab. Matches the backend's
// CompareDataResponse ({ users, chart }) using the same peer ids as
// demoPeerConnections/demoSharedGoals so avatars and names line up. The chart is a
// deterministic 12-month net-worth ramp per user (needs ≥2 points to render).
export const demoCompareData: CompareDataResponse = (() => {
  const users: PeerStatCard[] = [
    {
      user_id: 'demo-user-1',
      username: 'alexchen',
      name: 'Alex Chen',
      avatar_url: null,
      is_self: true,
      wallet_totals: { portfolio_total: 2_000_000, emergency_total: 250_000, cash_total: 0, life_total: 250_000, debt_total: 0, net_worth: 2_500_000 },
    },
    {
      user_id: 'demo-peer-1',
      username: 'minglin',
      name: '小明',
      avatar_url: null,
      is_self: false,
      wallet_totals: { portfolio_total: 1_200_000, emergency_total: 200_000, cash_total: 50_000, life_total: 350_000, debt_total: 0, net_worth: 1_800_000 },
    },
    {
      user_id: 'demo-peer-2',
      username: 'meiwang',
      name: '小美',
      avatar_url: null,
      is_self: false,
      wallet_totals: { portfolio_total: 2_600_000, emergency_total: 300_000, cash_total: 0, life_total: 300_000, debt_total: 0, net_worth: 3_200_000 },
    },
  ];

  // 12 month-end points ending at "now", each user ramping from ~80% → 100% of
  // their current net worth with a small deterministic wobble.
  const now = new Date();
  const chart: Array<{ date: string; [userId: string]: number | string }> = [];
  const MONTHS = 12;
  for (let i = MONTHS - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const t = (MONTHS - 1 - i) / (MONTHS - 1); // 0 → 1
    const row: { date: string; [userId: string]: number | string } = { date: d.toISOString().slice(0, 10) };
    for (const u of users) {
      const wobble = 1 + (((i * 7) % 5) - 2) / 100; // ±2% deterministic
      row[u.user_id] = Math.round(u.wallet_totals.net_worth * (0.8 + 0.2 * t) * wobble);
    }
    chart.push(row);
  }
  return { users, chart };
})();

// ─── LINE Group (bill splitter) demo data ──────────────────────────────────────
// Shapes mirror the GET /line-bot/* responses consumed by the groups pages so the
// demo experience renders exactly like the live one (no backend calls).

interface DemoGroup {
  id: string;
  line_group_id: string;
  name: string | null;
  currency: string;
  member_count: number;
  created_at: string;
}

interface DemoGroupBalanceEntry {
  owed_by: string;
  owed_to: string;
  amount: string;
  currency: string;
}

interface DemoGroupBalances {
  group_id: string;
  currency: string;
  balances: DemoGroupBalanceEntry[];
  member_names: Record<string, string>;
}

interface DemoGroupMember {
  user_id: string;
  display_name: string | null;
  line_user_id: string;
}

interface DemoGroupExpenseSplit {
  user_id: string;
  amount: string;
}

interface DemoGroupExpense {
  id: string;
  payer_id: string;
  amount: string;
  currency: string;
  description: string;
  created_at: string;
  splits: DemoGroupExpenseSplit[];
}

export const demoLineLinkStatus = {
  linked: true,
  display_name: 'Alex Chen',
};

// Sample debts so the Loans page shows realistic data in demo mode
// (Asian-market example: a mortgage + a credit-card instalment).
// A wallet transfer, as create_transfer stores one: two rows sharing a group id,
// an expense leaving Life and an income arriving in Emergency. Without a pair like
// this in the fixtures, every surface that excludes transfers looked identical to
// one that ignored them, and demo mode could not show the difference.
export const demoTransferPair: Transaction[] = [
  {
    id: 'demo-txn-transfer-out',
    userId: demoUser.id,
    type: 'expense',
    amount: 50000,
    currency: 'TWD',
    category: 'Transfer',
    description: '\u7dca\u6025\u9810\u5099\u91d1\u8f49\u5165',
    date: businessToday(), // the app day is Asia/Taipei; the UTC day lags it until 08:00
    walletType: 'life',
    transferGroupId: 'demo-transfer-1',
    createdAt: new Date(),
    updatedAt: new Date(),
  } as Transaction,
  {
    id: 'demo-txn-transfer-in',
    userId: demoUser.id,
    type: 'income',
    amount: 50000,
    currency: 'TWD',
    category: 'Transfer',
    description: '\u7dca\u6025\u9810\u5099\u91d1\u8f49\u5165',
    date: businessToday(), // the app day is Asia/Taipei; the UTC day lags it until 08:00
    walletType: 'emergency',
    transferGroupId: 'demo-transfer-1',
    createdAt: new Date(),
    updatedAt: new Date(),
  } as Transaction,
];

/**
 * The next date falling on `day` of the month, from today: demo loans are always
 * due soon, never months overdue (they were pinned to August 2026, which aged
 * into "64 days overdue" once the payment calendar listed them).
 */
function demoNextDue(day: number): string {
  const now = new Date();
  let d = new Date(now.getFullYear(), now.getMonth(), day);
  if (d < new Date(now.getFullYear(), now.getMonth(), now.getDate())) {
    d = new Date(now.getFullYear(), now.getMonth() + 1, day);
  }
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Payoff months and interest left for a demo loan, from its own terms, by the
 * same simulator the Loans page planner runs. These were hand-typed once
 * ("≈206 payments / NT$980,000 interest left" on a NT$1.2M balance at 2.1% and
 * NT$22K a month — really 58 months and ~NT$62K) and nothing kept them true.
 */
function demoPayoff(balance: number, annualRatePct: number, minimumPayment: number) {
  const plan = minimumsOnly([{ id: 'demo', name: 'demo', balance, annualRatePct, minimumPayment }]);
  return {
    payoff_months_estimate: plan.months ?? 0,
    total_interest_remaining: Math.round(plan.totalInterest),
  };
}

export const demoLoans: DebtAccount[] = [
  {
    id: 'demo-loan-1',
    user_id: demoUser.id,
    name: '房屋貸款',
    lender_name: '國泰世華銀行',
    account_type: 'mortgage',
    principal_amount: 5_000_000,
    // Mostly repaid, which is the only way a mortgage tells an honest story
    // here: the app tracks the loan but not the property behind it, so a fresh
    // NT$3.8M balance against NT$2.5M of tracked assets renders the demo
    // permanently underwater — a state worth handling, not worth shipping as
    // the first thing a visitor sees. Started 2021; this is year five.
    current_balance: 1_200_000,
    interest_rate: 2.1,
    minimum_payment: 22_000,
    payment_due_day: 5,
    start_date: '2021-03-01',
    term_months: 360,
    currency: 'TWD',
    status: 'active',
    notes: null,
    created_at: '2021-03-01T00:00:00Z',
    updated_at: '2026-07-01T00:00:00Z',
    // (principal - current_balance) / principal — kept in step with the balance
    // above, or the card draws a 24% bar beside a balance that is 76% repaid.
    progress_pct: 76,
    months_remaining: 300,
    // Paying above the scheduled amount, so it clears well ahead of the term.
    ...demoPayoff(1_200_000, 2.1, 22_000),
    // A getter: computed on every read, so a long-running server never freezes it.
    get next_payment_date() { return demoNextDue(5); },
  },
  {
    id: 'demo-loan-2',
    user_id: demoUser.id,
    name: '信用卡分期',
    lender_name: '玉山銀行',
    account_type: 'credit_card',
    principal_amount: 80_000,
    current_balance: 45_000,
    interest_rate: 15,
    minimum_payment: 5_000,
    payment_due_day: 20,
    start_date: '2025-11-01',
    term_months: 12,
    currency: 'TWD',
    status: 'active',
    notes: null,
    created_at: '2025-11-01T00:00:00Z',
    updated_at: '2026-07-01T00:00:00Z',
    progress_pct: 44,
    months_remaining: 6,
    // Minimum payment lags the term — clears a few months late.
    ...demoPayoff(45_000, 15, 5_000),
    // A getter: computed on every read, so a long-running server never freezes it.
    get next_payment_date() { return demoNextDue(20); },
  },
];

// Stable member ids reused across groups, balances, members and expenses so the
// same person always resolves to the same display name on both pages.
const DEMO_GM_ALEX = 'demo-gm-alex';
const DEMO_GM_MING = 'demo-gm-ming';
const DEMO_GM_MEI = 'demo-gm-mei';
const DEMO_GM_JOHN = 'demo-gm-john';

/** The demo viewer's member id inside the demo groups (Alex Chen, matching
 *  demoLineLinkStatus) — what "you" resolves to on the groups pages in demo. */
export const DEMO_GROUP_SELF_ID = DEMO_GM_ALEX;

const demoGroupMemberNames: Record<string, string> = {
  [DEMO_GM_ALEX]: 'Alex Chen',
  [DEMO_GM_MING]: '小明',
  [DEMO_GM_MEI]: '小美',
  [DEMO_GM_JOHN]: 'John',
};

// Recent dates, so the "this month" per-member stats card is populated. These
// were fixed days of the month (3rd, 12th, 15th), which put expenses in the
// future for the first half of every month. Now: `daysAgo` days back, clamped
// to the 1st of this month, and never later than now.
const _now = new Date();
const _thisMonth = (daysAgo: number, hour = 12) => {
  const first = new Date(_now.getFullYear(), _now.getMonth(), 1, hour, 0, 0);
  let d = new Date(_now.getFullYear(), _now.getMonth(), _now.getDate() - daysAgo, hour, 0, 0);
  if (d < first) d = first;
  if (d > _now) d = new Date(_now.getTime() - (daysAgo + 1) * 60 * 60 * 1000);
  return d.toISOString();
};
/** A day in the previous calendar month — always in the past. */
const _lastMonth = (day: number, hour = 12) =>
  new Date(_now.getFullYear(), _now.getMonth() - 1, day, hour, 0, 0).toISOString();

export const demoGroups: DemoGroup[] = [
  {
    id: 'demo-group-1',
    line_group_id: 'Cdemo000000000000000000000000001',
    name: '台北室友',
    currency: 'TWD',
    member_count: 3,
    created_at: '2026-01-05T08:00:00Z',
  },
  {
    id: 'demo-group-2',
    line_group_id: 'Cdemo000000000000000000000000002',
    name: '日本旅遊團',
    currency: 'TWD',
    member_count: 4,
    created_at: '2026-03-12T10:00:00Z',
  },
];

export const demoGroupMembers: Record<string, DemoGroupMember[]> = {
  'demo-group-1': [
    { user_id: DEMO_GM_ALEX, display_name: demoGroupMemberNames[DEMO_GM_ALEX], line_user_id: 'Udemo01' },
    { user_id: DEMO_GM_MING, display_name: demoGroupMemberNames[DEMO_GM_MING], line_user_id: 'Udemo02' },
    { user_id: DEMO_GM_MEI, display_name: demoGroupMemberNames[DEMO_GM_MEI], line_user_id: 'Udemo03' },
  ],
  'demo-group-2': [
    { user_id: DEMO_GM_ALEX, display_name: demoGroupMemberNames[DEMO_GM_ALEX], line_user_id: 'Udemo01' },
    { user_id: DEMO_GM_MING, display_name: demoGroupMemberNames[DEMO_GM_MING], line_user_id: 'Udemo02' },
    { user_id: DEMO_GM_MEI, display_name: demoGroupMemberNames[DEMO_GM_MEI], line_user_id: 'Udemo03' },
    { user_id: DEMO_GM_JOHN, display_name: demoGroupMemberNames[DEMO_GM_JOHN], line_user_id: 'Udemo04' },
  ],
};

export const demoGroupBalances: Record<string, DemoGroupBalances> = {
  'demo-group-1': {
    group_id: 'demo-group-1',
    currency: 'TWD',
    member_names: {
      [DEMO_GM_ALEX]: demoGroupMemberNames[DEMO_GM_ALEX],
      [DEMO_GM_MING]: demoGroupMemberNames[DEMO_GM_MING],
      [DEMO_GM_MEI]: demoGroupMemberNames[DEMO_GM_MEI],
    },
    balances: [
      { owed_by: DEMO_GM_MING, owed_to: DEMO_GM_ALEX, amount: '1200', currency: 'TWD' },
      { owed_by: DEMO_GM_MEI, owed_to: DEMO_GM_ALEX, amount: '450', currency: 'TWD' },
    ],
  },
  // Fully settled group to exercise the "all settled up" empty state.
  'demo-group-2': {
    group_id: 'demo-group-2',
    currency: 'TWD',
    member_names: {
      [DEMO_GM_ALEX]: demoGroupMemberNames[DEMO_GM_ALEX],
      [DEMO_GM_MING]: demoGroupMemberNames[DEMO_GM_MING],
      [DEMO_GM_MEI]: demoGroupMemberNames[DEMO_GM_MEI],
      [DEMO_GM_JOHN]: demoGroupMemberNames[DEMO_GM_JOHN],
    },
    balances: [],
  },
};

export const demoGroupExpenses: Record<string, DemoGroupExpense[]> = {
  'demo-group-1': [
    {
      id: 'demo-gx-1',
      payer_id: DEMO_GM_ALEX,
      amount: '3600',
      currency: 'TWD',
      description: '水電瓦斯費',
      created_at: _thisMonth(6, 9),
      splits: [
        { user_id: DEMO_GM_ALEX, amount: '1200' },
        { user_id: DEMO_GM_MING, amount: '1200' },
        { user_id: DEMO_GM_MEI, amount: '1200' },
      ],
    },
    {
      id: 'demo-gx-2',
      payer_id: DEMO_GM_ALEX,
      amount: '900',
      currency: 'TWD',
      description: '週末火鍋',
      created_at: _thisMonth(3, 19),
      splits: [
        { user_id: DEMO_GM_ALEX, amount: '300' },
        { user_id: DEMO_GM_MING, amount: '300' },
        { user_id: DEMO_GM_MEI, amount: '300' },
      ],
    },
    {
      // Authored (with the expenses above) so the four net exactly to the
      // demoGroupBalances source of truth: Ming→Alex 1200, Mei→Alex 450.
      // Alex 2400+600-800-550=+1650, Ming -1200-300-800+1100=-1200,
      // Mei -1200-300+1600-550=-450. Keeps initial render and post-write
      // recomputeBalances() consistent.
      id: 'demo-gx-3',
      payer_id: DEMO_GM_MEI,
      amount: '2400',
      currency: 'TWD',
      description: '日用品 Costco',
      created_at: _thisMonth(1, 14),
      splits: [
        { user_id: DEMO_GM_ALEX, amount: '800' },
        { user_id: DEMO_GM_MING, amount: '800' },
        { user_id: DEMO_GM_MEI, amount: '800' },
      ],
    },
    {
      id: 'demo-gx-4',
      payer_id: DEMO_GM_MING,
      amount: '1650',
      currency: 'TWD',
      description: '上個月外送',
      created_at: _lastMonth(20, 18),
      splits: [
        { user_id: DEMO_GM_ALEX, amount: '550' },
        { user_id: DEMO_GM_MING, amount: '550' },
        { user_id: DEMO_GM_MEI, amount: '550' },
      ],
    },
  ],
  // Fully-settled group: each of the four members paid one 4,800 expense split
  // evenly (1,200 each), so everyone paid exactly their fair share and the four
  // net to zero. This keeps recomputeBalances(expenses) === [] consistent with
  // the empty demoGroupBalances seed, so the "all settled up" state survives a
  // demo write instead of suddenly surfacing historical debts.
  'demo-group-2': [
    {
      id: 'demo-gx-5',
      payer_id: DEMO_GM_JOHN,
      amount: '4800',
      currency: 'TWD',
      description: '東京住宿',
      created_at: '2026-04-02T15:00:00Z',
      splits: [
        { user_id: DEMO_GM_ALEX, amount: '1200' },
        { user_id: DEMO_GM_MING, amount: '1200' },
        { user_id: DEMO_GM_MEI, amount: '1200' },
        { user_id: DEMO_GM_JOHN, amount: '1200' },
      ],
    },
    {
      id: 'demo-gx-6',
      payer_id: DEMO_GM_ALEX,
      amount: '4800',
      currency: 'TWD',
      description: '迪士尼門票',
      created_at: '2026-04-04T09:00:00Z',
      splits: [
        { user_id: DEMO_GM_ALEX, amount: '1200' },
        { user_id: DEMO_GM_MING, amount: '1200' },
        { user_id: DEMO_GM_MEI, amount: '1200' },
        { user_id: DEMO_GM_JOHN, amount: '1200' },
      ],
    },
    {
      id: 'demo-gx-7',
      payer_id: DEMO_GM_MING,
      amount: '4800',
      currency: 'TWD',
      description: '拉麵聚餐',
      created_at: '2026-04-05T12:30:00Z',
      splits: [
        { user_id: DEMO_GM_ALEX, amount: '1200' },
        { user_id: DEMO_GM_MING, amount: '1200' },
        { user_id: DEMO_GM_MEI, amount: '1200' },
        { user_id: DEMO_GM_JOHN, amount: '1200' },
      ],
    },
    {
      id: 'demo-gx-8',
      payer_id: DEMO_GM_MEI,
      amount: '4800',
      currency: 'TWD',
      description: '伴手禮',
      created_at: '2026-04-06T16:00:00Z',
      splits: [
        { user_id: DEMO_GM_ALEX, amount: '1200' },
        { user_id: DEMO_GM_MING, amount: '1200' },
        { user_id: DEMO_GM_MEI, amount: '1200' },
        { user_id: DEMO_GM_JOHN, amount: '1200' },
      ],
    },
  ],
};

export const demoSavingRecords: Record<string, SavingRecord[]> = {
  'demo-goal-1': [
    { id: 'rec-1a', goal_id: 'demo-goal-1', user_id: 'demo-user-1', user_name: 'Alex Chen', amount: 5000, record_date: '2026-01-20', note: 'Monthly savings', created_at: '2026-01-20T10:00:00Z' },
    { id: 'rec-1b', goal_id: 'demo-goal-1', user_id: 'demo-peer-1', user_name: '小明', amount: 4000, record_date: '2026-01-22', note: null, created_at: '2026-01-22T09:00:00Z' },
    { id: 'rec-1c', goal_id: 'demo-goal-1', user_id: 'demo-user-1', user_name: 'Alex Chen', amount: 7000, record_date: '2026-02-15', note: 'Bonus savings', created_at: '2026-02-15T11:00:00Z' },
    { id: 'rec-1d', goal_id: 'demo-goal-1', user_id: 'demo-peer-1', user_name: '小明', amount: 8000, record_date: '2026-03-10', note: 'March contribution', created_at: '2026-03-10T08:00:00Z' },
    { id: 'rec-1e', goal_id: 'demo-goal-1', user_id: 'demo-user-1', user_name: 'Alex Chen', amount: 6000, record_date: '2026-04-05', note: null, created_at: '2026-04-05T14:00:00Z' },
  ],
  'demo-goal-2': [
    { id: 'rec-2a', goal_id: 'demo-goal-2', user_id: 'demo-user-1', user_name: 'Alex Chen', amount: 15000, record_date: '2026-02-25', note: 'Initial deposit', created_at: '2026-02-25T09:00:00Z' },
    { id: 'rec-2b', goal_id: 'demo-goal-2', user_id: 'demo-peer-2', user_name: '小美', amount: 12000, record_date: '2026-03-01', note: null, created_at: '2026-03-01T10:00:00Z' },
    { id: 'rec-2c', goal_id: 'demo-goal-2', user_id: 'demo-user-1', user_name: 'Alex Chen', amount: 15000, record_date: '2026-04-20', note: 'April savings', created_at: '2026-04-20T11:00:00Z' },
    { id: 'rec-2d', goal_id: 'demo-goal-2', user_id: 'demo-peer-2', user_name: '小美', amount: 13000, record_date: '2026-05-10', note: null, created_at: '2026-05-10T09:00:00Z' },
  ],
  'demo-goal-3': [
    { id: 'rec-3a', goal_id: 'demo-goal-3', user_id: 'demo-user-1', user_name: 'Alex Chen', amount: 5500, record_date: '2025-12-20', note: 'Gift fund', created_at: '2025-12-20T10:00:00Z' },
    { id: 'rec-3b', goal_id: 'demo-goal-3', user_id: 'demo-peer-1', user_name: '小明', amount: 4500, record_date: '2025-12-25', note: null, created_at: '2025-12-25T08:00:00Z' },
  ],
};
