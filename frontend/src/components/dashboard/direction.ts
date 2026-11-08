/**
 * Up, down, or no change: how a signed figure is shown. Zero is "flat" (grey,
 * no arrow, no sign). Before, ">= 0" counted it as a gain, so an empty account
 * read "▲ NT$0 +0.0%" in green.
 */
export type Direction = 'up' | 'down' | 'flat';

export function direction(value: number): Direction {
  if (value > 0) return 'up';
  if (value < 0) return 'down';
  return 'flat';
}

export const DIRECTION_TEXT: Record<Direction, string> = {
  up: 'text-prosperity-700 dark:text-prosperity-400',
  down: 'text-error-700 dark:text-error-400',
  flat: 'text-gray-500 dark:text-gray-400',
};

export const ARROW: Record<Direction, string> = { up: '▲ ', down: '▼ ', flat: '' };
export const SIGN: Record<Direction, string> = { up: '+', down: '−', flat: '' };
