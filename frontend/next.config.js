/** @type {import('next').NextConfig} */
const withBundleAnalyzer = require('@next/bundle-analyzer')({
  enabled: process.env.ANALYZE === 'true',
})

const nextConfig = {
  // Required for Docker standalone deployment (Dockerfile copies .next/standalone)
  output: 'standalone',
  // Extra hosts the dev server accepts (e.g. a Tailscale name for phone testing).
  // Comma-separated; set from docker-compose.override.yml. Dev-only — ignored by builds.
  allowedDevOrigins: process.env.DEV_ALLOWED_ORIGINS
    ? process.env.DEV_ALLOWED_ORIGINS.split(',').map((h) => h.trim())
    : undefined,
  // Remove console logs in production (but keep errors and warnings)
  compiler: {
    removeConsole: process.env.NODE_ENV === 'production' ? {
      exclude: ['error', 'warn'],
    } : false,
  },
  typescript: {
    ignoreBuildErrors: false,
  },
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '**.supabase.co' },
      { protocol: 'https', hostname: '**.supabase.in' },
      { protocol: 'https', hostname: 'lh3.googleusercontent.com' },
    ],
    formats: ['image/avif', 'image/webp'],
    deviceSizes: [640, 750, 828, 1080, 1200, 1920, 2048, 3840],
    imageSizes: [16, 32, 48, 64, 96, 128, 256, 384],
    // Cache optimised images for 30 days (default is 60 s in dev, 0 in prod for
    // on-demand ISR). Avatar and chart images change infrequently.
    minimumCacheTTL: 60 * 60 * 24 * 30,
  },
  async redirects() {
    return [
      // /profile folded into /settings. Redirected here rather than from a
      // page: a page that only redirects still mounts a component first — a
      // blank flash, and in dev a React "negative time stamp" performance
      // error on every visit. Not permanent, so browsers don't cache a 308
      // should /profile ever come back.
      { source: '/profile', destination: '/settings', permanent: false },
      // /compare folded into /savings as its Compare tab.
      { source: '/compare', destination: '/savings?tab=compare', permanent: false },
      // Retired 2026-09-17. /review is the month-at-a-time read /reports
      // overlapped with; the "AI" chat was keyword templates with no model.
      { source: '/reports', destination: '/review', permanent: false },
      { source: '/chat', destination: '/dashboard', permanent: false },
    ];
  },
  // Allow ngrok and other external hosts in development
  async headers() {
    const isDev = process.env.NODE_ENV === 'development';
    return [
      {
        source: '/:path*',
        headers: [
          // Wildcard CORS only in dev (ngrok/local). Production sends no
          // Access-Control-Allow-Origin at all: the app is only fetched from its
          // own origin, and headers() is evaluated at BUILD time, so naming an
          // origin here (it used to be NEXTAUTH_URL || aspiro.app) would bake one
          // domain into a prebuilt image.
          ...(isDev ? [{ key: 'Access-Control-Allow-Origin', value: '*' }] : []),
          // Standard security headers (production only — dev hot-reload needs relaxed policy)
          ...(isDev ? [] : [
            { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
            { key: 'X-Content-Type-Options', value: 'nosniff' },
            { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
            { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
            { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
            {
              key: 'Content-Security-Policy',
              value: [
                "default-src 'self'",
                "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
                "style-src 'self' 'unsafe-inline'",
                "img-src 'self' data: https:",
                "font-src 'self' data:",
                "connect-src 'self' https:",
                "frame-ancestors 'none'",
              ].join('; '),
            },
          ]),
          // Prevent caching issues in development
          ...(isDev ? [
            { key: 'Cache-Control', value: 'no-store, must-revalidate' },
          ] : []),
        ],
      },
      // API routes should never be cached
      {
        source: '/api/:path*',
        headers: [
          { key: 'Cache-Control', value: 'no-store, no-cache, must-revalidate' },
          { key: 'Pragma', value: 'no-cache' },
        ],
      },
      // Static assets can be cached with revalidation
      {
        source: '/_next/static/:path*',
        headers: [
          { key: 'Cache-Control', value: isDev ? 'no-store' : 'public, max-age=31536000, immutable' },
        ],
      },
    ];
  },
  env: {
    // NEXTAUTH_URL is intentionally NOT exposed here — it is a server-side-only
    // variable. Putting it in the env block bakes the absolute URL into the client
    // bundle, causing NextAuth to make absolute-URL session requests that break on
    // DNS failure, preview deployments, or local dev. NextAuth client uses relative
    // URLs (/api/auth/*) when NEXTAUTH_URL is not in the client bundle.
    // NEXTAUTH_SECRET is intentionally NOT exposed here — it must be set as a real
    // environment variable and must never have a hardcoded fallback.
    GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
    // API_BASE_URL used to be inlined here with a localhost default. Nothing read
    // it, and an absolute URL in the bundle is exactly what pins an image to one
    // domain. API URLs resolve in one place: src/lib/api-url.ts.
    // NOTE: INTERNAL_API_URL is intentionally NOT inlined here.
    // Putting it in the env block would bake the build-time value into server code,
    // overriding the runtime value set in Vercel dashboard.
    // Server-side API routes (like NextAuth) read it from the real runtime environment.
  },
  experimental: {
    optimizePackageImports: [
      '@heroicons/react',
      'recharts',
      'date-fns',
      '@tanstack/react-query',
      'react-hook-form',
    ],
    // Speed up development builds
    webpackBuildWorker: true,
  },
  reactStrictMode: true,
  webpack: (config, { dev }) => {
    // Prevent webpack from resolving symlinks/bind-mounts to their real paths.
    // Without this, Docker volume mounts on macOS resolve to the host path
    // (/Users/samchen/...) via fs.realpath(), causing RSC Client Manifest IDs
    // to mismatch the container paths (/app/...) used at request time.
    config.resolve.symlinks = false

    // NOTE: the old `'date-fns': 'date-fns/esm'` alias was removed — date-fns v3+
    // dropped the /esm folder (it's ESM-native now), so the alias breaks the build
    // on any date-fns >= 3. Tree-shaking is handled by experimental
    // .optimizePackageImports (['date-fns', ...]) above and works for v2 too.

    // Mark packages as side-effect free for better tree shaking
    config.module.rules.push({
      test: /\.js$/,
      include: /node_modules\/(date-fns|recharts)/,
      sideEffects: false,
    })

    // Development-mode optimizations
    if (dev) {
      // Only skip the more expensive per-module passes; keep splitChunks default so
      // the JSX runtime and other shared modules stay in a common chunk and load
      // before layout/page chunks (splitChunks: false caused a chunk ordering bug
      // where jsx-dev-runtime ended up in page.js but was needed by layout.js first).
      config.optimization = {
        ...config.optimization,
        removeAvailableModules: false,
        removeEmptyChunks: false,
      }
    } else {
      // Production: isolate heavy chart/form libraries into their own async chunks
      // so they are only downloaded when a chart or modal is first rendered.
      config.optimization.splitChunks = {
        ...config.optimization.splitChunks,
        cacheGroups: {
          ...(config.optimization.splitChunks?.cacheGroups || {}),
          recharts: {
            test: /[\\/]node_modules[\\/]recharts[\\/]/,
            name: 'vendor-recharts',
            chunks: 'async', // only split when imported via dynamic()
            priority: 20,
          },
          reactHookForm: {
            test: /[\\/]node_modules[\\/]react-hook-form[\\/]/,
            name: 'vendor-react-hook-form',
            chunks: 'async',
            priority: 15,
          },
        },
      }
    }

    return config
  },
  // Compress output
  compress: true,
  // Additional performance optimizations
  poweredByHeader: false,
}

module.exports = withBundleAnalyzer(nextConfig)