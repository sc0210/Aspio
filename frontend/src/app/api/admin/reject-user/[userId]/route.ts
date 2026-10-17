export const dynamic = 'force-dynamic';

import { getServerApiUrl } from '@/lib/api-url';
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';

type RouteContext = { params: Promise<{ userId: string }> };

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { userId } = await context.params;
    const session = await getServerSession(authOptions);

    if (!session?.accessToken) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const reason = searchParams.get('reason');

    const apiBaseUrl = getServerApiUrl();

    const queryParams = reason ? `?reason=${encodeURIComponent(reason)}` : '';
    const response = await fetch(
      `${apiBaseUrl}/admin/reject-user/${userId}${queryParams}`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.accessToken}`,
          'Content-Type': 'application/json',
        },
      }
    );

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      return NextResponse.json(errorData, { status: response.status });
    }

    const responseData = await response.json();
    return NextResponse.json(responseData.data || responseData);
  } catch (error) {
    console.error('Error rejecting user:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
