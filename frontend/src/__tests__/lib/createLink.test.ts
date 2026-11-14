import { createLinkDefaults } from '@/lib/goals/createLink';

describe('createLinkDefaults (/goals?create=…)', () => {
  it("opens Create for '1' and a prefilled retirement goal for 'retirement'", () => {
    expect(createLinkDefaults('1')).toEqual({ open: true });
    const retirement = createLinkDefaults('retirement');
    expect(retirement.open).toBe(true);
    expect(retirement.returnToPortfolio).toBe(true);
    expect(retirement.defaults?.category).toBe('retirement');
  });

  it('opens nothing otherwise', () => {
    expect(createLinkDefaults(null).open).toBe(false);
    expect(createLinkDefaults('0').open).toBe(false);
  });
});
