/**
 * The phone groups view (#344): your net across every group up top, then each
 * group with what you owe / are owed in it. Rendered in demo mode, where "you"
 * is Alex in the fixtures (owed 1200 by 小明 and 450 by 小美).
 */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { MobileGroups } from '@/components/groups/MobileGroups';

const mockVisible = { value: true };

const mockMode: { isDemo: boolean; user: { id: string } | null } = { isDemo: true, user: null };
jest.mock('@/hooks/useAppMode', () => ({
  useAppMode: () => mockMode,
}));
jest.mock('@/contexts/PrivacyContext', () => ({
  usePrivacy: () => ({ isValueVisible: mockVisible.value }),
}));
const mockGet = jest.fn();
jest.mock('@/lib/api-client', () => ({ apiClient: { get: (...a: unknown[]) => mockGet(...a) } }));
jest.mock('@/components/layout/DashboardLayout', () => ({
  DashboardLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
jest.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => {} },
  useTranslation: () => ({
    t: (k: string, opts?: Record<string, unknown>) => {
      if (k === 'mobile.owesYou') return `${opts?.name} owes you`;
      if (k === 'mobile.youOweName') return `You owe ${opts?.name}`;
      if (k === 'mobile.failedCaveat') return `leaves out ${opts?.count}`;
      return k;
    },
  }),
}));

beforeEach(() => {
  mockVisible.value = true;
  mockMode.isDemo = true;
  mockMode.user = null;
  mockGet.mockReset();
});

it('leads with the net owed to you across groups', () => {
  render(<MobileGroups />);
  expect(screen.getByText('mobile.netOwedToYou')).toBeInTheDocument();
  // Hero and the one group with a stake both read +1,650.
  expect(screen.getAllByText(/\+.*1,650/)).toHaveLength(2);
});

it('names who owes you on the group row and links to the group', () => {
  render(<MobileGroups />);
  expect(screen.getByText(/小明 owes you .*1,200/)).toBeInTheDocument();
  expect(screen.getByRole('link', { name: /台北室友/ })).toHaveAttribute('href', '/groups/demo-group-1');
  expect(screen.getByRole('link', { name: /日本旅遊團/ })).toHaveTextContent('allSettled');
});

it('masks amounts when values are hidden', () => {
  mockVisible.value = false;
  render(<MobileGroups />);
  expect(screen.queryByText(/1,650/)).not.toBeInTheDocument();
  expect(screen.getAllByText(/••••/).length).toBeGreaterThan(0);
});

describe('signed in', () => {
  beforeEach(() => {
    mockMode.isDemo = false;
    mockMode.user = { id: 'u-me' };
  });

  it('matches "you" by the session user id', async () => {
    mockGet.mockImplementation((url: string) => {
      if (url === '/line-bot/link-status') return Promise.resolve({ data: { linked: true } });
      if (url === '/line-bot/groups') return Promise.resolve({ data: [{ id: 'g1', name: 'Flat', currency: 'TWD', member_count: 2 }] });
      return Promise.resolve({ data: {
        balances: [{ owed_by: 'u-me', owed_to: 'u-amy', amount: '300', currency: 'TWD' }],
        member_names: { 'u-me': 'Me', 'u-amy': 'Amy' },
      } });
    });
    render(<MobileGroups />);
    expect(await screen.findByText('mobile.netYouOwe')).toBeInTheDocument();
    expect(screen.getByText(/You owe Amy .*300/)).toBeInTheDocument();
  });

  it('a group whose balances failed is flagged, not shown as settled or all square', async () => {
    mockGet.mockImplementation((url: string) => {
      if (url === '/line-bot/link-status') return Promise.resolve({ data: { linked: true } });
      if (url === '/line-bot/groups') return Promise.resolve({ data: [{ id: 'g1', name: 'Flat', currency: 'TWD', member_count: 2 }] });
      return Promise.reject(new Error('500'));
    });
    render(<MobileGroups />);
    expect(await screen.findByText('leaves out 1', { exact: false })).toBeInTheDocument();
    expect(screen.getByText(/mobile.failedRow/)).toBeInTheDocument();
    expect(screen.queryByText(/mobile.allSquare/)).not.toBeInTheDocument();
    expect(screen.queryByText(/allSettled/)).not.toBeInTheDocument();
  });

  it('a failed groups list shows an error, not the "connect LINE" prompt', async () => {
    mockGet.mockImplementation((url: string) =>
      url === '/line-bot/link-status' ? Promise.resolve({ data: { linked: true } }) : Promise.reject(new Error('502')));
    render(<MobileGroups />);
    expect(await screen.findByText(/errors.generic/)).toBeInTheDocument();
    expect(screen.queryByText('notLinked.title')).not.toBeInTheDocument();
  });

  it('a failed link-status call shows an error with a retry that recovers', async () => {
    mockGet.mockRejectedValueOnce(new Error('502'));
    render(<MobileGroups />);
    expect(await screen.findByText(/errors.generic/)).toBeInTheDocument();
    expect(screen.queryByText('notLinked.title')).not.toBeInTheDocument();

    mockGet.mockImplementation((url: string) =>
      Promise.resolve({ data: url === '/line-bot/link-status' ? { linked: false } : [] }));
    fireEvent.click(screen.getByRole('button', { name: 'mobile.retry' }));
    expect(await screen.findByText('notLinked.title')).toBeInTheDocument();
  });
});
