/**
 * The tier as the frontend reads it, and the gate premium routes mount from
 * their layout.tsx. The backend enforces the tier; these decide what is shown.
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import { renderHook } from '@testing-library/react';

const mockMode = { isDemo: false, isAuthenticated: true, isLoading: false };
const mockUser: { data?: { access_tier?: 'free' | 'premium' }; isLoading: boolean; isError: boolean } = {
  data: undefined, isLoading: true, isError: false,
};
jest.mock('@/hooks/useAppMode', () => ({ useAppMode: () => mockMode }));
jest.mock('@/hooks/useCurrentUser', () => ({ useCurrentUser: () => mockUser }));
jest.mock('@/components/layout/DashboardLayout', () => ({
  DashboardLayout: ({ children }: { children: React.ReactNode }) => <div data-testid="layout">{children}</div>,
}));
jest.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => {} },
  useTranslation: () => ({ t: (_key: string, fallback?: string) => fallback ?? _key }),
}));

import { useAccessTier } from '@/hooks/useAccessTier';
import { PremiumGate } from '@/components/access/PremiumGate';

function signedIn(data: typeof mockUser['data'], extra: Partial<typeof mockUser> = {}) {
  Object.assign(mockUser, { data, isLoading: false, isError: false, ...extra });
}

beforeEach(() => {
  Object.assign(mockMode, { isDemo: false, isAuthenticated: true, isLoading: false });
  Object.assign(mockUser, { data: undefined, isLoading: true, isError: false });
});

describe('useAccessTier', () => {
  it('is not premium until the profile arrives', () => {
    expect(renderHook(() => useAccessTier()).result.current).toMatchObject({ tier: null, isPremium: false, isLoading: true });
  });

  it('reads the tier from the profile', () => {
    signedIn({ access_tier: 'free' });
    expect(renderHook(() => useAccessTier()).result.current).toMatchObject({ tier: 'free', isPremium: false });
    signedIn({ access_tier: 'premium' });
    expect(renderHook(() => useAccessTier()).result.current).toMatchObject({ tier: 'premium', isPremium: true });
  });

  it('treats a profile without the field as premium: that backend has no gate', () => {
    signedIn({});
    expect(renderHook(() => useAccessTier()).result.current.isPremium).toBe(true);
  });

  it('settles, not premium and not loading, when signed out', () => {
    Object.assign(mockMode, { isAuthenticated: false, isLoading: false });
    Object.assign(mockUser, { data: undefined, isLoading: false, isError: false });
    expect(renderHook(() => useAccessTier()).result.current).toMatchObject({ isPremium: false, isLoading: false });
  });

  it('is premium in demo mode, the full showcase, without asking', () => {
    mockMode.isDemo = true;
    expect(renderHook(() => useAccessTier()).result.current).toMatchObject({ tier: 'premium', isPremium: true, isLoading: false });
  });
});

describe('PremiumGate', () => {
  const page = <p>the premium page</p>;

  it('renders the page for a premium account', () => {
    signedIn({ access_tier: 'premium' });
    render(<PremiumGate>{page}</PremiumGate>);
    expect(screen.getByText('the premium page')).toBeInTheDocument();
  });

  it('explains, and never mounts the page, for a free account', () => {
    signedIn({ access_tier: 'free' });
    render(<PremiumGate>{page}</PremiumGate>);
    expect(screen.queryByText('the premium page')).not.toBeInTheDocument();
    expect(screen.getByText('This page needs Premium')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to dashboard' })).toHaveAttribute('href', '/dashboard');
  });

  it('waits while the session is still resolving and the profile query is off', () => {
    // A disabled TanStack query reports isLoading=false with no data.
    Object.assign(mockMode, { isAuthenticated: false, isLoading: true });
    Object.assign(mockUser, { data: undefined, isLoading: false, isError: false });
    render(<PremiumGate>{page}</PremiumGate>);
    expect(screen.queryByText('This page needs Premium')).not.toBeInTheDocument();
  });

  it('waits, rather than flash the refusal, while the profile loads', () => {
    render(<PremiumGate>{page}</PremiumGate>);
    expect(screen.queryByText('the premium page')).not.toBeInTheDocument();
    expect(screen.queryByText('This page needs Premium')).not.toBeInTheDocument();
  });

  it('renders the page when the profile request fails: the backend still enforces', () => {
    signedIn(undefined, { isError: true });
    render(<PremiumGate>{page}</PremiumGate>);
    expect(screen.getByText('the premium page')).toBeInTheDocument();
  });
});
