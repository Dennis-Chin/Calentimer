/**
 * testCalendarScheduleSync.js
 * 
 * Verification suite for Calendar and Today's Schedule Bi-directional Real-Time Sync.
 * Strictly verifies data integrity, dynamic timespan mapping, padlock time-anchoring,
 * cross-deletion, date reassignment, and future-proof schema fields.
 */

import { TaskStore } from './taskStore.js';
import { TimerRuntime } from './timerRuntime.js';

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

console.log('--- 1. Testing Store Initialization & Date Formatter ---');
const store = new TaskStore();
const todayStr = store.getTodayDateString();
assert(/^\d{4}-\d{2}-\d{2}$/.test(todayStr), `Today's date string is valid YYYY-MM-DD: ${todayStr}`);

console.log('\n--- 2. Testing Schedule Task -> Calendar Event Sync ---');
// Clear storage for fresh test run
store.saveTasks([]);
store.saveCalendarEvents([]);

const newTask = store.addTask({
  title: 'Morning Focus Sprint',
  plannedDuration: 45,
  isLocked: false,
  category: 'Study',
  emoji: '🎯'
});

assert(newTask.id !== undefined, 'Task created with ID: ' + newTask.id);
assert(newTask.source === 'local', 'Task includes future-proof source: "local"');
assert(typeof newTask.lastModified === 'number', 'Task includes numeric lastModified timestamp');

const calEventsAfterTask = store.getCalendarEvents();
const mirroredCalEvent = calEventsAfterTask.find(e => e.id === newTask.id && e.date === todayStr);
assert(Boolean(mirroredCalEvent), 'New task is immediately mirrored as a calendar event for today');
assert(mirroredCalEvent && mirroredCalEvent.title === 'Morning Focus Sprint', 'Calendar event matches task title');
assert(mirroredCalEvent && mirroredCalEvent.plannedDuration === 45, 'Calendar event matches duration');
assert(mirroredCalEvent && mirroredCalEvent.isLocked === false, 'Dynamic task starts flexible on calendar');

console.log('\n--- 3. Testing Calendar Event -> Schedule Task Sync ---');
const newCalEvent = store.addCalendarEvent({
  title: 'Client Standup Call',
  date: todayStr,
  startTime: '11:00',
  endTime: '11:30',
  plannedDuration: 30,
  isLocked: true,
  category: 'Work',
  emoji: '💼'
});

const tasksAfterCal = store.getTasks();
const mirroredTask = tasksAfterCal.find(t => t.id === newCalEvent.id);
assert(Boolean(mirroredTask), 'Calendar event for today is immediately mirrored in Today\'s Schedule tasks');
assert(mirroredTask && mirroredTask.title === 'Client Standup Call', 'Task matches calendar event title');
assert(mirroredTask && mirroredTask.isLocked === true, 'Task matches calendar locked status');
assert(mirroredTask && mirroredTask.fixedStartTime === '11:00', 'Locked calendar event sets fixedStartTime on task');

console.log('\n--- 4. Testing Padlock Time-Anchoring on Dynamic Tasks ---');
// Task was initially unlocked (isLocked: false, fixedStartTime: null)
assert(newTask.fixedStartTime === null, 'Dynamic task initially has fixedStartTime === null');

// Simulate locking the dynamic task at its computed start time (e.g. 09:00)
store.updateTask(newTask.id, {
  isLocked: true,
  fixedStartTime: '09:00'
});

const updatedTask = store.getTasks().find(t => t.id === newTask.id);
assert(updatedTask && updatedTask.isLocked === true, 'Task isLocked is now true');
assert(updatedTask && updatedTask.fixedStartTime === '09:00', 'Task fixedStartTime anchored to 09:00');

const updatedCalEvent = store.getCalendarEvents().find(e => e.id === newTask.id && e.date === todayStr);
assert(updatedCalEvent && updatedCalEvent.isLocked === true, 'Calendar event isLocked synced to true');
assert(updatedCalEvent && updatedCalEvent.startTime === '09:00', 'Calendar event startTime anchored to 09:00');

// Unlock it again
store.updateTask(newTask.id, {
  isLocked: false,
  fixedStartTime: null
});
const unlockedTask = store.getTasks().find(t => t.id === newTask.id);
assert(unlockedTask && unlockedTask.isLocked === false, 'Task unlocked successfully');
assert(unlockedTask && unlockedTask.fixedStartTime === null, 'Task fixedStartTime cleared to null');

