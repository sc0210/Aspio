import { monthLabel } from '@/components/dashboard/twCape';

describe('monthLabel', () => {
  it('formats a month in the UI language', () => {
    expect(monthLabel('2015-03', 'en')).toBe('Mar 2015');
  });

  it.each(['', '2015', '2015-13', 'garbage', null, undefined])(
    'returns nothing for %p instead of throwing while the dashboard renders',
    (value) => {
      expect(monthLabel(value as string | null | undefined, 'en')).toBe('');
    },
  );
});
