import { getServerApiUrl } from '@/lib/api-url';
import { NextRequest, NextResponse } from 'next/server';
import { backendError } from '@/lib/backendError';

const API_BASE = getServerApiUrl();

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const backendRes = await fetch(`${API_BASE}/auth/password/reset-confirm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: body.token,
        new_password: body.new_password,
        confirm_password: body.confirm_password,
      }),
    });

    const data = await backendRes.json().catch(() => ({}));

    if (!backendRes.ok) {
      return NextResponse.json(
        { message: backendError(data).message || 'Password reset failed' },
        { status: backendRes.status }
      );
    }

    return NextResponse.json({ message: 'Password reset successfully.' });
  } catch {
    return NextResponse.json({ message: 'Internal server error' }, { status: 500 });
  }
}
