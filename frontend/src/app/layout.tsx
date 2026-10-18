import localFont from 'next/font/local';
import { Providers } from './providers';
import { DemoBanner } from '@/components/layout/DemoBanner';
import { AnalyticsConsentBanner } from '@/components/analytics/AnalyticsConsentBanner';
import { AnalyticsBootstrap } from '@/components/analytics/AnalyticsBootstrap';
import { GlobalErrorBoundary } from '@/components/errors/GlobalErrorBoundary';
import { Toaster } from 'react-hot-toast';
import { getPublicApiUrl, isAbsoluteUrl } from '@/lib/api-url';
import './globals-hybrid.css';
import '@/styles/dashboard.css';
// Traditional Chinese. Hand-written @font-face rules over self-hosted subset
// files — see the header of that file for why next/font/local cannot express
// the unicode-range split this family needs.
import '@/styles/noto-sans-tc.css';

// Inter is vendored rather than pulled by next/font/google, which fetches from
// fonts.gstatic.com at BUILD time — a Google Fonts outage failed CI on
// 2026-08-14 and, since the Pi deploy is gated on CI, blocked deploys outright.
// See src/app/fonts/README.md.
//
// One variable file (font-weight 400-700) replaces the four static weights the
// google loader was requesting.
//
// Deliberately NO `fallback` here. next/font inlines that list into the
// variable's value, so anything ending in a generic (`sans-serif`,
// `system-ui`) terminates the cascade *inside* var(--font-inter) — before
// Noto Sans TC is ever reached, which would hand every Chinese glyph to
// whatever the generic resolves to. The generics live once, at the end of the
// Tailwind `sans` stack. Next still emits its metric-adjusted "Inter Fallback"
// face automatically, so this costs no extra layout shift.
const inter = localFont({
  src: './fonts/inter-latin-variable.woff2',
  weight: '400 700',
  style: 'normal',
  display: 'swap',
  variable: '--font-inter',
});

export const metadata = {
  verification: {
    google: 'j3ZqeyFvINNYRzUHW65bjeXOCkiCNlxdt6h5vOq2lbY',
  },
  title: 'Aspiro - FIRE Tracker | Financial Independence, Retire Early',
  description: 'Track your FIRE journey with comprehensive expense monitoring, investment tracking, and goal-based planning. Achieve Financial Independence, Retire Early with Aspiro.',
  keywords: 'FIRE, financial independence, retire early, personal finance, investment tracking, financial goals, budgeting, wealth building',
  authors: [{ name: 'Aspiro Team' }],
  creator: 'Aspiro',
  publisher: 'Aspiro',
  robots: 'index, follow',
  manifest: '/manifest.json',
  other: {
    'mobile-web-app-capable': 'yes',
    'apple-mobile-web-app-capable': 'yes',
    'apple-mobile-web-app-status-bar-style': 'default',
    'apple-mobile-web-app-title': 'Aspiro FIRE',
    'application-name': 'Aspiro FIRE',
    'msapplication-TileColor': '#3b82f6',
    'theme-color': '#3b82f6',
  },
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#0ea5e9',
};

/**
 * The API's origin, but only when it is somewhere else.
 *
 * This used to be the Railway backend's hostname, written out by hand. That
 * service is gone, so every visitor opened a connection to a host that answers
 * 404 — and would have kept doing so unnoticed. Reading the origin the app
 * actually calls keeps the hint honest, and skipping it when the API shares the
 * app's origin (Caddy serves both on the Pi) skips a hint that buys nothing.
 */
function backendPreconnectOrigin(): string | null {
  try {
    const apiUrl = getPublicApiUrl();
    // The default same-origin `/api/v1` needs no hint.
    if (!isAbsoluteUrl(apiUrl)) return null;
    const api = new URL(apiUrl);
    const app = process.env.NEXTAUTH_URL ?? '';
    if (app && new URL(app).origin === api.origin) return null;
    return api.origin;
  } catch {
    return null;
  }
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const apiOrigin = backendPreconnectOrigin();

  return (
    <html lang="zh-TW" className="h-full" suppressHydrationWarning>
      <head>
        {/*
          No font preconnects: Inter is self-hosted (see src/app/fonts/), so it
          is served from our own origin and there is no fonts.gstatic.com round
          trip left to warm up. next/font/local inlines the @font-face and
          preloads the file itself.

          We do keep the explicit preconnect for the API backend because every
          authenticated page makes requests there immediately after mount.
          crossOrigin="anonymous" is required for the TLS handshake to be shared
          with credentialed fetch requests.
        */}
        {apiOrigin && (
          <>
            <link rel="dns-prefetch" href={apiOrigin} />
            <link rel="preconnect" href={apiOrigin} crossOrigin="anonymous" />
          </>
        )}

        {/* Google OAuth avatar images — preconnect so avatar loads don't block LCP */}
        <link rel="preconnect" href="https://lh3.googleusercontent.com" crossOrigin="anonymous" />

        {/* Next.js automatically handles modulepreload for JS chunks */}
      </head>
      {/*
        inter.variable (not inter.className): className would pin the element to
        Inter alone, which has no CJK coverage. Exposing the variable instead
        lets Tailwind's `sans` stack put Noto Sans TC behind it, so the browser
        picks per glyph — Latin from Inter, Chinese from Noto — with no
        language-conditional class anywhere.
      */}
      <body suppressHydrationWarning className={`${inter.variable} font-sans h-full bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-gray-100 antialiased transition-colors duration-200`}>
        <Providers>
          <GlobalErrorBoundary>
            <AnalyticsBootstrap />
            <div className="min-h-full">
              <DemoBanner />
              {/* Not a <main>: DashboardLayout owns the app's one main landmark
                  (and its scroll container); pages outside it render their own. */}
              <div>
                {children}
              </div>
            </div>
            <AnalyticsConsentBanner />
          </GlobalErrorBoundary>
          <Toaster
            position="top-right"
            containerStyle={{
              top: 'max(16px, env(safe-area-inset-top))',
              right: 'max(16px, env(safe-area-inset-right))',
            }}
            toastOptions={{
              duration: 4000,
              className: 'dark:bg-gray-800 dark:text-gray-100',
              style: {
                background: 'var(--toast-bg, #363636)',
                color: 'var(--toast-color, #fff)',
              },
              success: {
                style: {
                  background: '#059669',
                },
              },
              error: {
                style: {
                  background: '#dc2626',
                },
              },
            }}
          />
        </Providers>
      </body>
    </html>
  );
}