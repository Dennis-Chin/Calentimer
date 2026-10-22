import { TimerRuntime, TimerStatus } from './timerRuntime.js';
import { taskStore } from './taskStore.js';

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (cond) {
    console.log(`  ✓ PASS: ${msg}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${msg}`);
    failed++;
  }
}

console.log('\n--- Testing Time Bank & Overrun Mechanics ---');

// 1. TaskStore Time Bank APIs
taskStore.setTimeBankSeconds(0);
assert(taskStore.getTimeBankSeconds() === 0, 'Initial time bank is 0s');

taskStore.addTimeBankSeconds(600); // 10 minutes
assert(taskStore.getTimeBankSeconds() === 600, 'Time bank has 600s after adding 10m');

// 2. TimerRuntime Overrun Test
const tasks = [
  { id: 'tb-task-1', title: 'Task with Bank', plannedDuration: 1, useTimeBank: true, isLocked: false }
];

const runtime = new TimerRuntime({
  hardStop: '23:59',
  tasks: tasks,
  referenceTime: '12:00'
});

assert(runtime.isOverrunning === false, 'Runtime starts not overrunning');

let overrunFired = false;
runtime.on('taskOverrunStart', (data) => {
  overrunFired = true;
});

// Artificially simulate timer expiration and tick down
runtime.start();
runtime.seek(0);

// Trigger a tick: remaining reaches 0
runtime._tick();

assert(overrunFired === true, 'taskOverrunStart fired when task expired with time in bank');
assert(runtime.isOverrunning === true, 'runtime.isOverrunning is true');

// Tick in overrun mode after 2 seconds elapsed
runtime.overrunStartTime -= 2000;
const bankBefore = taskStore.getTimeBankSeconds();
runtime._tick();
const bankAfter = taskStore.getTimeBankSeconds();
assert(bankAfter < bankBefore, 'Time Bank deducted during overrun tick');

// 3. Early completion deposit test
const tasks2 = [
  { id: 'tb-task-2', title: 'Fast Task', plannedDuration: 25, useTimeBank: true }
];
const runtime2 = new TimerRuntime({
  hardStop: '23:59',
  tasks: tasks2,
  referenceTime: '12:00'
});

runtime2.start();
runtime2.seek(1200); // 20m remaining of 25m

let depositFired = false;
let depositedSec = 0;
runtime2.on('timeBankDeposit', (data) => {
  depositFired = true;
  depositedSec = data.secondsDeposited;
});

const bankPrior = taskStore.getTimeBankSeconds();
runtime2.completeCurrentTaskEarly();

assert(depositFired === true, 'timeBankDeposit fired on early finish');
assert(depositedSec === 1200, 'Deposited exactly 1200 remaining seconds (20m)');
assert(taskStore.getTimeBankSeconds() === bankPrior + 1200, 'taskStore updated with surplus time');

console.log(`\nTime Bank test results: ${passed} passed, ${failed} failed.`);
if (failed > 0) process.exit(1);
else process.exit(0);
