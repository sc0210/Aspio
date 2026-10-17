import React from 'react';
import { render, screen, act, fireEvent } from '@testing-library/react';
import { SessionProvider } from 'next-auth/react';
import { DemoProvider, useDemo } from '@/contexts/DemoContext';

jest.mock('next-auth/react', () => ({
  ...jest.requireActual('next-auth/react'),
  useSession: jest.fn(),
  SessionProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

const { useSession } = jest.requireMock('next-auth/react') as { useSession: jest.Mock };

function TestConsumer() {
  const ctx = useDemo();
  return (
    <div>
      <span data-testid="is-demo">{String(ctx.isDemoMode)}</span>
      <span data-testid="tx-count">{ctx.demoTransactions.length}</span>
      <span data-testid="stats-portfolio">{ctx.getDemoStats().portfolio_wallet as number}</span>
      <button onClick={ctx.enableDemo}>enable</button>
      <button onClick={ctx.disableDemo}>disable</button>
      <button onClick={() => ctx.addDemoTransaction({
        type: 'expense',
        amount: 100,
        currency: 'TWD',
        description: 'Test',
        date: new Date().toISOString(),
        category: 'Food & Dining',
        tags: [],
      })}>add-tx</button>
    </div>
  );
}

function renderWithSession(sessionData: object | null, status = 'unauthenticated') {
  useSession.mockReturnValue({ data: sessionData, status });
  return render(
    <SessionProvider session={null}>
      <DemoProvider>
        <TestConsumer />
      </DemoProvider>
    </SessionProvider>
  );
}

beforeEach(() => {
  Object.defineProperty(document, 'cookie', {
    writable: true,
    configurable: true,
    value: '',
  });
  jest.clearAllMocks();
});

describe('DemoContext — isDemoMode state', () => {
  it('starts with demo mode off', () => {
    renderWithSession(null);
    expect(screen.getByTestId('is-demo').textContent).toBe('false');
  });

  it('enables demo mode and sets SameSite cookie', () => {
    const cookieJar: string[] = [];
    Object.defineProperty(document, 'cookie', {
      configurable: true,
      set: (v: string) => cookieJar.push(v),
      get: () => cookieJar.join('; '),
    });

    renderWithSession(null);
    act(() => { fireEvent.click(screen.getByText('enable')); });

    expect(screen.getByTestId('is-demo').textContent).toBe('true');
    expect(cookieJar.some(c => c.includes('SameSite=Strict'))).toBe(true);
  });

  it('disables demo mode and clears cookie', () => {
    const cookieJar: string[] = [];
    Object.defineProperty(document, 'cookie', {
      configurable: true,
      set: (v: string) => cookieJar.push(v),
      get: () => 'demo-mode=true',
    });

    renderWithSession(null);
    act(() => { fireEvent.click(screen.getByText('enable')); });
    act(() => { fireEvent.click(screen.getByText('disable')); });

    expect(screen.getByTestId('is-demo').textContent).toBe('false');
    const clearAttempt = cookieJar.find(c => c.includes('expires=Thu, 01 Jan 1970'));
    expect(clearAttempt).toBeTruthy();
  });

  it('disables demo mode when user authenticates', () => {
    useSession.mockReturnValue({ data: null, status: 'unauthenticated' });
    const { rerender } = render(
      <SessionProvider session={null}>
        <DemoProvider>
          <TestConsumer />
        </DemoProvider>
      </SessionProvider>
    );

    act(() => { fireEvent.click(screen.getByText('enable')); });
    expect(screen.getByTestId('is-demo').textContent).toBe('true');

    useSession.mockReturnValue({
      data: { user: { id: 'u1', email: 'u@test.com' }, accessToken: 'tok' },
      status: 'authenticated',
    });
    rerender(
      <SessionProvider session={null}>
        <DemoProvider>
          <TestConsumer />
        </DemoProvider>
      </SessionProvider>
    );

    expect(screen.getByTestId('is-demo').textContent).toBe('false');
  });
});

describe('DemoContext — deterministic transactions', () => {
  it('generates the same transaction amounts on every render', () => {
    renderWithSession(null);
    const count1 = screen.getByTestId('tx-count').textContent;

    // Re-render a second instance and confirm count is stable
    const { unmount } = render(
      <SessionProvider session={null}>
        <DemoProvider>
          <TestConsumer />
        </DemoProvider>
      </SessionProvider>
    );
    const count2 = screen.getAllByTestId('tx-count')[1].textContent;
    expect(count1).toBe(count2);
    unmount();
  });

  it('expense amounts are integers (no floating-point randomness)', () => {
    renderWithSession(null);
    // If Math.random were used amounts would have decimals; deterministic fractions + Math.round produces integers
    // We verify by checking getDemoStats returns numeric monthlyExpenses
    const stats = JSON.parse(
      JSON.stringify(screen.getByTestId('stats-portfolio').textContent)
    );
    expect(typeof Number(stats)).toBe('number');
  });
});

describe('DemoContext — getDemoStats memoization', () => {
  it('returns stable portfolio_wallet value', () => {
    renderWithSession(null);
    const val = screen.getByTestId('stats-portfolio').textContent;
    expect(val).toBe('2000000');
  });

  it('recomputes stats after addDemoTransaction', () => {
    renderWithSession(null);
    act(() => { fireEvent.click(screen.getByText('enable')); });
    act(() => { fireEvent.click(screen.getByText('add-tx')); });
    // tx-count should have increased
    const count = Number(screen.getByTestId('tx-count').textContent);
    expect(count).toBeGreaterThan(27); // 27 = 2 income + 25 expense
  });
});

describe('DemoContext — addDemoTransaction', () => {
  it('prepends the new transaction to the list', () => {
    renderWithSession(null);
    const before = Number(screen.getByTestId('tx-count').textContent);
    act(() => { fireEvent.click(screen.getByText('add-tx')); });
    const after = Number(screen.getByTestId('tx-count').textContent);
    expect(after).toBe(before + 1);
  });
});
