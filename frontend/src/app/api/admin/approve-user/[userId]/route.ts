export const dynamic = 'force-dynamic';

import { getServerApiUrl } from '@/lib/api-url';
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { isAccessTier } from '@/lib/access';

type RouteContext = { params: Promise<{ userId: string }> };

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { userId } = await context.params;
    const session = await getServerSession(authOptions);

    if (!session?.accessToken) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const apiBaseUrl = getServerApiUrl();

    // The tier picked beside Approve; anything else is dropped, not forwarded.
    const tier = request.nextUrl.searchParams.get('access_tier');
    const query = isAccessTier(tier) ? `?access_tier=${tier}` : '';

    const response = await fetch(`${apiBaseUrl}/admin/approve-user/${userId}${query}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session.accessToken}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      return NextResponse.json(errorData, { status: response.status });
    }

    const responseData = await response.json();
    return NextResponse.json(responseData.data || responseData);
  } catch (error) {
    console.error('Error approving user:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
