import React from 'react';
import { render, screen, act } from '@testing-library/react';
import { AnalyticsConsentBanner } from '@/components/analytics/AnalyticsConsentBanner';

jest.mock('@/lib/analytics/config', () => ({
  setAnalyticsConsent: jest.fn(),
}));

jest.mock('@/lib/analytics/provider', () => ({
  analyticsProvider: {
    initialize: jest.fn().mockResolvedValue(undefined),
  },
}));

jest.mock('@/components/ui/Button', () => ({
  Button: ({
    children,
    onClick,
    className,
  }: {
    children: React.ReactNode;
    onClick?: () => void;
    className?: string;
  }) => (
    <button onClick={onClick} className={className}>
      {children}
    </button>
  ),
}));

describe('AnalyticsConsentBanner — mobile UX fixes', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    localStorage.clear();
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  function renderAndShowBanner() {
    render(<AnalyticsConsentBanner />);
    // Banner appears after a 1000ms delay
    act(() => {
      jest.advanceTimersByTime(1100);
    });
  }

  it('renders the dismiss button once the banner is visible', () => {
    renderAndShowBanner();
    const dismissBtn = screen.getByRole('button', { name: /dismiss privacy banner/i });
    expect(dismissBtn).toBeInTheDocument();
  });

  it('dismiss button has aria-label="Dismiss privacy banner"', () => {
    renderAndShowBanner();
    const dismissBtn = screen.getByRole('button', { name: /dismiss privacy banner/i });
    expect(dismissBtn).toHaveAttribute('aria-label', 'Dismiss privacy banner');
  });

  it('dismiss button has min-w-[44px] class for 44px touch target', () => {
    renderAndShowBanner();
    const dismissBtn = screen.getByRole('button', { name: /dismiss privacy banner/i });
    expect(dismissBtn.className).toContain('min-w-[44px]');
  });

  it('dismiss button has min-h-[44px] class for 44px touch target', () => {
    renderAndShowBanner();
    const dismissBtn = screen.getByRole('button', { name: /dismiss privacy banner/i });
    expect(dismissBtn.className).toContain('min-h-[44px]');
  });

  it('banner wrapper has pb-[calc(3.5rem+env(safe-area-inset-bottom,0px))] class for safe-area inset', () => {
    renderAndShowBanner();
    // The outermost fixed wrapper carries the safe-area padding class
    const wrapper = document.querySelector(
      '.pb-\\[calc\\(3\\.5rem\\+env\\(safe-area-inset-bottom\\,0px\\)\\)\\]'
    );
    expect(wrapper).toBeInTheDocument();
  });

  it('does not show banner when consent is already stored in localStorage', () => {
    localStorage.setItem('aspiro_analytics_consent', 'true');
    render(<AnalyticsConsentBanner />);
    act(() => {
      jest.advanceTimersByTime(1100);
    });
    expect(screen.queryByRole('button', { name: /dismiss privacy banner/i })).not.toBeInTheDocument();
  });
});
