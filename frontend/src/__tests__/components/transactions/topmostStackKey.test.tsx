import { topmostStackKey } from '@/components/transactions/MonthlySummaryCharts';

it('the highest series with a value carries the rounded top, whichever it is', () => {
  expect(topmostStackKey({ Housing: 1, Eat: 2, Investment: 5 })).toBe('Investment');
  // No investment this month: the next one down is the top.
  expect(topmostStackKey({ Housing: 1, Transfer: 3, Debt: 2, Investment: 0 })).toBe('Debt');
  expect(topmostStackKey({ Others: '120' })).toBe('Others'); // values may arrive as strings
  expect(topmostStackKey({ Housing: 0 })).toBeUndefined();
  expect(topmostStackKey(undefined)).toBeUndefined();
});

import React from 'react';
import { render } from '@testing-library/react';
import { topRoundedShape } from '@/components/transactions/MonthlySummaryCharts';

const drawn = (key: string, payload: Record<string, number>) => {
  const Shape = topRoundedShape(key);
  // Recharts calls the shape as a function of its props; do the same.
  const { container } = render(<svg>{Shape({ x: 0, y: 0, width: 20, height: 40, fill: '#000', payload })}</svg>);
  return container.querySelector('path')?.getAttribute('d') ?? '';
};

it('draws arcs only on the segment that is on top of its month', () => {
  const month = { Housing: 10, Debt: 5, Investment: 0 };
  expect(drawn('Debt', month)).toMatch(/A/);      // top this month: rounded
  expect(drawn('Housing', month)).not.toMatch(/A/); // underneath: square
});
