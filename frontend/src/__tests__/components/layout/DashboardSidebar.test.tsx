/**
 * The sidebar's job is to be short enough to scan, so what is tested here is
 * what stays hidden: which section opens itself, that a reader's choice sticks,
 * and that the collapsed rail is still readable when the labels are gone.
 */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';

let mockPathname = '/dashboard';
const mockFeatures = { lineBot: true, isLoading: false, isError: false };
jest.mock('@/hooks/useFeatures', () => ({ useFeatures: () => mockFeatures }));
jest.mock('next/navigation', () => ({
  usePathname: () => mockPathname,
}));

jest.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => {} },
  useTranslation: () => ({
    // Second argument is a string default here, never an options object.
    t: (key: string, fallback?: string) => fallback ?? key,
    i18n: { language: 'en', changeLanguage: jest.fn() },
  }),
}));

jest.mock('@/contexts/DemoContext', () => ({
  useDemo: () => ({ isDemoMode: false, disableDemo: jest.fn() }),
}));

jest.mock('@/hooks/useAdmin', () => ({ useIsAdmin: () => ({ isAdmin: false }) }));
jest.mock('@/hooks/useScrollLock', () => ({ useScrollLock: () => {} }));

// Both pull in auth, privacy and gamification; neither is what this file is about.
jest.mock('@/components/layout/AccountMenu', () => ({
  AccountMenu: () => <div data-testid="account-menu" />,
}));
jest.mock('@/components/layout/CommandPalette', () => ({
  CommandPalette: () => null,
  openCommandPalette: jest.fn(),
}));

import { DashboardSidebar } from '@/components/layout/DashboardSidebar';

const FINANCE = 'navigation.sections.finance';
const GOALS = 'navigation.sections.goals_growth';

function renderSidebar(collapsed = false) {
  return render(
    <DashboardSidebar
      open={false}
      collapsed={collapsed}
      onToggleCollapsed={jest.fn()}
      onClose={jest.fn()}
    />,
  );
}

/** Desktop rail and mobile drawer both render; assert against the first. */
const header = (key: string) => screen.getAllByRole('button', { name: new RegExp(key) })[0];

describe('DashboardSidebar sections', () => {
  beforeEach(() => {
    localStorage.clear();
    mockPathname = '/dashboard';
  });

  it('opens the section holding the current page', () => {
    mockPathname = '/goals';
    renderSidebar();

    expect(header(GOALS)).toHaveAttribute('aria-expanded', 'true');
    expect(header(FINANCE)).toHaveAttribute('aria-expanded', 'false');
  });

  it('falls back to Finance where the current page is a standalone row', () => {
    // The dashboard belongs to no section, and one link under shut
    // headers is not a navigation.
    renderSidebar();

    expect(header(FINANCE)).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getAllByRole('link', { name: 'navigation.transactions' })[0]).toBeInTheDocument();
  });

  it('remembers what the reader opened, over what the route suggests', () => {
    localStorage.setItem(
      'aspiro-nav-sections',
      JSON.stringify({ [GOALS]: true, [FINANCE]: false }),
    );
    renderSidebar();

    expect(header(GOALS)).toHaveAttribute('aria-expanded', 'true');
    expect(header(FINANCE)).toHaveAttribute('aria-expanded', 'false');
  });

  it('writes a toggle straight to storage', () => {
    renderSidebar();
    fireEvent.click(header(GOALS));

    expect(header(GOALS)).toHaveAttribute('aria-expanded', 'true');
    expect(JSON.parse(localStorage.getItem('aspiro-nav-sections')!)).toEqual({ [GOALS]: true });
  });

  it('marks a closed section that holds the page you are on', () => {
    mockPathname = '/goals';
    localStorage.setItem('aspiro-nav-sections', JSON.stringify({ [GOALS]: false }));
    const { container } = renderSidebar();

    // Otherwise the active item simply vanishes with no trace of where it went.
    expect(header(GOALS)).toHaveAttribute('aria-expanded', 'false');
    expect(container.querySelector('nav .bg-primary-500')).toBeInTheDocument();
  });
});

describe('DashboardSidebar without the LINE bot', () => {
  afterEach(() => {
    mockFeatures.lineBot = true;
  });

  it('drops /groups, whose groups only the bot creates', () => {
    mockFeatures.lineBot = false;
    const { container } = renderSidebar(true);
    const rail = container.firstElementChild as HTMLElement;
    const hrefs = [...rail.querySelectorAll('nav a')].map((a) => a.getAttribute('href'));

    expect(hrefs).toContain('/transactions');
    expect(hrefs).not.toContain('/groups');
  });
});

describe('DashboardSidebar collapsed rail', () => {
  beforeEach(() => {
    localStorage.clear();
    mockPathname = '/dashboard';
  });

  it('names every icon, and drops the headings it cannot show', () => {
    const { container } = renderSidebar(true);

    // The desktop rail is the first of the two rendered sidebars.
    const rail = container.firstElementChild as HTMLElement;
    const links = [...rail.querySelectorAll('nav a')];

    expect(links.length).toBeGreaterThan(0);
    expect(links.every((link) => link.getAttribute('aria-label'))).toBe(true);
    expect(rail.querySelectorAll('nav button[aria-expanded]')).toHaveLength(0);
  });

  it('raises a tooltip on keyboard focus, not only on hover', () => {
    const { container } = renderSidebar(true);
    const rail = container.firstElementChild as HTMLElement;

    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    fireEvent.focus(rail.querySelector('nav a')!);
    expect(screen.getByRole('tooltip')).toHaveTextContent('navigation.dashboard');
  });

  it('takes the tooltip back down again', () => {
    // The hide half: left behind, it names whichever icon it is nearest.
    const { container } = renderSidebar(true);
    const rail = container.firstElementChild as HTMLElement;
    const link = rail.querySelector('nav a')!;

    fireEvent.focus(link);
    fireEvent.blur(link);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();

    fireEvent.mouseEnter(link);
    fireEvent.mouseLeave(link);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();

    // Scrolling slides the rows out from under a still cursor.
    fireEvent.mouseEnter(link);
    fireEvent.scroll(rail.querySelector('nav')!);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });
});
