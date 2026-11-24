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
**What it is:** Current market value of the Portfolio wallet's holdings, the same figure as Investment Total

**Context:**
- The portfolio page shows the Portfolio wallet only. Emergency-wallet holdings (legacy cash at a fixed price; Emergency money is cash transactions) are left out of its list, charts and totals, and counted under Emergency on the dashboard.

**Formula:**
```
Total Value = Sum of (quantity × current_price) for Portfolio-wallet holdings
```

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

### Pass-through money (`transactions.pass_through`, "Not my own spending")
Money that only passed through the user: a deposit (押金, 訂金), something bought for a friend (代購), a bill paid for family, and the refund or repayment that comes back. The wallet still moves, so every balance counts it. The figures that answer "what did I spend or earn" leave it out, the same places a wallet transfer is left out:
- the Monthly Summary (no bucket, not in `total` or `income`; the page says how much it left out);
- `living_expenses` (emergency-fund cover) and the spending alert, which now compares living expenses rather than every outflow;
- the trailing averages (`useExpenseBreakdown`, `useAnnualCashFlow`) and the phone's month hero;
- the Transactions page totals when "Only my own money" is on (`exclude_transfers`).
The reports (`/review`) still count it, so they reconcile with the wallets, but as its own "Pass-through" slice rather than under its category. Its "biggest expenses" list is the exception: it uses the "Only my own money" filter, so a deposit is a slice of the total but never one of your biggest expenses.

### Bills (`/transactions/recurring`)
A bill is a recurring rule without `auto_create`: nothing posts it. On its due date it waits on the Bills page, where the user records it at what it really cost (the rule then remembers that amount) or skips it. Recording claims the occurrence first (`next_occurrence` must still be the date the user saw), so a second tap or device gets 409 and one occurrence never records twice. Bills split with a partner are `auto_create` rules managed from Savings and do not appear here. Suggestions come from the user's own expenses: the same description in at least 3 of the last 6 months, about once a month, seen in the last two, Dining and Groceries excluded.

---

### Shared bills with a partner (`/savings`, Shared spending)

Split bills are recorded on a **share basis** (`peers/splits.py`):

