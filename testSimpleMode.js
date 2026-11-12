/**
 * testSimpleMode.js
 * 
 * Unit and integration tests for Simple Mode:
 *  - State isolation between Advanced and Simple modes
 *  - Preset generation (pure_focus, focus_break, pomodoro, one_hour, short_sprints, custom)
 *  - Continuous loop support in TimerRuntime
 *  - Timer session isolation across modes
 * Strictly zero optional chaining and zero nullish coalescing.
 */

import { taskStore } from './taskStore.js';
import { TimerRuntime, TimerStatus } from './timerRuntime.js';

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

console.log('========================================');
console.log('   SIMPLE MODE TEST SUITE              ');
console.log('========================================\n');

// 1. Storage & Config Tests
console.log('--- 1. Simple Mode Configuration & Store Keys ---');

taskStore.setAppMode('advanced');
assert(taskStore.getAppMode() === 'advanced', 'Initial mode is advanced');

let modeListenerNotified = false;
const unbindModeListener = taskStore.onChange(() => {
  modeListenerNotified = true;
});

// Silent mode switch should NOT notify store listeners
modeListenerNotified = false;
taskStore.setAppMode('simple', true);
assert(taskStore.getAppMode() === 'simple', 'setAppMode sets mode to simple silently');
assert(modeListenerNotified === false, 'setAppMode with silent=true does not fire onChange listeners');

// Non-silent mode switch SHOULD notify store listeners
modeListenerNotified = false;
taskStore.setAppMode('advanced', false);
assert(taskStore.getAppMode() === 'advanced', 'setAppMode sets mode to advanced non-silently');
assert(modeListenerNotified === true, 'setAppMode with silent=false fires onChange listeners');
unbindModeListener();

taskStore.setAppMode('simple');
assert(taskStore.getAppMode() === 'simple', 'setAppMode sets mode to simple');

assert(taskStore.getSimpleConfigured() === false, 'Default getSimpleConfigured is false');
taskStore.setSimpleConfigured(true);
assert(taskStore.getSimpleConfigured() === true, 'setSimpleConfigured saves true');

taskStore.setSimplePreset('pomodoro');
assert(taskStore.getSimplePreset() === 'pomodoro', 'setSimplePreset saves preset key');

assert(taskStore.getSimpleLoopEnabled() === true, 'Default getSimpleLoopEnabled is true');
taskStore.setSimpleLoopEnabled(false);
assert(taskStore.getSimpleLoopEnabled() === false, 'setSimpleLoopEnabled saves false');
taskStore.setSimpleLoopEnabled(true);

const customCfg = { focusMinutes: 45, restMinutes: 15, cycles: 2 };
taskStore.setSimpleCustomConfig(customCfg);
const readCfg = taskStore.getSimpleCustomConfig();
assert(readCfg.focusMinutes === 45 && readCfg.restMinutes === 15 && readCfg.cycles === 2, 'setSimpleCustomConfig persists correctly');

// 2. Preset Task Generation Tests
console.log('\n--- 2. Preset Task Generation ---');

const pureTasks = taskStore.generatePresetTasks('pure_focus');
assert(pureTasks.length === 1, 'pure_focus generates 1 task');
assert(pureTasks[0].plannedDuration === 50, 'pure_focus duration is 50m');
assert(pureTasks[0].category === 'Focus', 'pure_focus category is Focus');

const pairTasks = taskStore.generatePresetTasks('focus_break');
assert(pairTasks.length === 2, 'focus_break generates 2 tasks (1 focus, 1 rest)');
assert(pairTasks[0].plannedDuration === 25 && pairTasks[0].category === 'Focus', 'focus_break task 1 is 25m Focus');
assert(pairTasks[1].plannedDuration === 5 && pairTasks[1].category === 'Rest', 'focus_break task 2 is 5m Rest');

const pomodoroTasks = taskStore.generatePresetTasks('pomodoro');
assert(pomodoroTasks.length === 8, 'pomodoro generates 8 tasks (4 cycles of focus + rest)');
assert(pomodoroTasks[0].plannedDuration === 25, 'pomodoro focus duration is 25m');
assert(pomodoroTasks[1].plannedDuration === 5, 'pomodoro rest duration is 5m');

