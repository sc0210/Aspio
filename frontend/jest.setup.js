import '@testing-library/jest-dom'

// Mock Next.js router
jest.mock('next/router', () => ({
  useRouter() {
    return {
      route: '/',
      pathname: '/',
      query: {},
      asPath: '/',
      push: jest.fn(),
      pop: jest.fn(),
      reload: jest.fn(),
      back: jest.fn(),
      prefetch: jest.fn().mockResolvedValue(undefined),
      beforePopState: jest.fn(),
      events: {
        on: jest.fn(),
        off: jest.fn(),
        emit: jest.fn(),
      },
      isFallback: false,
    }
  },
}))

// Mock Next.js navigation
jest.mock('next/navigation', () => ({
  useRouter() {
    return {
      push: jest.fn(),
      replace: jest.fn(),
      refresh: jest.fn(),
      back: jest.fn(),
      forward: jest.fn(),
      prefetch: jest.fn(),
    }
  },
  useSearchParams() {
    return new URLSearchParams()
  },
  usePathname() {
    return '/'
  },
}))

// Mock NextAuth
jest.mock('next-auth/react', () => ({
  useSession: jest.fn(() => ({
    data: {
      user: {
        id: 'test-user-id',
        email: 'test@example.com',
        name: 'Test User',
      },
      accessToken: 'mock-access-token',
    },
    status: 'authenticated',
  })),
  signIn: jest.fn(),
  signOut: jest.fn(),
  // Resolve null rather than undefined: callers do `await getSession().catch(...)`,
  // and a bare jest.fn() returns undefined, so the .catch() itself threw.
  getSession: jest.fn().mockResolvedValue(null),
}))

// Mock AuthContext.
//
// useAuthContext() throws "must be used within AuthContextProvider" unless the
// tree is wrapped in the provider, and useAppMode() delegates straight to it — so
// any component that reads app mode, however indirectly, took the whole suite
// down. That single cause accounted for 74 of the 94 remaining failures.
//
// Mocking it globally (alongside next-auth/react, which is already stubbed as an
// authenticated session just above) keeps the default consistent with that: a
// normal signed-in user, which is what most component tests implicitly assume.
// Suites that care about a specific mode — demo, unauthenticated, loading —
// override this with their own jest.mock, as addTransactionDemoMode does.
jest.mock('@/contexts/AuthContext', () => ({
  useAuthContext: jest.fn(() => ({
    mode: 'authenticated',
    isAuthenticated: true,
    isDemo: false,
    user: { id: 'test-user-id', email: 'test@example.com', name: 'Test User' },
    canPersistData: true,
    session: { user: { id: 'test-user-id' }, accessToken: 'mock-access-token' },
    status: 'authenticated',
  })),
  AuthContextProvider: ({ children }) => children,
}))

// React Query is deliberately NOT mocked.
//
// It used to be stubbed globally here: useQuery returned a frozen idle result
// and useQueryClient().invalidateQueries was a no-op jest.fn(). That made every
// component render without a provider, at the cost of erasing the only thing
// the library does — caching. Two real bugs shipped underneath it, both
// invisible to the whole suite by construction:
//
//   * the dashboard Refresh button removed the queries it then tried to
//     invalidate, so nothing it targeted ever refetched;
//   * three callers shared one daily-performance key while requesting
//     different spans, so the trend page rendered the dashboard's year.
//
// A component that calls useQuery now needs a QueryClientProvider, and says so
// loudly ("No QueryClient set") instead of passing against a stub. Use
// src/__tests__/utils/queryWrapper.tsx — renderWithQuery for components,
// createQueryWrapper for renderHook.

// Mock window.matchMedia
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: jest.fn().mockImplementation(query => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: jest.fn(), // deprecated
    removeListener: jest.fn(), // deprecated
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    dispatchEvent: jest.fn(),
  })),
})

// Mock IntersectionObserver
global.IntersectionObserver = class IntersectionObserver {
  constructor() {}
  disconnect() {}
  observe() {}
  unobserve() {}
}

// Mock ResizeObserver
global.ResizeObserver = class ResizeObserver {
  constructor() {}
  disconnect() {}
  observe() {}
  unobserve() {}
}

// Setup fetch mock.
//
// A bare jest.fn() returns undefined, so every caller that touches the result —
// .then, .catch, .finally, .ok, .json() — died with "Cannot read properties of
// undefined". That is not a useful default: it fails inside the code under test
// rather than at the assertion, and it hides which request was even made.
// Resolve a minimal Response instead; suites that care about a specific payload
// override with mockResolvedValueOnce.
global.fetch = jest.fn(() =>
  Promise.resolve({
    ok: true,
    status: 200,
    statusText: 'OK',
    headers: new Headers({ 'content-type': 'application/json' }),
    json: async () => ({}),
    text: async () => '',
  }),
)

// Console error filter - suppress known warnings in tests
const originalError = console.error
beforeAll(() => {
  console.error = (...args) => {
    if (
      /Warning.*not wrapped in act/.test(args[0]) ||
      /Warning.*validateDOMNesting/.test(args[0])
    ) {
      return
    }
    originalError.call(console, ...args)
  }
})

afterAll(() => {
  console.error = originalError
})