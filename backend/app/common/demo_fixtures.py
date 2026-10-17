"""The demo account, in one place.

Demo data is served by two modules that know nothing about each other —
`dashboard` answers with the balance sheet and cash flow, `portfolio` with the
holdings and the rebalancing plan — and a visitor reads both on consecutive
screens. Every time these numbers have been written down twice they have
drifted: the portfolio existed in six transcriptions at once (NT$28,450 on one
screen, NT$2,000,000 on the next), the dashboard reported no debt while the
loans page reported NT$3.85M, and `/dashboard/stats` served a net worth of
23,400 beside a NT$2.5M balance sheet.

So the figures live here and the fixtures derive from them. The frontend's own
demo fixtures mirror these; `test_demo_portfolio_consistency.py` and
`demoFixtureConsistency.test.ts` assert the relationships on each side.
"""

# ── Balance sheet ────────────────────────────────────────────────────────────
DEMO_LIFE_WALLET = 250_000.0  # NT$250K for daily expenses
DEMO_PORTFOLIO_WALLET = 2_000_000.0  # NT$2M invested assets
DEMO_EMERGENCY_WALLET = 250_000.0  # NT$250K emergency fund
DEMO_TOTAL_ASSET = DEMO_LIFE_WALLET + DEMO_PORTFOLIO_WALLET + DEMO_EMERGENCY_WALLET

# The two demo loans, mirroring `demoLoans` in frontend/src/data/demoData.ts.
#
# Named separately so the split and the total are both derived from them: a bare
# `1200000.0 / 1245000.0` was a cross-language copy of two numbers that live in
# the fixture, and would have gone stale the first time the demo mortgage was
# paid down further — the very drift the frontend fixture tests exist to catch,
# in the one place those tests cannot see.
DEMO_MORTGAGE_BALANCE = 1_200_000.0
DEMO_CARD_BALANCE = 45_000.0
DEMO_TOTAL_DEBT = DEMO_MORTGAGE_BALANCE + DEMO_CARD_BALANCE
DEMO_MORTGAGE_SHARE = DEMO_MORTGAGE_BALANCE / DEMO_TOTAL_DEBT

DEMO_NET_WORTH = DEMO_TOTAL_ASSET - DEMO_TOTAL_DEBT

# ── One month of cash flow ───────────────────────────────────────────────────
# In the currency the wallets are denominated in. These were 4,200 against
# 2,850.75 — dollars, from a fixture predating the NT$ demo account.
DEMO_MONTHLY_INCOME = 78_000.0
DEMO_MONTHLY_EXPENSES = 32_200.0
DEMO_INVESTMENT_RETURN = 8.5  # % — demo-only; the real stats leave this at 0


def demo_savings_rate(income: float, expenses: float) -> float:
    """Percent of income kept. Zero income keeps nothing, and divides by nothing."""
    return round((income - expenses) / income * 100, 2) if income else 0.0


# `portfolio_value` is the legacy SUM of the portfolio and emergency wallets, as
# `dashboard/services.py::get_dashboard_stats` defines it. Named here so the two
# modules that report it cannot disagree about which wallets it covers.
DEMO_PORTFOLIO_VALUE_LEGACY = DEMO_PORTFOLIO_WALLET + DEMO_EMERGENCY_WALLET

# Coverage is a ratio against a MONTHLY spending rate, never a window's total —
# see `_calc_emergency_fund_months`, which measures the window to get one.
DEMO_EMERGENCY_FUND_MONTHS = round(DEMO_EMERGENCY_WALLET / DEMO_MONTHLY_EXPENSES, 2)
