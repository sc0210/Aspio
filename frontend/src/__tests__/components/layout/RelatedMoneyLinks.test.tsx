import React from 'react';
import { render, screen } from '@testing-library/react';
import { RelatedMoneyLinks } from '@/components/layout/RelatedMoneyLinks';

jest.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => {} },
  useTranslation: () => ({ t: (key: string, fallback?: string) => fallback ?? key }),
}));

let mockLineBot = true;
jest.mock('@/hooks/useFeatures', () => ({ useFeatures: () => ({ lineBot: mockLineBot }) }));

const links = () => screen.queryAllByRole('link').map((a) => a.getAttribute('href'));

beforeEach(() => { mockLineBot = true; });

it('points each page at the other two', () => {
  render(<RelatedMoneyLinks current="loans" />);
  expect(links()).toEqual(['/savings?tab=splits', '/groups']);
});

it('leaves Groups out when there is no LINE bot', () => {
  mockLineBot = false;
  render(<RelatedMoneyLinks current="splits" />);
  expect(links()).toEqual(['/loans']);
});

it('from Groups, points at Shared spending and Loans', () => {
  render(<RelatedMoneyLinks current="groups" />);
  expect(links()).toEqual(['/savings?tab=splits', '/loans']);
});
