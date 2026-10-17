#!/bin/bash

# Aspiro Frontend QA Test Runner
# Comprehensive testing script for the Aspiro personal finance application

set -e  # Exit on any error

echo "🚀 Aspiro Frontend QA Test Runner"
echo "======================================"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Default values
TEST_TYPE="all"
BROWSER="chromium"
HEADED=false
DEBUG=false
UPDATE_SNAPSHOTS=false
PARALLEL=true
RETRIES=2

# Parse command line arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --type)
      TEST_TYPE="$2"
      shift 2
      ;;
    --browser)
      BROWSER="$2"
      shift 2
      ;;
    --headed)
      HEADED=true
      shift
      ;;
    --debug)
      DEBUG=true
      shift
      ;;
    --update-snapshots)
      UPDATE_SNAPSHOTS=true
      shift
      ;;
    --no-parallel)
      PARALLEL=false
      shift
      ;;
    --retries)
      RETRIES="$2"
      shift 2
      ;;
    --help)
      echo "Usage: $0 [OPTIONS]"
      echo ""
      echo "Options:"
      echo "  --type TYPE           Test type: all, crud, api, e2e, mobile, accessibility (default: all)"
      echo "  --browser BROWSER     Browser: chromium, firefox, webkit (default: chromium)"
      echo "  --headed              Run tests in headed mode (visible browser)"
      echo "  --debug               Run tests in debug mode"
      echo "  --update-snapshots    Update visual regression baselines"
      echo "  --no-parallel         Disable parallel test execution"
      echo "  --retries COUNT       Number of retries on failure (default: 2)"
      echo "  --help                Show this help message"
      echo ""
      echo "Examples:"
      echo "  $0 --type crud --browser firefox --headed"
      echo "  $0 --type e2e --debug"
      echo "  $0 --type all --update-snapshots"
      exit 0
      ;;
    *)
      echo "Unknown option: $1"
      echo "Use --help for usage information"
      exit 1
      ;;
  esac
done

# Function to check if command exists
command_exists() {
  command -v "$1" >/dev/null 2>&1
}

# Function to print colored output
print_status() {
  echo -e "${BLUE}ℹ️  $1${NC}"
}

print_success() {
  echo -e "${GREEN}✅ $1${NC}"
}

print_warning() {
  echo -e "${YELLOW}⚠️  $1${NC}"
}

print_error() {
  echo -e "${RED}❌ $1${NC}"
}

# Check prerequisites
print_status "Checking prerequisites..."

if ! command_exists node; then
  print_error "Node.js is not installed. Please install Node.js 16 or higher."
  exit 1
fi

if ! command_exists npm; then
  print_error "npm is not installed. Please install npm."
  exit 1
fi

# Check if we're in the right directory
if [ ! -f "package.json" ]; then
  print_error "package.json not found. Please run this script from the frontend directory."
  exit 1
fi

# Check if Playwright is installed
if ! command_exists npx; then
  print_error "npx is not available. Please ensure npm is properly installed."
  exit 1
fi

print_success "Prerequisites check passed"

# Install Playwright browsers if needed
print_status "Checking Playwright installation..."

if ! npx playwright --version >/dev/null 2>&1; then
  print_warning "Playwright not found. Installing..."
  npm install @playwright/test
fi

# Check if browsers are installed
if ! npx playwright install --dry-run >/dev/null 2>&1; then
  print_warning "Playwright browsers not found. Installing..."
  npx playwright install
fi

print_success "Playwright installation verified"

# Check if backend is running (optional)
print_status "Checking backend availability..."

BACKEND_URL="http://localhost:8000"
if curl -f "$BACKEND_URL/health" >/dev/null 2>&1; then
  print_success "Backend is running at $BACKEND_URL"
else
  print_warning "Backend is not running. Tests will use mock data."
fi

# Check if frontend is running
print_status "Checking frontend availability..."

FRONTEND_URL="http://localhost:3000"
if curl -f "$FRONTEND_URL" >/dev/null 2>&1; then
  print_success "Frontend is running at $FRONTEND_URL"
else
  print_warning "Frontend is not running. Starting development server..."
  npm run dev &
  FRONTEND_PID=$!
  
  # Wait for frontend to start
  echo "Waiting for frontend to start..."
  for i in {1..30}; do
    if curl -f "$FRONTEND_URL" >/dev/null 2>&1; then
      print_success "Frontend started successfully"
      break
    fi
    sleep 2
  done
  
  if ! curl -f "$FRONTEND_URL" >/dev/null 2>&1; then
    print_error "Failed to start frontend. Please start it manually with 'npm run dev'"
    exit 1
  fi
fi

# Build test command
TEST_CMD="npx playwright test"

