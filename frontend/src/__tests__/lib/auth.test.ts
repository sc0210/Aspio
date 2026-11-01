/**
 * NextAuth config: every provider's authorize(), the jwt/session callbacks
 * (including token refresh) and the Google signIn exchange with the backend.
 * The provider factories are stubbed to hand their options straight back, so
 * authorize() is the function written here, not NextAuth's wrapper.
 */
import type { Account, Profile, Session, User } from 'next-auth';
import type { JWT } from 'next-auth/jwt';

jest.mock('next-auth/providers/credentials', () => ({
  __esModule: true,
  default: (opts: Record<string, unknown>) => ({ type: 'credentials', id: opts.id ?? 'credentials', ...opts }),
}));
jest.mock('next-auth/providers/google', () => ({
  __esModule: true,
  default: (opts: Record<string, unknown>) => ({ type: 'oauth', id: 'google', ...opts }),
}));
jest.mock('@/lib/api-url', () => ({ getServerApiUrl: () => 'http://api' }));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { authOptions } = require('@/lib/auth') as typeof import('@/lib/auth');

type Authorize = (credentials?: Record<string, string>) => Promise<User | null>;
const authorize = (id: string) =>
  (authOptions.providers.find((p) => p.id === id) as unknown as { authorize: Authorize }).authorize;

const cb = authOptions.callbacks!;
const fetchMock = jest.fn();

function reply(status: number, body: unknown = {}) {
  return { ok: status < 400, status, json: async () => body } as Response;
}

const backendLogin = {
  access_token: 'acc', refresh_token: 'ref',
  user: { id: 'u1', email: 'a@x', name: 'A', avatar: 'pic', role: 'ADMIN' },
};

