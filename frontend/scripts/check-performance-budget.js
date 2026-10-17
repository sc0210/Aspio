#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const budgetConfig = require('../performance-budget.config.js');

// Check if build directory exists
const buildDir = path.join(__dirname, '../.next/static/chunks');
if (!fs.existsSync(buildDir)) {
  console.error('❌ Build directory not found. Run `npm run build` first.');
  process.exit(1);
}

// Get all JS files and their sizes
const getFileSize = (filePath) => {
  const stats = fs.statSync(filePath);
  return Math.round(stats.size / 1024); // Size in KB
};

const getAllJSFiles = (dir) => {
  const files = [];
  const items = fs.readdirSync(dir);

  for (const item of items) {
    const fullPath = path.join(dir, item);
    const stat = fs.statSync(fullPath);

    if (stat.isDirectory()) {
      files.push(...getAllJSFiles(fullPath));
    } else if (item.endsWith('.js')) {
      files.push({
        name: item,
        path: fullPath,
        size: getFileSize(fullPath)
      });
    }
  }

  return files;
};

console.log('🔍 Analyzing bundle sizes...\n');

const jsFiles = getAllJSFiles(buildDir);
const budgets = budgetConfig.budgets;

let hasErrors = false;
let hasWarnings = false;
let totalSize = 0;

// Check individual bundles
for (const file of jsFiles) {
  const budget = budgets.find(b => {
    if (b.name === 'main') return file.name.includes('main');
    if (b.name === 'recharts') return file.name.includes('recharts');
    if (b.name === 'framework') return file.name.includes('framework');
    return false;
  });

  if (budget) {
    const status = file.size > budget.maximumError ? '❌' :
                   file.size > budget.maximumWarning ? '⚠️' : '✅';

    console.log(`${status} ${file.name}: ${file.size}KB (limit: ${budget.maximumError}KB)`);

    if (file.size > budget.maximumError) {
      hasErrors = true;
    } else if (file.size > budget.maximumWarning) {
      hasWarnings = true;
    }
  }

  totalSize += file.size;
}

// Check initial page load bundle size (only critical chunks)
const totalBudget = budgets.find(b => b.type === 'initial');
if (totalBudget) {
  // Calculate only the main page initial load (framework + commons + main page)
  const initialChunks = jsFiles.filter(file =>
    file.name.includes('framework') ||
    file.name.includes('commons') ||
    file.name.includes('main') ||
    file.name.includes('polyfills')
  );
  const initialSize = initialChunks.reduce((sum, file) => sum + file.size, 0);

  const status = initialSize > totalBudget.maximumError ? '❌' :
                 initialSize > totalBudget.maximumWarning ? '⚠️' : '✅';

  console.log(`\n${status} Initial page load: ${initialSize}KB (limit: ${totalBudget.maximumError}KB)`);
  console.log(`   Total bundle size (all chunks): ${totalSize}KB`);

  if (initialSize > totalBudget.maximumError) {
    hasErrors = true;
  } else if (initialSize > totalBudget.maximumWarning) {
    hasWarnings = true;
  }
}

// Show largest files
console.log('\n📊 Largest bundles:');
jsFiles
  .sort((a, b) => b.size - a.size)
  .slice(0, 10)
  .forEach(file => {
    console.log(`   ${file.name}: ${file.size}KB`);
  });

// Recommendations
if (hasErrors || hasWarnings) {
  console.log('\n💡 Optimization recommendations:');
  console.log('   • Use dynamic imports for heavy components');
  console.log('   • Optimize image formats and sizes');
  console.log('   • Remove unused dependencies');
  console.log('   • Enable tree shaking for libraries');
  console.log('   • Consider lazy loading for charts');
}

// Exit with appropriate code
if (hasErrors) {
  console.log('\n❌ Bundle size budget exceeded! Please optimize before deployment.');
  process.exit(1);
} else if (hasWarnings) {
  console.log('\n⚠️  Bundle size approaching limits. Consider optimizing.');
  process.exit(0);
} else {
  console.log('\n✅ All bundles within performance budget!');
  process.exit(0);
}