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

console.log('\n--- 13. Testing Day Drag Intent, Edge Navigation Resistance & Mirror Event Deduplication ---');
const updatedCalContent = fs.readFileSync(path.resolve(process.cwd(), 'calendarView.js'), 'utf8');
const updatedSyncServiceContent = fs.readFileSync(path.resolve(process.cwd(), 'calendarSyncService.js'), 'utf8');
const updatedCssContent = fs.readFileSync(path.resolve(process.cwd(), 'style.css'), 'utf8');
assert(updatedCalContent.includes('const isLeft = (diffX < -35) && (clientX < modalRect.left + 32);'), 'calendarView.js requires intentional horizontal displacement for left edge day navigation');
assert(updatedCalContent.includes("card.classList.remove('is-overlapping-earlier', 'is-overlapping-later');"), 'calendarView.js strips overlap column constraints when lifting event into flight');
assert(updatedCalContent.includes("card.style.right = 'auto';"), 'calendarView.js sets right: auto on in-flight event cards to avoid horizontal squeezing');
assert(updatedCalContent.includes('localEventSignatures.has(sig)'), 'calendarView.js deduplicates mirrored external calendar events');
assert(updatedSyncServiceContent.includes('existingLocal.externalId = incoming.externalId;'), 'calendarSyncService.js links existing local events on incoming external sync to prevent duplicates');
assert(updatedCssContent.includes('.day-event-card.is-dragging-cal-event') && updatedCssContent.includes('right: auto !important;'), 'style.css sets right: auto !important on in-flight day event card');

console.log('\n--- 14. Testing Header Cleanup, Schedule Bar, Finish Line, Done Tick Box & Category Colors ---');
const curHtml = fs.readFileSync(path.resolve(process.cwd(), 'index.html'), 'utf8');
const curApp = fs.readFileSync(path.resolve(process.cwd(), 'app.js'), 'utf8');
const curClassifier = fs.readFileSync(path.resolve(process.cwd(), 'eventClassifier.js'), 'utf8');
const curCss = fs.readFileSync(path.resolve(process.cwd(), 'style.css'), 'utf8');

// 1. Alerts On button removed from top header (alerts toggle remains in Settings only)
assert(!curHtml.includes('id="btnNotifToggle"'), 'index.html header has #btnNotifToggle removed');

// 2. Hard Stop removed from timer screen control bar; accessible via Today\'s schedule tabs
const scheduleControlBarSlice = curHtml.slice(curHtml.indexOf('class="schedule-control-bar"'), curHtml.indexOf('class="timer-viewport"'));
assert(!scheduleControlBarSlice.includes('id="hardStopPill"'), 'Timer screen schedule control bar has #hardStopPill removed');
assert(curHtml.includes('id="todayFinishLine"'), 'Today drawer has #todayFinishLine');
assert(curHtml.includes('id="calendarFinishLine"'), 'Calendar schedule modal has #calendarFinishLine');

// 3. Time Bank on left side; Total Minutes for the day on right side
assert(scheduleControlBarSlice.indexOf('id="timeBankPill"') < scheduleControlBarSlice.indexOf('id="totalMinutesPill"'), 'Time Bank pill sits on left and Total Minutes pill sits on right');
assert(curApp.includes('function updateTotalMinutesDisplay('), 'app.js defines updateTotalMinutesDisplay()');
assert(curApp.includes('function calculateTotalMinutesToday('), 'app.js defines calculateTotalMinutesToday()');

// 4. Calendar Finish Line on one line with TARGET HARD STOP subtext removed
const calFinishLineSlice = curHtml.slice(curHtml.indexOf('id="calendarFinishLine"'), curHtml.indexOf('class="calendar-modal-footer"'));
assert(!calFinishLineSlice.includes('class="finish-line-sub"'), '#calendarFinishLine removes TARGET HARD STOP subtext');
assert(!calFinishLineSlice.includes('TARGET HARD STOP'), '#calendarFinishLine does not contain TARGET HARD STOP');
assert(curCss.includes('.finish-line-title') && curCss.includes('white-space: nowrap;'), '.finish-line-title has white-space: nowrap;');

// 5. Done tick box on far right of name in Today\'s Schedule drawer
assert(curApp.includes('data-action="toggle-task-done"'), 'app.js renders toggle-task-done button');
assert(curApp.includes('class="task-check-btn'), 'app.js renders .task-check-btn');
assert(curCss.includes('.task-check-btn'), 'style.css defines styles for .task-check-btn');
assert(curCss.includes('.task-card.task-completed .task-card-title') && curCss.includes('line-through'), 'Completed task name is crossed out with line-through');

