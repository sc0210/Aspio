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
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const apiBaseUrl = getServerApiUrl();
    const backendUrl = `${apiBaseUrl}/admin/stats/system`;
    if (dev) console.log('[API /api/admin/stats/system] Calling backend:', backendUrl);

    const response = await fetch(backendUrl, {
      headers: {
        'Authorization': `Bearer ${session.accessToken}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      if (dev) console.log('[API /api/admin/stats/system] Error from backend:', errorData);
      return NextResponse.json(
        errorData,
        { status: response.status }
      );
    }

    const responseData = await response.json();
    const stats = responseData.data || responseData;
    return NextResponse.json(stats);
  } catch (error) {
    console.error('Error fetching system stats:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
