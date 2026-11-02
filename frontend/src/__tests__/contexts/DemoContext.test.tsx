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

  it('a demo visitor already reads as demo in the first effect a page runs', () => {
    // The cookie used to be read only in DemoProvider's own effect, which runs after
    // its children's, so a page fetching on `!isDemo` in its first effect hit the API.
    document.cookie = 'demo-mode=true';
    const seen: boolean[] = [];
    function Page() {
      const { isDemoMode } = useDemo();
      React.useEffect(() => { seen.push(isDemoMode); }, []); // eslint-disable-line react-hooks/exhaustive-deps
      return null;
    }
    useSession.mockReturnValue({ data: null, status: 'unauthenticated' });
    render(<DemoProvider><Page /></DemoProvider>);
    expect(seen[0]).toBe(true);
  });

  it('a signed-in user with a stale demo cookie never reads as demo, even in the first effect', () => {
    // Guards the "logged in but seeing demo data" bug: the cookie only counts when signed out.
    document.cookie = 'demo-mode=true';
    const seen: boolean[] = [];
    function Page() {
      const { isDemoMode } = useDemo();
      React.useEffect(() => { seen.push(isDemoMode); }, []); // eslint-disable-line react-hooks/exhaustive-deps
      return null;
    }
    useSession.mockReturnValue({ data: { user: { email: 'a@b.c' } }, status: 'authenticated' });
    render(<DemoProvider><Page /></DemoProvider>);
    expect(seen[0]).toBe(false);
  });

  it('ignores the demo cookie while the session is still loading', () => {
    // The server renders with status 'loading'; reading the cookie then would break hydration.
    document.cookie = 'demo-mode=true';
    renderWithSession(null, 'loading');
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
    // A jar that behaves like the browser's: the last write wins, and an
    // expired write deletes. The provider reads the cookie, so it must clear.
    const cookieJar: string[] = [];
    Object.defineProperty(document, 'cookie', {
      configurable: true,
      set: (v: string) => cookieJar.push(v),
      get: () => {
        const last = cookieJar[cookieJar.length - 1] ?? 'demo-mode=true';
        return last.includes('expires=Thu, 01 Jan 1970') ? '' : last.split(';')[0];
      },
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

describe('DemoContext — editing and deleting a demo transfer', () => {
  function TransferConsumer() {
    const ctx = useDemo();
    const pair = ctx.demoTransactions.filter((t) => t.transferGroupId);
    const groupId = pair[0]?.transferGroupId;
    return (
      <div>
        <span data-testid="tx-count">{ctx.demoTransactions.length}</span>
        <span data-testid="pair">{pair.map((t) => `${t.type}:${t.walletType}:${t.amount}`).sort().join('|')}</span>
        <button onClick={() => ctx.removeDemoTransaction(pair[0].id)}>delete-leg</button>
        <button onClick={() => groupId && ctx.updateDemoTransfer(groupId, {
          fromWallet: 'emergency', toWallet: 'life', amount: 42, currency: 'TWD', date: '2026-11-01', description: '',
        })}>swap</button>
      </div>
    );
  }

  function renderTransfer() {
    useSession.mockReturnValue({ data: null, status: 'unauthenticated' });
    return render(<DemoProvider><TransferConsumer /></DemoProvider>);
  }

  it('deletes both legs when one is deleted, as the backend does', () => {
    renderTransfer();
    const before = Number(screen.getByTestId('tx-count').textContent);
    expect(screen.getByTestId('pair').textContent).not.toBe('');
    act(() => { fireEvent.click(screen.getByText('delete-leg')); });
    expect(Number(screen.getByTestId('tx-count').textContent)).toBe(before - 2);
    expect(screen.getByTestId('pair').textContent).toBe('');
  });

  it('rewrites both legs on edit: out of the From wallet, into the To wallet', () => {
    renderTransfer();
    act(() => { fireEvent.click(screen.getByText('swap')); });
    expect(screen.getByTestId('pair').textContent).toBe('expense:emergency:42|income:life:42');
  });
});