const hourTasks = taskStore.generatePresetTasks('one_hour');
assert(hourTasks.length === 6, 'one_hour generates 6 tasks (3 cycles of 60m + 10m)');
assert(hourTasks[0].plannedDuration === 60, 'one_hour focus is 60m');
assert(hourTasks[1].plannedDuration === 10, 'one_hour rest is 10m');

const sprintTasks = taskStore.generatePresetTasks('short_sprints');
assert(sprintTasks.length === 8, 'short_sprints generates 8 tasks (4 cycles of 15m + 3m)');
assert(sprintTasks[0].plannedDuration === 15, 'short_sprints focus is 15m');
assert(sprintTasks[1].plannedDuration === 3, 'short_sprints rest is 3m');

const customTasks = taskStore.generatePresetTasks('custom', { focusMinutes: 40, restMinutes: 8, cycles: 3 });
assert(customTasks.length === 6, 'custom generates 6 tasks (3 cycles of 40m + 8m)');
assert(customTasks[0].plannedDuration === 40, 'custom focus is 40m');
assert(customTasks[1].plannedDuration === 8, 'custom rest is 8m');

// 3. Complete State Isolation Between Modes
console.log('\n--- 3. Two Isolated Environments ("Two Apps in One") ---');

// Set up Advanced Mode tasks
taskStore.setAppMode('advanced');
const advInitial = [
  { id: 'adv-1', title: 'Advanced Task A', plannedDuration: 30, category: 'Work', isCompleted: false },
  { id: 'adv-2', title: 'Advanced Task B', plannedDuration: 60, category: 'Study', isCompleted: false }
];
taskStore.saveAdvancedTasks(advInitial);
assert(taskStore.getTasks().length === 2, 'getTasks() in advanced mode returns advanced tasks');
assert(taskStore.getTasks()[0].title === 'Advanced Task A', 'Advanced task content is intact');

// Switch to Simple Mode
taskStore.setAppMode('simple');
const simpleInitial = taskStore.generatePresetTasks('pomodoro');
taskStore.saveSimpleTasks(simpleInitial);
assert(taskStore.getTasks().length === 8, 'getTasks() in simple mode returns simple tasks (8 tasks)');
assert(taskStore.getTasks()[0].title === 'Focus 1', 'Simple task content is isolated');

// Add task in Simple Mode
taskStore.addTask({ title: 'Extra Simple Focus', plannedDuration: 20, category: 'Focus' });
assert(taskStore.getTasks().length === 9, 'Simple tasks count increased to 9');

// Switch back to Advanced Mode and verify it is completely untouched
taskStore.setAppMode('advanced');
const advAfter = taskStore.getTasks();
assert(advAfter.length === 2, 'Advanced tasks completely untouched by Simple mode operations');
assert(advAfter[0].id === 'adv-1' && advAfter[1].id === 'adv-2', 'Original advanced task IDs preserved');

// Session State Isolation
const advSession = { status: TimerStatus.RUNNING, activeTaskIndex: 1, elapsedSeconds: 300, remainingSeconds: 1500 };
taskStore.saveAdvancedTimerSession(advSession);

taskStore.setAppMode('simple');
const simpleSession = { status: TimerStatus.PAUSED, activeTaskIndex: 0, elapsedSeconds: 120, remainingSeconds: 1380 };
taskStore.saveSimpleTimerSession(simpleSession);

assert(taskStore.getTimerSession().activeTaskIndex === 0, 'getTimerSession() in simple mode returns simple session');
taskStore.setAppMode('advanced');
assert(taskStore.getTimerSession().activeTaskIndex === 1, 'getTimerSession() in advanced mode returns advanced session');

// 4. Runtime Continuous Loop Support
console.log('\n--- 4. TimerRuntime Loop Continuously ---');

const loopTasks = [
  { id: 'loop-1', title: 'Focus Block', plannedDuration: 1, allocatedDuration: 1, isCompleted: false },
  { id: 'loop-2', title: 'Rest Block', plannedDuration: 1, allocatedDuration: 1, isCompleted: false }
];

const runtime = new TimerRuntime({
  hardStop: '18:00',
  tasks: loopTasks,
  isLoopEnabled: true
});

