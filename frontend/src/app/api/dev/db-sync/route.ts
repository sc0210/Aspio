import { getServerApiUrl } from '@/lib/api-url';
import { NextRequest, NextResponse } from 'next/server';

const isDev = process.env.NODE_ENV === 'development';
const backendBase = getServerApiUrl();

export async function POST(req: NextRequest) {
  if (!isDev) {
    return new NextResponse('Not found', { status: 404 });
  }

  const body = await req.json();
  const command: string = body.command ?? '';
  const confirmed: boolean = body.confirmed ?? false;

  // Remote (Supabase) targets: status/push/pull. LAN peer (Pi) targets: *-pi.
  const allowed = ['status', 'push', 'pull', 'status-pi', 'push-pi', 'pull-pi'];
  if (!allowed.includes(command)) {
    return NextResponse.json({ error: 'Invalid command' }, { status: 400 });
  }

  const isStatus = command.startsWith('status');
  const isMutation = command.startsWith('push') || command.startsWith('pull');
  if (isMutation && !confirmed) {
    return NextResponse.json({ error: 'Confirmation required' }, { status: 400 });
  }

  const method = isStatus ? 'GET' : 'POST';

  let backendRes: Response;
  try {
    backendRes = await fetch(`${backendBase}/dev/db-sync/${command}`, { method });
  } catch (err) {
    return new NextResponse(`Cannot reach backend: ${err}`, { status: 502 });
  }

  if (!backendRes.body) {
    const text = await backendRes.text();
    return new NextResponse(text, { status: backendRes.status });
  }

  return new Response(backendRes.body, {
    status: backendRes.status,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
