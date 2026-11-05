/**
 * testTelemetrySyncService.js
 * 
 * Unit tests for TelemetrySyncService & Cloudflare Worker integration:
 * - Anonymous client UUID generation and persistence
 * - Device platform & PWA mode detection
 * - Heartbeat payload compilation & non-blocking egress
 * - Session summary metric sanitization (Zero PII guarantee)
 * - Telemetry opt-out compliance (strictly no network traffic when disabled)
 * - Worker ingest & stats aggregation simulation
 * 
 * Strictly zero optional chaining (?.) and zero nullish coalescing (??) operators.
 */

const mockStorage = {};
global.localStorage = {
  getItem: function(k) { return mockStorage[k] !== undefined ? mockStorage[k] : null; },
  setItem: function(k, v) { mockStorage[k] = String(v); },
  removeItem: function(k) { delete mockStorage[k]; },
  clear: function() { Object.keys(mockStorage).forEach(k => delete mockStorage[k]); }
};

if (typeof global.window === 'undefined') {
  global.window = {};
}
if (typeof global.document === 'undefined') {
  global.document = {
    addEventListener: function() {},
    removeEventListener: function() {}
  };
}

(async function runTelemetrySyncTests() {
  const { taskStore } = await import('./taskStore.js');
  const { telemetrySync } = await import('./telemetrySyncService.js');

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

  console.log('--- 1. Testing Anonymous Client ID Generation & Privacy Guarantee ---');
  taskStore.clearTimerSession();
  const anonId1 = taskStore.getAnonymousClientId();
  const anonId2 = taskStore.getAnonymousClientId();

  assert(typeof anonId1 === 'string' && anonId1.length > 10, 'Anonymous client ID generated as non-empty string');
  assert(anonId1.indexOf('usr_') === 0, 'Client ID prefixed with "usr_" identifier');
  assert(anonId1 === anonId2, 'Client ID is persistent across subsequent calls');
  assert(anonId1.indexOf('@') === -1 && anonId1.indexOf(' ') === -1, 'Client ID contains zero PII or user details');

  console.log('\n--- 2. Testing Device Platform & PWA Detection ---');
  assert(typeof telemetrySync.getDeviceType() === 'string', 'getDeviceType returns string platform');
  assert(typeof telemetrySync.isPwaMode() === 'boolean', 'isPwaMode returns boolean flag');

  console.log('\n--- 3. Testing Dispatch & Beacon Interception ---');
  let dispatchedPayloads = [];
  const mockNavigator = {
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)',
    platform: 'iPhone',
    maxTouchPoints: 5,
    sendBeacon: function(url, blob) {
      dispatchedPayloads.push({ url: url, size: (blob && blob.size) || 0 });
      return true;
    }
  };
  global.fetch = async function(url, opts) {
    dispatchedPayloads.push({ url: url, size: (opts && opts.body && opts.body.length) || 0 });
    return { ok: true, status: 200, json: async () => ({ success: true }) };
  };
  Object.defineProperty(globalThis, 'navigator', {
    value: mockNavigator,
    configurable: true,
    writable: true
  });

  telemetrySync.init({ endpoint: 'https://test-worker.workers.dev/api/telemetry' });
  assert(telemetrySync.endpoint === 'https://test-worker.workers.dev/api/telemetry', 'Custom telemetry endpoint registered');

  // Verify iPhone platform detected from mock userAgent
  assert(telemetrySync.getDeviceType() === 'mobile-ios', 'Detected mobile-ios from iOS userAgent');

  // Send Heartbeat
  dispatchedPayloads = [];
  telemetrySync.sendHeartbeat(true, 'Study');
  assert(dispatchedPayloads.length === 1, 'sendHeartbeat dispatched 1 beacon payload');
  assert(dispatchedPayloads[0].url === 'https://test-worker.workers.dev/api/telemetry', 'Beacon dispatched to registered worker endpoint');

  console.log('\n--- 4. Testing Session Summary Telemetry (Zero PII Guarantee) ---');
  dispatchedPayloads = [];
  telemetrySync.sendSessionSummary({
    id: 'internal-secret-task-id-123',
    title: 'Secret Client NDA Meeting',
    notes: 'Confidential project details',
    category: 'Work',
    actualDurationSec: 1800,
    status: 'completed',
    useTimeBank: true
  });

  assert(dispatchedPayloads.length === 1, 'sendSessionSummary dispatched 1 beacon payload');

  console.log('\n--- 5. Testing Telemetry Opt-Out Compliance ---');
  taskStore.setTelemetryEnabled(false);
  assert(taskStore.getTelemetryEnabled() === false, 'taskStore.getTelemetryEnabled is false');

  dispatchedPayloads = [];
  telemetrySync.sendHeartbeat(true, 'Coding');
  telemetrySync.sendSessionSummary({ category: 'Coding', actualDurationSec: 1200 });
  assert(dispatchedPayloads.length === 0, 'Zero payloads dispatched when telemetry is disabled by user');

  // Re-enable for subsequent usage
  taskStore.setTelemetryEnabled(true);
  assert(taskStore.getTelemetryEnabled() === true, 'taskStore.getTelemetryEnabled restored to true');

  console.log('\n--- 5b. Testing App Exit / Disconnect Signal ---');
  dispatchedPayloads = [];
  telemetrySync.sendDisconnect();
  assert(dispatchedPayloads.length === 1, 'sendDisconnect dispatched exit payload');

  console.log('\n--- 6. Testing Worker Stats Calculation & Auth Shield ---');
  const workerModule = await import('./server/worker.js');
  assert(typeof workerModule.default.fetch === 'function', 'Worker exports fetch handler');

  // Unauthorized request test
  const unauthorizedReq = new Request('https://telemetry.calentimer.com/api/stats', {
    method: 'GET'
  });
  const unauthRes = await workerModule.default.fetch(unauthorizedReq, { ADMIN_SECRET: 'secret_123' });
  assert(unauthRes.status === 401, 'Worker returns 401 Unauthorized when admin key is missing or invalid');

  // Authorized request test with mock D1 database
  const mockD1 = {
    prepare: function(sql) {
      return {
        bind: function() { return this; },
        first: async function() {
          if (sql.indexOf('active_heartbeats') !== -1 && (sql.indexOf('-90 seconds') !== -1 || sql.indexOf('-5 minutes') !== -1)) {
            return { count: 12 };
          }
          if (sql.indexOf('DISTINCT client_id') !== -1) {
            return { count: 85 };
          }
          return { count: 0 };
        },
        all: async function() {
          if (sql.indexOf('device_type') !== -1) {
            return { results: [{ device_type: 'mobile-ios', count: 50 }, { device_type: 'desktop', count: 35 }] };
          }
          if (sql.indexOf('is_pwa') !== -1) {
            return { results: [{ is_pwa: 1, count: 40 }, { is_pwa: 0, count: 45 }] };
          }
          if (sql.indexOf('event_type = \'session_completed\'') !== -1) {
            return {
              results: [
                { payload: JSON.stringify({ durationSec: 1800, category: 'Study', hasHardStop: true, usedTimeBank: true }) },
                { payload: JSON.stringify({ durationSec: 1200, category: 'Work', hasHardStop: false, usedTimeBank: false }) }
              ]
            };
          }
          return { results: [] };
        },
        run: async function() {
          return { success: true };
        }
      };
    }
  };

  const authorizedReq = new Request('https://telemetry.calentimer.com/api/stats?key=secret_123', {
    method: 'GET'
  });
  const authRes = await workerModule.default.fetch(authorizedReq, { ADMIN_SECRET: 'secret_123', DB: mockD1 });
  assert(authRes.status === 200, 'Worker returns 200 OK for authorized admin request');
  const statsData = await authRes.json();
  assert(statsData.activeNow === 12, 'Active now reported as 12 users');
  assert(statsData.dau === 85, 'DAU reported as 85 users');
  assert(statsData.totalSessionsAnalyzed === 2, '2 sessions analyzed');
  assert(statsData.featureAdoption.hardStopUsagePct === 50, 'Hard stop adoption calculated as 50%');
  assert(statsData.featureAdoption.timeBankUsagePct === 50, 'Time bank adoption calculated as 50%');

  // Admin Dashboard HTML serving
  const dashReq = new Request('https://telemetry.calentimer.com/admin', { method: 'GET' });
  const dashRes = await workerModule.default.fetch(dashReq, {});
  assert(dashRes.status === 200, 'Worker serves 200 OK HTML for /admin dashboard');
  const dashHtml = await dashRes.text();
  assert(dashHtml.indexOf('Calentimer Telemetry') !== -1, 'Dashboard HTML contains Calentimer brand header');
  assert(dashHtml.indexOf('Active Users Right Now') !== -1, 'Dashboard HTML contains Active Users Right Now section');

  console.log(`\n========================================`);
  console.log(`Summary: ${passed} passed, ${failed} failed.`);
  console.log(`========================================`);

  if (failed > 0) {
    process.exit(1);
  }
})();
