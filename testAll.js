/**
 * testAll.js
 * 
 * Master test suite runner for Calentimer.
 * Runs all unit and compatibility tests in sequence.
 */

import { spawnSync } from 'child_process';
import path from 'path';

const suites = [
  'testSchedulerEngine.js',
  'testTimerRuntime.js',
  'testTimeBank.js',
  'testAnalyticsDb.js',
  'testCalendarView.js',
  'testCalendarScheduleSync.js',
  'testAppDrawerGestures.js',
  'testCalendarSyncService.js',
  'testSyntaxCompatibility.js'
];

let allPassed = true;

console.log('========================================');
console.log('   CALENTIMER MASTER TEST SUITE RUNNER  ');
console.log('========================================\n');

suites.forEach(function(suite) {
  console.log(`>>> Running ${suite}...`);
  const result = spawnSync('node', [suite], { stdio: 'inherit' });
  if (result.status !== 0) {
    allPassed = false;
    console.error(`\n❌ ${suite} failed with exit code ${result.status}\n`);
  } else {
    console.log(`\n✅ ${suite} completed successfully\n`);
  }
});

console.log('========================================');
if (allPassed) {
  console.log('  ALL TEST SUITES PASSED CLEANLY! 🎉    ');
  console.log('========================================');
  process.exit(0);
} else {
  console.error('  SOME TEST SUITES FAILED! ❌           ');
  console.log('========================================');
  process.exit(1);
}
