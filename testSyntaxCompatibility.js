/**
 * testSyntaxCompatibility.js
 * 
 * Verifies mobile WebView compatibility across all application JavaScript files.
 * Ensures strictly zero usage of:
 *  - Optional chaining (?.)
 *  - Nullish coalescing (??)
 * which crash on older iOS WebViews and Android mobile browsers.
 */

import fs from 'fs';
import path from 'path';

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✓ PASS: ${message}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${message}`);
    failed++;
  }
}

const targetFiles = [
  'app.js',
  'timerRuntime.js',
  'taskStore.js',
  'audioManager.js',
  'mobileServices.js',
  'schedulerEngine.js',
  'analyticsDb.js',
  'calendarView.js'
];

console.log('--- 1. Testing Mobile WebView Syntax Compatibility ---');

targetFiles.forEach(function(fileName) {
  const filePath = path.resolve(process.cwd(), fileName);
  if (!fs.existsSync(filePath)) {
    assert(false, `File exists: ${fileName}`);
    return;
  }

  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');

  let optionalChainingViolations = [];
  let nullishCoalescingViolations = [];

  lines.forEach(function(line, idx) {
    const lineNum = idx + 1;
    // Strip string literals and comments to avoid false positives in comments/test descriptions
    const cleanLine = line
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*/g, '');

    // Check for optional chaining: ?. followed by an identifier or bracket/call, not a ternary with a decimal
    // e.g. foo?.bar, foo?.[idx], foo?.(args)
    if (/\?\.[a-zA-Z_$\[(]/.test(cleanLine)) {
      optionalChainingViolations.push({ line: lineNum, text: line.trim() });
    }

    // Check for nullish coalescing: ??
    if (/\?\?/.test(cleanLine)) {
      nullishCoalescingViolations.push({ line: lineNum, text: line.trim() });
    }
  });

  const optChainOk = optionalChainingViolations.length === 0;
  if (!optChainOk) {
    console.error(`    Found ${optionalChainingViolations.length} optional chaining (?.) violation(s) in ${fileName}:`);
    optionalChainingViolations.forEach(function(v) {
      console.error(`      L${v.line}: ${v.text}`);
    });
  }
  assert(optChainOk, `${fileName} has zero optional chaining (?.) operators`);

  const nullishOk = nullishCoalescingViolations.length === 0;
  if (!nullishOk) {
    console.error(`    Found ${nullishCoalescingViolations.length} nullish coalescing (??) violation(s) in ${fileName}:`);
    nullishCoalescingViolations.forEach(function(v) {
      console.error(`      L${v.line}: ${v.text}`);
    });
  }
  assert(nullishOk, `${fileName} has zero nullish coalescing (??) operators`);
});

console.log(`\n========================================`);
console.log(`Summary: ${passed} passed, ${failed} failed.`);
console.log(`========================================`);

if (failed > 0) {
  process.exit(1);
}
