/**
 * Regression tests for the next-auth v4 malformed-Bearer crash.
 *
 * next-auth decodes a `Bearer` Authorization header with decodeURIComponent
 * outside its own try/catch, so `Authorization: Bearer %` raised a URIError that
 * escaped getToken and 500'd the middleware on every gated route. safeGetToken
 * must absorb that and report "no session" instead.
 */
import { getToken } from 'next-auth/jwt';
import type { NextRequest } from 'next/server';

import { safeGetToken } from '@/lib/safe-get-token';

jest.mock('next-auth/jwt', () => ({ getToken: jest.fn() }));

const mockGetToken = getToken as jest.MockedFunction<typeof getToken>;
const fakeRequest = {} as NextRequest;

describe('safeGetToken', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns the token when getToken resolves normally', async () => {
    mockGetToken.mockResolvedValue({ accessToken: 'abc' } as never);

    await expect(safeGetToken(fakeRequest)).resolves.toEqual({ accessToken: 'abc' });
  });

  it('returns null when there is no session', async () => {
    mockGetToken.mockResolvedValue(null);

    await expect(safeGetToken(fakeRequest)).resolves.toBeNull();
  });

  it('returns null instead of throwing on a malformed Bearer header', async () => {
    // What next-auth actually raises for `Authorization: Bearer %`.
    mockGetToken.mockRejectedValue(new URIError('URI malformed'));

    await expect(safeGetToken(fakeRequest)).resolves.toBeNull();
  });

  it('does not log the attacker-controlled URIError path', async () => {
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
    mockGetToken.mockRejectedValue(new URIError('URI malformed'));

    await safeGetToken(fakeRequest);

    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it('still surfaces unexpected failures, e.g. a missing NEXTAUTH_SECRET', async () => {
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
    mockGetToken.mockRejectedValue(new Error('secret is required'));

    await expect(safeGetToken(fakeRequest)).resolves.toBeNull();
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });
});
