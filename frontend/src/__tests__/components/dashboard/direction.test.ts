import { ARROW, DIRECTION_TEXT, SIGN, direction } from '@/components/dashboard/direction';

describe('direction', () => {
  it('calls zero flat, not a gain', () => {
    expect(direction(0)).toBe('flat');
    expect(direction(-0)).toBe('flat');
    expect(direction(5)).toBe('up');
    expect(direction(-5)).toBe('down');
  });

  it('shows flat without an arrow or a sign, in grey', () => {
    expect(ARROW.flat).toBe('');
    expect(SIGN.flat).toBe('');
    expect(DIRECTION_TEXT.flat).toContain('text-gray-500');
    expect(ARROW.up.trim()).toBe('▲');
    expect(SIGN.down).toBe('−');
  });
});
