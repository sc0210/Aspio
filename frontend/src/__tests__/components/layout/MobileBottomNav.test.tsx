/**
 * The phone's More sheet is the third nav surface beside the sidebar and ⌘K;
 * what is tested here is that it hides the same add-on pages they do.
 */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';

const mockFeatures = { lineBot: true, isLoading: false, isError: false };
jest.mock('@/hooks/useFeatures', () => ({ useFeatures: () => mockFeatures }));
jest.mock('next/navigation', () => ({ usePathname: () => '/dashboard' }));

jest.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => {} },
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
    i18n: { language: 'en', changeLanguage: jest.fn() },
  }),
}));

jest.mock('@/contexts/DemoContext', () => ({
  useDemo: () => ({ isDemoMode: false, disableDemo: jest.fn() }),
}));
jest.mock('@/contexts/AuthContext', () => ({ useAuthContext: () => ({ session: null }) }));
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
});
