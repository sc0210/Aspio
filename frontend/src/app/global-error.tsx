'use client';

/**
 * Last-resort error boundary: replaces the ROOT layout when it crashes, so no
 * providers (i18n, theme, query client) are available here. Copy is therefore
 * static and bilingual, and only browser APIs are used.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  console.error('[global error boundary]', error);

  return (
    <html lang="zh-TW">
      <body style={{ margin: 0, fontFamily: 'system-ui, sans-serif', background: '#f9fafb' }}>
        <div
          style={{
            minHeight: '100vh',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            textAlign: 'center',
            padding: '1rem',
          }}
        >
          <div style={{ maxWidth: '28rem' }}>
            <div style={{ fontSize: '3rem', marginBottom: '1rem' }} role="img" aria-label="Error">⚠️</div>
            <h1 style={{ fontSize: '1.25rem', fontWeight: 600, color: '#111827', marginBottom: '0.5rem' }}>
              發生錯誤 / Something went wrong
            </h1>
            <p style={{ fontSize: '0.875rem', color: '#4b5563', marginBottom: '1.5rem' }}>
              應用程式發生未預期的錯誤，請重試。
              <br />
              The app hit an unexpected error. Please try again.
            </p>
            <button
              onClick={reset}
              style={{
                padding: '0.5rem 1rem',
                fontSize: '0.875rem',
                fontWeight: 500,
                color: '#ffffff',
                background: '#2563eb',
                border: 'none',
                borderRadius: '0.5rem',
                cursor: 'pointer',
                minHeight: '44px',
                minWidth: '44px',
              }}
            >
              重試 / Try again
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
