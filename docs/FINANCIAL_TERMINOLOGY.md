# Financial Terminology Guide

**Last Updated:** July 29, 2026

This guide clarifies the financial terms used throughout Aspiro to avoid confusion.

---

## 📊 Visual Overview

```
┌──────────────────────────────────────────────────────────┐
│                     TOTAL ASSET 💎                       │
│              (Everything You Own)                        │
│                    NT$1,000,000                          │
├──────────────────────────────────────────────────────────┤
│                                                          │
│  ┌─────────────┐   ┌─────────────┐   ┌─────────────┐     │
│  │ Life Wallet │   │  Emergency  │   │  Portfolio  │     │
│  │     💰      │   │   Wallet    │   │     📈      │     │
│  │             │   │     🚨      │   │             │     │
│  │   50,000    │   │   150,000   │   │   800,000   │     │
│  │    TWD      │   │    TWD      │   │    TWD      │     │
│  └─────────────┘   └─────────────┘   └─────────────┘     │
│   Daily cash        Emergency fund    INVESTED           │
│   for living        (cash + parked    assets —           │
│                      holdings)         never cash        │
└──────────────────────────────────────────────────────────┘
              │                              │
              │                              │
    ┌─────────▼──────────┐        ┌──────────▼─────────┐
    │   Net Worth 🏆     │        │ Investment Total 📈│
    │ Total Asset − Debt │        │  (Only Invested)   │
    │    NT$850,000      │        │    NT$800,000      │
    └────────────────────┘        └────────────────────┘
      Debt: NT$150,000              Portfolio wallet only
```

