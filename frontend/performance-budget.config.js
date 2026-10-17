// Performance budget configuration for the FIRE tracker app
module.exports = {
  // Bundle size limits (in KB) - Updated for financial app with charts
  budgets: [
    {
      type: 'bundle',
      name: 'main',
      maximumWarning: 200, // Warn at 200KB
      maximumError: 250,   // Error at 250KB (our target achieved!)
    },
    {
      type: 'bundle',
      name: 'recharts',
      maximumWarning: 400, // Charts library - allow larger size for financial charts
      maximumError: 450,   // Increased limit for feature-rich charts
    },
    {
      type: 'bundle',
      name: 'framework',
      maximumWarning: 200,
      maximumError: 280,
    },
    {
      type: 'initial',
      maximumWarning: 400, // Initial load budget (main page)
      maximumError: 500,   // Under 500KB for main page load
    },
    {
      type: 'anyComponentStyle',
      maximumWarning: 6,
      maximumError: 10,
    },
    {
      type: 'any',
      maximumWarning: 2,
      maximumError: 5,
    }
  ],
  // Core Web Vitals targets
  coreWebVitals: {
    LCP: 2.5,    // Largest Contentful Paint (seconds)
    FID: 100,    // First Input Delay (milliseconds)
    CLS: 0.1,    // Cumulative Layout Shift
    INP: 200,    // Interaction to Next Paint (milliseconds)
  },
  // Performance monitoring thresholds
  performanceMetrics: {
    firstContentfulPaint: 1.8,
    speedIndex: 3.4,
    interactive: 5.2,
    totalBlockingTime: 200,
  }
};