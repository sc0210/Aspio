// Shared scales so semantic aliases (income/expense) can't drift from the
// base success/error palettes.
const successScale = {
  50: '#f0fdf4',
  100: '#dcfce7',
  200: '#bbf7d0',
  300: '#86efac',
  400: '#4ade80',
  500: '#22c55e',
  600: '#16a34a',
  700: '#15803d',
  800: '#166534',
  900: '#14532d',
};

const errorScale = {
  50: '#fef2f2',
  100: '#fee2e2',
  200: '#fecaca',
  300: '#fca5a5',
  400: '#f87171',
  500: '#ef4444',
  600: '#dc2626',
  700: '#b91c1c',
  800: '#991b1b',
  900: '#7f1d1d',
  950: '#450a0a', // Darker shade for enhanced contrast
};

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  darkMode: 'class',
  safelist: [
    // Ensure theme-aware colors are always available
    'dark:bg-gray-900',
    'dark:bg-gray-800',
    'dark:bg-gray-700',
    'dark:text-gray-100',
    'dark:text-gray-200',
    'dark:text-gray-300',
    'dark:text-gray-400',
    'dark:border-gray-700',
    'dark:border-gray-600',
    // Financial colors
    'dark:text-prosperity-300',
    'dark:text-prosperity-400',
    'dark:bg-prosperity-900/20',
    'dark:border-prosperity-700',
    'dark:text-error-300',
    'dark:text-error-400',
    'dark:bg-error-900/20',
    'dark:border-error-700',
    // Primary colors
    'dark:text-primary-300',
    'dark:text-primary-400',
    'dark:bg-primary-900/20',
    'dark:border-primary-700',
    // Success colors (metric cards, financial positive states)
    'bg-success-50',
    'bg-success-100',
    'border-success-200/50',
    'text-success-600',
    'text-success-400',
    'text-success-900',
    'text-success-100',
    'dark:from-success-900/20',
    'dark:to-success-900/10',
    // Warning colors (metric cards)
    'bg-warning-50',
    'bg-warning-100',
    'border-warning-200/50',
    'text-warning-600',
    'text-warning-400',
    'text-warning-900',
    'text-warning-100',
    'dark:from-warning-900/20',
    'dark:to-warning-900/10',
    'bg-warning-500/5',
    'dark:bg-warning-500/10',
    // Secondary/neutral colors (metric cards)
    'bg-secondary-50',
    'bg-secondary-100',
    'border-secondary-200/50',
    'text-secondary-600',
    'text-secondary-400',
    'text-secondary-900',
    'text-secondary-100',
    'dark:from-secondary-900/20',
    'dark:to-secondary-900/10',
    // Error/expense color variants
    'bg-error-50',
    'bg-error-100',
    'border-error-200/50',
    'text-error-600',
    'text-error-400',
    'text-error-900',
    'text-error-100',
    'bg-error-500/5',
    'dark:bg-error-500/10',
    'bg-error-100',
    'dark:bg-error-900/30',
    'text-error-700',
    'text-error-300',
    // Prosperity variants for metric cards
    'bg-prosperity-500/30',
    'text-prosperity-200',
    'bg-error-500/30',
    'text-error-200',
    'bg-error-500',
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          50: '#f0f9ff',
          100: '#e0f2fe',
          200: '#bae6fd',
          300: '#7dd3fc',
          400: '#38bdf8',
          500: '#0ea5e9',
          600: '#0284c7',
          700: '#0369a1',
          800: '#075985',
          900: '#0c4a6e',
        },
        // Asian market color preferences
        gold: {
          50: '#fffdf7',
          100: '#fffbeb',
          200: '#fef3c7',
          300: '#fde68a',
          400: '#fcd34d',
          500: '#f59e0b',
          600: '#d97706',
          700: '#b45309',
          800: '#92400e',
          900: '#78350f',
        },
        // Lucky colors for Asian markets
        auspicious: {
          red: '#dc2626',
          gold: '#f59e0b',
          jade: '#10b981',
        },
        // Trust and security colors
        trust: {
          50: '#f0f9ff',
          100: '#e0f2fe',
          200: '#bae6fd',
          300: '#7dd3fc',
          400: '#38bdf8',
          500: '#0ea5e9',
          600: '#0284c7',
          700: '#0369a1',
          800: '#075985',
          900: '#0c4a6e',
        },
        prosperity: {
          50: '#ecfdf5',
          100: '#d1fae5',
          200: '#a7f3d0',
          300: '#6ee7b7',
          400: '#34d399',
          500: '#10b981',
          600: '#059669',
          700: '#047857',
          800: '#065f46',
          900: '#064e3b',
          950: '#022c22', // Darker shade for enhanced contrast
        },
        secondary: {
          50: '#f8fafc',
          100: '#f1f5f9',
          200: '#e2e8f0',
          300: '#cbd5e1',
          400: '#94a3b8',
          500: '#64748b',
          600: '#475569',
          700: '#334155',
          800: '#1e293b',
          900: '#0f172a',
        },
        success: successScale,
        warning: {
          50: '#fffbeb',
          100: '#fef3c7',
          200: '#fde68a',
          300: '#fcd34d',
          400: '#fbbf24',
          500: '#f59e0b',
          600: '#d97706',
          700: '#b45309',
          800: '#92400e',
          900: '#78350f',
        },
        error: errorScale,
        // Semantic aliases for money direction. Use income-*/expense-* instead
        // of raw green-*/red-* literals so the meaning stays consistent
        // app-wide and can be re-themed in one place. Aliased to the exact
        // success/error scales (defined above via the shared consts) so the
        // pairs cannot drift apart.
        income: successScale,
        expense: errorScale,
      },
      fontFamily: {
        // Order does the language switching for us: Inter carries no CJK
        // glyphs, so Latin resolves to Inter and Chinese falls through to Noto
        // Sans TC per glyph. No language-conditional class needed anywhere.
        //
        // Both are self-hosted (Inter via next/font/local in app/layout.tsx,
        // Noto via src/styles/noto-sans-tc.css), and neither is named bare
        // here: a bare 'Inter' would let a random system copy win over the
        // subsetted file we ship. The generics sit at the end, exactly once —
        // putting one inside Inter's own fallback list would terminate the
        // cascade before Noto was ever consulted.
        //
        // The per-language noto-sans-{sc,tc,jp} utilities that used to live
        // here named fonts nothing installs and nothing loads, so they resolved
        // to Inter then a generic. The app is zh-TW; that is now the default
        // stack rather than an opt-in class no page used.
        sans: [
          'var(--font-inter)',
          'var(--font-noto-tc)',
          'system-ui',
          '-apple-system',
          'sans-serif',
        ],
      },
      animation: {
        'fade-in': 'fadeIn 0.5s ease-in-out',
        'fade-in-up': 'fadeInUp 0.3s ease-out',
        'slide-up': 'slideUp 0.3s ease-out',
        'slide-down': 'slideDown 0.3s ease-out',
        'bounce-gentle': 'bounceGentle 2s infinite',
        'bounce-slow': 'bounceSlow 3s ease-in-out infinite',
        'pulse-slow': 'pulse 3s ease-in-out infinite',
        'pulse-subtle': 'pulseSubtle 2s ease-in-out infinite',
        'shimmer': 'shimmer 1.5s ease-in-out infinite',
        'metric-enter': 'metricEnter 0.6s cubic-bezier(0.34, 1.56, 0.64, 1)',
        'metric-hover': 'metricHover 0.3s ease-out',
        'spin-slow': 'spin 1.5s linear infinite',
        'spin-reverse': 'spinReverse 1s linear infinite',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        fadeInUp: {
          '0%': { opacity: '0', transform: 'translateY(10px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        slideUp: {
          '0%': { transform: 'translateY(10px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        slideDown: {
          '0%': { transform: 'translateY(-10px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        bounceGentle: {
          '0%, 20%, 50%, 80%, 100%': { transform: 'translateY(0)' },
          '40%': { transform: 'translateY(-4px)' },
          '60%': { transform: 'translateY(-2px)' },
        },
        bounceSlow: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-10px)' },
        },
        pulseSubtle: {
          '0%, 100%': { opacity: '1', transform: 'scale(1)' },
          '50%': { opacity: '0.8', transform: 'scale(1.02)' },
        },
        spinReverse: {
          '0%': { transform: 'rotate(0deg)' },
          '100%': { transform: 'rotate(-360deg)' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-200px 0' },
          '100%': { backgroundPosition: 'calc(200px + 100%) 0' },
        },
        metricEnter: {
          '0%': { opacity: '0', transform: 'translateY(8px) scale(0.96)' },
          '100%': { opacity: '1', transform: 'translateY(0) scale(1)' },
        },
        metricHover: {
          '0%': { transform: 'translateY(0)', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' },
          '100%': { transform: 'translateY(-4px)', boxShadow: '0 20px 40px rgba(0,0,0,0.1)' },
        },
      },
      spacing: {
        '18': '4.5rem',
        '88': '22rem',
        '120': '30rem',
      },
      boxShadow: {
        'card-base': '0 1px 3px rgba(0,0,0,0.05)',
        'card-hover': '0 20px 40px rgba(0,0,0,0.1)',
        'card-elevated': '0 10px 25px rgba(0,0,0,0.08)',
      },
      fontSize: {
        'xs': ['0.75rem', { lineHeight: '1rem' }],
        'sm': ['0.875rem', { lineHeight: '1.25rem' }],
        'base': ['1rem', { lineHeight: '1.5rem' }],
        'lg': ['1.125rem', { lineHeight: '1.75rem' }],
        'xl': ['1.25rem', { lineHeight: '1.75rem' }],
        '2xl': ['1.5rem', { lineHeight: '2rem' }],
        '3xl': ['1.875rem', { lineHeight: '2.25rem' }],
        '4xl': ['2.25rem', { lineHeight: '2.5rem' }],
        '5xl': ['3rem', { lineHeight: '1' }],
      },
      borderRadius: {
        'none': '0',
        'sm': '0.125rem',
        DEFAULT: '0.25rem',
        'md': '0.375rem',
        'lg': '0.5rem',
        'xl': '0.75rem',
        '2xl': '1rem',
        '3xl': '1.5rem',
        'full': '9999px',
        'card': '16px',
        'card-lg': '20px',
      },
    },
  },
  plugins: [],
}