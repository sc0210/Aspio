export const dynamic = 'force-dynamic';

import { getServerApiUrl } from '@/lib/api-url';
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.accessToken) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const table = searchParams.get('table');

    const apiBaseUrl = getServerApiUrl();

    const backendUrl = new URL(`${apiBaseUrl}/admin/database/vacuum`);
    if (table) backendUrl.searchParams.set('table', table);

    const response = await fetch(backendUrl.toString(), {
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
    console.error('Error running vacuum:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
