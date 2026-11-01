/**
 * The demo-mode cookie is set by any visitor, so it may open the demo pages
 * and nothing else. It used to pass the route guard everywhere, /admin
 * included.
 */
import type { NextRequest } from 'next/server';

jest.mock('next/server', () => ({
  NextResponse: {
    next: () => ({ kind: 'next' }),
    redirect: (url: URL) => ({ kind: 'redirect', location: url.pathname }),
  },
}));
jest.mock('@/lib/safe-get-token', () => ({ safeGetToken: jest.fn().mockResolvedValue(null) }));

import { middleware } from '@/middleware';

function visit(pathname: string, { demo }: { demo: boolean }) {
  const nextUrl = new URL(`http://localhost:3000${pathname}`);
  const request = {
    nextUrl,
    url: nextUrl.toString(),
    cookies: { get: (name: string) => (demo && name === 'demo-mode' ? { value: 'true' } : undefined) },
  };
  return middleware(request as unknown as NextRequest) as unknown as Promise<{ kind: string; location?: string }>;
}

describe('middleware with the demo-mode cookie and no session', () => {
  it.each(['/dashboard', '/transactions', '/portfolio', '/api/proxy/dashboard/stats'])('lets a demo visitor into %s', async (path) => {
    await expect(visit(path, { demo: true })).resolves.toEqual({ kind: 'next' });
  });

  it.each(['/admin', '/admin/users'])('sends a demo visitor at %s to sign in', async (path) => {
    await expect(visit(path, { demo: true })).resolves.toEqual({ kind: 'redirect', location: '/auth/signin' });
  });

  it('still sends a visitor without the cookie to sign in', async () => {
    await expect(visit('/dashboard', { demo: false })).resolves.toEqual({ kind: 'redirect', location: '/auth/signin' });
  });
});
