/**
 * The palette is what lets the sidebar stay short, so what matters is that it
 * opens from the keyboard and finds a page by more than its visible label — a
 * reader on a Chinese UI still types "loan", and one on English still knows the
 * page as 房貸.
 */

import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import { getNavigationItems } from '@/lib/navigation';

const mockPush = jest.fn();
// The LINE bot is configured: these suites exercise the pages it unlocks.
jest.mock('@/hooks/useFeatures', () => ({ useFeatures: () => ({ lineBot: true, isLoading: false }) }));
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}));

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
jest.mock('@/contexts/PrivacyContext', () => ({
  usePrivacy: () => ({ isValueVisible: true, toggleValueVisibility: jest.fn() }),
}));
jest.mock('@/hooks/useAdmin', () => ({ useIsAdmin: () => ({ isAdmin: false }) }));
jest.mock('@/lib/session-actions', () => ({
  signOutCompletely: jest.fn(),
  changeAppLanguage: jest.fn(),
}));

import { CommandPalette, openCommandPalette } from '@/components/layout/CommandPalette';

const pressCommandK = () =>
  fireEvent.keyDown(window, { key: 'k', metaKey: true });

describe('CommandPalette', () => {
  beforeEach(() => mockPush.mockClear());

  it('stays out of the way until asked for', () => {
    render(<CommandPalette />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('opens on ⌘K with every page and action listed', () => {
    render(<CommandPalette />);
    pressCommandK();

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    // Every non-admin destination, plus the six actions. Counted off the
    // navigation itself: the literal 19 here fell out of date the first time a
    // page was added, and a palette missing a page is invisible until someone
    // searches for one.
    expect(screen.getAllByRole('option')).toHaveLength(getNavigationItems(false).length + 6);
  });

  it('opens for anyone who never tries the shortcut', () => {
    render(<CommandPalette />);
    act(() => openCommandPalette());
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('finds a page by a keyword its label never shows', () => {
    render(<CommandPalette />);
    pressCommandK();

    // 房貸 appears nowhere in the English label — only in the item's keywords.
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '房貸' } });

    const options = screen.getAllByRole('option');
    expect(options).toHaveLength(1);
    expect(options[0]).toHaveTextContent('navigation.housing');
  });

  it('says so plainly when nothing matches', () => {
    render(<CommandPalette />);
    pressCommandK();
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'zzzz' } });

    expect(screen.queryAllByRole('option')).toHaveLength(0);
    expect(screen.getByText('Nothing matches that')).toBeInTheDocument();
  });

  it('navigates on Enter, and closes behind itself', () => {
    // Enter on the highlighted option — the flow anyone who reached for ⌘K is
    // already in. Clicking works too, but Headless UI selects on pointer
    // events jsdom does not synthesize, so that path is covered in the browser.
    render(<CommandPalette />);
    pressCommandK();
    const input = screen.getByRole('combobox');
    fireEvent.change(input, { target: { value: 'loan' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(mockPush).toHaveBeenCalledWith('/loans');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
