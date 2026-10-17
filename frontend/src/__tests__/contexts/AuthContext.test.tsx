import React from 'react';
import { render, screen } from '@testing-library/react';
import { SessionProvider } from 'next-auth/react';
import { AuthContextProvider, useAuthContext } from '@/contexts/AuthContext';
import { DemoProvider } from '@/contexts/DemoContext';

// jest.setup.js mocks @/contexts/AuthContext globally as a signed-in user, so
// that most component suites don't each have to stub it. This suite is the one
// place that tests the real mode calculation, so it has to opt back out —
// otherwise every assertion here reads the global stub and "unauthenticated"
// and "demo" both come back as "authenticated".
jest.unmock('@/contexts/AuthContext');

jest.mock('next-auth/react', () => ({
  ...jest.requireActual('next-auth/react'),
  useSession: jest.fn(),
  SessionProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

const { useSession } = jest.requireMock('next-auth/react') as { useSession: jest.Mock };

function ModeDisplay() {
  const { mode, isAuthenticated, isDemo } = useAuthContext();
  return (
    <div>
      <span data-testid="mode">{mode}</span>
      <span data-testid="is-auth">{String(isAuthenticated)}</span>
      <span data-testid="is-demo">{String(isDemo)}</span>
    </div>
  );
}

function renderWithSession(session: object | null, status: string) {
  useSession.mockReturnValue({ data: session, status });
  return render(
    <SessionProvider session={null}>
      <DemoProvider>
        <AuthContextProvider>
          <ModeDisplay />
        </AuthContextProvider>
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

describe('AuthContext — mode calculation', () => {
  it('mode is "authenticated" when session + accessToken present', () => {
    renderWithSession(
      { user: { id: 'u1', email: 'a@b.com' }, accessToken: 'tok' },
      'authenticated'
    );
    expect(screen.getByTestId('mode').textContent).toBe('authenticated');
    expect(screen.getByTestId('is-auth').textContent).toBe('true');
    expect(screen.getByTestId('is-demo').textContent).toBe('false');
  });

  it('mode is "unauthenticated" when no session and no demo cookie', () => {
    renderWithSession(null, 'unauthenticated');
    expect(screen.getByTestId('mode').textContent).toBe('unauthenticated');
    expect(screen.getByTestId('is-auth').textContent).toBe('false');
    expect(screen.getByTestId('is-demo').textContent).toBe('false');
  });

  it('mode is "demo" when unauthenticated and demo cookie is set', () => {
    Object.defineProperty(document, 'cookie', {
      writable: true,
      configurable: true,
      value: 'demo-mode=true',
    });
    useSession.mockReturnValue({ data: null, status: 'unauthenticated' });
    render(
      <SessionProvider session={null}>
        <DemoProvider>
          <AuthContextProvider>
            <ModeDisplay />
          </AuthContextProvider>
        </DemoProvider>
      </SessionProvider>
    );
    expect(screen.getByTestId('mode').textContent).toBe('demo');
    expect(screen.getByTestId('is-demo').textContent).toBe('true');
  });

  it('mode is "authenticated" and isDemo is false even if demo cookie exists', () => {
    Object.defineProperty(document, 'cookie', {
      writable: true,
      configurable: true,
      value: 'demo-mode=true',
    });
    renderWithSession(
      { user: { id: 'u1', email: 'a@b.com' }, accessToken: 'tok' },
      'authenticated'
    );
    expect(screen.getByTestId('mode').textContent).toBe('authenticated');
    expect(screen.getByTestId('is-demo').textContent).toBe('false');
  });

  it('isAuthenticated requires both session.user and accessToken', () => {
    // When session has user+accessToken+no error → isAuthenticated = true
    renderWithSession(
      { user: { id: 'u1' }, accessToken: 'tok', error: undefined },
      'authenticated'
    );
    expect(screen.getByTestId('is-auth').textContent).toBe('true');
  });

  it('isAuthenticated is false when session has an error field', () => {
    // A session with error='RefreshAccessTokenError' causes navigation in the effect,
    // so we test a non-navigation error value here.
    renderWithSession(
      { user: { id: 'u1' }, accessToken: 'tok', error: 'SomeOtherError' },
      'authenticated'
    );
    expect(screen.getByTestId('is-auth').textContent).toBe('false');
  });
});
