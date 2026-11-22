import { getServerApiUrl } from '@/lib/api-url';
import { NextRequest, NextResponse } from 'next/server';
import { backendError } from '@/lib/backendError';

const API_BASE = getServerApiUrl();

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const backendRes = await fetch(`${API_BASE}/auth/verify-email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: body.token, email: body.email }),
    });

    const data = await backendRes.json().catch(() => ({}));

    if (!backendRes.ok) {
      const { message, code } = backendError(data);
      return NextResponse.json(
        { message: message || 'Verification failed', code },
        { status: backendRes.status }
      );
    }

    return NextResponse.json({ message: 'Email verified successfully.' });
  } catch {
    return NextResponse.json({ message: 'Internal server error' }, { status: 500 });
  }
}
