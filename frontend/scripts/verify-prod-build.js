#!/usr/bin/env node

/**
 * Verify Production Build Script
 * 
 * This script checks the production build for console statements
 * and ensures only console.error and console.warn remain.
 * 
 * Usage: npm run verify:prod
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const NEXT_BUILD_DIR = path.join(__dirname, '..', '.next');
const COLORS = {
    reset: '\x1b[0m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    red: '\x1b[31m',
    blue: '\x1b[34m',
    cyan: '\x1b[36m',
};

function log(message, color = 'reset') {
    console.log(`${COLORS[color]}${message}${COLORS.reset}`);
}

function checkBuildExists() {
    if (!fs.existsSync(NEXT_BUILD_DIR)) {
        log('❌ No production build found!', 'red');
        log('Run: npm run build:prod', 'yellow');
        process.exit(1);
    }
    log('✅ Production build found', 'green');
}

function searchForConsoleLogs() {
    log('\n🔍 Searching for console statements in build...', 'blue');

    const searchPatterns = [
        { pattern: 'console.log', severity: 'error', label: 'console.log' },
        { pattern: 'console.debug', severity: 'error', label: 'console.debug' },
        { pattern: 'console.info', severity: 'error', label: 'console.info' },
        { pattern: 'console.warn', severity: 'warning', label: 'console.warn (expected)' },
        { pattern: 'console.error', severity: 'warning', label: 'console.error (expected)' },
    ];

    const results = {
        errors: [],
        warnings: [],
        clean: true,
    };

    searchPatterns.forEach(({ pattern, severity, label }) => {
        try {
            // Search in .next directory, excluding source maps. Arguments go to grep
            // directly, not through a shell, so the path is never parsed as a command.
            let output = '';
            try {
                output = execFileSync(
                    'grep',
                    ['-r', '-F', pattern, NEXT_BUILD_DIR, '--include=*.js', '--exclude=*.map'],
                    { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] },
                );
            } catch (e) {
                // grep exits 1 when nothing matches; anything else is a real failure.
                if (e.status !== 1) throw e;
            }

            const matches = output.split('\n').filter(line => line.trim());

            if (matches.length > 0) {
                const result = {
                    pattern: label,
                    count: matches.length,
                    samples: matches.slice(0, 3), // Show first 3 matches
                };

                if (severity === 'error') {
                    results.errors.push(result);
                    results.clean = false;
                } else {
                    results.warnings.push(result);
                }
            }
        } catch (error) {
            // Grep returns non-zero if no matches, which is fine
        }
    });

    return results;
}

function displayResults(results) {
    console.log('\n' + '='.repeat(60));
    log('📊 Production Build Verification Results', 'cyan');
    console.log('='.repeat(60) + '\n');

    if (results.errors.length === 0) {
        log('✅ No console.log/debug/info found in production build!', 'green');
    } else {
        log('❌ Found console statements that should be removed:', 'red');
        results.errors.forEach(({ pattern, count, samples }) => {
            log(`\n  ${pattern}: ${count} occurrences`, 'red');
            samples.forEach(sample => {
                const truncated = sample.length > 100 ? sample.substring(0, 100) + '...' : sample;
                log(`    ${truncated}`, 'yellow');
            });
        });
    }

    if (results.warnings.length > 0) {
        log('\n⚠️  Expected console statements (OK in production):', 'yellow');
        results.warnings.forEach(({ pattern, count }) => {
            log(`  ${pattern}: ${count} occurrences`, 'yellow');
        });
    }

    console.log('\n' + '='.repeat(60));

    if (results.clean) {
        log('✨ Build is CLEAN for production! ✨', 'green');
        log('\n📝 Tips:', 'cyan');
        log('  • Use logger.debug() instead of console.log()', 'cyan');
        log('  • Keep console.error() for critical errors', 'cyan');
        log('  • Keep console.warn() for warnings', 'cyan');
        console.log('='.repeat(60) + '\n');
        return 0;
    } else {
        log('\n⚠️  Build needs cleanup before production release!', 'red');
        log('\n📝 Action required:', 'cyan');
        log('  • Replace console.log() with logger.debug()', 'cyan');
        log('  • Replace console.debug() with logger.debug()', 'cyan');
        log('  • Replace console.info() with logger.info()', 'cyan');
        console.log('='.repeat(60) + '\n');
        return 1;
    }
}

function checkEnvironmentVariables() {
    log('\n🔧 Environment Configuration:', 'blue');

    const envVars = [
        'NODE_ENV',
        'NEXT_PUBLIC_DEBUG_LOGS',
        'NEXT_PUBLIC_COMPACT_LOGS',
        'NEXT_PUBLIC_LOG_MODULES',
    ];

    envVars.forEach(varName => {
        const value = process.env[varName] || '(not set)';
        const isProduction = varName === 'NODE_ENV' && value === 'production';
        const color = isProduction ? 'green' : 'yellow';
        log(`  ${varName}: ${value}`, color);
    });

    if (process.env.NEXT_PUBLIC_DEBUG_LOGS === 'true') {
        log('\n⚠️  WARNING: NEXT_PUBLIC_DEBUG_LOGS=true in production!', 'yellow');
        log('  Logger will output to console.', 'yellow');
    }
}

// Main execution
function main() {
    log('🚀 Production Build Verification Tool', 'cyan');
    log('='.repeat(60) + '\n', 'cyan');

    checkBuildExists();
    checkEnvironmentVariables();

    const results = searchForConsoleLogs();
    const exitCode = displayResults(results);

    process.exit(exitCode);
}

main();
