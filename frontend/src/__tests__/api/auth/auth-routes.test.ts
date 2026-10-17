/**
 * Unit tests for the three Next.js auth API route handlers.
 * The backend fetch and NextResponse are mocked so no network or edge runtime is needed.
 */

// jest.mock is hoisted — use require() inside the factory to grab the mock later
jest.mock('next/server', () => ({
  NextRequest: jest.fn(),
  NextResponse: { json: jest.fn() },
}));

// ─── Route + mock imports (after mock registration) ──────────────────────────

import { NextResponse } from 'next/server';
import { POST as forgotPost } from '@/app/api/auth/forgot-password/route';
import { POST as verifyPost } from '@/app/api/auth/verify-email/route';
import { POST as resendPost } from '@/app/api/auth/resend-verification/route';

const mockJson = NextResponse.json as jest.Mock;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function mockBackend(status: number, body: unknown) {
  global.fetch = jest.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: jest.fn().mockResolvedValue(body),
  });
}

function makeRequest(body: unknown) {
  return { json: jest.fn().mockResolvedValue(body) };
}

// Returns [responseBody, initOptions] from the last NextResponse.json call
function lastCall(): [Record<string, unknown>, { status?: number } | undefined] {
  const calls = mockJson.mock.calls;
  return calls[calls.length - 1] as [Record<string, unknown>, { status?: number }];
}

// ─── forgot-password route ────────────────────────────────────────────────────

describe('POST /api/auth/forgot-password', () => {
  beforeEach(() => mockJson.mockClear());

  it('returns 200 with generic message on success', async () => {
    mockBackend(200, { message: 'ok' });
    await forgotPost(makeRequest({ email: 'user@test.com' }) as never);

    const [body, init] = lastCall();
    expect(init?.status ?? 200).toBe(200);
    expect(body.message as string).toMatch(/reset instructions/i);
  });

  it('forwards non-200 backend status', async () => {
    mockBackend(422, { message: 'Validation error' });
    await forgotPost(makeRequest({ email: 'bad' }) as never);

    const [, init] = lastCall();
    expect(init?.status).toBe(422);
  });

  it('returns 500 when backend is unreachable', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    await forgotPost(makeRequest({ email: 'user@test.com' }) as never);

    const [, init] = lastCall();
    expect(init?.status).toBe(500);
  });
});

// ─── verify-email route ───────────────────────────────────────────────────────

describe('POST /api/auth/verify-email', () => {
  beforeEach(() => mockJson.mockClear());

  it('returns 200 on successful verification', async () => {
    mockBackend(200, { message: 'verified' });
    await verifyPost(makeRequest({ token: 'tok123', email: 'u@test.com' }) as never);

    const [body, init] = lastCall();
    expect(init?.status ?? 200).toBe(200);
    expect(body.message as string).toMatch(/verified/i);
  });

  it('passes TOKEN_EXPIRED code through from backend', async () => {
    mockBackend(400, { detail: 'Token has expired', code: 'TOKEN_EXPIRED' });
    await verifyPost(makeRequest({ token: 'oldtok' }) as never);

    const [body, init] = lastCall();
    expect(init?.status).toBe(400);
    expect(body.code).toBe('TOKEN_EXPIRED');
    expect(body.message as string).toMatch(/expired/i);
  });

  it('passes TOKEN_INVALID code through from backend', async () => {
    mockBackend(400, { detail: 'Invalid token', code: 'TOKEN_INVALID' });
    await verifyPost(makeRequest({ token: 'badtok' }) as never);

    const [body, init] = lastCall();
    expect(init?.status).toBe(400);
    expect(body.code).toBe('TOKEN_INVALID');
  });

  it('returns 500 when backend throws', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('network'));
    await verifyPost(makeRequest({ token: 'x' }) as never);

    const [, init] = lastCall();
    expect(init?.status).toBe(500);
  });
});

// ─── resend-verification route ────────────────────────────────────────────────

describe('POST /api/auth/resend-verification', () => {
  beforeEach(() => mockJson.mockClear());

  it('returns 200 on success', async () => {
    mockBackend(200, { message: 'sent' });
    await resendPost(makeRequest({ email: 'user@test.com' }) as never);

    const [, init] = lastCall();
    expect(init?.status ?? 200).toBe(200);
  });

  it('forwards non-200 backend status', async () => {
    mockBackend(429, { message: 'Too many requests' });
    await resendPost(makeRequest({ email: 'user@test.com' }) as never);

    const [, init] = lastCall();
    expect(init?.status).toBe(429);
  });

  it('returns 500 when backend is unreachable', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    await resendPost(makeRequest({ email: 'user@test.com' }) as never);

    const [, init] = lastCall();
    expect(init?.status).toBe(500);
  });
});
