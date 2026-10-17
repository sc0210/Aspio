# Product Overview

What Aspiro does, from the user's side. For how it's built see
[ARCHITECTURE.md](ARCHITECTURE.md); for the money vocabulary see
[FINANCIAL_TERMINOLOGY.md](FINANCIAL_TERMINOLOGY.md).

## The idea

A personal finance app for Asian markets — Taiwan first — that puts expense tracking and
investment management in one place, so net worth is a single number rather than something you
assemble from three apps.

What makes it specific rather than generic:

- **Local by default.** TWD base currency, Taiwan brokerage fee models, regional payment methods,
  bilingual English/Chinese UI, and market-convention colour for price movement.
- **The three-wallet model** (Life · Emergency · Portfolio) as the organising idea, rather than a
  flat list of accounts.
- **LINE as an input surface.** Recording an expense or splitting a group bill happens in the
  chat app people already have open.

## Feature surface

| Area | Routes | What's there |
|---|---|---|
| Dashboard | `/`, `/dashboard` | Net worth, wallet balances, savings rate, trend charts, cash-flow and holdings treemaps. Phone gets a distinct focused layout, not a shrunk desktop one |
| Transactions | `/transactions`, `/add`, `/edit/[id]`, `/monthly-summary`, `/scan` | Income/expense CRUD, categories, filters, transfers between Life and Emergency, receipt scanning via local OCR, CSV import |
| Portfolio | `/portfolio`, `/add`, `/edit/[id]`, `/holdings/[symbol]`, `/trend` | Holdings, live and historical prices, per-holding drill-down, allocation, performance, IRR |
| Rebalancing | `/rebalancing` | Deviation detection against target allocation, buy/sell quantities, fee estimation, FX conversion timing |
| Goals & savings | `/goals`, `/savings`, `/achievements` | Savings goals, milestones, contributions, streaks and achievement badges. `/savings` is saving with peers: one roster, a Shared goals tab and a Compare tab (`/compare` redirects to it) |
| Loans | `/loans` | Peer loan tracking; an expense can repay a loan via `loan_id` |
| Groups | `/groups`, `/groups/[id]` | Shared expenses and settlement, fed by LINE group splitting |
| Housing | `/housing` | Client-side buy-vs-rent simulator, readiness scorecard, car-impact panel |
| Lifecycle | `/lifecycle` | Borrow-to-invest leverage against a Samuelson target, spread and crossover |
| Month in Review | `/review` | One calendar month read as a story: verdict, cash flow against the month before, the year around it, category movers, balance change. `/reports` redirects here; `/chat` (keyword templates, not a model) redirects to the dashboard. Both retired 2026-09-17 |
| LINE | `/link-line`, `/liff` | Account linking and the in-LINE webview |
| Admin | `/admin` | User management, system stats, audit log, DB health |
| Account | `/settings` | Profile, preferences, preferred currency, notifications, theme (`/profile` redirects here) |

## Two modes

**Demo** — fixture data, no account, no backend writes. The whole UI is explorable before
signup, and it doubles as the preview path for UI work.

**Authenticated** — real data, live prices, persistence. Google OAuth or email/password.

Components must check `isDemo` from `useAppMode()` before calling the API, and guard writes with
`canPersistData`. Demo is not a stub of a few screens; keeping it complete is a standing
requirement when adding a feature.

## Market data

Prices come from several providers with a fallback chain — FinLab for Taiwan equities, plus
general providers for international symbols and crypto. Two pipelines feed the UI independently:
the live quote and the previous close. They can go stale separately, which is why a current
price can sit next to a wrong "% today".

A provider returning an empty response is a failure, not a success. `{}` is truthy in JS and
once short-circuited the whole fallback chain, reporting success with a price of 0.

## Gamification

Streaks, milestones and achievement badges attach to savings goals. It's engagement scaffolding
around the core tracking loop — treat the underlying financial numbers as the source of truth
and the badges as derived.