const ENV = { ...process.env };
beforeEach(() => {
  jest.clearAllMocks();
  global.fetch = fetchMock as unknown as typeof fetch;
  process.env = { ...ENV };
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

describe('credentials provider', () => {
  const login = authorize('credentials');

  it('maps the backend login to a NextAuth user', async () => {
    fetchMock.mockResolvedValue(reply(200, backendLogin));
    await expect(login({ email: 'a@x', password: 'pw' })).resolves.toEqual({
      id: 'u1', email: 'a@x', name: 'A', image: 'pic', role: 'ADMIN', accessToken: 'acc', refreshToken: 'ref',
    });
    expect(fetchMock).toHaveBeenCalledWith('http://api/auth/login', expect.objectContaining({ method: 'POST' }));
  });

  it('needs both fields', async () => {
    await expect(login({ email: 'a@x' })).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('raises PendingApproval from the error envelope message', async () => {
    fetchMock.mockResolvedValue(reply(403, { success: false, error: { message: 'Account pending approval' } }));
    await expect(login({ email: 'a@x', password: 'pw' })).rejects.toThrow('PendingApproval');
  });

  it('treats other refusals and network failures as a plain failure', async () => {
    fetchMock.mockResolvedValueOnce(reply(403, { detail: 'disabled' }));
    await expect(login({ email: 'a@x', password: 'pw' })).resolves.toBeNull();
    fetchMock.mockResolvedValueOnce(reply(401));
    await expect(login({ email: 'a@x', password: 'pw' })).resolves.toBeNull();
    fetchMock.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    await expect(login({ email: 'a@x', password: 'pw' })).resolves.toBeNull();
  });

  it('defaults a missing role to USER', async () => {
    fetchMock.mockResolvedValue(reply(200, { ...backendLogin, user: { ...backendLogin.user, role: undefined } }));
    await expect(login({ email: 'a@x', password: 'pw' })).resolves.toMatchObject({ role: 'USER' });
  });
});

describe('demo provider', () => {
  const demo = authorize('demo');

  it('does nothing without demo credentials configured', async () => {
    delete process.env.DEMO_EMAIL;
    await expect(demo()).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('logs in with the configured account', async () => {
    process.env.DEMO_EMAIL = 'demo@x';
    process.env.DEMO_PASSWORD = 'pw';
    fetchMock.mockResolvedValue(reply(200, backendLogin));
    await expect(demo()).resolves.toMatchObject({ id: 'u1', accessToken: 'acc' });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ email: 'demo@x', password: 'pw' });

    fetchMock.mockResolvedValue(reply(401));
    await expect(demo()).resolves.toBeNull();
    fetchMock.mockRejectedValue(new Error('down'));
    await expect(demo()).resolves.toBeNull();
  });
});

describe('dev provider', () => {
  const dev = authorize('dev');

  it('is off unless enabled and given a token', async () => {
    process.env.DEV_LOGIN_ENABLED = 'false';
    process.env.DEV_TOOLS_TOKEN = 't';
    await expect(dev({ email: 'a@x' })).resolves.toBeNull();
    process.env.DEV_LOGIN_ENABLED = 'true';
    delete process.env.DEV_TOOLS_TOKEN;
    await expect(dev({ email: 'a@x' })).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends the token server-side as a header', async () => {
    process.env.DEV_LOGIN_ENABLED = 'true';
    process.env.DEV_TOOLS_TOKEN = 'secret';
    await expect(dev({})).resolves.toBeNull();

    fetchMock.mockResolvedValue(reply(200, backendLogin));
    await expect(dev({ email: 'a@x' })).resolves.toMatchObject({ id: 'u1' });
    expect(fetchMock.mock.calls[0][1].headers['X-Dev-Tools-Token']).toBe('secret');

    fetchMock.mockResolvedValue(reply(404));
    await expect(dev({ email: 'a@x' })).resolves.toBeNull();
    fetchMock.mockRejectedValue(new Error('down'));
    await expect(dev({ email: 'a@x' })).resolves.toBeNull();
  });
});

describe('LIFF provider', () => {
  const liff = authorize('liff');
  const jwtWith = (claims: object) =>
    `h.${Buffer.from(JSON.stringify(claims)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_')}.s`;

  it('builds the user from the access token claims', async () => {
    fetchMock.mockResolvedValue(reply(200, {
      success: true,
      data: { linked: true, access_token: jwtWith({ sub: 'u9', email: 'l@x', role: 'ADMIN' }), display_name: 'Line' },
    }));
    await expect(liff({ idToken: 'id' })).resolves.toMatchObject({
      id: 'u9', email: 'l@x', name: 'Line', role: 'ADMIN', refreshToken: undefined,
    });
  });

  it.each([
    ['no id token', undefined, undefined],
    ['backend refuses', 'id', reply(401)],
    ['not linked', 'id', reply(200, { data: { linked: false } })],
    ['token without sub', 'id', reply(200, { data: { linked: true, access_token: jwtWith({ email: 'x' }) } })],
    ['undecodable token', 'id', reply(200, { data: { linked: true, access_token: 'garbage' } })],
  ])('returns null when %s', async (_label, idToken, response) => {
    if (response) fetchMock.mockResolvedValue(response);
    await expect(liff(idToken ? { idToken } : {})).resolves.toBeNull();
  });

  it('returns null when the call throws', async () => {
    fetchMock.mockRejectedValue(new Error('down'));
    await expect(liff({ idToken: 'id' })).resolves.toBeNull();
  });
});

describe('jwt callback', () => {
  const jwt = (args: { token: JWT; user?: User; account?: Account | null }) =>
    cb.jwt!({ ...args, account: args.account ?? null } as never) as Promise<JWT>;
  const now = 1_000_000;

  beforeEach(() => jest.spyOn(Date, 'now').mockReturnValue(now));

  it('stores the backend tokens on sign-in with a 15 minute expiry', async () => {
    const token = await jwt({
      token: { error: 'RefreshAccessTokenError' },
      user: { id: 'u1', accessToken: 'a', refreshToken: 'r' } as User,
      account: { provider: 'credentials' } as Account,
    });
    expect(token).toMatchObject({ accessToken: 'a', refreshToken: 'r', userId: 'u1', role: 'USER', accessTokenExpires: now + 900_000 });
    expect(token.error).toBeUndefined();
  });

  it('keeps a live token without calling the backend', async () => {
    const token = { accessToken: 'a', accessTokenExpires: now + 1 };
    await expect(jwt({ token })).resolves.toBe(token);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('never retries once refresh has failed', async () => {
    const token = { error: 'RefreshAccessTokenError', refreshToken: 'r', accessTokenExpires: 0 };
    await expect(jwt({ token })).resolves.toBe(token);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refreshes an expired token, keeping the old refresh token if none is rotated in', async () => {
    fetchMock.mockResolvedValueOnce(reply(200, { access_token: 'a2', refresh_token: 'r2' }));
    await expect(jwt({ token: { refreshToken: 'r', accessTokenExpires: now - 1 } }))
      .resolves.toMatchObject({ accessToken: 'a2', refreshToken: 'r2', accessTokenExpires: now + 900_000 });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ refresh_token: 'r' });

    fetchMock.mockResolvedValueOnce(reply(200, { access_token: 'a3' }));
    await expect(jwt({ token: { refreshToken: 'r', accessTokenExpires: now - 1 } }))
      .resolves.toMatchObject({ accessToken: 'a3', refreshToken: 'r' });
  });

  it.each([
    ['refused', () => fetchMock.mockResolvedValueOnce(reply(401))],
    ['unreachable', () => fetchMock.mockRejectedValueOnce(new Error('down'))],
  ])('marks the token when refresh is %s', async (_label, arrange) => {
    arrange();
    await expect(jwt({ token: { refreshToken: 'r', accessTokenExpires: now - 1 } }))
      .resolves.toMatchObject({ error: 'RefreshAccessTokenError' });
  });

  it('marks an expired token that has nothing to refresh with (LIFF)', async () => {
    await expect(jwt({ token: { accessToken: 'a', accessTokenExpires: now - 1 } }))
      .resolves.toMatchObject({ error: 'RefreshAccessTokenError' });
  });
});

describe('session callback', () => {
  const session = (token: JWT) =>
    cb.session!({ session: { user: { name: 'A' }, expires: '' } as Session, token } as never) as Promise<Session>;

  it('copies identity and the access token onto the session', async () => {
    await expect(session({ userId: 'u1', role: 'ADMIN', accessToken: 'a', refreshToken: 'r' })).resolves.toMatchObject({
      user: { name: 'A', id: 'u1', role: 'ADMIN' }, accessToken: 'a',
    });
  });

  // The session is what page JavaScript reads; the 7-day refresh token stays
  // in the HttpOnly JWT cookie, where only the server can use it.
  it.each([
    ['a live session', { userId: 'u1', accessToken: 'a', refreshToken: 'r' }],
    ['a failed refresh', { error: 'RefreshAccessTokenError', accessToken: 'stale', refreshToken: 'r' }],
  ])('never hands the refresh token to the page (%s)', async (_label, token) => {
    expect(await session(token)).not.toHaveProperty('refreshToken');
  });

  it('strips the access token once refresh has failed', async () => {
    const s = await session({ error: 'RefreshAccessTokenError', accessToken: 'stale' });
    expect(s).toMatchObject({ error: 'RefreshAccessTokenError', accessToken: undefined });
  });
});

describe('signOut event', () => {
  const signOut = (token: JWT) => authOptions.events!.signOut!({ token } as never);
  const now = 1_000_000;

  beforeEach(() => jest.spyOn(Date, 'now').mockReturnValue(now));

  it('revokes the refresh token on the backend, server-side', async () => {
    fetchMock.mockResolvedValueOnce(reply(200));
    await signOut({ accessToken: 'a', refreshToken: 'r', accessTokenExpires: now + 1 });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://api/auth/logout');
    expect(init.headers.Authorization).toBe('Bearer a');
    expect(JSON.parse(init.body)).toEqual({ refresh_token: 'r', logout_all_devices: false });
  });

  it('refreshes an expired access token first, then revokes the rotated refresh token', async () => {
    fetchMock.mockResolvedValueOnce(reply(200, { access_token: 'a2', refresh_token: 'r2' })).mockResolvedValueOnce(reply(200));
    await signOut({ accessToken: 'a', refreshToken: 'r', accessTokenExpires: now - 1 });

    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual(['http://api/auth/refresh', 'http://api/auth/logout']);
    const [, init] = fetchMock.mock.calls[1];
    expect(init.headers.Authorization).toBe('Bearer a2');
    expect(JSON.parse(init.body).refresh_token).toBe('r2');
  });

  it('does nothing for a session that holds no refresh token (LIFF)', async () => {
    await signOut({ accessToken: 'a', accessTokenExpires: now + 1 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('never throws when the backend is down: sign-out must still finish', async () => {
    fetchMock.mockRejectedValueOnce(new Error('down'));
    await expect(signOut({ accessToken: 'a', refreshToken: 'r', accessTokenExpires: now + 1 })).resolves.toBeUndefined();
  });
});

describe('Google signIn', () => {
  const google = { provider: 'google', access_token: 'gtok', providerAccountId: 'g1' } as Account;
  const signIn = (account: Account | null, user: User = { id: 'tmp', email: 'g@x', name: 'G' } as User) =>
    cb.signIn!({ user, account, profile: { email: 'g@x', verified_email: true } as Profile } as never);

  it('lets other providers through untouched', async () => {
    await expect(signIn({ provider: 'credentials' } as Account)).resolves.toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('exchanges the Google token and swaps in the backend user', async () => {
    fetchMock.mockResolvedValue(reply(200, backendLogin));
    const user = { id: 'tmp', email: 'g@x' } as User;
    await expect(signIn(google, user)).resolves.toBe(true);
    expect(user).toMatchObject({ id: 'u1', accessToken: 'acc', refreshToken: 'ref', role: 'ADMIN' });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://api/auth/google/callback');
    expect(JSON.parse(init.body)).toMatchObject({ code: 'gtok', email: 'g@x', id: 'g1', verified_email: true });
  });

  it.each([
    ['backend 200 without a token', reply(200, {}), '/auth/error?error=BackendUnavailable'],
    ['pending approval', reply(403, { error: { message: 'Pending admin approval' } }), '/auth/pending-approval'],
    ['other client errors', reply(401, {}), false],
    ['backend failure', reply(502, {}), '/auth/error?error=BackendUnavailable'],
  ])('%s', async (_label, response, expected) => {
    fetchMock.mockResolvedValue(response);
    await expect(signIn(google)).resolves.toBe(expected);
  });

  it('reports the backend as unavailable when unreachable or when there is no token', async () => {
    fetchMock.mockRejectedValue(new Error('timeout'));
    await expect(signIn(google)).resolves.toBe('/auth/error?error=BackendUnavailable');
    await expect(signIn({ provider: 'google' } as Account)).resolves.toBe('/auth/error?error=BackendUnavailable');
  });
});

it('only logs the next-auth errors worth seeing', () => {
  authOptions.logger!.error!('SIGNIN_OAUTH_ERROR' as never, {} as never);
  authOptions.logger!.error!('CLIENT_FETCH_ERROR' as never, {} as never);
  authOptions.logger!.warn!('x' as never);
  authOptions.logger!.debug!('x', {});
  expect(console.error).toHaveBeenCalledTimes(1);
});
