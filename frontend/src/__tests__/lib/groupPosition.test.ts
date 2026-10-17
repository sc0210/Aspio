import { groupPosition, groupsPosition } from '@/lib/groups/position';

const ME = 'me';
const names = { me: 'Me', amy: 'Amy', ben: 'Ben', cat: 'Cat' };

describe('groupPosition', () => {
  it('signs edges by direction and ignores edges that do not touch you', () => {
    const p = groupPosition({
      id: 'g', name: 'Flat', currency: 'TWD', member_names: names,
      balances: [
        { owed_by: 'amy', owed_to: ME, amount: '1200', currency: 'TWD' },
        { owed_by: ME, owed_to: 'ben', amount: '300', currency: 'TWD' },
        { owed_by: 'cat', owed_to: 'ben', amount: '999', currency: 'TWD' },
      ],
    }, ME);
    expect(p.net).toBe(900);
    expect(p.counterparties).toEqual([
      { name: 'Amy', amount: 1200, currency: 'TWD' },
      { name: 'Ben', amount: -300, currency: 'TWD' },
    ]);
    expect(p.settled).toBe(false);
  });

  it('a group where others still owe each other is not "settled" for the row, but has nothing for you', () => {
    const p = groupPosition({
      id: 'g', name: null, currency: 'TWD', member_names: names,
      balances: [{ owed_by: 'cat', owed_to: 'ben', amount: '50', currency: 'TWD' }],
    }, ME);
    expect(p.counterparties).toEqual([]);
    expect(p.settled).toBe(false);
  });
});

describe('groupsPosition', () => {
  it('keeps totals per currency and never adds TWD to JPY', () => {
    const res = groupsPosition([
      { id: 'flat', name: 'Flat', currency: 'TWD', member_names: names,
        balances: [{ owed_by: 'amy', owed_to: ME, amount: '1200', currency: 'TWD' }] },
      { id: 'trip', name: 'Trip', currency: 'JPY', member_names: names,
        balances: [{ owed_by: ME, owed_to: 'ben', amount: '5000', currency: 'JPY' }] },
      { id: 'done', name: 'Done', currency: 'TWD', member_names: names, balances: [] },
    ], ME);
    expect(res.totals).toEqual([
      { currency: 'JPY', owedToYou: 0, youOwe: 5000, net: -5000 },
      { currency: 'TWD', owedToYou: 1200, youOwe: 0, net: 1200 },
    ]);
    // Largest stake first; the settled group last.
    expect(res.groups.map((g) => g.id)).toEqual(['trip', 'flat', 'done']);
  });

  it('with no edges touching you there are no totals (all square)', () => {
    expect(groupsPosition([], ME).totals).toEqual([]);
  });
});

describe('review fixes', () => {
  it('a failed balances fetch is unknown, never "settled", and is counted', () => {
    const res = groupsPosition([
      { id: 'g', name: 'G', currency: 'TWD', member_names: names, balances: [], failed: true },
    ], ME);
    expect(res.groups[0].settled).toBe(false);
    expect(res.groups[0].failed).toBe(true);
    expect(res.failedCount).toBe(1);
  });

  it('decimal amounts that cancel leave no phantom counterparty', () => {
    const p = groupPosition({
      id: 'g', name: 'G', currency: 'TWD', member_names: names,
      balances: [
        { owed_by: 'amy', owed_to: ME, amount: '0.1', currency: 'TWD' },
        { owed_by: 'amy', owed_to: ME, amount: '0.2', currency: 'TWD' },
        { owed_by: ME, owed_to: 'amy', amount: '0.3', currency: 'TWD' },
      ],
    }, ME);
    expect(p.counterparties).toEqual([]);
    expect(p.net).toBe(0);
  });

  it('one person in two currencies stays two entries', () => {
    const p = groupPosition({
      id: 'g', name: 'G', currency: 'TWD', member_names: names,
      balances: [
        { owed_by: 'amy', owed_to: ME, amount: '100', currency: 'TWD' },
        { owed_by: 'amy', owed_to: ME, amount: '500', currency: 'JPY' },
      ],
    }, ME);
    expect(p.counterparties).toHaveLength(2);
    expect(p.net).toBe(100);
  });
});
