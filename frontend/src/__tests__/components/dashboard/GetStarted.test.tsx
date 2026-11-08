import React from 'react';
import { render, screen } from '@testing-library/react';
import { GetStarted } from '@/components/dashboard/GetStarted';

jest.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => {} },
  useTranslation: () => ({ t: (key: string) => key }),
}));

describe('GetStarted', () => {
  it.each(['grid', 'list'] as const)('links the four first steps (%s)', (variant) => {
    render(<GetStarted variant={variant} />);
    const hrefs = screen.getAllByRole('link').map((a) => a.getAttribute('href'));
    expect(hrefs).toEqual(['/transactions/add', '/transactions/add', '/portfolio/add', '/goals']);
    expect(screen.getByRole('region', { name: 'dashboard:onboarding.title' })).toBeInTheDocument();
  });
});
