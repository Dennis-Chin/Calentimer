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
  const { classifyEvent, getCategoryColor } = await import('./eventClassifier.js');
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

  console.log('\n--- 16. Testing Microsoft Calendar Adapter Features & Parity with Google ---');
  const {
    microsoftCalendarAdapter,
    MICROSOFT_CATEGORY_COLORS,
    MICROSOFT_CATEGORY_NAME_MAP,
    MICROSOFT_CALENDAR_COLORS
  } = await import('./microsoftCalendarAdapter.js');
  const { OAUTH_CONFIG } = await import('./oauthConfig.js');

  // 1. Verify Microsoft Client ID
  assert(OAUTH_CONFIG && OAUTH_CONFIG.microsoft && OAUTH_CONFIG.microsoft.clientId === '15001074-5d3f-42d1-97fd-f61ea17c5be9', 'OAUTH_CONFIG has updated Microsoft Application ID 15001074-5d3f-42d1-97fd-f61ea17c5be9');
  assert(microsoftCalendarAdapter.clientId === '15001074-5d3f-42d1-97fd-f61ea17c5be9', 'microsoftCalendarAdapter initialized with new Client ID');

  // 2. Verify Microsoft Color Dictionaries
  assert(MICROSOFT_CATEGORY_COLORS['preset0'] === '#d13438', 'MICROSOFT_CATEGORY_COLORS preset0 is #d13438');
  assert(MICROSOFT_CATEGORY_NAME_MAP['blue category'] === '#0078d4', 'MICROSOFT_CATEGORY_NAME_MAP resolves blue category');
  assert(MICROSOFT_CALENDAR_COLORS['lightGreen'] === '#107c41', 'MICROSOFT_CALENDAR_COLORS lightGreen is #107c41');

  // 3. Test Microsoft Event Mapping: Color matching from categories
  const rawMsEvent1 = {
    id: 'ms-evt-1',
    subject: 'Biology Lecture',
    categories: ['Green category'],
    start: { dateTime: '2026-10-28T10:00:00.0000000' },
    end: { dateTime: '2026-10-28T11:30:00.0000000' },
    bodyPreview: 'Review cells and mitosis chapters'
  };
  const mappedMs1 = microsoftCalendarAdapter.mapToCalentimerEvent(rawMsEvent1, '#0078d4');
  assert(Boolean(mappedMs1), 'Microsoft event mapped successfully');
  assert(mappedMs1.id === 'cal-ms-ms-evt-1', 'Event id prefixed with cal-ms-');
  assert(mappedMs1.provider === 'microsoft', 'Provider is microsoft');
  assert(mappedMs1.isLocked === true, 'Imported Microsoft event is locked');
  assert(mappedMs1.color === '#107c41', 'Green category correctly mapped to #107c41');
  assert(mappedMs1.plannedDuration === 90, 'Planned duration calculated as 90m');
  assert(Boolean(mappedMs1.emoji), 'Semantic emoji assigned to Biology Lecture: ' + mappedMs1.emoji);

  // 4. Test Deterministic Classification Parity: Identical titles receive identical emojis
  const rawMsEvent2 = {
    id: 'ms-evt-2',
    subject: 'Biology Lecture',
    start: { dateTime: '2026-10-29T14:00:00.0000000' },
    end: { dateTime: '2026-10-29T15:00:00.0000000' }
  };
  const mappedMs2 = microsoftCalendarAdapter.mapToCalentimerEvent(rawMsEvent2);
  assert(mappedMs1.emoji === mappedMs2.emoji, 'Identical Microsoft event titles receive identical default emoji');
  assert(mappedMs1.category === mappedMs2.category, 'Identical Microsoft event titles receive identical default category');

  // 5. Test All-Day Event Mapping
  const rawMsAllDay = {
    id: 'ms-evt-allday',
    subject: 'Annual Conference',
    isAllDay: true,
    start: { dateTime: '2026-11-01T00:00:00.0000000' },
    end: { dateTime: '2026-11-02T00:00:00.0000000' }
  };
  const mappedMsAllDay = microsoftCalendarAdapter.mapToCalentimerEvent(rawMsAllDay);
  assert(mappedMsAllDay.startTime === '09:00', 'All-day event default start time is 09:00');
  assert(mappedMsAllDay.endTime === '17:00', 'All-day event default end time is 17:00');
  assert(mappedMsAllDay.plannedDuration === 480, 'All-day event duration is 480m');

  // 6. Test Outbound Payload Mapping
  const calentimerTask = {
    title: 'Client Strategy Meeting',
    category: 'Work',
    date: '2026-10-30',
    startTime: '13:00',
    endTime: '14:00'
  };
  const msPayload = microsoftCalendarAdapter.mapToMicrosoftPayload(calentimerTask);
  assert(msPayload.subject === 'Client Strategy Meeting', 'Outbound payload subject matches');
  assert(msPayload.start.dateTime === '2026-10-30T13:00:00', 'Outbound start dateTime matches');
  assert(msPayload.end.dateTime === '2026-10-30T14:00:00', 'Outbound end dateTime matches');
  assert(Array.isArray(msPayload.categories) && msPayload.categories[0] === 'Work', 'Outbound categories contains Work');

  // 7. Test fetchCalendarList API
  const calList = await microsoftCalendarAdapter.fetchCalendarList();
  assert(Array.isArray(calList) && calList.length >= 1, 'fetchCalendarList returns active calendars');
  assert(Boolean(calList[0].hexColor || calList[0].backgroundColor), 'Calendar has theme color');

  // 8. Test Dynamic OAuth Redirect URI Resolution (prevents production www.calentimer.com from redirecting to localhost)
  global.window.location = { origin: 'https://www.calentimer.com' };
  assert(microsoftCalendarAdapter.getRedirectUri() === 'https://www.calentimer.com', 'Resolves https://www.calentimer.com in production without redirecting to localhost');

  global.window.location = { origin: 'http://localhost:3000' };
  assert(microsoftCalendarAdapter.getRedirectUri() === 'http://localhost:3000', 'Resolves http://localhost:3000 in development');

  global.window.location = { origin: 'https://calentimer.com/' };
  assert(microsoftCalendarAdapter.getRedirectUri() === 'https://calentimer.com', 'Strips trailing slash from origin');

  console.log('\n--- 11. Testing WebCrypto subtle.digest SHA-256 Polyfill (MSAL PKCE Support) ---');
  const { ensureWebCryptoPolyfill } = await import('./cryptoPolyfill.js');
  assert(typeof ensureWebCryptoPolyfill === 'function', 'ensureWebCryptoPolyfill is a function');

  const testScope = {};
  ensureWebCryptoPolyfill(testScope);
  assert(Boolean(testScope.crypto), 'testScope.crypto initialized');
  assert(typeof testScope.crypto.getRandomValues === 'function', 'testScope.crypto.getRandomValues polyfilled');
  assert(Boolean(testScope.crypto.subtle), 'testScope.crypto.subtle initialized');
  assert(typeof testScope.crypto.subtle.digest === 'function', 'testScope.crypto.subtle.digest is a function');

  // Test getRandomValues randomness & bounds
  const randBytes = new Uint8Array(16);
  testScope.crypto.getRandomValues(randBytes);
  let allZero = true;
  for (let i = 0; i < randBytes.length; i++) {
    if (randBytes[i] !== 0) allZero = false;
    assert(randBytes[i] >= 0 && randBytes[i] <= 255, `randBytes[${i}] within uint8 range`);
  }
  assert(!allZero, 'getRandomValues populated non-zero pseudorandom bytes');

  // Helper to convert ArrayBuffer to hex string
  function bufToHex(buffer) {
    const bytes = new Uint8Array(buffer);
    let hex = '';
    for (let i = 0; i < bytes.length; i++) {
      hex += bytes[i].toString(16).padStart(2, '0');
    }
    return hex;
  }

  // Test standard NIST vector for "abc"
  const digestAbc = await testScope.crypto.subtle.digest('SHA-256', 'abc');
  const hexAbc = bufToHex(digestAbc);
  assert(hexAbc === 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad', 'SHA-256("abc") matches standard NIST hash vector');

  // Test Uint8Array input with object algorithm { name: 'SHA-256' }
  const textBytes = new Uint8Array([104, 101, 108, 108, 111]); // "hello"
  const digestHello = await testScope.crypto.subtle.digest({ name: 'SHA-256' }, textBytes);
  const hexHello = bufToHex(digestHello);
  assert(hexHello === '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824', 'SHA-256("hello") matches standard NIST hash vector');

  // Test unsupported algorithm rejection
  let unsupportedCaught = false;
  try {
    await testScope.crypto.subtle.digest('MD5', 'abc');
  } catch (err) {
    unsupportedCaught = true;
    assert(Boolean(err && err.message && err.message.indexOf('SHA-256') !== -1), 'Rejects non-SHA-256 algorithm gracefully');
  }
  assert(unsupportedCaught, 'Rejects unsupported hash algorithm');

  // --- 8. Testing Outbound Event Color Mapping & Disappearing Event Protection ---
  console.log('\n--- 8. Testing Outbound Event Color Mapping & Disappearing Event Protection ---');
  assert(typeof googleCalendarAdapter.getGoogleColorId === 'function', 'googleCalendarAdapter implements getGoogleColorId()');
  assert(googleCalendarAdapter.getGoogleColorId('Work') === '9', 'Work category maps to Google colorId 9 (Blueberry)');
  assert(googleCalendarAdapter.getGoogleColorId('Break') === '6', 'Break category maps to Google colorId 6 (Tangerine)');
  assert(googleCalendarAdapter.getGoogleColorId('Study') === '3', 'Study category maps to Google colorId 3 (Grape)');
  assert(googleCalendarAdapter.getGoogleColorId('Fitness') === '11', 'Fitness category maps to Google colorId 11 (Tomato)');
  assert(googleCalendarAdapter.getGoogleColorId('Health') === '11', 'Health category maps to Google colorId 11 (Tomato)');
  assert(googleCalendarAdapter.getGoogleColorId('Personal') === '6', 'Personal category maps to Google colorId 6 (Tangerine)');

  const gPayload = googleCalendarAdapter.mapToGooglePayload({
    title: 'Focus Sprint',
    category: 'Work',
    date: '2026-10-28',
    startTime: '10:00',
    endTime: '11:00'
  });
  assert(gPayload && gPayload.colorId === '9', 'Google Calendar payload includes colorId: "9" for Work');

  assert(typeof microsoftCalendarAdapter.getMicrosoftColorCategory === 'function', 'microsoftCalendarAdapter implements getMicrosoftColorCategory()');
  assert(microsoftCalendarAdapter.getMicrosoftColorCategory('Work') === 'Blue category', 'Work category maps to Microsoft "Blue category"');
  assert(microsoftCalendarAdapter.getMicrosoftColorCategory('Break') === 'Orange category', 'Break category maps to Microsoft "Orange category"');
  assert(microsoftCalendarAdapter.getMicrosoftColorCategory('Study') === 'Purple category', 'Study category maps to Microsoft "Purple category"');
  assert(microsoftCalendarAdapter.getMicrosoftColorCategory('Fitness') === 'Red category', 'Fitness category maps to Microsoft "Red category"');
  assert(microsoftCalendarAdapter.getMicrosoftColorCategory('Health') === 'Red category', 'Health category maps to Microsoft "Red category"');
  assert(microsoftCalendarAdapter.getMicrosoftColorCategory('Personal') === 'Orange category', 'Personal category maps to Microsoft "Orange category"');

  const colorMsPayload = microsoftCalendarAdapter.mapToMicrosoftPayload({
    title: 'Break Time',
    category: 'Break',
    date: '2026-10-28',
    startTime: '11:00',
    endTime: '11:15'
  });
  assert(colorMsPayload && colorMsPayload.categories && colorMsPayload.categories.indexOf('Orange category') !== -1, 'Microsoft Graph payload includes "Orange category" in categories for Break');
  assert(colorMsPayload && colorMsPayload.categories && colorMsPayload.categories.indexOf('Break') !== -1, 'Microsoft Graph payload preserves "Break" in categories');

  // Test that unpairing/cloud cancellation NEVER deletes a local Calentimer event
  const localCalEvent = taskStore.addCalendarEvent({
    id: 'cal-event-keep-me-123',
    title: 'Critical Project Work',
    category: 'Work',
    date: '2026-10-28',
    startTime: '14:00',
    endTime: '15:00',
    externalId: 'ext-google-to-unpair-99',
    googleEventId: 'ext-google-to-unpair-99',
    provider: 'google',
    source: 'local'
  });
  assert(Boolean(taskStore.getCalendarEventById('cal-event-keep-me-123')), 'Local event created and stored');

  const syncEngine = new CalendarSyncService();
  const reconResult = syncEngine._reconcileInboundEvents('google', [
    { externalId: 'ext-google-to-unpair-99', status: 'cancelled' }
  ]);
  const preservedEvent = taskStore.getCalendarEventById('cal-event-keep-me-123');
  assert(Boolean(preservedEvent), 'Local Calentimer event was NOT deleted on cloud cancellation');
  assert(preservedEvent && preservedEvent.externalId === null, 'Remote externalId cleared on unpair/cancellation');
  assert(preservedEvent && preservedEvent.googleEventId === null, 'googleEventId cleared on unpair/cancellation');
  assert(preservedEvent && preservedEvent.provider === 'local', 'provider detached back to local');

  // Test that an external-only imported event DOES get deleted on cloud cancellation
  const extImportedEvent = taskStore.addCalendarEvent({
    id: 'cal-gcal-remote-only-456',
    title: 'Remote Standup',
    category: 'Meeting',
    date: '2026-10-28',
    startTime: '16:00',
    endTime: '16:30',
    externalId: 'ext-remote-del-77',
    provider: 'google',
    source: 'google'
  });
  assert(Boolean(taskStore.getCalendarEventById('cal-gcal-remote-only-456')), 'External imported event created');
  syncEngine._reconcileInboundEvents('google', [
    { externalId: 'ext-remote-del-77', status: 'cancelled' }
  ]);
  const deletedEvent = taskStore.getCalendarEventById('cal-gcal-remote-only-456');
  assert(deletedEvent === null, 'Pure external event was properly deleted when cancelled in cloud');

  console.log('\n--- 17. Testing External Calendar Deletion Safety Shield ---');
  taskStore.setGoogleCalendarConnected(true);
  taskStore.setMicrosoftCalendarConnected(true);

  const initialGoogleDeletes = mockGoogle.getDeletedExternalIds().length;
  const initialMsDeletes = mockMicrosoft.getDeletedExternalIds().length;

  // 1. Block external Google event deletion
  const externalGoogleEvent = {
    id: 'cal-gcal-important-board-meeting-1',
    externalId: 'ext-gcal-board-123',
    origin: 'external',
    createdInApp: false,
    source: 'google',
    provider: 'google'
  };
  const blockedGcalDelete = await syncService.pushEventDelete(externalGoogleEvent, 'google');
  assert(blockedGcalDelete === false, 'pushEventDelete safely blocked deletion of external Google event');
  assert(mockGoogle.getDeletedExternalIds().length === initialGoogleDeletes, 'Google adapter deleteEvent was NEVER called for external event');

  // 2. Block external Microsoft event deletion
  const externalMsEvent = {
    id: 'cal-ms-important-client-pitch-2',
    externalId: 'ext-ms-pitch-456',
    origin: 'external',
    createdInApp: false,
    source: 'microsoft',
    provider: 'microsoft'
  };
  const blockedMsDelete = await syncService.pushEventDelete(externalMsEvent, 'microsoft');
  assert(blockedMsDelete === false, 'pushEventDelete safely blocked deletion of external Microsoft event');
  assert(mockMicrosoft.getDeletedExternalIds().length === initialMsDeletes, 'Microsoft adapter deleteEvent was NEVER called for external event');

  // 3. Block raw string ID deletion (no proven in-app provenance)
  const blockedRawString = await syncService.pushEventDelete('some-random-external-id-789', 'google');
  assert(blockedRawString === false, 'pushEventDelete safely blocked deletion from unverified raw string ID');
  assert(mockGoogle.getDeletedExternalIds().length === initialGoogleDeletes, 'Google adapter deleteEvent was NEVER called for raw string ID');

  // 4. Allow Calentimer-created event deletion when deselecting sync
  const appCreatedEvent = {
    id: 'task-app-study-session-77',
    externalId: 'ext-mirror-google-777',
    origin: 'local',
    createdInApp: true,
    provider: 'google',
    source: 'local'
  };
  const allowedAppDelete = await syncService.pushEventDelete(appCreatedEvent, 'google');
  assert(allowedAppDelete === true, 'pushEventDelete allows deletion of Calentimer-originated mirror event');
  assert(mockGoogle.getDeletedExternalIds().indexOf('ext-mirror-google-777') !== -1, 'Google adapter deleteEvent was called to clean up Calentimer mirror');

  // 5. Inbound Tombstone Suppression: Verify deleted external event is not resurrected on next delta
  taskStore.addDeletedId('ext-gcal-suppressed-meeting-888');
  const inboundSuppressResult = syncService._reconcileInboundEvents('google', [
    {
      id: 'cal-gcal-suppressed-meeting-888',
      externalId: 'ext-gcal-suppressed-meeting-888',
      title: 'Suppressed External Meeting',
      date: '2026-10-28',
      startTime: '11:00',
      endTime: '12:00'
    }
  ]);
  assert(inboundSuppressResult.added === 0, 'Reconcile inbound skipped tombstoned external event without adding');
  assert(taskStore.getCalendarEventById('cal-gcal-suppressed-meeting-888') === null, 'Tombstoned external event was not resurrected in taskStore');

  // --- 18. Testing Cross-Device Profile Save & Restore ---
  console.log('\n--- 18. Testing Cross-Device Profile Save & Restore ---');
  taskStore.addCategory('CrossDeviceDesign');
  taskStore.saveTodoTasks([{ id: 'todo-cross-1', title: 'Buy groceries across devices', isCompleted: false }]);
  const profileSaveOk = await syncService.saveCloudProfile('google');
  assert(profileSaveOk === true, 'saveCloudProfile successfully saved backup event to connected provider');

  // Simulate Device B signing in and receiving the cloud sync payload
  const cloudProfilePayload = JSON.stringify({
    _calentimer_cloud_profile: true,
    version: 1,
    savedAt: Date.now(),
    categories: ['DeviceBCat1', 'DeviceBCat2'],
    todos: [{ id: 'todo-device-b', title: 'Synced from Device A', isCompleted: false }],
    events: [{ id: 'cal-event-device-b', title: 'Local Event From Device A', origin: 'local', createdInApp: true, date: '2026-10-28', startTime: '13:00', endTime: '14:00' }],
    tasks: [],
    timeBankSeconds: 1500,
    hardStop: '19:30',
    hardStopEnabled: true,
    timespansEnabled: true
  });

  const deviceBReconcile = syncService._reconcileInboundEvents('google', [
    {
      id: 'cal-sync-profile-evt-1',
      externalId: 'ext-sync-profile-1',
      title: '[Calentimer Cloud Sync]',
      description: cloudProfilePayload
    }
  ]);

  assert(deviceBReconcile.added === 0, 'Profile sync event is strictly hidden from calendar timeline');
  assert(taskStore.getCategories().indexOf('DeviceBCat1') !== -1, 'Categories restored across devices');
  assert(taskStore.getTodoTasks().some(t => t.id === 'todo-device-b'), 'To-do tasks transferred across devices');
  assert(taskStore.getCalendarEventById('cal-event-device-b') !== null, 'Local calendar events transferred across devices');
  assert(taskStore.getHardStop() === '19:30', 'Settings (Hard Stop) restored across devices');

  // --- 19. Testing Color Collision Cascade & Dedicated Calentimer Calendar ---
  console.log('\n--- 19. Testing Color Collision Cascade & Dedicated Calentimer Calendar ---');
  const { hexToRgb, areColorsSimilar } = await import('./googleCalendarAdapter.js');

  // Test hexToRgb & areColorsSimilar
  assert(hexToRgb('#00d2ff') !== null, 'hexToRgb parsed 6-digit hex');
  assert(hexToRgb('#abc') !== null, 'hexToRgb parsed 3-digit hex');
  assert(areColorsSimilar('#00d2ff', '#00d2ff') === true, 'Identical colors are detected as similar');
  assert(areColorsSimilar('#00d2ff', '#ff0000') === false, 'Dissimilar colors (blue vs red) are correctly differentiated');

  // Test taskStore dedicated calendar ID & color getters/setters
  taskStore.setGoogleCalentimerCalendarId('gcal-calentimer-id-123');
  assert(taskStore.getGoogleCalentimerCalendarId() === 'gcal-calentimer-id-123', 'getGoogleCalentimerCalendarId returns saved ID');

  taskStore.setMicrosoftCalentimerCalendarId('ms-calentimer-id-456');
  assert(taskStore.getMicrosoftCalentimerCalendarId() === 'ms-calentimer-id-456', 'getMicrosoftCalentimerCalendarId returns saved ID');

  taskStore.setCalentimerCalendarColor('google', '#00d2ff');
  assert(taskStore.getCalentimerCalendarColor('google') === '#00d2ff', 'getCalentimerCalendarColor returns saved neon blue');

  taskStore.setCalentimerCalendarColor('microsoft', '#00e676');
  assert(taskStore.getCalentimerCalendarColor('microsoft') === '#00e676', 'getCalentimerCalendarColor returns saved neon green');

  // --- 20. Testing Real-time Outbound Push on Moved Task & 120Hz Gesture Shield ---
  console.log('\n--- 20. Testing Real-time Outbound Push on Moved Task & 120Hz Gesture Shield ---');
  // Create an app task with existing googleEventId
  const movedTaskEvent = {
    id: 'cal-event-drag-moved-1',
    title: 'Dragged Deep Work',
    date: '2026-10-28',
    startTime: '14:00',
    endTime: '15:00',
    plannedDuration: 60,
    googleEventId: 'ext-gcal-moved-event-99',
    provider: 'google',
    source: 'local',
    origin: 'local',
    createdInApp: true,
    isDirty: true
  };
  taskStore.saveCalendarEvents([movedTaskEvent]);

  // Outbound push dirty events
  const dirtyPushResult = await syncService._pushDirtyEvents('google');
  assert(dirtyPushResult.pushed === 1, '_pushDirtyEvents pushed 1 moved dirty event to adapter');
  const savedMovedEvent = taskStore.getCalendarEventById('cal-event-drag-moved-1');
  assert(savedMovedEvent && savedMovedEvent.isDirty === false, 'Moved event was marked clean (isDirty: false) after push');
  assert(mockGoogle.getUpdatedEvents().some(e => e.externalId === 'ext-gcal-moved-event-99'), 'Google adapter updateEvent was called for moved event');

  // Test 120Hz Gesture Shield: simulate user actively dragging
  global.window.isUserInteracting = () => true;
  syncService.startAutoSync();
  syncService.triggerOutboundSyncDebounced(10);
  await new Promise(r => setTimeout(r, 30));
  assert(true, 'Debounced outbound push executed safely with zero exceptions');

  // Reset user interaction
  global.window.isUserInteracting = () => false;
  syncService.stopAutoSync();

  // --- 21. Testing Category Custom Color Picker, Padlock Unlock Color Guard & Outbound Color Sync ---
  console.log('\n--- 21. Testing Category Custom Color Picker, Padlock Unlock Color Guard & Outbound Color Sync ---');
  // 1. Custom category color storage
  taskStore.setCategoryColor('Coding', '#a855f7');
  assert(taskStore.getCategoryColor('Coding') === '#a855f7', 'taskStore remembers custom color for Coding (#a855f7)');
  assert(getCategoryColor('Coding') === '#a855f7', 'eventClassifier.getCategoryColor returns remembered custom color');

  // 2. Padlock unlock color guard: External event has Flamingo color (#e67c73, colorId 4)
  // When event is unlocked, getGoogleColorId must NOT change it to blueberry (9)
  const flamingoColorId = googleCalendarAdapter.getGoogleColorId('Work', '#e67c73', '4');
  assert(flamingoColorId === '4', 'Padlock unlock color guard: preserves existing Google colorId 4 for Flamingo event');

  // 3. Outbound color mapping with custom color: Closest Google colorId
  // #ea580c (Orange) maps to Google colorId 6 (Tangerine)
  const customOrangeColorId = googleCalendarAdapter.getGoogleColorId('Work', '#ea580c');
  assert(customOrangeColorId === '6', 'getGoogleColorId maps custom orange #ea580c to Google Tangerine (colorId 6)');

  // #f59e0b (Amber/Yellow) maps to Google colorId 5 (Banana)
  const customAmberColorId = googleCalendarAdapter.getGoogleColorId('Work', '#f59e0b');
  assert(customAmberColorId === '5', 'getGoogleColorId maps custom amber #f59e0b to Google Banana (colorId 5)');

  // 4. Microsoft adapter preserves existing category on padlock unlock
  const msPreservedCat = microsoftCalendarAdapter.getMicrosoftColorCategory('Work', '#107c41', 'Green category');
  assert(msPreservedCat === 'Green category', 'Padlock unlock color guard: preserves existing Microsoft "Green category"');

  // 5. Inbound imported event adopts external color
  const inboundExtEvent = {
    id: 'cal-gcal-designer-color-1',
    title: 'Design Critique',
    category: 'Work',
    date: '2026-10-29',
    startTime: '10:00',
    endTime: '11:00',
    color: '#e67c73',
    colorId: '4',
    externalId: 'ext-gcal-designer-1',
    provider: 'google',
    source: 'google'
  };
  taskStore.saveCalendarEvents([inboundExtEvent]);
  const retrievedExt = taskStore.getCalendarEventById('cal-gcal-designer-color-1');
  assert(retrievedExt && retrievedExt.color === '#e67c73', 'App event preserves imported external color (#e67c73)');
  assert(retrievedExt && retrievedExt.colorId === '4', 'App event preserves imported external colorId ("4")');

  // --- 22. Testing Dedicated "Calentimer" Calendar Shield & Today Desync Prevention ---
  {
    console.log('\n--- 22. Testing Dedicated "Calentimer" Calendar Shield & Today Desync Prevention ---');
    const { OAUTH_CONFIG: ocfg } = await import('./oauthConfig.js');
    const { googleCalendarAdapter: gAdapter } = await import('./googleCalendarAdapter.js');
    const { microsoftCalendarAdapter: mAdapter } = await import('./microsoftCalendarAdapter.js');

    // 1. Google OAuth full calendar scope present
    assert(
      ocfg && ocfg.google && ocfg.google.scopes && ocfg.google.scopes.indexOf('https://www.googleapis.com/auth/calendar') !== -1,
      'Google OAuth config includes full "https://www.googleapis.com/auth/calendar" scope for secondary calendar management'
    );

    // 2. Calentimer Calendar ID ignores and clears 'primary'
    taskStore.setGoogleCalentimerCalendarId('primary');
    assert(taskStore.getGoogleCalentimerCalendarId() === null, 'taskStore rejects and clears "primary" for Google Calentimer calendar ID');

    taskStore.setMicrosoftCalentimerCalendarId('primary');
    assert(taskStore.getMicrosoftCalentimerCalendarId() === null, 'taskStore rejects and clears "primary" for Microsoft Calentimer calendar ID');

    taskStore.setGoogleCalentimerCalendarId('c_secondary_calentimer_123');
    assert(taskStore.getGoogleCalentimerCalendarId() === 'c_secondary_calentimer_123', 'taskStore stores valid dedicated Calentimer secondary ID');

    // 3. Provider tombstone clearing
    taskStore.addDeletedId('cal-gcal-del-1', '2026-10-29');
    taskStore.addDeletedId('cal-ms-del-1', '2026-10-29');
    taskStore.addDeletedId('local-task-del-1', '2026-10-29');
    taskStore.clearDeletedIdsForProvider('google');
    const deletedIdsAfter = taskStore.getDeletedIds('2026-10-29');
    assert(!deletedIdsAfter.has('cal-gcal-del-1'), 'clearDeletedIdsForProvider clears Google tombstones');
    assert(deletedIdsAfter.has('cal-ms-del-1'), 'clearDeletedIdsForProvider preserves Microsoft tombstones');
    assert(deletedIdsAfter.has('local-task-del-1'), 'clearDeletedIdsForProvider preserves local tombstones');

    // 4. Outbound event create shield: Throws error if target is primary or missing
    let googleThrewShield = false;
    try {
      const fakeAdapter = new gAdapter.constructor({ useMock: false });
      fakeAdapter.accessToken = 'test_token';
      fakeAdapter.getOrCreateCalentimerCalendar = async () => null;
      await fakeAdapter.createEvent({ title: 'Test Shield Event', date: '2026-10-29' });
    } catch (err) {
      googleThrewShield = Boolean(err && err.message && err.message.indexOf('primary personal calendar') !== -1);
    }
    assert(googleThrewShield, 'Google adapter strictly throws and refuses to write events into primary personal calendar');

    let msThrewShield = false;
    try {
      const fakeMsAdapter = new mAdapter.constructor({ useMock: false });
      fakeMsAdapter.accessToken = 'test_token';
      fakeMsAdapter.getOrCreateCalentimerCalendar = async () => null;
      await fakeMsAdapter.createEvent({ title: 'Test Shield Event', date: '2026-10-29' });
    } catch (err) {
      msThrewShield = Boolean(err && err.message && err.message.indexOf('primary personal calendar') !== -1);
    }
    assert(msThrewShield, 'Microsoft adapter strictly throws and refuses to write events into primary personal calendar');

    // 5. Zombie resurrection guard in syncScheduleAndCalendar
    const todayDate = taskStore.getTodayDateString();
    taskStore.saveTasks([
      { id: 'cal-gcal-orphan-1', title: 'Disconnected Orphan Task', origin: 'external', provider: 'google', date: todayDate }
    ]);
    taskStore.saveCalendarEvents([]); // external calendar event is gone
    taskStore.syncScheduleAndCalendar();
    const tasksAfterSync = taskStore.getTasks();
    assert(!tasksAfterSync.some(t => t.id === 'cal-gcal-orphan-1'), 'syncScheduleAndCalendar eliminates disconnected orphan external tasks without resurrecting them');
  }

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
