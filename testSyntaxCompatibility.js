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
import { spawnSync } from 'child_process';

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

console.log('\n--- 2. Testing V8 AST JavaScript Syntax Validity (node --check) ---');

targetFiles.forEach(function(fileName) {
  const filePath = path.resolve(process.cwd(), fileName);
  if (!fs.existsSync(filePath)) {
    assert(false, `File exists: ${fileName}`);
    return;
  }

  const content = fs.readFileSync(filePath, 'utf8');
  const result = spawnSync(process.execPath, ['--input-type=module', '--check'], {
    input: content,
    encoding: 'utf8'
  });
  const isSyntaxValid = result.status === 0;

  if (!isSyntaxValid) {
    console.error(`    V8 SyntaxError detected in ${fileName}:`);
    const errMsg = (result.stderr || result.stdout || '').trim();
    errMsg.split('\n').forEach(function(line) {
      console.error(`      ${line}`);
    });
  }

  assert(isSyntaxValid, `${fileName} passes V8 syntax validation (node --check)`);
});

console.log('\n--- 3. Testing Module-Level & Shared Scope Identifier Integrity ---');

// Audit app.js to ensure shared flags are declared at top-level module scope
const appContent = fs.readFileSync(path.resolve(process.cwd(), 'app.js'), 'utf8');
const appRequiredTopLevelDeclarations = [
  'isNavSwiping',
  'isDrawerTouching',
  'isDrawerPullingDown',
  'isDrawerPullingUp',
  'isDraggingTask',
  'isScrubbingGreenLine',
  'isDraggingOuterDial',
  'openTaskDrawer',
  'closeTaskDrawer'
];

appRequiredTopLevelDeclarations.forEach(function(varName) {
  // Regex ensures it is declared with let/const/var at top level before function definitions
  const regex = new RegExp(`^\\s*(?:let|var|const)\\s+${varName}\\b`, 'm');
  const isDeclared = regex.test(appContent);
  assert(isDeclared, `app.js has top-level module declaration for '${varName}'`);
});

// Audit calendarView.js to ensure required drag variables are declared within handlers
const calContent = fs.readFileSync(path.resolve(process.cwd(), 'calendarView.js'), 'utf8');
const calRequiredDeclarations = [
  'lastClientX',
  'lastClientY',
  'isPinching',
  'pinchCooldownUntil',
  '_activeDragCancelHandler'
];

calRequiredDeclarations.forEach(function(token) {
  const isFound = calContent.includes(token);
  assert(isFound, `calendarView.js contains required coordinate/state handler '${token}'`);
});

console.log('\n--- 4. Testing Settings Hierarchy, Sub-Panels & Default Dark Theme ---');
const htmlContent = fs.readFileSync(path.resolve(process.cwd(), 'index.html'), 'utf8');

// 1. Default theme mode
assert(htmlContent.includes('<html lang="en" data-theme="dark">'), 'index.html has data-theme="dark" by default');

const taskStoreContent = fs.readFileSync(path.resolve(process.cwd(), 'taskStore.js'), 'utf8');
assert(taskStoreContent.includes("safeGetItem('calentimer_theme') || 'dark'"), 'taskStore.getTheme() defaults to "dark"');

// 2. Settings hierarchy order
const posTheme = htmlContent.indexOf('id="themeSegmented"');
const posHaptics = htmlContent.indexOf('id="toggleHapticsEnabled"');
const posTimerRow = htmlContent.indexOf('id="settingRowTimer"');
const posCalRow = htmlContent.indexOf('id="settingRowCalendar"');

assert(posTheme > 0 && posHaptics > posTheme, 'Settings: Theme mode sits at the very top (1st)');
assert(posHaptics > 0 && posTimerRow > posHaptics, 'Settings: Haptic feedback toggle is 2nd');
assert(posTimerRow > 0 && posCalRow > posTimerRow, 'Settings: Timer settings sits 3rd above Calendar settings (4th)');

// 3. Timer Settings sub-panel content
const posTimerSubPanel = htmlContent.indexOf('id="timerSettingsSubPanel"');
const posAlertsToggle = htmlContent.indexOf('id="toggleAlertsEnabled"');
const posAlertVolume = htmlContent.indexOf('id="alertVolumeSlider"');
const posConfirmAdjust = htmlContent.indexOf('id="toggleConfirmAdjust"');

assert(posTimerSubPanel > 0, '#timerSettingsSubPanel exists in index.html');
assert(posAlertsToggle > posTimerSubPanel, 'Alerts & Notifications toggle is inside #timerSettingsSubPanel');
assert(posAlertVolume > posTimerSubPanel, 'Alert Volume slider is inside #timerSettingsSubPanel');
assert(posConfirmAdjust > posTimerSubPanel, 'Confirm Dial Adjustments toggle is inside #timerSettingsSubPanel');

// 4. Calendar Add Event Work / Break segmented toggle
assert(htmlContent.includes('id="calEventTypeSegment"'), 'index.html contains #calEventTypeSegment in #calendarEventModal');
assert(htmlContent.includes('id="calTypeSegmentWork"'), 'index.html contains #calTypeSegmentWork');
assert(htmlContent.includes('id="calTypeSegmentBreak"'), 'index.html contains #calTypeSegmentBreak');
assert(calContent.includes('setCalEventType('), 'calendarView.js implements setCalEventType() handler');

console.log('\n--- 5. Testing Exit App Modal, ensureHistoryBuffer & Clean Day Locked Styling ---');
// 5. Exit App modal in index.html
assert(htmlContent.includes('id="confirmExitAppModalBackdrop"'), '#confirmExitAppModalBackdrop exists in index.html');
assert(htmlContent.includes('id="btnCancelExitApp"'), '#btnCancelExitApp exists in index.html');
assert(htmlContent.includes('id="btnConfirmExitApp"'), '#btnConfirmExitApp exists in index.html');

// 6. ensureHistoryBuffer declared in app.js
assert(appContent.includes('function ensureHistoryBuffer('), 'app.js defines ensureHistoryBuffer()');

// 7. Verify Day View locked card has no static orange border in style.css
const cssContent = fs.readFileSync(path.resolve(process.cwd(), 'style.css'), 'utf8');
const hasDayLockedOrangeBoxShadow = cssContent.includes('.day-event-card.is-locked') && cssContent.match(/\.day-event-card\.is-locked[^{]*\{[^}]*#f59e0b/);
assert(!hasDayLockedOrangeBoxShadow, 'style.css has zero static orange borders or box-shadows on .day-event-card.is-locked');

console.log(`\n========================================`);
console.log(`Summary: ${passed} passed, ${failed} failed.`);
console.log(`========================================`);

if (failed > 0) {
  process.exit(1);
}
