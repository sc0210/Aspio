/**
 * Unit tests for the /api/auth/reset-password route handler.
 */

jest.mock('next/server', () => ({
  NextRequest: jest.fn(),
  NextResponse: { json: jest.fn() },
}));

import { NextResponse } from 'next/server';
import { POST } from '@/app/api/auth/reset-password/route';

const mockJson = NextResponse.json as jest.Mock;

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

function lastCall(): [Record<string, unknown>, { status?: number } | undefined] {
  const calls = mockJson.mock.calls;
  return calls[calls.length - 1] as [Record<string, unknown>, { status?: number }];
}

beforeEach(() => mockJson.mockClear());

describe('POST /api/auth/reset-password', () => {
  it('returns 200 on successful reset', async () => {
    mockBackend(200, { data: { password_reset: true }, message: 'Password reset successfully.' });

    await POST(makeRequest({ token: 'valid-token', new_password: 'NewPass1', confirm_password: 'NewPass1' }) as never);

    const [body, init] = lastCall();
    expect(init?.status ?? 200).toBe(200);
    expect(body.message as string).toMatch(/reset/i);
  });

  it('forwards 400 for invalid or expired token', async () => {
    mockBackend(400, { detail: 'Invalid or expired reset token' });

    await POST(makeRequest({ token: 'bad-token', new_password: 'NewPass1', confirm_password: 'NewPass1' }) as never);

    const [body, init] = lastCall();
    expect(init?.status).toBe(400);
    expect(body.message as string).toMatch(/invalid|expired/i);
  });

  it('forwards 400 for password requirements not met', async () => {
    mockBackend(400, { detail: 'Password requirements not met: must include uppercase' });

    await POST(makeRequest({ token: 'tok', new_password: 'weak', confirm_password: 'weak' }) as never);

    const [, init] = lastCall();
    expect(init?.status).toBe(400);
  });

  it('returns 500 when backend is unreachable', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'));

    await POST(makeRequest({ token: 'tok', new_password: 'NewPass1', confirm_password: 'NewPass1' }) as never);

    const [, init] = lastCall();
    expect(init?.status).toBe(500);
  });
});
