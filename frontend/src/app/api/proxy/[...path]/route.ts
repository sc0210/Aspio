import { getServerApiUrl } from '@/lib/api-url';
import { NextRequest, NextResponse } from 'next/server';
import { safeGetToken } from '@/lib/safe-get-token';

/**
 * API Proxy Route
 * 
 * This route proxies requests to the backend API, solving the problem where
 * external clients (via ngrok) can't reach localhost:8000 directly.
 * 
 * Usage: /api/proxy/holdings -> http://backend:8000/api/v1/holdings
 */

const BACKEND_URL = getServerApiUrl();

type RouteContext = { params: Promise<{ path: string[] }> };

export async function GET(request: NextRequest, context: RouteContext) {
  const { path } = await context.params;
  return proxyRequest(request, path, 'GET');
}

export async function POST(request: NextRequest, context: RouteContext) {
  const { path } = await context.params;
  return proxyRequest(request, path, 'POST');
}

export async function PUT(request: NextRequest, context: RouteContext) {
  const { path } = await context.params;
  return proxyRequest(request, path, 'PUT');
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const { path } = await context.params;
  return proxyRequest(request, path, 'PATCH');
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const { path } = await context.params;
  return proxyRequest(request, path, 'DELETE');
}

async function proxyRequest(
  request: NextRequest,
  pathSegments: string[],
  method: string
): Promise<NextResponse> {
  try {
    const path = pathSegments.join('/');
    const url = new URL(request.url);
    const queryString = url.search;
    const targetUrl = `${BACKEND_URL}/${path}${queryString}`;

    if (process.env.NODE_ENV === 'development') console.log(`[API Proxy] ${method} ${path} -> ${targetUrl}`);

    // Get auth token if available. Guarded so a malformed Authorization header
    // reads as "unauthenticated" instead of surfacing as a bogus 502 from the
    // catch below, which would wrongly look like the backend was down.
    const token = await safeGetToken(request);

    // Pass the caller's Content-Type through. Forcing application/json dropped a
    // multipart upload's boundary, so the backend saw no `file` field and every
    // receipt scan and CSV import through this proxy failed with a 422.
    const headers: Record<string, string> = {
      'Content-Type': request.headers.get('content-type') || 'application/json',
    };

    // Forward authorization if available
    if (token?.accessToken) {
      headers['Authorization'] = `Bearer ${token.accessToken}`;
    }

    // Forward ngrok-skip-browser-warning header if present
    const skipWarning = request.headers.get('ngrok-skip-browser-warning');
    if (skipWarning) {
      headers['ngrok-skip-browser-warning'] = skipWarning;
    }

    // Build fetch options
    const fetchOptions: RequestInit = {
      method,
      headers,
    };

    // Add body for non-GET requests. Raw bytes, not text(): decoding an image as
    // UTF-8 replaces every invalid byte, so the file would arrive corrupted. As a
    // Blob, not the bare ArrayBuffer: fetch detaches an ArrayBuffer on the first
    // send, so following a backend redirect (POST /transactions -> /transactions/)
    // failed with "fetch failed"; a Blob can be sent again.
    if (method !== 'GET' && method !== 'HEAD') {
      try {
        const body = await request.arrayBuffer();
        if (body.byteLength > 0) {
          fetchOptions.body = new Blob([body]);
        }
      } catch {
        // No body to forward
      }
    }

    // Make the request to backend with a 30s timeout to prevent connection exhaustion
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30_000);
    let response: Response;
    try {
      response = await fetch(targetUrl, { ...fetchOptions, signal: controller.signal });
    } finally {
      clearTimeout(timeoutId);
    }

    // Handle 204 No Content specially - return proper empty response
    if (response.status === 204) {
      return new NextResponse(null, {
        status: 204,
        statusText: 'No Content',
        headers: {
          'Cache-Control': 'no-store, no-cache, must-revalidate',
          'Pragma': 'no-cache',
        },
      });
    }

    // Get response body
    const responseText = await response.text();

    // Return proxied response with no-cache headers to prevent stale data
    return new NextResponse(responseText || null, {
      status: response.status,
      statusText: response.statusText,
      headers: {
        'Content-Type': response.headers.get('Content-Type') || 'application/json',
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        'Pragma': 'no-cache',
      },
    });
  } catch (error) {
    console.error('[API Proxy] Error:', error);
    return NextResponse.json(
      {
        error: 'Proxy error',
        message: error instanceof Error ? error.message : 'Unknown error',
        details: 'Failed to connect to backend API'
      },
      { status: 502 }
    );
  }
}