# Add test type
case $TEST_TYPE in
  "crud")
    TEST_CMD="$TEST_CMD crud/"
    ;;
  "api")
    TEST_CMD="$TEST_CMD api/"
    ;;
  "e2e")
    TEST_CMD="$TEST_CMD e2e/"
    ;;
  "mobile")
    TEST_CMD="$TEST_CMD --project='Mobile Chrome' --project='Mobile Safari'"
    ;;
  "accessibility")
    TEST_CMD="$TEST_CMD accessibility/"
    ;;
  "responsive")
    TEST_CMD="$TEST_CMD responsive/"
    ;;
  "all")
    # Run all tests (default)
    ;;
  *)
    print_error "Invalid test type: $TEST_TYPE"
    exit 1
    ;;
esac

# Add browser selection
if [ "$TEST_TYPE" != "mobile" ]; then
  TEST_CMD="$TEST_CMD --project=$BROWSER"
fi

# Add other options
if [ "$HEADED" = true ]; then
  TEST_CMD="$TEST_CMD --headed"
fi

if [ "$DEBUG" = true ]; then
  TEST_CMD="$TEST_CMD --debug"
fi

if [ "$UPDATE_SNAPSHOTS" = true ]; then
  TEST_CMD="$TEST_CMD --update-snapshots"
fi

if [ "$PARALLEL" = false ]; then
  TEST_CMD="$TEST_CMD --workers=1"
else
  TEST_CMD="$TEST_CMD --workers=4"
fi

TEST_CMD="$TEST_CMD --retries=$RETRIES"

# Add reporters for comprehensive output
TEST_CMD="$TEST_CMD --reporter=html,list"

# Create test results directory
mkdir -p test-results/screenshots

# Run the tests
print_status "Running tests with command: $TEST_CMD"
echo ""

# Set environment variables for testing
export NODE_ENV=test
export NEXT_PUBLIC_API_URL=http://localhost:8000/api/v1
export TEST_AUTH_TOKEN=mock-auth-token-for-testing

# Record start time
START_TIME=$(date +%s)

# Run tests with error handling
if $TEST_CMD; then
  # Calculate duration
  END_TIME=$(date +%s)
  DURATION=$((END_TIME - START_TIME))
  
  print_success "All tests passed! Duration: ${DURATION}s"
  
  # Generate summary
  echo ""
  echo "📊 Test Summary:"
  echo "================="
  echo "Test Type: $TEST_TYPE"
  echo "Browser: $BROWSER"
  echo "Duration: ${DURATION}s"
  echo "Reports: playwright-report/index.html"
  
  # Open report if not in CI
  if [ -z "$CI" ] && [ "$DEBUG" = false ]; then
    print_status "Opening test report..."
    if command_exists open; then
      open playwright-report/index.html
    elif command_exists xdg-open; then
      xdg-open playwright-report/index.html
    fi
  fi
  
else
  TEST_EXIT_CODE=$?
  
  # Calculate duration
  END_TIME=$(date +%s)
  DURATION=$((END_TIME - START_TIME))
  
  print_error "Tests failed! Duration: ${DURATION}s"
  
  # Generate failure summary
  echo ""
  echo "💥 Failure Summary:"
  echo "==================="
  echo "Test Type: $TEST_TYPE"
  echo "Browser: $BROWSER"
  echo "Exit Code: $TEST_EXIT_CODE"
  echo "Duration: ${DURATION}s"
  echo "Reports: playwright-report/index.html"
  echo "Traces: Available in test-results/"
  
  print_status "Opening failure report..."
  if [ -z "$CI" ]; then
    if command_exists open; then
      open playwright-report/index.html
    elif command_exists xdg-open; then
      xdg-open playwright-report/index.html
    fi
  fi
  
  # Cleanup and exit with error
  if [ -n "$FRONTEND_PID" ]; then
    kill $FRONTEND_PID 2>/dev/null || true
  fi
  
  exit $TEST_EXIT_CODE
fi

# Cleanup
if [ -n "$FRONTEND_PID" ]; then
  print_status "Stopping development server..."
  kill $FRONTEND_PID 2>/dev/null || true
fi

print_success "QA testing completed successfully! 🎉"

# Show next steps
echo ""
echo "🎯 Next Steps:"
echo "==============="
echo "1. Review test reports: playwright-report/index.html"
echo "2. Check screenshots: test-results/screenshots/"
echo "3. Review any failures in detail"
echo "4. Update visual baselines if UI changes are expected: npm run test:update-snapshots"
echo "5. Run specific test suites: npm run test:crud, npm run test:api, npm run test:e2e"

echo ""
echo "Happy testing! 🚀"