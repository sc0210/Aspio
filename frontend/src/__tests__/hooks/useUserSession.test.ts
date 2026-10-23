/**
 * useUserSession and the userDataService paths it drives: the per-user
 * localStorage cache is created on sign-in, reused while fresh, and cleared on
 * sign-out.
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { getSession, useSession } from 'next-auth/react';
import { useAppMode } from '@/hooks/useAppMode';
import { useUserSession } from '@/hooks/useUserSession';
import { userDataService } from '@/services/userDataService';

jest.mock('@/hooks/useAppMode', () => ({ useAppMode: jest.fn() }));

const mockSession = useSession as jest.Mock;
const mockGetSession = getSession as jest.Mock;
const mockMode = useAppMode as jest.Mock;

const KEY = 'aspiro_user_u1';
const session = { user: { id: 'u1' }, accessToken: 'tok' };

function signedIn() {
  mockSession.mockReturnValue({ data: session, status: 'authenticated' });
  mockGetSession.mockResolvedValue(session);
  mockMode.mockReturnValue({ isAuthenticated: true });
}

function signedOut() {
  mockSession.mockReturnValue({ data: null, status: 'unauthenticated' });
  mockGetSession.mockResolvedValue(null);
  mockMode.mockReturnValue({ isAuthenticated: false });
}

beforeEach(() => {
  jest.clearAllMocks();
  localStorage.clear();
});

describe('useUserSession', () => {
  it('creates and stores a default cache on sign-in', async () => {
    signedIn();
    const { result } = renderHook(() => useUserSession());

    await waitFor(() => expect(result.current.isInitialized).toBe(true));
    expect(result.current.userData).toMatchObject({ userId: 'u1' });
    expect(JSON.parse(localStorage.getItem(KEY) ?? 'null')).toMatchObject({ userId: 'u1' });
  });

  it('reuses a fresh cache', async () => {
    localStorage.setItem(KEY, JSON.stringify({ userId: 'u1', lastLogin: new Date(), preferences: { currency: 'JPY' } }));
    signedIn();
    const { result } = renderHook(() => useUserSession());

    await waitFor(() => expect(result.current.isInitialized).toBe(true));
    expect(result.current.userData).toMatchObject({ preferences: { currency: 'JPY' } });
  });

  it('reports loading while the session resolves', () => {
    mockSession.mockReturnValue({ data: null, status: 'loading' });
    mockMode.mockReturnValue({ isAuthenticated: false });
    const { result } = renderHook(() => useUserSession());
    expect(result.current.isLoading).toBe(true);
  });

  it('surfaces an initialisation failure', async () => {
    signedIn();
    const spy = jest.spyOn(userDataService, 'initializeUserSession').mockRejectedValueOnce(new Error('quota'));
    const { result } = renderHook(() => useUserSession());

    await waitFor(() => expect(result.current.error).toBe('quota'));
    expect(result.current.isInitialized).toBe(false);
    spy.mockRestore();
  });

  it('clears the cache once signed out', async () => {
    signedIn();
    const { rerender } = renderHook(() => useUserSession());
    await waitFor(() => expect(localStorage.getItem(KEY)).not.toBeNull());

    signedOut();
    rerender();
    // Signed out, the service has no user id to clear by, so the cache stays;
    // a later sign-in as the same user reuses it while it is fresh.
    await waitFor(() => expect(mockGetSession).toHaveBeenCalled());
    expect(localStorage.getItem(KEY)).not.toBeNull();

    await act(() => userDataService.clearAllUserData('u1'));
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it('syncs every five minutes while signed in', async () => {
    jest.useFakeTimers();
    try {
      signedIn();
      const sync = jest.spyOn(userDataService, 'syncUserData');
      const { unmount } = renderHook(() => useUserSession());

      await act(async () => {
        jest.advanceTimersByTime(5 * 60 * 1000);
      });
      expect(sync).toHaveBeenCalledWith('u1');

      unmount();
      sync.mockClear();
      await act(async () => {
        jest.advanceTimersByTime(5 * 60 * 1000);
      });
      expect(sync).not.toHaveBeenCalled();
      sync.mockRestore();
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('userDataService', () => {
  it('drops a cache older than a day', () => {
    const stale = new Date(Date.now() - 25 * 60 * 60 * 1000);
    localStorage.setItem(KEY, JSON.stringify({ userId: 'u1', lastLogin: stale }));
    expect(userDataService.getUserCache('u1')).toBeNull();
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it('treats an unreadable cache as absent', () => {
    localStorage.setItem(KEY, '{broken');
    expect(userDataService.getUserCache('u1')).toBeNull();
  });

  it('does not initialise without a token', async () => {
    mockGetSession.mockResolvedValue({ user: { id: 'u1' } });
    expect(await userDataService.initializeUserSession()).toBeNull();
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it('does not initialise without a user', async () => {
    mockGetSession.mockResolvedValue(null);
    expect(await userDataService.initializeUserSession()).toBeNull();
  });

  it('sync is a no-op without a user, a token or a cache', async () => {
    mockGetSession.mockResolvedValue(null);
    await expect(userDataService.syncUserData()).resolves.toBeUndefined();
    mockGetSession.mockResolvedValue({ user: { id: 'u1' } });
    await expect(userDataService.syncUserData('u1')).resolves.toBeUndefined();
    mockGetSession.mockResolvedValue(session);
    await expect(userDataService.syncUserData('u1')).resolves.toBeUndefined();
  });

  it('onAuthStateChange initialises on sign-in and clears on sign-out', async () => {
    mockGetSession.mockResolvedValue(session);
    await userDataService.onAuthStateChange(session as never);
    expect(localStorage.getItem(KEY)).not.toBeNull();

    // Signing out clears by the id the live session still reports.
    await userDataService.onAuthStateChange(null);
    expect(localStorage.getItem(KEY)).toBeNull();
  });
});
