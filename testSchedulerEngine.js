/**
 * testSchedulerEngine.js
 * Verification suite for schedulerEngine.js
 */

import {
  calculateSchedule,
  sortTasks,
  parseTimeToMinutes,
  formatMinutesToTime,
  calculateAvailableMinutes,
  apportionWholeMinutes
} from './schedulerEngine.js';

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

console.log('--- 1. Testing Time Utilities ---');
assert(parseTimeToMinutes("13:00") === 780, 'parseTimeToMinutes("13:00") === 780');
assert(parseTimeToMinutes("00:00") === 0, 'parseTimeToMinutes("00:00") === 0');
assert(formatMinutesToTime(780) === "13:00", 'formatMinutesToTime(780) === "13:00"');
assert(formatMinutesToTime(1440) === "00:00", 'formatMinutesToTime(1440) wraps to "00:00"');
assert(calculateAvailableMinutes("12:00", "13:00") === 60, 'calculateAvailableMinutes(12:00, 13:00) === 60');
assert(calculateAvailableMinutes("23:00", "01:00") === 120, 'calculateAvailableMinutes(23:00, 01:00) handles midnight crossover');

console.log('\n--- 2. Testing Largest Remainder Whole-Minute Apportionment ---');
const items = [{ plannedDuration: 50 }, { plannedDuration: 25 }];
const apportioned = apportionWholeMinutes(items, 50); // 50 min available for 75 min total
assert(apportioned.length === 2, 'Returns correct number of allocations');
assert(Number.isInteger(apportioned[0]) && Number.isInteger(apportioned[1]), 'All allocated minutes are whole integers');
assert(apportioned[0] + apportioned[1] === 50, `Allocated minutes sum exactly to 50 (got ${apportioned[0]} + ${apportioned[1]} = ${apportioned[0] + apportioned[1]})`);
assert(apportioned[0] === 33 && apportioned[1] === 17, `Apportioned 50/75 proportionally into 33 and 17`);

console.log('\n--- 3. Testing Category and Tag Sorting ---');
const sampleTasks = [
  { id: '1', title: 'Task 1', category: 'Math', tags: ['exam'], plannedDuration: 30, isLocked: false },
  { id: '2', title: 'Task 2', category: 'Biology', tags: ['lab'], plannedDuration: 20, isLocked: true },
  { id: '3', title: 'Task 3', category: 'Admin', tags: ['email'], plannedDuration: 10, isLocked: false }
];

const sortedByCat = sortTasks(sampleTasks, 'category');
assert(sortedByCat[0].category === 'Admin' && sortedByCat[1].category === 'Biology' && sortedByCat[2].category === 'Math', 'sortTasks by category alphabetical');

const sortedByLocked = sortTasks(sampleTasks, 'isLocked');
assert(sortedByLocked[0].isLocked === true, 'sortTasks by isLocked puts locked first');

console.log('\n--- 4. Testing Normal Fit (No Compression Needed) ---');
const normalResult = calculateSchedule({
  hardStop: "14:00",
  startTime: "12:00", // 120 min available
  tasks: [
    { id: 'a', title: 'Read', plannedDuration: 30, isLocked: false },
    { id: 'b', title: 'Quiz', plannedDuration: 40, isLocked: true }
  ]
});
assert(normalResult.success === true, 'Normal fit succeeds');
assert(normalResult.isCompressed === false, 'isCompressed is false');
assert(normalResult.availableMinutes === 120, 'Available is 120');
assert(normalResult.totalPlannedMinutes === 70, 'Total planned is 70');
assert(normalResult.totalAllocatedMinutes === 70, 'Total allocated is 70');
assert(normalResult.bufferMinutes === 50, 'Buffer minutes is 50');
assert(normalResult.tasks[0].allocatedDuration === 30, 'Task A keeps 30 min');
assert(normalResult.tasks[1].allocatedDuration === 40, 'Task B keeps 40 min');
assert(normalResult.tasks[0].startTime === '12:00' && normalResult.tasks[0].endTime === '12:30', 'Task A runs 12:00 - 12:30');
assert(normalResult.tasks[1].startTime === '12:30' && normalResult.tasks[1].endTime === '13:10', 'Task B runs 12:30 - 13:10');

console.log('\n--- 5. Testing Proportional Compression with Whole Minutes ---');
// 60 minutes available. Locked = 10m. Unlocked = 50m + 25m = 75m. Total planned = 85m.
// Remaining for unlocked: 60 - 10 = 50m.
const compressedResult = calculateSchedule({
  hardStop: "13:00",
  startTime: "12:00",
  options: { enableCompression: true },
  tasks: [
    { id: 't1', title: 'Problem Set', plannedDuration: 50, isLocked: false, category: 'Physics' },
    { id: 't2', title: 'Flashcards', plannedDuration: 25, isLocked: false, category: 'Biology' },
    { id: 't3', title: 'Submit Assignment', plannedDuration: 10, isLocked: true, category: 'Admin' }
  ]
});