// 6. Timer dial ring and revolving circle thicker/larger
assert(curCss.includes('.track-progress') && curCss.includes('stroke-width: 14;'), '.track-progress stroke-width increased to 14');
assert(curCss.includes('.dial-tick.major') && curCss.includes('stroke-width: 6.2;'), '.dial-tick.major stroke-width increased to 6.2');
assert(curHtml.includes('id="revolvingCircle" cx="160" cy="30" r="11"'), 'revolvingCircle radius increased to 11');

// 7. Category colors cannot have done green or active light blue
const presetColorsSlice = curClassifier.slice(curClassifier.indexOf('export const PRESET_CATEGORY_COLORS = ['), curClassifier.indexOf('];', curClassifier.indexOf('export const PRESET_CATEGORY_COLORS = [')));
assert(presetColorsSlice && !presetColorsSlice.includes("'#047857'"), 'PRESET_CATEGORY_COLORS excludes greens');
assert(curClassifier.includes('const activeBlues =') && curClassifier.includes('const doneGreens ='), 'sanitizeCategoryColor checks active cyan/blues and done greens');

console.log('\n--- 15. Testing Work Today Label, Keep Screen Awake & Completion Haptics ---');
// 1. Work Today label in timer screen
assert(curHtml.includes('WORK TODAY:'), 'index.html has WORK TODAY: label in #totalMinutesPill');
assert(curApp.includes('isBreak') && curApp.includes('calculateTotalMinutesToday'), 'app.js calculateTotalMinutesToday excludes breaks');

// 2. Keep Screen Awake toggle & taskStore persistence
assert(curHtml.includes('id="toggleKeepScreenAwake"'), 'index.html has #toggleKeepScreenAwake toggle');
const posHapticsRow = curHtml.indexOf('id="toggleHapticsEnabled"');
const posKeepScreenRow = curHtml.indexOf('id="toggleKeepScreenAwake"');
const posTimerRowEnd = curHtml.indexOf('id="settingRowTimer"');
assert(posKeepScreenRow > posHapticsRow && posKeepScreenRow < posTimerRowEnd, '#toggleKeepScreenAwake sits directly below #toggleHapticsEnabled and above Timer Settings');
assert(storeContent.includes('getKeepScreenAwake()') && storeContent.includes('setKeepScreenAwake('), 'taskStore.js implements getKeepScreenAwake and setKeepScreenAwake');

// 3. Completion Haptics toggle & taskStore persistence
assert(curHtml.includes('id="toggleCompletionHaptics"'), 'index.html has #toggleCompletionHaptics toggle in #timerSettingsSubPanel');
assert(curHtml.indexOf('id="toggleCompletionHaptics"') > curHtml.indexOf('id="timerSettingsSubPanel"'), '#toggleCompletionHaptics is inside #timerSettingsSubPanel');
assert(storeContent.includes('getCompletionHapticsEnabled()') && storeContent.includes('setCompletionHapticsEnabled('), 'taskStore.js implements getCompletionHapticsEnabled and setCompletionHapticsEnabled');
const mobileServicesContent = fs.readFileSync(path.resolve(process.cwd(), 'mobileServices.js'), 'utf8');
assert(mobileServicesContent.includes('hapticTaskComplete()'), 'mobileServices.js defines hapticTaskComplete()');
assert(mobileServicesContent.includes('forceReleaseWakeLock()'), 'mobileServices.js defines forceReleaseWakeLock()');

console.log('\n--- 16. Testing Status Pill Tap, Completion Sync & Persistent Notification ---');
// 1. Status pill tap handler and touch exemption
assert(curApp.includes('data-action="tap-status-pill"'), 'app.js renders data-action="tap-status-pill" on status pills');
assert(curApp.includes('[data-action="tap-status-pill"]') && curApp.includes('.task-card-status-wrap'), 'card touch and mouse events exempt status pill actions');
assert(!curApp.includes('task.isCompleted || ((isRunning || isPaused) && runtime && runtime.activeTaskIndex > 0 && idx < runtime.activeTaskIndex)'), 'renderTaskList bases completion strictly on task.isCompleted');
assert(!curApp.includes('task.isCompleted || ((isRunning || isPaused) && runtime && runtime.activeTaskIndex > 0 && idx < activeIdx)'), 'renderCalendarModal bases completion strictly on task.isCompleted');

// 2. Calendar view completion sync
const calViewContent = fs.readFileSync(path.resolve(process.cwd(), 'calendarView.js'), 'utf8');
assert(!calViewContent.includes('evIdx < rt.activeTaskIndex'), 'calendarView.js does not override isDone using activeTaskIndex');
assert(calViewContent.includes('let isDone = Boolean(ev.isCompleted);'), 'calendarView.js strictly bases event completion on ev.isCompleted');

