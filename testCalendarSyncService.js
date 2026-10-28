/**
 * testCalendarSyncService.js
 * 
 * Unit tests for CalendarSyncService:
 * - Provider connection & disconnection lifecycle (Google & Microsoft)
 * - Echo Guard deterministic hash signature computation and loop suppression
 * - Inbound delta reconciliation (new, updated, and deleted events)
 * - Automatic bridging of today's external events into Today's Schedule as locked items
 * - Outbound CRUD operations (create, update, delete) and offline dirty queueing
 * - Full syncAll orchestration and auto-sync controls
 * Strictly zero optional chaining and zero nullish coalescing operators.
 */

// 1. Setup Mock DOM and Storage Environment before imports
const mockStorage = {};
global.localStorage = {
  getItem: (k) => (mockStorage[k] !== undefined ? mockStorage[k] : null),
  setItem: (k, v) => { mockStorage[k] = String(v); },
  removeItem: (k) => { delete mockStorage[k]; },
  clear: () => { Object.keys(mockStorage).forEach(k => delete mockStorage[k]); }
};

if (typeof global.window === 'undefined') {
  global.window = {};
}
if (typeof global.document === 'undefined') {
  global.document = {
    addEventListener: () => {},
    removeEventListener: () => {}
  };
}

(async function runCalendarSyncTests() {
  const { CalendarSyncService } = await import('./calendarSyncService.js');
  const { taskStore } = await import('./taskStore.js');
  const { classifyEvent } = await import('./eventClassifier.js');
  const { TimerRuntime, TimerStatus } = await import('./timerRuntime.js');
  const { calculateSchedule } = await import('./schedulerEngine.js');

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

  // Helper Mock Adapter Factory
  function createMockAdapter(providerName, initialEmail) {
    let email = initialEmail || `${providerName}@test.com`;
    let isConnected = false;
    let deltaEventsToReturn = [];
    let nextDeltaToken = `next_${providerName}_token_1`;
    let createdEvents = [];
    let updatedEvents = [];
    let deletedExternalIds = [];

    return {
      init: () => {},
      requestAccessToken: async () => {
        isConnected = true;
        return 'mock_token_abc123';
      },
      fetchUserEmail: async () => email,
      signOut: () => {
        isConnected = false;
      },
      setDeltaEvents: (events, nextToken) => {
        deltaEventsToReturn = events || [];
        if (nextToken) nextDeltaToken = nextToken;
      },
      fetchEvents: async (timeMin, timeMax, token) => {
        const res = {
          events: deltaEventsToReturn.slice(),
          nextSyncToken: providerName === 'google' ? nextDeltaToken : undefined,
          nextDeltaLink: providerName === 'microsoft' ? nextDeltaToken : undefined
        };
        deltaEventsToReturn = [];
        return res;
      },
      pullDelta: async (token) => {
        const res = {
          events: deltaEventsToReturn.slice(),
          nextSyncToken: providerName === 'google' ? nextDeltaToken : undefined,
          nextDeltaLink: providerName === 'microsoft' ? nextDeltaToken : undefined
        };
        deltaEventsToReturn = [];
        return res;
      },
      createEvent: async (ev) => {
        const extId = `${providerName}_ext_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`;
        const record = {
          externalId: extId,
          etag: `etag_${providerName}_${Date.now()}`
        };
        createdEvents.push(Object.assign({}, ev, record));
        return record;
      },
      updateEvent: async (ev) => {
        const record = {
          externalId: ev.externalId,
          etag: `etag_upd_${Date.now()}`
        };
        updatedEvents.push(Object.assign({}, ev, record));
        return record;
      },
      deleteEvent: async (externalId) => {
        deletedExternalIds.push(externalId);
        return true;
      },
      getCreatedEvents: () => createdEvents,
      getUpdatedEvents: () => updatedEvents,
      getDeletedExternalIds: () => deletedExternalIds
    };
  }

  console.log('--- 1. Testing CalendarSyncService Initialization & Adapter Options ---');
  const mockGoogle = createMockAdapter('google', 'engineer@google.com');
  const mockMicrosoft = createMockAdapter('microsoft', 'engineer@microsoft.com');

  const syncService = new CalendarSyncService({
    googleAdapter: mockGoogle,
    microsoftAdapter: mockMicrosoft
  });

  syncService.init();
  assert(syncService.adapters.google === mockGoogle, 'Google adapter registered correctly in sync service');
  assert(syncService.adapters.microsoft === mockMicrosoft, 'Microsoft adapter registered correctly in sync service');
  assert(syncService.isSyncing === false, 'isSyncing is false initially');

  console.log('\n--- 2. Testing Echo Guard Hash Calculation (computeSyncHash) ---');
  const evA = {
    title: 'Sprint Planning',
    date: '2026-10-28',
    startTime: '10:00',
    endTime: '11:00',
    isLocked: true
  };
  const hashA1 = syncService.computeSyncHash(evA);
  const hashA2 = syncService.computeSyncHash(evA);
  assert(typeof hashA1 === 'string' && hashA1.length > 0, 'computeSyncHash returns non-empty string hash');
  assert(hashA1 === hashA2, 'computeSyncHash is strictly deterministic for identical event objects');

  const evB = Object.assign({}, evA, { title: 'Sprint Retrospective' });
  const hashB = syncService.computeSyncHash(evB);
  assert(hashA1 !== hashB, 'Hash changes when title differs');

  const evC = Object.assign({}, evA, { startTime: '10:30' });
  const hashC = syncService.computeSyncHash(evC);
  assert(hashA1 !== hashC, 'Hash changes when startTime differs');

  const evD = Object.assign({}, evA, { isLocked: false });
  const hashD = syncService.computeSyncHash(evD);
  assert(hashA1 !== hashD, 'Hash changes when isLocked differs');

  console.log('\n--- 3. Testing Provider Connection & Disconnection Lifecycle ---');
  // Clear any existing stored events
  taskStore.saveCalendarEvents([]);
  taskStore.setGoogleCalendarConnected(false);
  taskStore.setMicrosoftCalendarConnected(false);

  assert(syncService.isProviderConnected('google') === false, 'Google not connected initially');
  assert(syncService.isProviderConnected('microsoft') === false, 'Microsoft not connected initially');

  let statusChangeNotified = false;
  const unbindListener = syncService.onSyncStatusChange((isSyncing, details) => {
    statusChangeNotified = true;
  });

  const connectGoogleRes = await syncService.connectProvider('google');
  assert(connectGoogleRes.success === true, 'connectProvider Google returned success');
  assert(connectGoogleRes.email === 'engineer@google.com', 'Connected user email returned');
  assert(taskStore.getGoogleCalendarConnected() === true, 'taskStore.getGoogleCalendarConnected is true');
  assert(taskStore.getGoogleUserEmail() === 'engineer@google.com', 'taskStore stores Google user email');
  assert(syncService.isProviderConnected('google') === true, 'isProviderConnected Google is true');
  assert(statusChangeNotified === true, 'onSyncStatusChange listener triggered during connection');

  const connectMsRes = await syncService.connectProvider('microsoft');
  assert(connectMsRes.success === true, 'connectProvider Microsoft returned success');
  assert(taskStore.getMicrosoftCalendarConnected() === true, 'taskStore.getMicrosoftCalendarConnected is true');
  assert(taskStore.getMicrosoftUserEmail() === 'engineer@microsoft.com', 'taskStore stores Microsoft user email');
  assert(syncService.isProviderConnected('microsoft') === true, 'isProviderConnected Microsoft is true');

  unbindListener();

  console.log('\n--- 4. Testing Inbound Delta Sync & Today Schedule Bridging ---');
  const todayStr = taskStore.getTodayDateString();

  // Prepare external delta: 1 Google event for today, 1 Microsoft event for tomorrow
  const inboundGoogleEvent = {
    externalId: 'g_event_1',
    title: 'Client Architecture Review',
    date: todayStr,
    startTime: '13:00',
    endTime: '14:00',
    plannedDuration: 60,
    category: 'Work',
    emoji: '💼',
    color: '#7986cb',
    colorId: '1',
    etag: 'etag_g1'
  };

  mockGoogle.setDeltaEvents([inboundGoogleEvent], 'next_google_token_2');
  const syncGoogleResult = await syncService.syncProvider('google');

  assert(syncGoogleResult.imported === 1, 'Inbound delta imported 1 event');
  assert(taskStore.getGoogleSyncToken() === 'next_google_token_2', 'Next syncToken stored');

  const allEventsAfterSync = taskStore.getCalendarEvents();
  const importedLocal = allEventsAfterSync.find(e => e.externalId === 'g_event_1');
  assert(importedLocal !== undefined && importedLocal !== null, 'External event added to local calendar events');
  assert(importedLocal.provider === 'google', 'Event provider assigned to google');
  assert(importedLocal.isLocked === true, 'External meeting automatically locked to preserve schedule anchor');
  assert(importedLocal.color === '#7986cb', 'External event color preserved in local calendar');
  assert(importedLocal.syncHash === syncService.computeSyncHash(importedLocal), 'Calculated and saved syncHash matches event payload');

  // Verify bridging to Today's Tasks
  const todayTasks = taskStore.getTasks();
  const bridgedTask = todayTasks.find(t => t.id === importedLocal.id);
  assert(bridgedTask !== undefined && bridgedTask !== null, 'Today external meeting automatically bridged to Today schedule');
  assert(bridgedTask.isLocked === true, 'Bridged today task is locked');
  assert(bridgedTask.color === '#7986cb', 'External event color bridged to Today schedule task');

  console.log('\n--- 4b. Testing Google Calendar Timezone & Color Parsing ---');
  const { googleCalendarAdapter, GOOGLE_EVENT_COLORS } = await import('./googleCalendarAdapter.js');
  const sampleGoogleItem = {
    id: 'test_gcal_sample_123',
    summary: 'Design Review',
    colorId: '4', // Flamingo (#e67c73)
    start: { dateTime: '2026-10-28T05:00:00Z' },
    end: { dateTime: '2026-10-28T08:00:00Z' }
  };
  const mappedSample = googleCalendarAdapter.mapToCalentimerEvent(sampleGoogleItem);
  assert(mappedSample.color === '#e67c73', 'Google colorId="4" mapped to flamingo #e67c73');
  const localStartH = new Date('2026-10-28T05:00:00Z').getHours();
  const expectedStartTime = String(localStartH).padStart(2, '0') + ':00';
  assert(mappedSample.startTime === expectedStartTime, `Event start time matches browser local timezone (${expectedStartTime}), not raw UTC 05:00`);

  console.log('\n--- 5. Testing Echo Guard: Ping-Pong Loop Suppression ---');
  // External delta returns the same event with identical payload and etag
  mockGoogle.setDeltaEvents([inboundGoogleEvent], 'next_google_token_3');
  const echoSyncResult = await syncService.syncProvider('google');
  assert(echoSyncResult.echoesSuppressed === 1, 'Echo guard detected matching syncHash and suppressed echo');
  assert(echoSyncResult.imported === 0, 'No duplicate event was created on echo');

  console.log('\n--- 6. Testing Inbound Remote Event Update ---');
  // External delta returns event rescheduled by external organizer to 13:30 - 14:30
  const modifiedInboundEvent = {
    externalId: 'g_event_1',
    title: 'Client Architecture Review (Rescheduled)',
    date: todayStr,
    startTime: '13:30',
    endTime: '14:30',
    plannedDuration: 60,
    category: 'Work',
    etag: 'etag_g2'
  };
  mockGoogle.setDeltaEvents([modifiedInboundEvent], 'next_google_token_4');
  const modSyncResult = await syncService.syncProvider('google');

  assert(modSyncResult.updated === 1, 'Inbound changed event detected and updated');
  const updatedLocal = taskStore.getCalendarEventById(importedLocal.id);
  assert(updatedLocal.title === 'Client Architecture Review (Rescheduled)', 'Local event title updated');
  assert(updatedLocal.startTime === '13:30', 'Local event startTime updated to 13:30');
  assert(updatedLocal.endTime === '14:30', 'Local event endTime updated to 14:30');
  assert(updatedLocal.etag === 'etag_g2', 'Local event etag updated');

  console.log('\n--- 7. Testing Inbound Remote Event Deletion ---');
  const deletedInboundEvent = {
    externalId: 'g_event_1',
    deleted: true
  };
  mockGoogle.setDeltaEvents([deletedInboundEvent], 'next_google_token_5');
  const delSyncResult = await syncService.syncProvider('google');

  assert(delSyncResult.deleted === 1, 'Inbound deleted event processed');
  const afterDeleteLocal = taskStore.getCalendarEventById(importedLocal.id);
  assert(afterDeleteLocal === null, 'Event removed from local calendar store');

  console.log('\n--- 8. Testing Outbound Event CRUD Push ---');
  // 1. pushEventCreate
  const newLocalEv = taskStore.addCalendarEvent({
    title: 'Local Meeting to Push',
    date: todayStr,
    startTime: '15:00',
    endTime: '16:00',
    plannedDuration: 60,
    provider: 'google'
  });

  const pushCreateRes = await syncService.pushEventCreate(newLocalEv);
  assert(pushCreateRes !== null && pushCreateRes.externalId !== undefined, 'pushEventCreate returned externalId from adapter');
  const savedAfterCreate = taskStore.getCalendarEventById(newLocalEv.id);
  assert(savedAfterCreate.externalId === pushCreateRes.externalId, 'taskStore updated with externalId');
  assert(savedAfterCreate.isDirty === false, 'isDirty cleared on successful push');
  assert(savedAfterCreate.etag !== null, 'etag recorded on local event');

  // 2. pushEventUpdate
  savedAfterCreate.title = 'Local Meeting Pushed and Renamed';
  savedAfterCreate.startTime = '15:15';
  taskStore.updateCalendarEvent(savedAfterCreate.id, {
    title: savedAfterCreate.title,
    startTime: savedAfterCreate.startTime
  });

  const pushUpdateRes = await syncService.pushEventUpdate(savedAfterCreate);
  assert(pushUpdateRes !== null, 'pushEventUpdate succeeded');
  const savedAfterUpdate = taskStore.getCalendarEventById(savedAfterCreate.id);
  assert(savedAfterUpdate.syncHash === syncService.computeSyncHash(savedAfterUpdate), 'Local event syncHash updated to match new title and time');

  // 3. pushEventDelete
  const pushDeleteRes = await syncService.pushEventDelete(savedAfterUpdate);
  assert(pushDeleteRes === true, 'pushEventDelete succeeded');
  assert(mockGoogle.getDeletedExternalIds().includes(savedAfterUpdate.externalId), 'Adapter deleteEvent called with externalId');

  console.log('\n--- 9. Testing Offline / Disconnected Dirty Queueing ---');
  // If provider is disconnected, pushEventCreate marks event as dirty
  await syncService.disconnectProvider('microsoft');
  assert(syncService.isProviderConnected('microsoft') === false, 'Microsoft disconnected');

  const offlineMsEvent = taskStore.addCalendarEvent({
    title: 'Offline Draft Task',
    date: todayStr,
    startTime: '17:00',
    endTime: '18:00',
    plannedDuration: 60,
    provider: 'microsoft'
  });

  const pushOfflineRes = await syncService.pushEventCreate(offlineMsEvent);
  assert(pushOfflineRes === null, 'pushEventCreate returned null for disconnected provider');
  assert(offlineMsEvent.isDirty === true, 'Event marked isDirty = true for future synchronization');

  console.log('\n--- 10. Testing syncAll Orchestration ---');
  // Re-connect Google
  taskStore.setGoogleCalendarConnected(true);
  mockGoogle.setDeltaEvents([], 'token_all_1');

  const syncAllResult = await syncService.syncAll();
  assert(typeof syncAllResult.providers === 'object', 'syncAll returned provider breakdown');
  assert(syncAllResult.providers.google !== undefined, 'Google provider executed in syncAll');
  assert(typeof taskStore.getLastSyncTimestamp('all') === 'number', 'Master lastSyncTimestamp recorded');

  console.log('\n--- 11. Testing Auto-Sync Timer Lifecycle ---');
  taskStore.setAutoSyncEnabled(true);
  syncService.startAutoSync();
  assert(syncService.autoSyncTimer !== null, 'autoSyncTimer started');
  assert(syncService.isAutoSyncRunning === true, 'isAutoSyncRunning is true');

  syncService.stopAutoSync();
  assert(syncService.autoSyncTimer === null, 'autoSyncTimer cleared');
  assert(syncService.isAutoSyncRunning === false, 'isAutoSyncRunning is false');

  console.log('\n--- 12. Testing Disconnect Provider Event Cleanup ---');
  // Add 1 Google event and 1 Microsoft event and 1 Local event
  taskStore.saveCalendarEvents([
    { id: 'rem-loc-1', title: 'Local Note', provider: 'local' },
    { id: 'rem-g-1', title: 'Google Standup', provider: 'google', externalId: 'g_123' },
    { id: 'rem-ms-1', title: 'MS Discussion', provider: 'microsoft', externalId: 'ms_456' }
  ]);

  await syncService.disconnectProvider('google');
  const remainingAfterGoogleDisc = taskStore.getCalendarEvents();
  assert(remainingAfterGoogleDisc.some(e => e.id === 'rem-loc-1'), 'Local event remains after Google disconnect');
  assert(!remainingAfterGoogleDisc.some(e => e.id === 'rem-g-1'), 'Google events removed upon Google disconnect');
  assert(remainingAfterGoogleDisc.some(e => e.id === 'rem-ms-1'), 'Microsoft event remains after Google disconnect');
  assert(taskStore.getGoogleCalendarConnected() === false, 'Google connected flag set to false');
  assert(taskStore.getGoogleSyncToken() === null, 'Google syncToken cleared on disconnect');

  console.log('\n--- 13. Testing Event Classifier (Word Extraction & Semantic Domains) ---');
  const classA = classifyEvent('Biology Lab Experiment', 'Conducting osmosis analysis');
  assert(classA.category === 'Study', 'Biology Lab classified as Study');
  assert(classA.emoji === '🔬', 'Biology Lab assigned microscope emoji');

  const classB = classifyEvent('History Lecture', 'World history overview');
  assert(classB.category === 'Study', 'History Lecture classified as Study (shared category)');
  assert(classB.emoji === '🎓', 'History Lecture assigned graduation cap emoji');

  // Deterministic Identity: Same name receives exact same emoji and category every single time
  const classC1 = classifyEvent('Quarterly Budget Review');
  const classC2 = classifyEvent('Quarterly Budget Review');
  assert(classC1.category === classC2.category, 'Identical event name receives identical category deterministically');
  assert(classC1.emoji === classC2.emoji, 'Identical event name receives identical emoji deterministically');

  // Fallback hash determinism for unclassified custom strings
  const classD1 = classifyEvent('XYZCustomUncategorizedProject123');
  const classD2 = classifyEvent('XYZCustomUncategorizedProject123');
  assert(classD1.category === 'General', 'Unclassified event falls back to General category');
  assert(classD1.emoji === classD2.emoji, 'Unclassified event produces identical fallback emoji via string hashing');

  // Explicit Google Calendar color preservation
  const customGoogleHex = '#33b679';
  const classE = classifyEvent('Team Sync', 'Sprint planning', customGoogleHex);
  assert(classE.color === customGoogleHex, 'Explicit Google Calendar color is preserved in classification');

  console.log('\n--- 14. Testing Color & Attribute Preservation across Engine and Sync ---');
  // SchedulerEngine output preservation
  const schedResult = calculateSchedule({
    startTime: '09:00',
    hardStop: '12:00',
    tasks: [
      { id: 'task-col-1', title: 'Task with Google Color', plannedDuration: 30, color: '#e67c73', colorId: '4', emoji: '🎨', category: 'Creative' }
    ]
  });
  assert(schedResult.success === true, 'calculateSchedule succeeded');
  assert(Boolean(schedResult.tasks[0] && schedResult.tasks[0].color === '#e67c73'), 'calculateSchedule preserves task color');
  assert(Boolean(schedResult.tasks[0] && schedResult.tasks[0].colorId === '4'), 'calculateSchedule preserves task colorId');

  // TaskStore syncScheduleAndCalendar bidirectional color propagation
  taskStore.saveCalendarEvents([
    { id: 'cal-col-1', title: 'Synced Calendar Event', startTime: '10:00', endTime: '11:00', date: taskStore.getTodayDateString(), color: '#f4511e', colorId: '6', category: 'Work' }
  ]);
  taskStore.syncScheduleAndCalendar();
  const scheduleAfterSync = taskStore.getTasks();
  const syncedScheduleTask = scheduleAfterSync.find(t => t.id === 'cal-col-1');
  assert(Boolean(syncedScheduleTask), 'Calendar event bridged to Today\'s Schedule');
  assert(Boolean(syncedScheduleTask && syncedScheduleTask.color === '#f4511e'), 'TaskStore sync bridges color to schedule task');

  console.log('\n--- 15. Testing Timer Runtime Active Task Persistence & Non-Skipping on Recalculate ---');
  const runtimeInstance = new TimerRuntime({
    hardStop: '23:59',
    tasks: [
      { id: 'run-t1', title: 'Morning Task 1', startTime: '06:00', endTime: '07:00', plannedDuration: 60, color: '#2563eb', emoji: '📝' },
      { id: 'run-t2', title: 'Morning Task 2', startTime: '07:00', endTime: '08:00', plannedDuration: 60, color: '#7c3aed', emoji: '💻' }
    ]
  });

  // 1. In IDLE mode with morning tasks in the past, getActiveTask() returns valid task (never null)
  const idleActiveTask = runtimeInstance.getActiveTask();
  assert(Boolean(idleActiveTask), 'getActiveTask() returns valid task in IDLE even if tasks are in past');
  assert(Boolean(idleActiveTask && idleActiveTask.id === 'run-t1'), 'IDLE mode activeTask starts with Task 1');

  // 2. Start timer on Task 1
  runtimeInstance.start();
  assert(runtimeInstance.status === TimerStatus.RUNNING, 'Timer started into RUNNING state');
  assert(runtimeInstance.activeTaskIndex === 0, 'Active task index is 0 (Task 1)');
  assert(Boolean(runtimeInstance.getActiveTask() && runtimeInstance.getActiveTask().id === 'run-t1'), 'Active task is Task 1 while RUNNING');

  // 3. Trigger recalculate (simulating opening bottom drawer / slider)
  runtimeInstance.recalculate();
  assert(runtimeInstance.activeTaskIndex === 0, 'activeTaskIndex remains strictly 0 after recalculate() during RUNNING');
  assert(Boolean(runtimeInstance.getActiveTask() && runtimeInstance.getActiveTask().id === 'run-t1'), 'getActiveTask() strictly retains Task 1 and does NOT skip to Task 2');
  assert(Boolean(runtimeInstance.getActiveTask() && runtimeInstance.getActiveTask().color === '#2563eb'), 'Active task color preserved during RUNNING recalculate');

  // 4. Pause and recalculate
  runtimeInstance.pause();
  assert(runtimeInstance.status === TimerStatus.PAUSED, 'Timer in PAUSED state');
  runtimeInstance.recalculate();
  assert(runtimeInstance.activeTaskIndex === 0, 'activeTaskIndex remains strictly 0 after recalculate() during PAUSED');
  assert(Boolean(runtimeInstance.getActiveTask() && runtimeInstance.getActiveTask().id === 'run-t1'), 'getActiveTask() retains Task 1 when PAUSED');

  console.log('\n========================================');
  console.log(`Summary: ${passed} passed, ${failed} failed.`);
  console.log('========================================');

  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
})().catch(function(err) {
  console.error('Unhandled error in testCalendarSyncService:', err);
  process.exit(1);
});
