/**
 * The phone's More sheet is the third nav surface beside the sidebar and ⌘K;
 * what is tested here is that it hides the same add-on pages they do.
 */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';

const mockFeatures = { lineBot: true, isLoading: false, isError: false };
jest.mock('@/hooks/useFeatures', () => ({ useFeatures: () => mockFeatures }));
jest.mock('@/hooks/useAccessTier', () => ({ useAccessTier: () => ({ tier: 'premium', isPremium: true, isLoading: false, isError: false }) }));
jest.mock('next/navigation', () => ({ usePathname: () => '/dashboard' }));

jest.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => {} },
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
    i18n: { language: 'en', changeLanguage: jest.fn() },
  }),
}));

jest.mock('@/contexts/DemoContext', () => ({
  useDemo: () => ({ isDemoMode: false, exitDemo: jest.fn() }),
}));
jest.mock('@/contexts/AuthContext', () => ({ useAuthContext: () => ({ session: null }) }));
jest.mock('@/hooks/useAdmin', () => ({ useIsAdmin: () => ({ isAdmin: false }) }));
const mockToggleValues = jest.fn();
jest.mock('@/contexts/PrivacyContext', () => ({ usePrivacy: () => ({ isValueVisible: true, toggleValueVisibility: mockToggleValues }) }));
const mockStats: { data: unknown } = { data: undefined };
jest.mock('@/hooks/api-hooks', () => ({ useGamificationStats: () => mockStats }));
jest.mock('@/lib/session-actions', () => ({ changeAppLanguage: jest.fn(), signOutCompletely: jest.fn() }));

import { MobileBottomNav } from '@/components/layout/MobileBottomNav';

function openSheetHrefs() {
  render(<MobileBottomNav />);
  fireEvent.click(screen.getByRole('button', { name: 'navigation.moreOptions' }));
  const sheet = screen.getByRole('dialog');
  return [...sheet.querySelectorAll('a')].map((a) => a.getAttribute('href'));
}

describe('MobileBottomNav More sheet', () => {
  afterEach(() => {
    mockFeatures.lineBot = true;
  });

  it('lists /groups when the LINE bot is configured', () => {
    expect(openSheetHrefs()).toContain('/groups');
  });

  it('drops /groups when it is not', () => {
    mockFeatures.lineBot = false;
    const hrefs = openSheetHrefs();
    expect(hrefs).toContain('/loans');
    expect(hrefs).not.toContain('/groups');
  });

  afterEach(() => {
    mockStats.data = undefined;
    mockToggleValues.mockClear();
  });

  it('carries Hide values, which only the removed phone drawer had', () => {
    render(<MobileBottomNav />);
    fireEvent.click(screen.getByRole('button', { name: 'navigation.moreOptions' }));
    fireEvent.click(screen.getByRole('button', { name: 'Hide values' }));
    expect(mockToggleValues).toHaveBeenCalledTimes(1);
  });

  it('shows your level, linking to achievements, once it is known', () => {
    mockStats.data = { level: 3, experience_points: 0, experience_to_next_level: 0 };
    render(<MobileBottomNav />);
    fireEvent.click(screen.getByRole('button', { name: 'navigation.moreOptions' }));
    expect(screen.getByRole('link', { name: /Lv 3/ })).toHaveAttribute('href', '/achievements');
    // A new account's 0/0 is 0%, not NaN.
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0');
  });

  it('shows no level while it is unknown', () => {
    openSheetHrefs();
    expect(screen.queryByRole('link', { name: /Lv/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });
});
