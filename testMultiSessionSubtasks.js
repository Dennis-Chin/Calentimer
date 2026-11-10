/**
 * testMultiSessionSubtasks.js
 * 
 * Unit tests for Multi-Session Time Blocking & Shared Subtask Pool engine.
 */

import { taskStore } from './taskStore.js';

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✓ PASS: ${message}`);
    passed++;
  } else {
    console.error(`  ❌ FAIL: ${message}`);
    failed++;
  }
}

console.log('--- 1. Testing Subtask Pool CRUD & Reordering ---');

const masterTask = taskStore.addTodoTask({
  title: 'Project Roadmap',
  completed: false
});
const masterId = masterTask.id;
const s1 = taskStore.addSubtask(masterId, { title: 'Step 1: Outlining' });
const s2 = taskStore.addSubtask(masterId, { title: 'Step 2: Research' });
const s3 = taskStore.addSubtask(masterId, { title: 'Step 3: Drafting' });

let subs = taskStore.getSubtasks(masterId);
assert(subs.length === 3, 'Created 3 subtasks');
assert(subs[0].title === 'Step 1: Outlining', 'First subtask is Step 1');
assert(subs[0].completed === false, 'Subtask starts uncompleted');

// Update subtask
taskStore.updateSubtask(masterId, s1.id, { completed: true });
subs = taskStore.getSubtasks(masterId);
assert(subs[0].completed === true, 'Subtask 1 marked completed');

// Progress calculation
let progress = taskStore.getTaskProgress({ id: masterId, subtasks: subs });
assert(progress.completed === 1, 'Progress completed is 1');
assert(progress.total === 3, 'Progress total is 3');
assert(progress.percent === 33, 'Progress percent is 33%');

// Reorder subtasks
taskStore.reorderSubtasks(masterId, 0, 2);
subs = taskStore.getSubtasks(masterId);
assert(subs[2].title === 'Step 1: Outlining', 'Step 1 moved to index 2');
assert(subs[0].title === 'Step 2: Research', 'Step 2 moved to index 0');

// Delete subtask
taskStore.deleteSubtask(masterId, s2.id);
subs = taskStore.getSubtasks(masterId);
assert(subs.length === 2, 'Subtask deleted, length is now 2');

console.log('\n--- 2. Testing Multi-Session Time Blocking Model & Scheduling ---');

const multiTask = taskStore.addTask({
  title: 'Write Thesis Paper',
  plannedDuration: 45,
  isMultiSession: true,
  sessionCount: 3,
  sessionDuration: 45,
  sessionIndex: 1,
  subtasks: [
    { id: 'sub-t-1', title: 'Chapter 1', completed: true },
    { id: 'sub-t-2', title: 'Chapter 2', completed: false }
  ]
});

assert(multiTask.isMultiSession === true, 'Task is multi-session');
assert(multiTask.sessionCount === 3, 'Task has 3 sessions');
assert(multiTask.sessionIndex === 1, 'Task session index is 1');

// Test finding task anywhere
const found = taskStore.findTaskAnywhere(multiTask.id);
assert(found !== null && found.task.title === 'Write Thesis Paper', 'Found task anywhere in store');

// Test progress with mixed multi-session & subtasks
const multiProg = taskStore.getTaskProgress(multiTask);
assert(multiProg.completed === 1, 'Multi-session progress completed matches subtasks');
assert(multiProg.total === 2, 'Multi-session progress total matches subtasks');
assert(multiProg.percent === 50, 'Multi-session progress is 50%');

console.log('\n--- 3. Testing Unscheduled Sidebar Items & Calendar Placement ---');

// Add a multi-session Todo
const todoMaster = taskStore.addTodoTask({
  title: 'Prepare Exam',
  isMultiSession: true,
  sessionCount: 2,
  sessionDuration: 60,
  plannedDuration: 120,
  subtasks: [{ id: 'sub-ex-1', title: 'Practice Test A', completed: false }]
});

const unscheduled = taskStore.getUnscheduledSessionsAndTodos();
const examSessions = unscheduled.filter(item => item.masterTaskId === todoMaster.id);
assert(examSessions.length === 2, 'Generated 2 session items for exam');
assert(examSessions[0].displayTitle.indexOf('Session 1 of 2') !== -1, 'Display title includes Session 1 of 2');
assert(examSessions[0].isScheduled === false, 'Session 1 is not scheduled yet');

// Schedule Session 1 from sidebar onto calendar
const scheduledEvent = taskStore.scheduleSessionBlock({
  masterTaskId: todoMaster.id,
  sessionIndex: 1,
  totalSessions: 2,
  title: todoMaster.title,
  duration: 60,
  startTime: '14:00',
  date: taskStore.getTodayDateString()
});

assert(scheduledEvent !== null, 'Session 1 scheduled successfully');
assert(scheduledEvent.startTime === '14:00', 'Scheduled start time is 14:00');
assert(scheduledEvent.endTime === '15:00', 'Calculated end time is 15:00');
assert(scheduledEvent.subtasks.length === 1, 'Inherited subtasks from master task');

// Check that Unscheduled list now reflects session 1 as scheduled
const unscheduledAfter = taskStore.getUnscheduledSessionsAndTodos();
const examSession1 = unscheduledAfter.find(item => item.masterTaskId === todoMaster.id && item.sessionIndex === 1);
assert(examSession1.isScheduled === true, 'Session 1 marked as scheduled');

console.log('\n========================================');
console.log(`Summary: ${passed} passed, ${failed} failed.`);
console.log('========================================\n');

if (failed > 0) {
  process.exit(1);
} else {
  process.exit(0);
}
