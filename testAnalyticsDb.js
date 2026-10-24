/**
 * testAnalyticsDb.js
 * 
 * Unit tests for AnalyticsDB: in-memory queueing, task tracking, session accumulation,
 * and productivity insights calculations.
 */

import { analytics } from './analyticsDb.js';

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

console.log('--- 1. Testing Interaction Telemetry Queueing ---');
analytics.trackInteraction('btn_click', 'btnPlayPause', { status: 'running' });
analytics.trackInteraction('dial_rotate', 'timer_dial', { deltaMinutes: 5 });

assert(analytics.interactionQueue.length === 2, 'Two interactions queued in memory');
assert(analytics.interactionQueue[0].type === 'btn_click', 'First event type is btn_click');
assert(analytics.interactionQueue[1].type === 'dial_rotate', 'Second event type is dial_rotate');
assert(analytics.interactionQueue[1].metadata.deltaMinutes === 5, 'Metadata deltaMinutes preserved');

console.log('\n--- 2. Testing Task Metric Lifecycle Tracking ---');
const mockTask = {
  id: 'test-task-1',
  title: 'Calculus Study',
  category: 'Math',
  isLocked: false,
  emoji: '📐',
  plannedDuration: 30
};

analytics.startTaskMetric(mockTask, { index: 0 });
assert(analytics.activeTaskMetric !== null, 'Active task metric created');
assert(analytics.activeTaskMetric.taskId === 'test-task-1', 'Active task metric ID matches');
assert(analytics.activeTaskMetric.category === 'Math', 'Category is Math');
assert(analytics.activeTaskMetric.plannedDurationMin === 30, 'Planned duration is 30m');

// Simulate pause
analytics.recordTaskPause(true);
assert(analytics.activeTaskMetric.pauseCount === 1, 'Pause count incremented to 1');
analytics.recordTaskPause(false);

// Simulate dial adjustment
analytics.recordTaskAdjustment(5);
assert(analytics.activeTaskMetric.dialAdjustmentsDeltaMin === 5, 'Dial adjustment recorded as +5m');

// Simulate bank deposit
analytics.recordTaskBankEvent(300, 0);
assert(analytics.activeTaskMetric.bankDepositedSec === 300, 'Bank deposit recorded as 300s');

// Finalize task
analytics.finalizeTaskMetric('completed_early', 1500); // 25 minutes (1500s)
assert(analytics.activeTaskMetric === null, 'Active task metric cleared after finalization');
assert(analytics.taskQueue.length === 1, 'Finalized task queued for storage');
assert(analytics.taskQueue[0].status === 'completed_early', 'Status is completed_early');
assert(analytics.taskQueue[0].actualDurationSec === 1500, 'Actual duration is 1500s');

console.log('\n--- 3. Testing Productivity Insights & Estimation Bias ---');
// Mocking getTaskMetrics response to test calculation algorithm
const originalGetTaskMetrics = analytics.getTaskMetrics;
analytics.getTaskMetrics = async () => [
  {
    taskId: 't1',
    category: 'Study',
    plannedDurationMin: 30,
    actualDurationSec: 2400, // 40m (+10m error)
    status: 'completed',
    pauseCount: 2,
    bankDepositedSec: 0,
    bankConsumedSec: 0
  },
  {
    taskId: 't2',
    category: 'Study',
    plannedDurationMin: 45,
    actualDurationSec: 3300, // 55m (+10m error)
    status: 'completed',
    pauseCount: 1,
    bankDepositedSec: 0,
    bankConsumedSec: 0
  },
  {
    taskId: 't3',
    category: 'Admin',
    plannedDurationMin: 20,
    actualDurationSec: 900, // 15m (-5m error)
    status: 'completed_early',
    pauseCount: 0,
    bankDepositedSec: 300,
    bankConsumedSec: 0
  }
];

const insights = await analytics.getProductivityInsights(30);
assert(insights.tasksAnalyzed === 3, 'Analyzed 3 tasks');
assert(insights.completedCount === 3, '3 tasks completed');
assert(insights.earlyCount === 1, '1 task completed early');
assert(insights.totalBankDepositedMin === 5, '5 minutes banked in total');

// Verify category estimation bias
const studyCat = insights.categoryInsights.find(c => c.category === 'Study');
assert(studyCat !== undefined, 'Study category found in insights');
assert(studyCat.avgEstimationBiasMin === 10, 'Study category bias is +10m (underestimated)');

const adminCat = insights.categoryInsights.find(c => c.category === 'Admin');
assert(adminCat !== undefined, 'Admin category found in insights');
assert(adminCat.avgEstimationBiasMin === -5, 'Admin category bias is -5m (finishes early)');

// Restore
analytics.getTaskMetrics = originalGetTaskMetrics;

console.log('\n========================================');
console.log(`Summary: ${passed} passed, ${failed} failed.`);
console.log('========================================');

if (failed > 0) process.exit(1);