- Each person's ledger holds an ordinary expense for **their own share only**. Across the two ledgers the shares add up to exactly the cash that left, so every total, review and dashboard figure is right with no special case.
- Nothing reaches a partner's ledger until they accept (or have chosen auto-accept). Until then the payer's row carries the whole bill.
- The **balance** (who owes whom, per currency) is derived, never stored. It equals the accepted splits less the confirmed repayments.
- **Splitting an expense you already recorded** ("Split with partner" on a transaction) reuses that row as the payer's share instead of writing a new one, and the split records it in `source_transaction_id`. Withdrawing, a decline or a cancel hands it back whole and unlinked; it is never deleted. Expenses that can't be split: income, transfer legs, holding purchases, loan repayments (shrinking one would put the loan's balance out of step), and rows already in a split.
- **So the cash wallets differ from the bank while a balance is open.** Pay a 1,000 bill and split it, and the app counts 500 spent while the bank shows 1,000 gone, until your partner pays you back; the reverse when they paid. Net worth already includes the money owed to you. The dashboard's Shared bills note (`SharedBalanceNote`) states the gap per currency.
- **Finding and exporting them:** on Transactions, "Shared bills only" (`?shared=shared`, API `shared_only=true`) lists the rows of open splits. The CSV and Excel exports add `Shared Bill Total` and `Shared With` on those rows, so your share can be read against the whole bill your bank saw.
- **Changing an accepted split** takes both people: one proposes a new total, division or description (the payer stays), and only when the other accepts do the split and both ledger rows take the new figures (`peer_split_amendments`, one open per split). Closing the split drops an open change.
- **Cancelling an accepted split:** the payer cancels directly (it only moves cost onto themselves). The other person can only **ask** to cancel (`POST /splits/{id}/cancel-request`): a `peer_split_amendments` row with `kind = 'cancel'`, so it shares the one-open-change limit. If the payer accepts, the split closes as if they had cancelled it; declining or withdrawing changes nothing.
- **Changing a split not yet answered** is the creator's alone and applies at once (same `POST /splits/{id}/amend`): the partner hasn't agreed to anything, so they just see the updated bill. The creator's row follows as when proposing (the payer's carries the whole bill, a non-payer's their share). A split made from an expense the payer recorded keeps its total, so a withdraw still hands that expense back as it was.
- **Repeating bills** ("Repeat this bill", weekly / monthly / yearly, when splitting a bill you paid) are a recurring expense of the payer's (`recurring_transactions.split_connection_id`): each occurrence the scheduler posts is split as "Split with partner" would split it. If it can't be (the partner turned splitting off), the occurrence stays an ordinary expense and the rule carries on; removing the partner turns the rule's splitting off. Both people see the rule (the partner read-only, `payer_is_me: false`); only the payer can stop it.
- **Settling up writes no transactions.** The payer's ledger already shows only their share, so it already reads as if they had been paid back. A repayment row would count the money twice. A settlement only lowers the balance.
- A row linked to an open split can't be deleted, and its amount can't be edited. Closing a split (cancel, or removing the partner) unlinks its rows, and they become ordinary expenses.

### Goal money: reserved, not moved (`goals/reservations.py`)

A goal never holds money of its own and is not a wallet. It **reserves** Life Wallet cash:

- **Reserve / release** (`POST /goals/{id}/reserve`, `/release`) write a `goal_contributions` row (`kind` = `reserve` / `release`, signed amount) and **no transaction**. The cash stays in Life, so Life, Total Asset and Net Worth never change because of a goal.
- **Life available = Life balance − Σ reserved over the user's goals** (`GET /goals/life-cash`; a cancelled goal holds nothing). A reservation can't exceed what is available. Spending can: Available then goes negative, and the UI says so rather than blocking the expense.
- **Paying from a goal** is an ordinary Life expense carrying `transactions.goal_id`. It counts as spending everywhere, and moves the goal's money from *reserved* to *spent*, so Available does not drop a second time. It can't exceed what the goal holds. Unlinking, editing or deleting the expense gives the money back to the goal: every figure is derived from rows.
- **Progress** (`goals.current_amount`) = Σ contribution rows = what was put in. Every write re-reads it from the rows. Spending and investing do not lower it; releasing does (and reopens a completed goal that falls below target). Cancelling a goal releases what it holds.
- **Investing goal money** (`portfolio_holdings.goal_id`): a buy paid with a goal's money is the usual Life expense (the buy leg), carrying the goal's id. Reserved drops by the cost, Available does not move, and the lot's market value counts toward the goal as *invested*. It can't exceed what the goal holds. Every goal-funded buy leaves Life, including a cash or lending lot in the Portfolio wallet (a fixed deposit), which otherwise moves no money. A goal's lots never merge with, or sell as part of, lots that are not the goal's; a sale's proceeds carry the goal's id back to its reserve. Deleting the holding withdraws its leg, so the cash returns to the goal.
- **Value** = reserved + spent + legacy + invested at market value: progress counting the goal's holdings at today's price. The goal card shows it once anything is invested, and warns when a goal due within 3 years holds stocks, funds or crypto (cash, lending and CPF lots are steady).
- **Legacy** rows are progress recorded before reservations existed (2026-11-14 migration): they count toward the goal but hold no cash.
- **Shared goals (couples, `peers`)** are two personal goals, one per partner (`goals.shared_goal_id`). A side is that partner's goal: its target is their *part*, its value (reserved + spent + legacy + invested) their amount. The shared goal holds no money and no target of its own: its target is the sum of the two parts and its amount the sum of the two values, so each partner sets and edits only their own part. Creating one makes the creator's part (a new goal of the amount they give, or a goal they already have); the partner adds theirs with `POST /peers/goals/{id}/link-goal` (default: the creator's part). A part must be the caller's own, not cancelled, and not another shared goal's. Each partner reserves only their own Life cash and sees only the other side's totals; the history (`GET /peers/goals/{id}/history`) shows each side's net progress per day, never notes. It is "completed" only once both parts exist and the sum is met, read from today's totals. Cancelling a part unlinks it; deleting the shared goal leaves both parts. Saving records (typed amounts holding no cash) were retired on 2026-11-16 and became `legacy` progress on each partner's part.
- **A sale's gain or loss** on a goal's lot is a contribution row (`kind = gain`), measured against what the goal paid: each lot's buy legs in TWD over the native amount its buys cost. Proceeds are booked at the sale day's rate, so an exchange-rate move between buy and sale is part of the gain, and releasing everything ends at exactly 0. Goal money (buys, sales, lot edits) always books in TWD: a USD trade with no rate for the day uses the last stored USD/TWD close from the past 31 days, and a trade with no usable rate is refused, rather than leaving the goal's progress short of its money. Once a sale has taken units from a lot (any lot, a goal's or not), the lot's quantity and cost can't be edited (its buy still covers the sold units, whose cost the sale booked), nor can it be deleted (that would refund the sold units). Its date can still be corrected, but not to after the sale.
- **Emergency-fund goals** (`category = emergency_fund`) follow the Emergency Wallet: their value is its balance (cash plus holdings parked there, in TWD), the money being set aside by a Life → Emergency transfer. Reserving Life cash for one is refused; release stays open for cash reserved before this rule. Its status follows the wallet too: completed while the wallet covers the target, active again when the wallet falls below it (stored when goals are listed or summarised and after an edit; achievements and the month review read the same rule without writing; never judged from its contribution rows; paused and cancelled are left alone). As one side of a shared goal it counts the Emergency Wallet too. Marking one completed by hand below its target is refused: lower the target instead.
- **A shared goal's stored status and "reached" alert** follow the parts: a reservation, release, sale gain or new target on either part re-judges the shared goal, and a reservation tells the partner.
- Goals are kept in **TWD**, the currency of every wallet balance. A foreign-currency expense is converted at the same rates the wallets use.

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

## Market Valuation (Dashboard)

### Taiwan CAPE (Shiller P/E of the TAIEX)
- **Formula:** `CAPE_t = (TAIEX_t / CPI_t) / mean over the 120 months to t of (E_s / CPI_s)`, where `E_s = TAIEX_s / market P/E_s` is the TAIEX's earnings that month.
- **Market P/E** for a day is total market cap over total trailing-four-quarter earnings of the listed companies TWSE gives a P/E for (positive earnings): per stock, cap = close × shares issued and earnings = cap / P/E. Loss-makers have no P/E, so they are left out rather than subtracted, which flatters earnings in a bad year.
- **Inputs, one row a month** (`tw_market_valuations`): TWSE's dated reports MI_INDEX (closes; the TAIEX from ~2009), FMTQIK (the TAIEX for older months), BWIBBU_d (P/E) and MI_QFIIS (shares), read on the month's last trading day; DGBAS's general CPI (2021 = 100) once published; its download URL is read from the data.gov.tw catalogue (dataset 6019), and every fetch rewrites the whole CPI column so a new base year cannot mix bases. Since 2005-10, so the series starts in 2015-03.
- **Window:** a CAPE needs at least 114 of the 120 months (a few may be missing after an outage) reaching back about ten years.
- **Reading:** the share of earlier months whose CAPE was strictly lower ("higher than 94% of months"). Fewer than 20% lower is **cheap**, more than 80% **expensive**, otherwise **fair**. The API returns both band edges as CAPE values (`cheapAtOrBelow`, `expensiveAbove`) and the card's dashed lines are drawn at them. Not a fixed number: Taiwan's ten-year earnings average lags how fast its largest companies' profits grew, so a US-style "above 30" would say expensive every month.
- **Where:** `backend/app/modules/market/` (`valuation.py` is the pure math); `GET /market/tw-cape` (public); refreshed by the daily job `sync_tw_market` (08:30 UTC) or `scripts/run_tw_market_sync.py`. The first run backfills from 2005, about an hour of paced requests.

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

**Answer:** Total Value is the Portfolio wallet only. Total Asset adds the Life and Emergency wallets (cash, plus any legacy Emergency holdings), so it is higher by those two balances.

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
