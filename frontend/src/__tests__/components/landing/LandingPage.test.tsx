/**
 * The landing page states capabilities a visitor can check, so it must not
 * claim the LINE bot on an instance that has none configured.
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';

const mockFeatures = { lineBot: true, isLoading: false, isError: false };
jest.mock('@/hooks/useFeatures', () => ({ useFeatures: () => mockFeatures }));

jest.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => {} },
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en', changeLanguage: jest.fn() },
  }),
}));

jest.mock('@/contexts/DemoContext', () => ({ useDemo: () => ({ enableDemo: jest.fn() }) }));
jest.mock('@/components/ui/LanguageSwitcher', () => ({ LanguageSwitcher: () => null }));
jest.mock('@/components/ui/ThemeToggle', () => ({ ThemeToggle: () => null }));

import { LandingPage } from '@/components/landing/LandingPage';

const LINE_CARD = 'landing.capabilities.lineBot.title';

describe('LandingPage capabilities', () => {
  afterEach(() => {
    mockFeatures.lineBot = true;
  });

  it('claims the LINE bot where it is configured', () => {
    render(<LandingPage />);
    expect(screen.getByText(LINE_CARD)).toBeInTheDocument();
  });

  it('leaves it out where it is not', () => {
    mockFeatures.lineBot = false;
    render(<LandingPage />);
    expect(screen.queryByText(LINE_CARD)).not.toBeInTheDocument();
    expect(screen.getByText('landing.capabilities.csv.title')).toBeInTheDocument();
  });
});
