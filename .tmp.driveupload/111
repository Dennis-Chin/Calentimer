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

console.log('\n--- 5. Testing Task Skip & Completion Flow ---');
let allDone = false;
runtime.on('allTasksCompleted', () => {
  allDone = true;
});

// Skip task 2
runtime.skipCurrentTask();
assert(runtime.status === TimerStatus.COMPLETED, 'Status changed to COMPLETED after skipping last task');
assert(allDone === true, 'allTasksCompleted event fired');

console.log(`\n========================================`);
console.log(`Summary: ${passed} passed, ${failed} failed.`);
console.log(`========================================`);

if (failed > 0) {
  process.exit(1);
}