assert(compressedResult.success === true, 'Compression calculation succeeds');
assert(compressedResult.isCompressed === true, 'isCompressed is true');
assert(compressedResult.availableMinutes === 60, 'Available minutes is 60');
assert(compressedResult.totalPlannedMinutes === 85, 'Total planned minutes is 85');
assert(compressedResult.totalAllocatedMinutes === 60, 'Total allocated strictly matches available 60');
assert(compressedResult.bufferMinutes === 0, 'Buffer minutes is 0');

const t1 = compressedResult.tasks.find(t => t.id === 't1');
const t2 = compressedResult.tasks.find(t => t.id === 't2');
const t3 = compressedResult.tasks.find(t => t.id === 't3');

assert(t3.allocatedDuration === 10, 'Locked task t3 remains exactly 10 min');
assert(t1.allocatedDuration === 33, `t1 compressed proportionally from 50 to 33 min (got ${t1.allocatedDuration})`);
assert(t2.allocatedDuration === 17, `t2 compressed proportionally from 25 to 17 min (got ${t2.allocatedDuration})`);
assert(t1.allocatedDuration + t2.allocatedDuration + t3.allocatedDuration === 60, 'Sum of all task durations is exactly 60');
assert(Number.isInteger(t1.allocatedDuration) && Number.isInteger(t2.allocatedDuration), 'All compressed durations are whole minutes');

console.log('\n--- 6. Testing Error: Locked Tasks Exceed Hard Stop ---');
// 30 min available, but locked tasks need 45 min
const lockedExceedResult = calculateSchedule({
  hardStop: "12:30",
  startTime: "12:00",
  options: { enableCompression: true },
  tasks: [
    { id: 'l1', title: 'Mandatory Lecture', plannedDuration: 45, isLocked: true },
    { id: 'u1', title: 'Optional Reading', plannedDuration: 20, isLocked: false }
  ]
});

assert(lockedExceedResult.success === false, 'Returns failure when locked tasks exceed available time');
assert(lockedExceedResult.error.code === 'LOCKED_TASKS_EXCEED_TIME', 'Error code is LOCKED_TASKS_EXCEED_TIME');
assert(lockedExceedResult.error.details.requiredLockedMinutes === 45, 'Error details shows 45 required');
assert(lockedExceedResult.error.details.availableMinutes === 30, 'Error details shows 30 available');
assert(lockedExceedResult.error.details.deficitMinutes === 15, 'Deficit is 15 minutes');

console.log('\n--- 7. Testing Error: Hard Stop in the Past ---');
const pastResult = calculateSchedule({
  hardStop: "12:00",
  startTime: "12:00",
  tasks: [{ id: '1', plannedDuration: 10, isLocked: false }]
});
assert(pastResult.success === false, 'Fails when hard stop equals start time');
assert(pastResult.error.code === 'HARD_STOP_PASSED', 'Error code is HARD_STOP_PASSED');

console.log('\n--- 8. Testing Integrated Sorting in calculateSchedule ---');
const sortedScheduleResult = calculateSchedule({
  hardStop: "13:00",
  startTime: "12:00",
  sortBy: "category",
  tasks: [
    { id: 'p', title: 'Physics', plannedDuration: 20, category: 'Physics', isLocked: false },
    { id: 'b', title: 'Biology', plannedDuration: 20, category: 'Biology', isLocked: false },
    { id: 'c', title: 'Chemistry', plannedDuration: 20, category: 'Chemistry', isLocked: false }
  ]
});
assert(sortedScheduleResult.success === true, 'Schedule with sortBy succeeds');
assert(sortedScheduleResult.tasks[0].category === 'Biology', 'First task category is Biology');
assert(sortedScheduleResult.tasks[1].category === 'Chemistry', 'Second task category is Chemistry');
assert(sortedScheduleResult.tasks[2].category === 'Physics', 'Third task category is Physics');
assert(sortedScheduleResult.tasks[0].startTime === '12:00' && sortedScheduleResult.tasks[0].endTime === '12:20', 'Biology 12:00-12:20');
assert(sortedScheduleResult.tasks[1].startTime === '12:20' && sortedScheduleResult.tasks[1].endTime === '12:40', 'Chemistry 12:20-12:40');
assert(sortedScheduleResult.tasks[2].startTime === '12:40' && sortedScheduleResult.tasks[2].endTime === '13:00', 'Physics 12:40-13:00');

console.log(`\n========================================`);
console.log(`Summary: ${passed} passed, ${failed} failed.`);
console.log(`========================================`);

if (failed > 0) {
  process.exit(1);
}
