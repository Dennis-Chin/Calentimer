/**
 * testTimerRuntime.js
 * Verification suite for timerRuntime.js
 */

import { TimerRuntime, TimerStatus } from './timerRuntime.js';

let passed = 0;
let failed = 0;

function assert(condition, testName) {
  if (condition) {
    console.log(`  ✓ PASS: ${testName}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${testName}`);
    failed++;
  }
}

console.log('--- 1. Testing TimerRuntime Initialization ---');
// Give a hardStop well in the future so calculateSchedule succeeds
const futureHour = (new Date().getHours() + 2) % 24;
const hardStopTime = `${String(futureHour).padStart(2, '0')}:00`;

const runtime = new TimerRuntime({
  hardStop: hardStopTime,
  tasks: [
    { id: '1', title: 'Task 1', plannedDuration: 20, isLocked: false, category: 'Work' },
    { id: '2', title: 'Task 2', plannedDuration: 30, isLocked: true, category: 'Study' }
  ]
});

assert(runtime.status === TimerStatus.IDLE, 'Initial status is IDLE');
assert(runtime.currentSchedule !== null, 'Schedule generated upon initialization');
assert(runtime.currentSchedule.tasks.length === 2, '2 tasks scheduled');

console.log('\n--- 1b. Testing Skip in IDLE Mode (Before timer starts / on reset) ---');
let idleSkipFired = false;
const unsubIdleSkip = runtime.on('taskSkipped', () => { idleSkipFired = true; });
runtime.skipCurrentTask();
assert(idleSkipFired === true, 'taskSkipped event fired in IDLE mode');
assert(runtime.activeTaskIndex === 1, 'activeTaskIndex moved to next task (index 1)');
assert(runtime.getActiveTask().id === '2', 'Active task is now Task 2 while IDLE');
assert(runtime.status === TimerStatus.IDLE, 'Status remains IDLE when skipped before start');
// Wrap back to 0 for subsequent tests
runtime.skipCurrentTask();
assert(runtime.activeTaskIndex === 0, 'activeTaskIndex wrapped back to 0 in IDLE mode');
unsubIdleSkip();

console.log('\n--- 2. Testing Event Subscriptions ---');
let tickReceived = false;
let startReceived = false;
let completeReceived = false;

runtime.on('tick', (data) => {
  tickReceived = true;
  assert(data.activeTask !== null, 'Tick includes activeTask');
  assert(typeof data.remainingSeconds === 'number', 'Tick includes remainingSeconds');
});

const startedTaskIds = [];
runtime.on('taskStart', (data) => {
  startReceived = true;
  startedTaskIds.push(data.task.id);
});

runtime.on('taskComplete', (data) => {
  completeReceived = true;
  assert(data.completedEarly === true, 'taskComplete flags completedEarly');
});

console.log('\n--- 3. Testing Start, Tick & Pause Mechanics ---');
runtime.start();
assert(runtime.status === TimerStatus.RUNNING, 'Status changed to RUNNING on start()');
assert(startReceived === true, 'taskStart event fired on start()');
assert(startedTaskIds[0] === '1', 'taskStart received for first task');
assert(tickReceived === true, 'Immediate tick event fired on start()');

runtime.pause();
assert(runtime.status === TimerStatus.PAUSED, 'Status changed to PAUSED on pause()');
assert(runtime._intervalId === null, 'Ticker interval cleared on pause()');

runtime.start(); // Resumes
assert(runtime.status === TimerStatus.RUNNING, 'Status resumed to RUNNING');

console.log('\n--- 4. Testing Dynamic Re-compression on Early Completion ---');
const task1AllocatedBefore = runtime.getActiveTask().allocatedDuration;
const initialTask2Allocated = runtime.currentSchedule.tasks[1].allocatedDuration;

// Complete Task 1 early!
runtime.completeCurrentTaskEarly();
assert(completeReceived === true, 'taskComplete event fired for early finish');
assert(runtime.activeTaskIndex === 1, 'Advanced to next task (index 1)');
assert(runtime.getActiveTask().id === '2', 'Active task is now Task 2');
assert(runtime.getActiveTask().plannedDuration === 30, 'Task 2 retained its own planned duration of 30m');
assert(runtime.getRemainingSeconds() === 30 * 60, 'Task 2 timer started fresh with 30 minutes');

console.log('\n--- 5. Testing Task Skip & Completion Flow ---');
let allDone = false;
runtime.on('allTasksCompleted', () => {
  allDone = true;
});

// Skip task 2
runtime.skipCurrentTask();
assert(runtime.status === TimerStatus.COMPLETED, 'Status changed to COMPLETED after skipping last task');
assert(allDone === true, 'allTasksCompleted event fired');

console.log('\n--- 6. Testing deleteTask & Reordering in TimerRuntime ---');
const rt = new TimerRuntime({
  hardStop: '18:00',
  tasks: [
    { id: 'a', title: 'Task A', plannedDuration: 20 },
    { id: 'b', title: 'Task B', plannedDuration: 30 },
    { id: 'c', title: 'Task C', plannedDuration: 15 }
  ]
});
assert(rt.currentSchedule.tasks.length === 3, 'Initial schedule has 3 tasks');

