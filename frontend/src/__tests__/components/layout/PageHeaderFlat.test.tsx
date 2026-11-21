/**
 * The phone title row is PageHeader's `flat` variant, named after the route as
 * the nav names it. Each Mobile* screen used to write its own <h1>, and the
 * titles had drifted from the tabs ("Buy vs. Rent — House Plan" beside a
 * "Housing Plan" nav entry).
 */
import React from 'react';
import { render, screen } from '@testing-library/react';

let mockPath = '/housing';
jest.mock('next/navigation', () => ({ usePathname: () => mockPath }));
jest.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => {} },
  useTranslation: () => ({ t: (k: string) => ({ 'navigation.housing': 'Housing Plan', 'navigation.monthlySummary': 'Monthly summary' }[k] ?? k) }),
}));

import { PageHeader } from '@/components/layout/PageHeader';

describe('PageHeader flat', () => {
  it("defaults its title to the route's nav name", () => {
    render(<PageHeader variant="flat" />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Housing Plan');
  });

  it('names a sub-page and keeps its back link and actions', () => {
    mockPath = '/transactions/monthly-summary';
    render(<PageHeader variant="flat" backHref="/transactions" backLabel="Back" actions={<button>2026</button>} />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Monthly summary');
    expect(screen.getByRole('link', { name: 'Back' })).toHaveAttribute('href', '/transactions');
    expect(screen.getByRole('button', { name: '2026' })).toBeInTheDocument();
  });

  it('takes an explicit title, such as the dashboard greeting', () => {
    render(<PageHeader variant="flat" title="Good evening, Alex" />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Good evening, Alex');
  });
});
