/**
 * Where you stand across your LINE expense groups.
 *
 * A group's balances are pairwise debts ("A owes B"). Only the edges that touch
 * you matter here: an edge owed *to* you is money coming back, one owed *by* you
 * is money going out. Group members are keyed by their Aspiro user id, so "you"
 * is the signed-in user's id — no extra lookup needed.
 *
 * Groups can be in different currencies and are never converted: totals are
 * kept per currency, so a TWD flat and a JPY trip don't add up into nonsense.
 */

export interface GroupBalanceEdge {
    owed_by: string;
    owed_to: string;
    amount: string | number;
    currency: string;
}

export interface GroupPositionInput {
    id: string;
    name: string | null;
    currency: string;
    balances: GroupBalanceEdge[];
    member_names: Record<string, string>;
    /** The balances call failed — the group's figures are unknown, not zero. */
    failed?: boolean;
}

interface Counterparty {
    name: string;
    /** Positive: they owe you. Negative: you owe them. */
    amount: number;
    currency: string;
}

interface GroupPosition {
    id: string;
    name: string | null;
    currency: string;
    /** Positive: you are owed overall. Negative: you owe overall. */
    net: number;
    counterparties: Counterparty[];
    /** Nobody in the group owes anybody (known, not just unloaded). */
    settled: boolean;
    failed: boolean;
}

interface CurrencyTotal {
    currency: string;
    owedToYou: number;
    youOwe: number;
    net: number;
}

interface GroupsPosition {
    groups: GroupPosition[];
    totals: CurrencyTotal[];
    /** Groups whose balances didn't load — the totals leave them out. */
    failedCount: number;
}

const short = (id: string) => id.slice(0, 8);

// Sum in cents: float sums of decimal strings leave dust (0.1 + 0.2 - 0.3 ≠ 0)
// that would read as a phantom debt.
const toCents = (x: number) => Math.round(x * 100);

/** Money at stake for you in a group, in either direction. */
const stake = (p: GroupPosition) => p.counterparties.reduce((s, c) => s + Math.abs(c.amount), 0);

export function groupPosition(group: GroupPositionInput, selfId: string): GroupPosition {
    // Keyed by person *and* currency, so two currencies with one person never merge.
    const byPerson = new Map<string, { id: string; cents: number; currency: string }>();
    for (const b of group.balances) {
        const amount = toCents(Number(b.amount));
        if (!Number.isFinite(amount) || amount === 0) continue;
        let other: string;
        let signed: number;
        if (b.owed_to === selfId) {
            other = b.owed_by;
            signed = amount;
        } else if (b.owed_by === selfId) {
            other = b.owed_to;
            signed = -amount;
        } else {
            continue;
        }
        const currency = b.currency || group.currency;
        const key = `${other}|${currency}`;
        const prev = byPerson.get(key);
        byPerson.set(key, { id: other, cents: (prev?.cents ?? 0) + signed, currency });
    }

    const counterparties = Array.from(byPerson.values())
        .filter((v) => v.cents !== 0)
        .map((v) => ({ name: group.member_names[v.id] ?? short(v.id), amount: v.cents / 100, currency: v.currency }))
        // Largest amount first, whichever direction it runs.
        .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));

    return {
        id: group.id,
        name: group.name,
        currency: group.currency,
        // In the group's own currency; an edge in another currency is listed but not netted.
        net: counterparties
            .filter((c) => c.currency === group.currency)
            .reduce((s, c) => s + toCents(c.amount), 0) / 100,
        counterparties,
        settled: !group.failed && group.balances.length === 0,
        failed: !!group.failed,
    };
}

export function groupsPosition(groups: GroupPositionInput[], selfId: string): GroupsPosition {
    const positions = groups.map((g) => groupPosition(g, selfId));
    const cents = new Map<string, { in: number; out: number }>();
    for (const p of positions) {
        for (const c of p.counterparties) {
            const t = cents.get(c.currency) ?? { in: 0, out: 0 };
            const v = toCents(c.amount);
            if (v > 0) t.in += v;
            else t.out -= v;
            cents.set(c.currency, t);
        }
    }
    const totals: CurrencyTotal[] = Array.from(cents.entries()).map(([currency, t]) => ({
        currency,
        owedToYou: t.in / 100,
        youOwe: t.out / 100,
        net: (t.in - t.out) / 100,
    }));
    return {
        // Groups where you have money at stake first, the largest stake leading.
        groups: [...positions].sort((a, b) => stake(b) - stake(a)),
        failedCount: positions.filter((p) => p.failed).length,
        totals: totals.sort((a, b) => Math.abs(b.net) - Math.abs(a.net)),
    };
}
