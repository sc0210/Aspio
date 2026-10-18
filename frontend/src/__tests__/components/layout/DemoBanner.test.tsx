import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import authEn from '@/locales/en/auth.json';
import commonEn from '@/locales/en/common.json';
import { DemoBanner } from '@/components/layout/DemoBanner';
import { useDemo } from '@/contexts/DemoContext';

// The banner's copy all comes from i18n keys. lib/i18n never initialises under
// Jest, so an unmocked useTranslation echoes the key and every assertion on
// visible copy compares against "auth:demo.title". Initialising the real
// library with inline resources is synchronous and keeps these tests honest
// about what a user in demo mode actually reads.
i18n.use(initReactI18next).init({
  lng: 'en',
  fallbackLng: 'en',
  ns: ['auth', 'common'],
  defaultNS: 'common',
  resources: { en: { auth: authEn, common: commonEn } },
  interpolation: { escapeValue: false },
  react: { useSuspense: false },
});

const mockPush = jest.fn();

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, replace: jest.fn() }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}));

jest.mock('@/contexts/DemoContext', () => ({
  useDemo: jest.fn(),
}));

const mockUseDemo = useDemo as jest.Mock;

describe('DemoBanner', () => {
  beforeEach(() => jest.clearAllMocks());

  it('renders nothing when not in demo mode', () => {
    mockUseDemo.mockReturnValue({ isDemoMode: false, disableDemo: jest.fn() });
    const { container } = render(<DemoBanner />);
    expect(container.firstChild).toBeNull();
  });

  it('renders the banner when in demo mode', () => {
    mockUseDemo.mockReturnValue({ isDemoMode: true, disableDemo: jest.fn() });
    render(<DemoBanner />);
    expect(screen.getByText(/Demo Mode/)).toBeInTheDocument();
  });

  it('shows a link to create a real account', () => {
    mockUseDemo.mockReturnValue({ isDemoMode: true, disableDemo: jest.fn() });
    render(<DemoBanner />);
    const link = screen.getByRole('link', { name: /Create Account/i });
    expect(link).toHaveAttribute('href', '/auth/signup');
  });

  it('clicking X calls disableDemo', () => {
    const disableDemo = jest.fn();
    mockUseDemo.mockReturnValue({ isDemoMode: true, disableDemo });
    render(<DemoBanner />);
    fireEvent.click(screen.getByRole('button', { name: /Exit Demo/i }));
    expect(disableDemo).toHaveBeenCalledTimes(1);
  });

  it('clicking X navigates to "/"', () => {
    mockUseDemo.mockReturnValue({ isDemoMode: true, disableDemo: jest.fn() });
    render(<DemoBanner />);
    fireEvent.click(screen.getByRole('button', { name: /Exit Demo/i }));
    expect(mockPush).toHaveBeenCalledWith('/');
  });

  it('dismiss button has aria-label', () => {
    mockUseDemo.mockReturnValue({ isDemoMode: true, disableDemo: jest.fn() });
    render(<DemoBanner />);
    expect(screen.getByRole('button', { name: /Exit Demo/i })).toBeInTheDocument();
  });
});
