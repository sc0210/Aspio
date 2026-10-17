export const dynamic = 'force-dynamic';

import { getServerApiUrl } from '@/lib/api-url';
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';

const dev = process.env.NODE_ENV === 'development';

export async function GET() {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.accessToken) {
      return NextResponse.json(
        { isAdmin: false, isSuperAdmin: false, role: null },
        { status: 200 }
      );
    }

    const apiBaseUrl = getServerApiUrl();
    const backendUrl = `${apiBaseUrl}/admin/check`;
    if (dev) console.log('[API /api/admin/check] Calling backend:', backendUrl);

    const response = await fetch(backendUrl, {
      headers: {
        'Authorization': `Bearer ${session.accessToken}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      return NextResponse.json(
        { isAdmin: false, isSuperAdmin: false, role: null },
        { status: 200 }
      );
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error('[API /api/admin/check] Error:', error);
    return NextResponse.json(
      { isAdmin: false, isSuperAdmin: false, role: null },
      { status: 200 }
    );
  }
}
