import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import authEn from '@/locales/en/auth.json';
import authZh from '@/locales/zh-TW/auth.json';
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

jest.mock('@/contexts/DemoContext', () => ({
  useDemo: jest.fn(),
}));

const mockUseDemo = useDemo as jest.Mock;

describe('DemoBanner', () => {
  beforeEach(() => jest.clearAllMocks());

  it('renders nothing when not in demo mode', () => {
    mockUseDemo.mockReturnValue({ isDemoMode: false, exitDemo: jest.fn() });
    const { container } = render(<DemoBanner />);
    expect(container.firstChild).toBeNull();
  });

  it('renders the banner when in demo mode', () => {
    mockUseDemo.mockReturnValue({ isDemoMode: true, exitDemo: jest.fn() });
    render(<DemoBanner />);
    expect(screen.getByText(/Demo Mode/)).toBeInTheDocument();
  });

  it('shows the short title on phones, the full one from sm up', () => {
    mockUseDemo.mockReturnValue({ isDemoMode: true, exitDemo: jest.fn() });
    render(<DemoBanner />);
    expect(screen.getByText('Demo')).toHaveClass('sm:hidden');
    expect(screen.getByText('Demo Mode')).toHaveClass('hidden', 'sm:inline');
  });

  it('reads the short title from the locale, not the inline English fallback', async () => {
    // Rendered in zh-TW: a renamed or mistyped key would fall back to 'Demo' and fail here.
    i18n.addResourceBundle('zh-TW', 'auth', authZh);
    await i18n.changeLanguage('zh-TW');
    try {
      mockUseDemo.mockReturnValue({ isDemoMode: true, exitDemo: jest.fn() });
      render(<DemoBanner />);
      expect(screen.getByText('示範')).toHaveClass('sm:hidden');
      expect(screen.queryByText('Demo')).toBeNull();
    } finally {
      await i18n.changeLanguage('en');
    }
  });

  it('shows a link to create a real account', () => {
    mockUseDemo.mockReturnValue({ isDemoMode: true, exitDemo: jest.fn() });
    render(<DemoBanner />);
    const link = screen.getByRole('link', { name: /Create Account/i });
    expect(link).toHaveAttribute('href', '/auth/signup');
  });

  it('"Exit Demo" leaves demo via exitDemo', () => {
    const exitDemo = jest.fn();
    mockUseDemo.mockReturnValue({ isDemoMode: true, exitDemo, hideDemoBanner: jest.fn() });
    render(<DemoBanner />);
    fireEvent.click(screen.getByRole('button', { name: /Exit Demo/i }));
    expect(exitDemo).toHaveBeenCalledTimes(1);
  });

  // A bare × reads as "dismiss"; it used to exit demo and land on /auth/signin.
  it('the × hides the banner and stays in demo', () => {
    const exitDemo = jest.fn();
    const hideDemoBanner = jest.fn();
    mockUseDemo.mockReturnValue({ isDemoMode: true, exitDemo, hideDemoBanner });
    render(<DemoBanner />);
    fireEvent.click(screen.getByRole('button', { name: /Hide banner/i }));
    expect(hideDemoBanner).toHaveBeenCalledTimes(1);
    expect(exitDemo).not.toHaveBeenCalled();
  });

  it('renders nothing once hidden', () => {
    mockUseDemo.mockReturnValue({ isDemoMode: true, demoBannerHidden: true, exitDemo: jest.fn() });
    const { container } = render(<DemoBanner />);
    expect(container.firstChild).toBeNull();
  });
});