// Delete future task 'c'
rt.deleteTask('c');
assert(rt.currentSchedule.tasks.length === 2, 'Schedule has 2 tasks after deleteTask(c)');
assert(!rt.currentSchedule.tasks.some(t => t.id === 'c'), 'Task c is not in schedule');
assert(!rt.initialTasks.some(t => t.id === 'c'), 'Task c is not in initialTasks');

// Start timer and delete future task 'b'
rt.start();
assert(rt.status === TimerStatus.RUNNING, 'Timer is running');
rt.deleteTask('b');
assert(rt.currentSchedule.tasks.length === 1, 'Schedule has 1 task after deleting b while running');
assert(rt.getActiveTask().id === 'a', 'Active task remains Task a');

console.log('\n--- 7. Testing Scrub Elapsed Time in IDLE Mode ---');
const idleRt = new TimerRuntime({
  hardStop: '23:00',
  tasks: [
    { id: 't1', title: 'Task Scrub', plannedDuration: 20 }
  ]
});
assert(idleRt.status === TimerStatus.IDLE, 'idleRt starts in IDLE');
assert(idleRt.getRemainingSeconds() === 20 * 60, 'Initial remaining seconds is full duration (1200s)');
// Simulate scrubbing to 900s remaining while IDLE
idleRt.seek(900);
assert(idleRt.getRemainingSeconds() === 15 * 60, 'getRemainingSeconds reflects scrubbed elapsed in IDLE (900s)');
// Simulate scrubbing further to 600s remaining
idleRt.seek(600);
assert(idleRt.getRemainingSeconds() === 10 * 60, 'getRemainingSeconds continues from scrubbed position (600s)');

console.log('\n--- 8. Testing getActiveTaskIndexByTime with Timespans ---');
const sampleTasks = [
  { id: 'past', title: 'Past Task', plannedDuration: 60, startTime: '06:00', endTime: '07:00' },
  { id: 'curr', title: 'Current Task', plannedDuration: 60, startTime: '10:00', endTime: '11:00' },
  { id: 'fut', title: 'Future Task', plannedDuration: 60, startTime: '14:00', endTime: '15:00' }
];

const timeRt = new TimerRuntime({
  hardStop: '23:59',
  tasks: sampleTasks
});

const idxDuringCurrent = timeRt.getActiveTaskIndexByTime(sampleTasks, 10 * 60 + 30); // 10:30
assert(idxDuringCurrent === 1, 'Locates index of task currently in progress at 10:30');

const idxBeforeAll = timeRt.getActiveTaskIndexByTime(sampleTasks, 5 * 60); // 05:00
assert(idxBeforeAll === 0, 'Locates first upcoming task when before all tasks');

const idxBetweenTasks = timeRt.getActiveTaskIndexByTime(sampleTasks, 12 * 60); // 12:00
assert(idxBetweenTasks === 2, 'Locates next upcoming task (14:00) when between tasks at 12:00');

console.log('\n--- 9. Testing Locked Task Duration Shortening in Chronological Mode on Start ---');
const now = new Date();
const currentTotalMin = (now.getHours() * 60) + now.getMinutes();
const sTotalMin = Math.max(0, currentTotalMin - 15);
const eTotalMin = Math.min(1439, currentTotalMin + 45);

const startStr = `${String(Math.floor(sTotalMin / 60)).padStart(2, '0')}:${String(sTotalMin % 60).padStart(2, '0')}`;
const endStr = `${String(Math.floor(eTotalMin / 60)).padStart(2, '0')}:${String(eTotalMin % 60).padStart(2, '0')}`;
const remainingExpectedMin = eTotalMin - currentTotalMin;
const remainingExpectedSec = remainingExpectedMin * 60;

const lockedTaskRt = new TimerRuntime({
  hardStop: '23:59',
  tasks: [
    {
      id: 'locked-active',
      title: 'Current Window Meeting',
      plannedDuration: 30,
      startTime: startStr,
      endTime: endStr,
      fixedStartTime: startStr,
      isLocked: true
    }
  ]
});

lockedTaskRt.start();
// Since current time is past start time, start time switches to current time, and duration shortens to endTime - currentTime (45m)
assert(lockedTaskRt.taskDurationMs === remainingExpectedMin * 60 * 1000, `Duration shortened to ${remainingExpectedMin}m (end time - time started)`);
assert(lockedTaskRt.accumulatedElapsedMs === 0, 'Accumulated elapsed resets to 0 as countdown begins fresh from current start');
assert(lockedTaskRt.getRemainingSeconds() === remainingExpectedSec, `Remaining seconds matches shortened window (${remainingExpectedSec}s)`);

console.log(`\n========================================`);
console.log(`Summary: ${passed} passed, ${failed} failed.`);
console.log(`========================================`);

if (failed > 0) {
  process.exit(1);
} else {
  process.exit(0);
}