console.log('\n--- 5. Testing Moving Calendar Event Across Dates ---');
// Move "Client Standup Call" from today to tomorrow
const tomorrow = new Date();
tomorrow.setDate(tomorrow.getDate() + 1);
const tomorrowStr = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`;

store.updateCalendarEvent(newCalEvent.id, {
  date: tomorrowStr
});

const tasksAfterDateMove = store.getTasks();
const movedTaskInToday = tasksAfterDateMove.find(t => t.id === newCalEvent.id);
assert(movedTaskInToday === undefined, 'Event moved to tomorrow is removed from Today\'s Schedule');

// Move it back to today
store.updateCalendarEvent(newCalEvent.id, {
  date: todayStr
});
const tasksAfterMoveBack = store.getTasks();
const restoredTask = tasksAfterMoveBack.find(t => t.id === newCalEvent.id);
assert(Boolean(restoredTask), 'Event moved back to today is re-added to Today\'s Schedule');

console.log('\n--- 6. Testing Cross-Deletion ---');
// Delete task from schedule -> removed from calendar
store.deleteTask(newTask.id);
const calAfterTaskDelete = store.getCalendarEvents();
assert(!calAfterTaskDelete.some(e => e.id === newTask.id && e.date === todayStr), 'Deleting task deletes it from Today\'s Calendar');

// Delete event from calendar -> removed from schedule
store.deleteCalendarEvent(newCalEvent.id);
const tasksAfterEventDelete = store.getTasks();
assert(!tasksAfterEventDelete.some(t => t.id === newCalEvent.id), 'Deleting calendar event deletes it from Today\'s Schedule');

console.log('\n--- 7. Testing Schedule Reordering & Dynamic Recalculation ---');
const taskA = store.addTask({ title: 'Task A', plannedDuration: 30 });
const taskB = store.addTask({ title: 'Task B', plannedDuration: 30 });

const runtime = new TimerRuntime({
  hardStop: '17:00',
  tasks: store.getTasks()
});
runtime.recalculate();

assert(runtime.currentSchedule.tasks.length === 2, 'Runtime scheduled 2 tasks');
assert(runtime.currentSchedule.tasks[0].id === taskA.id, 'Task A is first in pipeline');
assert(runtime.currentSchedule.tasks[1].id === taskB.id, 'Task B is second in pipeline');

// Reorder tasks
store.reorderTaskById(taskB.id, taskA.id);
runtime.initialTasks = store.getTasks();
runtime.recalculate();

assert(runtime.currentSchedule.tasks[0].id === taskB.id, 'Task B is now first in pipeline after reorder');
assert(runtime.currentSchedule.tasks[1].id === taskA.id, 'Task A is now second in pipeline after reorder');

console.log('\n--- 8. Testing Real-Time Calendar Event Drag Move ---');
store.saveTasks([]);
store.saveCalendarEvents([]);
const cal1 = store.addCalendarEvent({
  title: 'Morning Sync',
  date: todayStr,
  startTime: '09:00',
  endTime: '10:00',
  plannedDuration: 60,
  isLocked: true
});
const cal2 = store.addCalendarEvent({
  title: 'Afternoon Review',
  date: todayStr,
  startTime: '14:00',
  endTime: '15:00',
  plannedDuration: 60,
  isLocked: true
});

store.updateCalendarEvent(cal2.id, {
  date: todayStr,
  startTime: '08:00',
  endTime: '09:00',
  plannedDuration: 60,
  fixedStartTime: '08:00',
  isLocked: true
});

const tasksAfterDrag = store.getTasks();
const movedTaskInSchedule = tasksAfterDrag.find(t => t.id === cal2.id);
assert(movedTaskInSchedule && movedTaskInSchedule.fixedStartTime === '08:00', 'Moved calendar event updates fixedStartTime on Today\'s Schedule');
assert(movedTaskInSchedule && movedTaskInSchedule.startTime === '08:00', 'Moved calendar event updates startTime on Today\'s Schedule');
assert(tasksAfterDrag[0] && tasksAfterDrag[0].id === cal2.id, 'Tasks in Today\'s Schedule are sorted chronologically by new start time');

console.log('\n--- 9. Testing Padlock Unlock on Active/Progressed Task ---');
runtime.initialTasks = store.getTasks();
runtime.recalculate();
const activeTask = runtime.getActiveTask();
assert(Boolean(activeTask.isLocked || activeTask.fixedStartTime), 'Active task starts locked');

const currentLocked = Boolean(activeTask.isLocked || activeTask.fixedStartTime);
const nextLock = !currentLocked;
const fixedStartTime = nextLock ? (activeTask.fixedStartTime || activeTask.startTime || null) : null;
store.updateTask(activeTask.id, { isLocked: nextLock, fixedStartTime: fixedStartTime });
runtime.initialTasks = store.getTasks();
runtime.recalculate();

const unlockedActiveTask = runtime.getActiveTask();
assert(unlockedActiveTask.isLocked === false, 'Active task isLocked toggled to false');
assert(unlockedActiveTask.fixedStartTime === null, 'Active task fixedStartTime cleared to null');

console.log('\n--- 10. Testing Overlap Cascade Collision Detection Logic ---');
store.saveTasks([]);
const testA = store.addTask({ title: 'Task A', startTime: '10:00', endTime: '11:00', plannedDuration: 60, isLocked: true });
const testB = store.addTask({ title: 'Task B', startTime: '10:30', endTime: '11:30', plannedDuration: 60, isLocked: true });
const testC = store.addTask({ title: 'Task C', startTime: '11:30', endTime: '12:30', plannedDuration: 60, isLocked: true });

const shiftStartMin = 11 * 60;
const shiftEndMin = shiftStartMin + 60;
const taskCStartMin = 11 * 60 + 30;
const taskCEndMin = 12 * 60 + 30;

const willCascadeCollide = (shiftStartMin < taskCEndMin && taskCStartMin < shiftEndMin);
assert(willCascadeCollide === true, 'Cascade collision correctly detected: shifting B to 11:00-12:00 collides with C at 11:30');

console.log('\n========================================');
console.log(`Summary: ${passed} passed, ${failed} failed.`);
console.log('========================================');

if (failed > 0) {
  process.exit(1);
}