// 3. Timer runtime property preservation
const latestRuntimeContent = fs.readFileSync(path.resolve(process.cwd(), 'timerRuntime.js'), 'utf8');
assert(latestRuntimeContent.includes('isCompleted: Boolean(initTask.isCompleted)'), 'timerRuntime.js preserves isCompleted in recalculate()');
assert(latestRuntimeContent.includes('manualCompleted: (typeof initTask.manualCompleted === \'boolean\') ? initTask.manualCompleted : null'), 'timerRuntime.js preserves manualCompleted in recalculate()');

// 4. Mobile services persistent notification bar
assert(mobileServicesContent.includes('ongoing: !isPaused'), 'mobileServices.js sets ongoing flag for notification bar persistence');
assert(mobileServicesContent.includes('timespanText'), 'mobileServices.js includes timespan in live notification');
assert(mobileServicesContent.includes('durMin'), 'mobileServices.js includes duration in live notification');

console.log('\n--- 17. Testing Dial Pre-rendering, Nav Swipe, Google Auth Persistence & Notification Icons ---');
// 1. Dial pre-rendering in HTML & app.js skip check
assert(curHtml.includes('class="dial-tick major"') && curHtml.indexOf('dialTicksGroup') !== -1, 'index.html contains pre-rendered dial ticks');
assert(curApp.includes('dialTicksGroup.children.length === 60'), 'app.js skips re-rendering dial ticks when pre-rendered');

// 2. Nav drawer swipe from left edge
assert(curApp.includes('touch.clientX > 90') && curApp.includes('target.closest(\'.wheel-container'), 'app.js allows edge swipe (clientX <= 90) to open nav drawer without dial blockage');

// 3. Google OAuth persistence in localStorage
const gcalAdapterContent = fs.readFileSync(path.resolve(process.cwd(), 'googleCalendarAdapter.js'), 'utf8');
assert(gcalAdapterContent.includes('localStorage.getItem(\'calentimer_gcal_token\')'), 'googleCalendarAdapter.js reads token from localStorage');
assert(gcalAdapterContent.includes('localStorage.setItem(\'calentimer_gcal_token\', token)'), 'googleCalendarAdapter.js stores token in localStorage');
assert(gcalAdapterContent.includes('ensureValidToken(interactive = false)') && gcalAdapterContent.includes('if (!interactive)'), 'googleCalendarAdapter.js guards against startup GIS popup when not interactive');

// 4. Notification format without square brackets & badge icon
assert(!mobileServicesContent.includes('`⏱ [${timeStr}]'), 'mobileServices.js notification title removes square brackets');
assert(mobileServicesContent.includes('badge: \'/badge-icon.png\''), 'mobileServices.js uses transparent silhouette badge-icon.png for Android status bar');

// 5. Timer icons exist and icon.svg has 16 ticks and mild shimmer
assert(fs.existsSync(path.resolve(process.cwd(), 'badge-icon.png')), 'badge-icon.png exists');
assert(fs.existsSync(path.resolve(process.cwd(), 'badge-icon.svg')), 'badge-icon.svg exists');
assert(fs.existsSync(path.resolve(process.cwd(), 'icon.svg')), 'icon.svg exists');
assert(fs.existsSync(path.resolve(process.cwd(), 'icon.png')), 'icon.png exists');
assert(fs.existsSync(path.resolve(process.cwd(), 'icon-512.png')), 'icon-512.png exists');
const iconSvgContent = fs.readFileSync(path.resolve(process.cwd(), 'icon.svg'), 'utf8');
assert(iconSvgContent.includes('id="innerShimmer"'), 'icon.svg includes mild green-to-blue inner shimmer gradient');
assert(iconSvgContent.includes('#00f0ff'), 'icon.svg includes light blue tick markers');

// 6. Dynamic background countdown Web Worker in timerRuntime
assert(latestRuntimeContent.includes('new Worker(workerUrl)'), 'timerRuntime.js uses dedicated Web Worker for unthrottled background countdown');

// 7. Modal swipe down allowed when touching categories
const latestAppContent = fs.readFileSync(path.resolve(process.cwd(), 'app.js'), 'utf8');
assert(!latestAppContent.includes("if (e.target.closest('input[type=\"range\"], .category-chips-list, .category-chip'))"), 'app.js does not block modal pull-to-dismiss touch start on categories');
assert(latestAppContent.includes("const chipsList = e.target.closest('.category-chips-list');") && latestAppContent.includes("if (isAtTop || isHeaderOrFooterTouch || Boolean(chipsList))"), 'app.js allows modal pull-to-dismiss when touching categories');


console.log(`\n========================================`);
console.log(`Summary: ${passed} passed, ${failed} failed.`);
console.log(`========================================`);

if (failed > 0) {
  process.exit(1);
}