assert(runtime.isLoopEnabled === true, 'TimerRuntime initialized with isLoopEnabled: true');
runtime.setHardStopEnabled(false);

let loopRestartedFired = false;
runtime.on('loopRestarted', (data) => {
  loopRestartedFired = true;
});

// Start and finish task 0
runtime.start();
assert(runtime.activeTaskIndex === 0, 'Runtime activeTaskIndex is 0');
runtime.completeCurrentTaskEarly(); // finishes task 0, moves to task 1

assert(runtime.activeTaskIndex === 1, 'Runtime advanced to task 1');

// Now finish task 1 (final task)
runtime.completeCurrentTaskEarly(); // with loop enabled, should wrap around to index 0

assert(loopRestartedFired === true, 'loopRestarted event emitted on final task finish');
assert(runtime.activeTaskIndex === 0, 'Runtime wrapped around to activeTaskIndex 0');
assert(runtime.initialTasks[0].isCompleted === false, 'Task 0 completed status reset for next loop');
assert(runtime.initialTasks[1].isCompleted === false, 'Task 1 completed status reset for next loop');

// Test with loop disabled
runtime.setLoopEnabled(false);
assert(runtime.isLoopEnabled === false, 'setLoopEnabled(false) turns off loop');

let allCompletedFired = false;
runtime.on('allTasksCompleted', () => {
  allCompletedFired = true;
});

runtime.completeCurrentTaskEarly(); // task 0
runtime.completeCurrentTaskEarly(); // task 1 (final) -> should stop

assert(allCompletedFired === true, 'allTasksCompleted emitted when loop is disabled');
assert(runtime.status === TimerStatus.COMPLETED, 'Runtime status is COMPLETED when loop is disabled');

// 5. Alternating Focus/Rest Calendar Sequence & Reconfiguration Preservation
console.log('\n--- 5. Calendar Alternating Order & Reconfig Preservation ---');

taskStore.setAppMode('simple');
const baseStart = 540; // 09:00
const pomodoroSeq = taskStore.generatePresetTasks('pomodoro', null, baseStart);

assert(pomodoroSeq[0].startTime === '09:00', 'Pomodoro Focus 1 starts at 09:00');
assert(pomodoroSeq[0].endTime === '09:25', 'Pomodoro Focus 1 ends at 09:25');
assert(pomodoroSeq[1].startTime === '09:25', 'Pomodoro Rest 1 starts at 09:25 immediately after Focus 1');
assert(pomodoroSeq[1].endTime === '09:30', 'Pomodoro Rest 1 ends at 09:30');
assert(pomodoroSeq[2].startTime === '09:30', 'Pomodoro Focus 2 starts at 09:30 immediately after Rest 1');
assert(pomodoroSeq[2].endTime === '09:55', 'Pomodoro Focus 2 ends at 09:55');
assert(pomodoroSeq[3].startTime === '09:55', 'Pomodoro Rest 2 starts at 09:55 immediately after Focus 2');
assert(pomodoroSeq[3].endTime === '10:00', 'Pomodoro Rest 2 ends at 10:00');

// Save tasks to Simple store and sync to calendar
taskStore.saveSimpleTasks(pomodoroSeq);
taskStore.syncScheduleAndCalendar();

const todayStr = taskStore.getTodayDateString();
const calEventsAfterSync = taskStore.getCalendarEvents().filter(e => e.date === todayStr);
const simpleEvents = calEventsAfterSync.filter(e => e.id && String(e.id).indexOf('simple-') === 0);

// Verify calendar events maintain strict alternating sequential order
const firstFourCal = simpleEvents.slice(0, 4);
assert(firstFourCal.length >= 4, 'Calendar has at least 4 synced simple events');
assert(firstFourCal[0].category === 'Focus' && firstFourCal[0].startTime === '09:00', 'Cal Event 0 is Focus at 09:00');
assert(firstFourCal[1].category === 'Rest' && firstFourCal[1].startTime === '09:25', 'Cal Event 1 is Rest at 09:25');
assert(firstFourCal[2].category === 'Focus' && firstFourCal[2].startTime === '09:30', 'Cal Event 2 is Focus at 09:30');
assert(firstFourCal[3].category === 'Rest' && firstFourCal[3].startTime === '09:55', 'Cal Event 3 is Rest at 09:55');

