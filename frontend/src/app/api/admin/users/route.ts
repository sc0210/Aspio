export const dynamic = 'force-dynamic';

import { getServerApiUrl } from '@/lib/api-url';
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.accessToken) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const { searchParams } = new URL(request.url);
    const page = searchParams.get('page') || '1';
    const limit = searchParams.get('limit') || '100';
    const is_active = searchParams.get('is_active');

    const search = searchParams.get('search');

    const queryParams = new URLSearchParams({
      skip: String((parseInt(page) - 1) * parseInt(limit)),
      limit,
      ...(search && { search }),
      ...(is_active && { is_active }),
    });

    const apiBaseUrl = getServerApiUrl();
    const response = await fetch(
      `${apiBaseUrl}/admin/users?${queryParams}`,
      {
        headers: {
          'Authorization': `Bearer ${session.accessToken}`,
          'Content-Type': 'application/json',
        },
      }
    );

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      return NextResponse.json(
        errorData,
        { status: response.status }
      );
    }

    const responseData = await response.json();

    // Extract data from ApiResponse wrapper
    const usersData = responseData.data || responseData;

    return NextResponse.json(usersData);
  } catch (error) {
    console.error('Error fetching users:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
