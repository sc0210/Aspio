export const dynamic = 'force-dynamic';

import { getServerApiUrl } from '@/lib/api-url';
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { isAccessTier } from '@/lib/access';

type RouteContext = { params: Promise<{ userId: string }> };

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const { userId } = await context.params;
    const session = await getServerSession(authOptions);

    if (!session?.accessToken) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    if (!isAccessTier(body?.access_tier)) {
      return NextResponse.json({ error: 'access_tier must be free or premium' }, { status: 422 });
    }

    const response = await fetch(`${getServerApiUrl()}/admin/users/${userId}/access-tier`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${session.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ access_tier: body.access_tier }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      return NextResponse.json(errorData, { status: response.status });
    }

    const responseData = await response.json();
    return NextResponse.json(responseData.data || responseData);
  } catch (error) {
    console.error('Error setting access tier:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
