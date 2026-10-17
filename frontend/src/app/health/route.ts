import { NextResponse } from 'next/server';
import { getServerBackendOrigin } from '@/lib/api-url';

export async function GET() {
  try {
    // Basic health check
    const healthCheck = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      environment: process.env.NODE_ENV || 'development',
      version: process.env.npm_package_version || '1.0.0',
      services: {
        frontend: 'operational',
        backend: await checkBackendHealth(),
      }
    };

    return NextResponse.json(healthCheck, { status: 200 });
  } catch (error) {
    return NextResponse.json(
      {
        status: 'unhealthy',
        timestamp: new Date().toISOString(),
        error: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}

async function checkBackendHealth(): Promise<string> {
  try {
    // Server-side fetch: needs the absolute backend origin. The backend mounts
    // /health at its root, outside /api/v1. GET, not HEAD: FastAPI's @app.get
    // route answers HEAD with 405, which read as "degraded".
    const response = await fetch(`${getServerBackendOrigin()}/health`, {
      method: 'GET',
      signal: AbortSignal.timeout(3000), // 3 second timeout
    });

    return response.ok ? 'operational' : 'degraded';
  } catch {
    return 'unavailable';
  }
}