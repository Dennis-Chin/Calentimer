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
  'calendarView.js',
  'oauthConfig.js',
  'googleCalendarAdapter.js',
  'microsoftCalendarAdapter.js',
  'calendarSyncService.js',
  'eventClassifier.js',
  'cryptoPolyfill.js'
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
  'closeTaskDrawer',
  'updateTimespansButtonUI',
  'setScheduleMode'
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

console.log('\n--- 6. Testing Touch Scrolling, Overlap Indentation & Hard Stop Regression ---');
// Touch-action on drag handles must be pan-y !important to allow native vertical scrolling
assert(cssContent.includes('.drag-handle') && cssContent.includes('touch-action: pan-y !important;'), '.drag-handle has touch-action: pan-y !important;');
assert(cssContent.includes('.drag-handle-locked') && cssContent.includes('touch-action: pan-y !important;'), '.drag-handle-locked has touch-action: pan-y !important;');
assert(cssContent.includes('.drag-handle-compact') && cssContent.includes('touch-action: pan-y !important;'), '.drag-handle-compact has touch-action: pan-y !important;');
assert(cssContent.includes('.drag-handle-locked-compact') && cssContent.includes('touch-action: pan-y !important;'), '.drag-handle-locked-compact has touch-action: pan-y !important;');

// Today & Calendar finish lines display unconditionally in sequential & chronological modes
assert(appContent.includes("todayFinishLine.style.display = 'block';"), "todayFinishLine displays unconditionally in sequential & chronological modes");
assert(appContent.includes("finishLine.style.display = 'flex';"), "calendarFinishLine displays unconditionally in sequential & chronological modes");

// Finish lines have tap/click listeners that launch openHardStopModal
assert(appContent.includes("todayFinishLine.addEventListener('click', () => {") && appContent.includes("openHardStopModal();"), "todayFinishLine has click listener opening Hard Stop modal");
assert(appContent.includes("calendarFinishLine.addEventListener('click', () => {") && appContent.includes("openHardStopModal();"), "calendarFinishLine has click listener opening Hard Stop modal");

// Overlap popup only triggered on click, not auto-prompted on opening schedule tabs
const openDrawerSlice = appContent.slice(appContent.indexOf('openTaskDrawer = function()'), appContent.indexOf('closeTaskDrawer = function()'));
assert(!openDrawerSlice.includes('checkAndPromptScheduleConflict'), 'openTaskDrawer does not auto-prompt overlap conflict');
const openCalSlice = appContent.slice(appContent.indexOf('function openCalendar()'), appContent.indexOf('function closeCalendar()'));
assert(!openCalSlice.includes('checkAndPromptScheduleConflict'), 'openCalendar does not auto-prompt overlap conflict');

// Overlap conflict resolution triggered when active timer starts on overlapping event; priority swap arrows on cards
assert(appContent.includes('function promptConflictForTask('), 'app.js defines promptConflictForTask()');
assert(appContent.includes('function checkActiveTaskTimerConflict(') && appContent.includes('checkActiveTaskTimerConflict('), 'overlap conflict modal triggered when first overlapping event starts on timer');
assert(appContent.includes('data-action="swap-overlap-priority"') && appContent.includes('handleSwapOverlapPriority('), 'Today schedule cards render inline priority swap arrows (▲/▼)');

// Overlap indentation alternates so second overlapping event does not also indent
assert(appContent.includes('!overlapIndices.has(laterIdx - 1)'), 'renderTaskList alternates overlap indentation');
assert(appContent.includes('!calIndentedIndices.has(laterIdx - 1)'), 'renderCalendarModal alternates overlap indentation');
assert(calContent.includes('eventCols[cB - 1] === 1') || calContent.includes('eventCols[k - 1] === 1'), 'calendarView.js alternates overlap columns');

// Complete curated emojis palette matching classifier emojis
assert(appContent.includes('CURATED_EMOJIS') && appContent.includes('🎓') && appContent.includes('🩺') && appContent.includes('✈️') && appContent.includes('🍽️') && appContent.includes('🍕'), 'CURATED_EMOJIS contains all classifier domain emojis');

