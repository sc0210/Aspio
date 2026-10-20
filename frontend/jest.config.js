const nextJest = require('next/jest')

const createJestConfig = nextJest({
  // Provide the path to your Next.js app to load next.config.js and .env files
  dir: './',
})

// Add any custom config to be passed to Jest
const customJestConfig = {
  // Pins the suite to the app's business timezone; see the file for why it cannot
  // live in a test.
  globalSetup: '<rootDir>/jest.global-setup.js',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
  testEnvironment: 'jsdom',
  collectCoverageFrom: [
    'src/**/*.{js,jsx,ts,tsx}',
    '!src/**/*.d.ts',
    '!src/**/index.{js,ts}',
    '!src/**/*.stories.{js,jsx,ts,tsx}',
    '!src/**/node_modules/**',
  ],
  coverageReporters: [
    'text',
    'lcov',
    'html',
    'cobertura'
  ],
  coverageDirectory: 'coverage',
  // Coverage floors, enforced in CI (`--coverage`). These are a ratchet, not a
  // target: each is the measured level rounded down, so coverage cannot slide.
  // Raise them when tests land; never lower them to get a PR green.
  // Directory keys are aggregate (a glob key would apply per file); files under
  // them are left out of `global`.
  coverageThreshold: {
    global: {
      statements: 43,
      branches: 34,
      functions: 38,
      lines: 44,
    },
    // Critical paths; the goal for both is 60 across the board.
    './src/services/': {
      statements: 70,
      branches: 64,
      functions: 76,
      lines: 71,
    },
    './src/hooks/': {
      statements: 53,
      branches: 45,
      functions: 51,
      lines: 54,
    },
  },
  moduleNameMapper: {
    // Handle module aliases (this will be automatically configured for you based on your tsconfig.json paths)
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  testPathIgnorePatterns: [
    '<rootDir>/.next/',
    '<rootDir>/node_modules/',
    '<rootDir>/tests/', // Ignore Playwright tests
    '<rootDir>/e2e/',
    '<rootDir>/playwright-report/',
    '<rootDir>/test-results/',
  ],
  // Only files named *.test.* / *.spec.* are suites. The first pattern used to
  // match EVERY file under __tests__, so shared helpers were collected as test
  // files and had to carry a dummy `it()` to avoid "Your test suite must
  // contain at least one test" (src/__tests__/utils/test-utils.tsx still does).
  // Every real suite in this repo is already named *.test.*, so narrowing costs
  // nothing and lets helpers live beside the tests that use them.
  testMatch: [
    '<rootDir>/src/**/__tests__/**/*.{test,spec}.{js,jsx,ts,tsx}',
    '<rootDir>/src/**/*.{test,spec}.{js,jsx,ts,tsx}',
    '<rootDir>/__tests__/**/*.{test,spec}.{js,jsx,ts,tsx}',
  ],
  transform: {
    '^.+\\.(js|jsx|ts|tsx)$': ['babel-jest', { presets: ['next/babel'] }],
  },
  transformIgnorePatterns: [
    '/node_modules/',
    '^.+\\.module\\.(css|sass|scss)$',
  ],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
}

// createJestConfig is exported this way to ensure that next/jest can load the Next.js config which is async
module.exports = createJestConfig(customJestConfig)