// Mark Focus 1 as completed
pomodoroSeq[0].isCompleted = true;
pomodoroSeq[0].completedDate = todayStr;
taskStore.saveSimpleTasks(pomodoroSeq);
taskStore.updateCalendarEvent(pomodoroSeq[0].id, { isCompleted: true, completedDate: todayStr });

// Now user reconfigures to One Hour preset (60m focus, 10m rest, 3 cycles)
const existingSimple = taskStore.getSimpleTasks();
const completedInStore = existingSimple.filter(t => Boolean(t.isCompleted));
assert(completedInStore.length === 1, 'Completed Focus 1 task is found');

const newHourPreset = taskStore.generatePresetTasks('one_hour', null, 570); // starts at 09:30 after Focus 1
assert(newHourPreset[0].startTime === '09:30', 'New 1-hour focus starts at 09:30 after completed Focus 1');
assert(newHourPreset[0].endTime === '10:30', 'New 1-hour focus ends at 10:30');
assert(newHourPreset[1].startTime === '10:30', 'New 1-hour rest starts at 10:30');
assert(newHourPreset[1].endTime === '10:40', 'New 1-hour rest ends at 10:40');

// Final list retains completed tasks + new preset tasks
const finalReconfiguredTasks = completedInStore.concat(newHourPreset);
taskStore.saveSimpleTasks(finalReconfiguredTasks);

// Update calendar: retain completed events, remove old unfinished simple events, add new preset events
const currentCal = taskStore.getCalendarEvents();
const otherDayCal = currentCal.filter(e => e.date !== todayStr);
const todayCal = currentCal.filter(e => e.date === todayStr);

const unfinishedIds = new Set(existingSimple.filter(t => !t.isCompleted).map(t => t.id));
const retainedCalToday = todayCal.filter(e => {
  if (e.isCompleted) return true;
  if (unfinishedIds.has(e.id)) return false;
  if (e.id && String(e.id).indexOf('simple-') === 0) return false;
  return true;
});

const newCalForHour = newHourPreset.map(t => ({
  id: t.id,
  title: t.title,
  date: todayStr,
  startTime: t.startTime,
  endTime: t.endTime,
  plannedDuration: t.plannedDuration,
  isCompleted: false,
  category: t.category
}));

const updatedCalEvents = otherDayCal.concat(retainedCalToday).concat(newCalForHour);
taskStore.saveCalendarEvents(updatedCalEvents);

// Verify calendar updated with completed task preserved
const verifiedCal = taskStore.getCalendarEvents().filter(e => e.date === todayStr);
const completedPreserved = verifiedCal.find(e => e.id === pomodoroSeq[0].id);
assert(completedPreserved !== undefined && completedPreserved.isCompleted === true, 'Completed Focus 1 task is preserved on calendar after reconfig');
const hasNewHourTask = verifiedCal.some(e => e.id === newHourPreset[0].id);
assert(hasNewHourTask === true, 'New 1-hour preset tasks are present on calendar');
const oldUnfinishedRemoved = verifiedCal.every(e => !unfinishedIds.has(e.id));
assert(oldUnfinishedRemoved === true, 'Old unfinished Pomodoro tasks removed from calendar upon reconfig');

// 7. Silent Save Operations (Mode Switch Performance)
console.log('--- 7. Silent Save Operations for Instant Mode Switching ---');

let silentNotifyFired = false;
const unbindSilentWatcher = taskStore.onChange(() => {
  silentNotifyFired = true;
});

silentNotifyFired = false;
taskStore.saveTasks(taskStore.getTasks(), true);
assert(silentNotifyFired === false, 'saveTasks with silent=true does not fire onChange listeners');

silentNotifyFired = false;
taskStore.saveCalendarEvents(taskStore.getCalendarEvents(), true);
assert(silentNotifyFired === false, 'saveCalendarEvents with silent=true does not fire onChange listeners');

unbindSilentWatcher();

// Cleanup
taskStore.setAppMode('advanced');

console.log('\n========================================');
console.log(`RESULTS: ${passed} passed, ${failed} failed`);
console.log('========================================\n');

if (failed > 0) {
  process.exit(1);
} else {
  process.exit(0);
}
