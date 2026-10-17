/**
 * Which goal is the retirement goal.
 *
 * A matched goal is credited the whole portfolio as its progress, on /goals,
 * the dashboard tracker and — through the backend mirror of this rule — the
 * goals report behind /review. So a false match is not cosmetic: "Fireplace
 * renovation" matched on the substring "fire" and read as nearly complete.
 */

import { isRetirementGoal, portfolioCreditedGoal } from '@/utils/goalMatchers';

describe('isRetirementGoal', () => {
    it.each([
        ['Retirement Fund', 'house_down_payment'], // renamed, category kept
        ['早日財務自由', 'general'],
        ['退休金', 'education'],
        ['FIRE by 45', 'general'],
        ['Anything', 'retirement'],
    ])('matches %s (%s)', (title, category) => {
        expect(isRetirementGoal({ title, category })).toBe(true);
    });

    it.each([
        ['House down payment', 'house_down_payment'],
        ['Fireplace renovation', 'house_down_payment'],
        ['Fire insurance fund', 'general'],
        ['Campfire trip', 'travel'],
    ])('does not match %s (%s)', (title, category) => {
        expect(isRetirementGoal({ title, category })).toBe(false);
    });
});

describe('portfolioCreditedGoal', () => {
    const goal = (id: string, title: string, targetAmount: number | string, status = 'active') =>
        ({ id, title, targetAmount, status });

    it('credits one goal: the active retirement goal with the largest target', () => {
        const goals = [
            goal('a', 'Retirement Fund', 10_000_000),
            goal('b', 'FIRE by 45', 20_000_000),
            goal('c', 'House', 90_000_000),
            goal('d', 'Retirement (old plan)', 50_000_000, 'completed'),
        ];
        expect(portfolioCreditedGoal(goals)?.id).toBe('b');
    });

    it('compares string Decimals as numbers', () => {
        expect(portfolioCreditedGoal([goal('a', '退休金', '600000'), goal('b', '財務自由', '1000000')])?.id).toBe('b');
    });

    it('falls back to any match when none is active, and breaks ties by id', () => {
        expect(portfolioCreditedGoal([goal('a', 'Retirement', 5, 'completed')])?.id).toBe('a');
        expect(portfolioCreditedGoal([goal('a', 'Retirement', 5), goal('b', 'FIRE', 5)])?.id).toBe('b');
    });

    it('is null when nothing matches', () => {
        expect(portfolioCreditedGoal([goal('c', 'House', 1)])).toBeNull();
        expect(portfolioCreditedGoal([])).toBeNull();
    });
});