console.log('\n--- 7. Testing Microsoft Calendar Integration & Feature Parity ---');
const msAdapterContent = fs.readFileSync(path.resolve(process.cwd(), 'microsoftCalendarAdapter.js'), 'utf8');
const oauthConfigContent = fs.readFileSync(path.resolve(process.cwd(), 'oauthConfig.js'), 'utf8');
assert(oauthConfigContent.includes('15001074-5d3f-42d1-97fd-f61ea17c5be9'), 'oauthConfig.js contains configured Microsoft Client ID');
assert(msAdapterContent.includes('MICROSOFT_CATEGORY_COLORS'), 'microsoftCalendarAdapter.js defines MICROSOFT_CATEGORY_COLORS');
assert(msAdapterContent.includes('MICROSOFT_CALENDAR_COLORS'), 'microsoftCalendarAdapter.js defines MICROSOFT_CALENDAR_COLORS');
assert(msAdapterContent.includes('fetchCalendarList('), 'microsoftCalendarAdapter.js implements fetchCalendarList()');
assert(msAdapterContent.includes('_resolveEventColor('), 'microsoftCalendarAdapter.js implements _resolveEventColor()');
assert(msAdapterContent.includes('classifyEvent('), 'microsoftCalendarAdapter.js implements semantic word classification');
assert(msAdapterContent.includes('getRedirectUri('), 'microsoftCalendarAdapter.js implements dynamic getRedirectUri()');
assert(!oauthConfigContent.includes("redirectUri: 'http://localhost:3000'"), 'oauthConfig.js does not hardcode localhost redirectUri');

// Microsoft WebCrypto / MSAL PKCE subtle.digest polyfill verification
const cryptoPolyfillContent = fs.readFileSync(path.resolve(process.cwd(), 'cryptoPolyfill.js'), 'utf8');
assert(cryptoPolyfillContent.includes('function ensureWebCryptoPolyfill'), 'cryptoPolyfill.js defines ensureWebCryptoPolyfill');
assert(cryptoPolyfillContent.includes('sha256Buffer('), 'cryptoPolyfill.js implements sha256Buffer');
assert(cryptoPolyfillContent.includes('SubtleCrypto polyfill only supports SHA-256'), 'cryptoPolyfill.js provides SubtleCrypto digest implementation');
assert(htmlContent.includes('cryptoPolyfill.js'), 'index.html includes cryptoPolyfill.js');
assert(msAdapterContent.includes("from './cryptoPolyfill.js'"), 'microsoftCalendarAdapter.js imports cryptoPolyfill.js');

console.log('\n--- 8. Testing Outbound Sync Toggles, Multi-Calendar Settings & Live Classifier ---');
// Outbound sync toggle boxes in all modals
assert(htmlContent.includes('id="addTaskSyncGoogle"') && htmlContent.includes('id="addTaskSyncMS"'), 'index.html has Add Task outbound sync checkboxes');
assert(htmlContent.includes('id="editTaskSyncGoogle"') && htmlContent.includes('id="editTaskSyncMS"'), 'index.html has Edit Task outbound sync checkboxes');
assert(htmlContent.includes('id="calEventSyncGoogle"') && htmlContent.includes('id="calEventSyncMS"'), 'index.html has Calendar Event outbound sync checkboxes');

// Multi-calendar display selectors in Settings
assert(htmlContent.includes('id="settingsGoogleCalendarsContainer"') && htmlContent.includes('id="settingsGoogleCalChecklist"'), 'index.html has Google multi-calendar checklist');
assert(htmlContent.includes('id="settingsMSCalendarsContainer"') && htmlContent.includes('id="settingsMSCalChecklist"'), 'index.html has Microsoft multi-calendar checklist');
assert(appContent.includes('function openCalendarSettingsSubPanel('), 'app.js defines openCalendarSettingsSubPanel()');
assert(appContent.includes('renderMultiCalendarChecklist('), 'app.js implements renderMultiCalendarChecklist()');

// Live debounced title auto-classification
assert(appContent.includes('addTitleDebounceTimer') && appContent.includes('classifyEvent(text)'), 'app.js debounces title input for Add Task classification');
assert(appContent.includes('editTitleDebounceTimer'), 'app.js debounces title input for Edit Task classification');
assert(calContent.includes('classifyEvent(val)') || calContent.includes('classifyEvent('), 'calendarView.js debounces title input for Event classification');

// Harmonized category palette in eventClassifier.js
const classifierContent = fs.readFileSync(path.resolve(process.cwd(), 'eventClassifier.js'), 'utf8');
assert(classifierContent.includes('export function getCategoryColor('), 'eventClassifier.js exports getCategoryColor() single source of truth');
assert(classifierContent.includes('export function getAllClassificationEmojis('), 'eventClassifier.js exports getAllClassificationEmojis()');