**Key Insight:**
- **Total Asset** = all 3 wallets combined (everything you own)
- **Net Worth** = Total Asset − debt (what you'd keep if you settled up)
- **Investment Total** = only the Portfolio wallet (money in the market)

---

## Core Financial Metrics

### 🏦 Three-Wallet System

Aspiro uses a three-wallet system to organize your finances:

| Wallet | Purpose | Examples |
|--------|---------|----------|
| **Life Wallet** | Daily living, bills, expenses | Groceries, rent, utilities, entertainment |
| **Emergency Wallet** | Emergency fund, safety net | Emergency savings, insurance funds, holdings parked as reserve |
| **Portfolio Wallet** | Invested assets (stocks, ETFs, crypto) | Stock holdings, ETF positions, crypto assets |

Cash lives only in **Life** and **Emergency**. The **Portfolio** wallet holds assets, never cash — money enters it by buying a holding (which debits Life) and leaves it by selling (which credits Life back).

> **Was four wallets until 2026-05-02.** The `Investment` wallet (cash staged for trading) was removed and its transactions re-classified to Life; `Portfolio Performance` → `Portfolio` and `Urgent` → `Emergency` were renamed. Older docs and comments may still use the old names.

---

## Dashboard Metrics Explained

### 1. **Total Asset** 💎
**What it is:** The sum of all three wallets — everything you own

**Formula:**
```
Total Asset = Life Wallet + Emergency Wallet + Portfolio Wallet
```

**Example:**
- Life Wallet: NT$50,000 (daily cash)
- Emergency Wallet: NT$150,000 (emergency fund)
- Portfolio Wallet: NT$800,000 (stocks & ETFs)
- **Total Asset = NT$1,000,000**

**Where you see it:** Dashboard hero section, main financial overview

**Why it matters:** This is everything you own. It does **not** subtract what you owe — for that, see Net Worth.

---

### 2. **Investment Total** 📈
**What it is:** Only the value of your invested assets (stocks, ETFs, crypto)

**Formula:**
```
Investment Total = Portfolio Wallet only
```

**Example:**
Using the same scenario:
- **Investment Total = NT$800,000** (only the stocks & ETFs)

**Where you see it:** Dashboard hero section, investment tracking

**Why it matters:** Shows how much money you have **actively invested** in the market

**Key Difference from Total Asset:**
- Total Asset also includes your cash (Life and Emergency wallets)
- Investment Total only includes **invested positions** (stocks, ETFs, crypto)

---

### 3. **Total Value** (Portfolio Page) 💼
**What it is:** Current market value of all holdings shown on the portfolio page

**Context:**
- On portfolio page with "All Wallets" filter: every holding you own
- On portfolio page with a wallet filter (e.g. "Emergency"): holdings in that wallet only

**Formula:**
```
Total Value = Sum of (quantity × current_price) for all visible holdings
```

**Example:**
If viewing only the Emergency Wallet:
- Holdings parked as reserve: NT$150,000
- **Total Value = NT$150,000**

If viewing All Wallets:
- All holdings across both holding wallets
- **Total Value = NT$950,000** (Portfolio + Emergency — note this excludes Life Wallet cash, so it does *not* equal Total Asset)

**Where you see it:** Portfolio page header, PortfolioStats component

---

### 4. **Net Worth** 🏆
**What it is:** What you actually own after subtracting what you owe

**Formula:**
```
Net Worth = Total Asset − Total Debt
```

**Example:**
- Total Asset: NT$1,000,000
- Total Debt: NT$150,000 (sum of `current_balance` across active, non-deleted debt accounts)
- **Net Worth = NT$850,000**

**Where you see it:** Dashboard net-worth card and trend chart, API responses

> ⚠️ **This changed.** Net Worth used to be a legacy alias for Total Asset. It is now a distinct figure that subtracts liabilities (`dashboard/services.py`). If you find code or docs treating the two as interchangeable, that code is stale.

---

### 5. **Portfolio Value** (Legacy) 📊
**What it is:** Legacy calculation for the portfolio page

**Formula:**
```
Portfolio Value = Portfolio Wallet + Emergency Wallet
```

**Note:** Excludes Life Wallet (daily spending money). This is the sum of the two *holding* wallets.

**Status:** Legacy field, prefer using Total Asset or Investment Total

---

## Income vs. Asset Terms

### **Total Income**
- Money coming IN during a period
- Salary, dividends, interest, side income
- Tracked in transactions page

### **Total Expenses**
- Money going OUT during a period
- Bills, purchases, subscriptions
- Tracked in transactions page

### **Savings Rate**
```
Savings Rate = (Total Income - Total Expenses) / Total Income × 100%
```

**Example:**
- Income: NT$100,000/month
- Expenses: NT$70,000/month
- **Savings Rate = 30%**

---

## Returns & Risk (Portfolio Wallet)

All of these measure the **Portfolio wallet only**, in **TWD**, with your own deposits taken out. They share one source: the time-weighted return's daily returns. Never compute a portfolio return from `value / cost` or from a value series rebuilt from today's quantities. Both were in the code until 2026-10, and both were wrong (see "Data rules" below).

### Time-weighted return (TWR)
- **Formula:** a day's return is `r_d = (V_d − CF_d) / V_{d−1} − 1`, and `TWR = Π(1 + r_d) − 1`.
  - `V_d` is the end-of-day value of what you held, in TWD at that day's USD/TWD rate.
  - `CF_d` is the units bought minus sold that day, **priced at that day's close**, so trading contributes zero and only price and FX moves count.
- **Units held** on each day come from lots plus ledger sells (see "Data rules").
- **Missing data:** missing closes carry forward. Before a symbol's first close, its trade price stands in. Every stand-in is counted in `data_quality`.
- **Annualised** only with at least 365 days invested (`twr.py`); a few months are never annualised.
- **Where:** `backend/app/modules/portfolio/twr.py` (pure, hand-tested); `PerformanceTracker.calculate_time_weighted_return`; `GET /portfolio/performance/time-weighted-return`.

### Annual return (stats strip, formerly "CAGR")
- **What it is:** the TWR since inception, annualised.
- **Shown only when** it is annualised and `data_quality.real_price_share ≥ 0.9`; otherwise nothing.
- **Never** `(value / cost)^(1 / years since the first lot)`. That treats every dollar as invested since the first purchase: it read 14% for a portfolio whose TWR is 40%.
- **Where:** `AnalyticsService.calculate_portfolio_performance` (`annual_return_from_twr`).

### Realized return (/lifecycle spread)
- **Default:** the annual return above. It is used when TWR has it and real-price coverage is ≥ 90%.
- **Fallback:** the value-weighted average of per-lot IRRs over the Portfolio wallet. It applies in demo mode and to portfolios under a year old.

### Per-lot IRR (`portfolio_holdings.irr`)
- **Formula:** the lot's own CAGR, `(value / cost)^(1/years) − 1` from **its** purchase date (`return_calculator.lot_irr`).
- **None** when the lot is held under a year.
- **Not** an XIRR over the symbol's ledger. That weighed every buy of every lot, duplicates included, against one lot's value, and produced −60% on lots up 88%.

### Volatility, max drawdown, Sharpe, best/worst day, win rate
- **Window:** the trailing 365 days of TWR daily returns (`metrics_calculator.risk_from_twr_returns`).
- **Weekends** are compounded into the next weekday: for stocks they are zero, while crypto moves on weekends.
- **Volatility:** stdev × √252.
- **Max drawdown:** on the growth index Π(1 + r), so a large buy cannot fake a recovery.
- **Sharpe:** `(annualised return − 4%) / volatility`, and only with at least 60 trading days.

### Beta (Dimson) and alpha
- **Benchmark:** a daily-rebalanced blend of **TAIEX** (`^TWII`) for the TWD book and **VT in TWD** (with that day's USD/TWD) for the USD book, weighted by today's split. Labelled e.g. `TAIEX/VT 62/38`.
  - It falls back to **SPY** when a leg doesn't span the window or is stale.
  - Each leg carries over its own market's holidays, as the TWR series does.
- **Beta** comes from one joint regression `r_d = a + b0·x_d + b1·x_{prev session}` and is reported as `b0 + b1`. Taipei closes before New York opens, so a US move reaches TW holdings the next session; same-day beta alone read 0.58 against 1.19.
  - It needs at least 60 paired days.
  - It is hidden when |β| > 3 or the benchmark's last close is more than 5 days old.
- **Alpha** is Jensen's alpha against the same benchmark over the **same** 365-day window. It is computed only when both the portfolio and the benchmark span that window and beta stands.

### Data rules these depend on
- **Lots are the truth for what is held; the ledger is the truth for what was sold.** `portfolio_transactions` holds a buy for every lot ever created, including closed re-import duplicates (877 on the main account as of 2026-10). A real sale zeroes its lot (`quantity = 0`). Never rebuild holdings by replaying ledger buys (`twr.build_trades`).
- **A bar is stored only once its session has closed** (`utils/market_sessions.py`):
  - TW and TAIEX (`TW-INDEX`) at 13:30 Taipei; US at 16:00 New York.
  - **FX (`TWD=X`) once its London day is over.** Yahoo dates FX bars at London midnight.
  - Backfill scripts apply the same rule.
- **Series nobody holds are refreshed by the daily sync explicitly:** `TWD=X`, `SPY`, `^TWII`, `VT` (`scheduler.sync_historical_data_for_all_users`).

---

## Quick Reference Table

| Term | Formula | What It Shows | Where Used |
|------|---------|---------------|------------|
| **Total Asset** | Life + Emergency + Portfolio | Everything you own | Dashboard |
| **Net Worth** | Total Asset − Total Debt | Assets minus liabilities | Dashboard, API responses |
| **Investment Total** | Portfolio wallet only | Actively invested money | Dashboard |
| **Total Value** | Sum of visible holdings | Current portfolio value | Portfolio page |
| **Portfolio Value** | Portfolio + Emergency | Legacy holding-wallet total | API responses |
| **Total Income** | Sum of income transactions | Money earned | Transactions |
| **Total Expenses** | Sum of expense transactions | Money spent | Transactions |
| **Savings Rate** | (Income - Expenses) / Income | % of income saved | Dashboard |
| **Annual return** | TWR since inception, annualised (≥1y, ≥90% real prices) | What the investments earned per year, deposits taken out | Portfolio stats, /lifecycle |
| **Per-lot IRR** | The lot's own CAGR from its purchase date (none under 1y) | One lot's return | `portfolio_holdings.irr` |
| **Beta / Alpha** | Dimson beta and Jensen's alpha vs TAIEX/VT blend, trailing year | Market sensitivity; excess return | Portfolio stats |

---

## Common Confusion Scenarios

### ❓ "Why is Total Asset higher than Investment Total?"

**Answer:** Total Asset includes ALL your money:
- ✅ Cash in Life Wallet (daily spending)
- ✅ Emergency fund (Emergency Wallet)
- ✅ Invested money (stocks, ETFs) ← This is Investment Total

**Think of it this way:**
- **Investment Total** = Money actively in the market
- **Total Asset** = Everything you own

---

### ❓ "Why don't Total Value and Total Asset match on Portfolio page?"

**Answer:** Two reasons — the wallet filter, and Life Wallet cash.

- **Filter = "All Wallets"** → Total Value = Portfolio + Emergency holdings
- **Filter = "Portfolio"** → Total Value = Only invested assets ✅
- **Filter = "Emergency"** → Total Value = Only holdings parked in the emergency fund ✅

Total Value never includes Life Wallet cash, because the portfolio page shows *holdings*. So even at "All Wallets" it sits below Total Asset by the amount of your Life Wallet balance.

---

### ❓ "What's the difference between Total Asset and Net Worth?"

**Answer:** Debt. Total Asset is everything you own; Net Worth subtracts everything you owe.

If you have NT$1,000,000 across your wallets and a NT$150,000 loan balance, your Total Asset is NT$1,000,000 but your Net Worth is NT$850,000.

---

### ❓ "Why can't I transfer cash into the Portfolio wallet?"

**Answer:** By design. The Portfolio wallet holds assets, never cash, so `portfolio` is rejected as a transfer target — cash transfers move only between Life and Emergency.

Money enters investments by **buying a holding**, which debits the Life Wallet. Selling credits the proceeds back to Life. That bridge is what stops the same money being counted twice.

---

## For Developers

### Backend Calculation (DashboardService)

```python
# Calculate three wallets
life_wallet = sum(transactions where wallet_type = 'life')
emergency_wallet = sum(transactions/holdings where wallet_type = 'emergency')
portfolio_wallet = sum(holdings where wallet_type = 'portfolio')

# Aggregated totals
total_asset = life_wallet + portfolio_wallet + emergency_wallet
total_debt = sum(current_balance for active, non-deleted debt accounts)
investment_total = portfolio_wallet          # Only invested assets
net_worth = total_asset - total_debt         # Assets minus liabilities

# Legacy fields
total_balance = life_wallet
portfolio_value = portfolio_wallet + emergency_wallet
```

Note that `emergency` appears in **both** enums — `TransactionWalletType.EMERGENCY` (cash) and `HoldingWalletType.EMERGENCY` (parked holdings) — while `life` is transaction-only and `portfolio` is holding-only.

### Frontend Usage

```typescript
// Dashboard - Show complete financial picture
<HeroStat label="Total Asset" value={stats.total_asset} />
<HeroStat label="Investment Total" value={stats.investment_total} />

// Portfolio Page - Show filtered holdings
<PortfolioStats 
  portfolio={{
    totalValue: filteredPortfolioStats.totalValue,  // Changes with filter
    totalCost: filteredPortfolioStats.totalCost,
  }}
/>
```

---

## Naming Conventions

### ✅ Preferred Terms (Use These)
- `total_asset` - Everything you own
- `net_worth` - Total asset minus debt
- `investment_total` - Value of invested assets only
- `totalValue` - Current market value (portfolio context)
- `savings_rate` - Percentage of income saved

### ⚠️ Legacy Terms (Avoid in New Code)
- `portfolio_value` - Use specific wallet calculations
- `total_balance` - Use `life_wallet` instead
- `investment_wallet`, `portfolio_performance_wallet`, `urgent_wallet` - Removed in the 2026-05-02 three-wallet migration

---

## Related Documentation

- [Architecture Overview](./ARCHITECTURE.md) — system design, module layout, and the data model
- [Product Overview](./PRODUCT_OVERVIEW.md) — what each feature does with these numbers
- API reference — Swagger at `/docs` on a running backend

If a term here stops matching the code, fix this file in the same change.