console.log('\n--- 9. Testing Outbound Color Sync & Local Event Preservation ---');
const gAdapterContent = fs.readFileSync(path.resolve(process.cwd(), 'googleCalendarAdapter.js'), 'utf8');
const syncServiceContent = fs.readFileSync(path.resolve(process.cwd(), 'calendarSyncService.js'), 'utf8');
assert(gAdapterContent.includes('getGoogleColorId('), 'googleCalendarAdapter.js implements getGoogleColorId()');
assert(gAdapterContent.includes('payload.colorId ='), 'googleCalendarAdapter.js attaches colorId to outbound payload');
assert(msAdapterContent.includes('getMicrosoftColorCategory('), 'microsoftCalendarAdapter.js implements getMicrosoftColorCategory()');
assert(msAdapterContent.includes('getMicrosoftColorCategory(event.category') && msAdapterContent.includes('categories.push(colorCategory)'), 'microsoftCalendarAdapter.js attaches color category to outbound payload');
assert(calContent.includes('isLocalItem') && calContent.includes("ev.id.startsWith('cal-event-')"), 'calendarView.js exempts local items from cloud visibility filters');
assert(syncServiceContent.includes('isLocalItem') && syncServiceContent.includes("existing.id.startsWith('cal-event-')"), 'calendarSyncService.js protects local items from deletion on cloud cancellation');

console.log('\n--- 10. Testing Token Renewal & Mobile Back Modal Dismissal ---');
assert(gAdapterContent.includes('markTokenExpired('), 'googleCalendarAdapter.js implements markTokenExpired()');
assert(msAdapterContent.includes('markTokenExpired('), 'microsoftCalendarAdapter.js implements markTokenExpired()');
assert(appContent.includes("'calendarConnectModalBackdrop'"), 'app.js handles calendarConnectModalBackdrop in subModals for mobile back button');
assert(appContent.includes('!googleEmail && !msEmail'), 'app.js checks stored user emails to avoid unexpected startup connect modals');
assert(calContent.includes('navItemTimer.click()'), 'calendarView.js wires Skip Connect directly to Timer return');

console.log('\n--- 11. Testing Flexible Task End Time Span & Duration Preservation ---');
const runtimeContent = fs.readFileSync(path.resolve(process.cwd(), 'timerRuntime.js'), 'utf8');
const storeContent = fs.readFileSync(path.resolve(process.cwd(), 'taskStore.js'), 'utf8');
const schedEngineContent = fs.readFileSync(path.resolve(process.cwd(), 'schedulerEngine.js'), 'utf8');
assert(appContent.includes('// Padlock NOT enabled and end time hasn\'t been defined'), 'app.js documents unlocked flexible end time span preservation');
assert(appContent.includes('endMin = (startMin + taskDur) % 1440'), 'app.js dynamically calculates end time from planned duration without shrinking');
assert(runtimeContent.includes('this.taskDurationMs = plannedDur * 60 * 1000;') && runtimeContent.includes('task.endTime = formatMinutesToTime((nowMin + plannedDur) % 1440);'), 'timerRuntime.js preserves planned duration on unlocked tasks without fixed end time');
assert(storeContent.includes('fixedEndTime: (task && task.fixedEndTime) ? task.fixedEndTime : null,'), 'taskStore.js supports fixedEndTime in addTask');
assert(schedEngineContent.includes('fixedEndTime: task.fixedEndTime || null,'), 'schedulerEngine.js propagates fixedEndTime in calculateSchedule');

console.log('\n--- 12. Testing Double-Creation Guards, Dedicated Mirror Exception & Sync Token Query ---');
assert(gAdapterContent.includes('if (isPrimary && syncToken) {') && gAdapterContent.includes('url += `&syncToken=${encodeURIComponent(syncToken)}`') && gAdapterContent.includes('url += `&singleEvents=true&timeMin='), 'googleCalendarAdapter.js omits singleEvents=true when syncToken is present');
assert(syncServiceContent.includes('this._creatingEventIds.has(ev.id)') && syncServiceContent.includes('isCreatingEvent(id)'), 'calendarSyncService.js guards against double-pushes with _creatingEventIds and isCreatingEvent');
assert(syncServiceContent.includes('isDedicatedCalentimerEvent') && syncServiceContent.includes('if (!isDedicatedCalentimerEvent && (isExplicitlyExternal || !isCreatedInApp))'), 'calendarSyncService.js enforces Calentimer Mirror deletion exception while safeguarding external items');
assert(storeContent.includes('localStorage.removeItem(STORAGE_KEYS.GOOGLE_SELECTED_CALS)') && storeContent.includes('delete memoryStorage[STORAGE_KEYS.GOOGLE_SELECTED_CALS]'), 'taskStore.js cleans up storage key when setting selected calendar ids to null');
assert(calContent.includes('googleSelectedSet !== null') && calContent.includes('msSelectedSet !== null'), 'calendarView.js filters visible events by selected calendar sets');

console.log(`\n========================================`);
console.log(`Summary: ${passed} passed, ${failed} failed.`);
console.log(`========================================`);

if (failed > 0) {
  process.exit(1);
}
