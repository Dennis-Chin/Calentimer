/**
 * app.js
 * 
 * Application Controller for Hard-Stop Focus Timer.
 * Connects TimerRuntime, TaskStore, AudioManager, and Interactive Rotary Wheel.
 */

import { TimerRuntime, TimerStatus } from './timerRuntime.js';
import { taskStore } from './taskStore.js';
import { audioManager } from './audioManager.js';
import { mobileServices } from './mobileServices.js';
import { formatMinutesToTime, parseTimeToMinutes } from './schedulerEngine.js';
import { analytics } from './analyticsDb.js';
import { calendarView } from './calendarView.js';
import { calendarSyncService } from './calendarSyncService.js';
import { googleCalendarAdapter } from './googleCalendarAdapter.js';
import { microsoftCalendarAdapter } from './microsoftCalendarAdapter.js';
import { classifyEvent, getCategoryColor as classifierGetCategoryColor, getAllClassificationEmojis, PRESET_CATEGORY_COLORS } from './eventClassifier.js';
import { telemetrySync } from './telemetrySyncService.js';

// DOM Elements
const hardStopPill = document.getElementById('hardStopPill');
const hardStopInput = document.getElementById('hardStopInput');
const calendarFinishLine = document.getElementById('calendarFinishLine');
const calendarHardStopInput = document.getElementById('calendarHardStopInput');
const btnClearCalendarSchedule = document.getElementById('btnClearCalendarSchedule');
const calendarModalBackdrop = document.getElementById('calendarModalBackdrop');
const calendarTimelineList = document.getElementById('calendarTimelineList');
const navItemTimer = document.getElementById('navItemTimer');
const navItemCalendar = document.getElementById('navItemCalendar');
const navItemSettings = document.getElementById('navItemSettings');
const btnOpenNav = document.getElementById('btnOpenNav');
const btnCloseNav = document.getElementById('btnCloseNav');
const navDrawerBackdrop = document.getElementById('navDrawerBackdrop');
const navDrawer = document.getElementById('navDrawer');
const settingsModalBackdrop = document.getElementById('settingsModalBackdrop');
const btnCloseSettings = document.getElementById('btnCloseSettings');
const btnCloseCalendar = document.getElementById('btnCloseCalendar');
const toggleConfirmAdjust = document.getElementById('toggleConfirmAdjust');
const toggleHardStopEnabled = document.getElementById('toggleHardStopEnabled');
const statusBanner = document.getElementById('statusBanner');
const statusText = document.getElementById('statusText');

let isDraggingTask = false;
let isSwipingCardToDelete = false;
let isCalendarModalPullingDown = false;

const btnNotifToggle = document.getElementById('btnNotifToggle');
const notifStatusText = document.getElementById('notifStatusText');

const wheelContainer = document.getElementById('wheelContainer');
const rotarySvg = document.getElementById('rotarySvg');
const rotaryDialGroup = document.getElementById('rotaryDialGroup');
const dialHitRing = document.getElementById('dialHitRing');
const dialTicksGroup = document.getElementById('dialTicksGroup');
const trackProgress = document.getElementById('trackProgress');
const revolvingCircleGroup = document.getElementById('revolvingCircleGroup');
const revolvingHitbox = document.getElementById('revolvingHitbox');
const revolvingCircle = document.getElementById('revolvingCircle');
const revolvingGlow = document.getElementById('revolvingGlow');

const digitalClock = document.getElementById('digitalClock');
const activeCategoryChip = document.getElementById('activeCategoryChip');
const activeTaskTitle = document.getElementById('activeTaskTitle');
const activeTaskTimeSpan = document.getElementById('activeTaskTimeSpan');

const rotaryPreviewBadge = document.getElementById('rotaryPreviewBadge');
const rotaryConfirmPill = document.getElementById('rotaryConfirmPill');
const rotaryConfirmText = document.getElementById('rotaryConfirmText');
const btnConfirmAdjust = document.getElementById('btnConfirmAdjust');
const btnCancelAdjust = document.getElementById('btnCancelAdjust');

const warningAlertCard = document.getElementById('warningAlertCard');
const warningDesc = document.getElementById('warningDesc');

const btnPlayPause = document.getElementById('btnPlayPause');
const iconPlay = document.getElementById('iconPlay');
const iconPause = document.getElementById('iconPause');
const btnStopTime = document.getElementById('btnStopTime');
const btnSkipTask = document.getElementById('btnSkipTask');
const btnFinishEarly = document.getElementById('btnFinishEarly');
const finishEarlyText = document.getElementById('finishEarlyText');

const taskDrawer = document.getElementById('taskDrawer');
const drawerHeader = document.getElementById('drawerHeader');
const taskCountBadge = document.getElementById('taskCountBadge');
const addTaskForm = document.getElementById('addTaskForm');
const taskListContainer = document.getElementById('taskListContainer');

// Rotary Wheel Constants: Radius 130 fits perfectly inside 320x320 SVG
const CIRCLE_RADIUS = 130;
const CIRCUMFERENCE = 2 * Math.PI * CIRCLE_RADIUS; // ~816.81

// Wheel Interaction State
let isScrubbingGreenLine = false;
let isDraggingOuterDial = false;
let currentDialRotationDeg = 0;
let accumulatedDialAngleDeltaDeg = 0;
let pendingMinuteAdjustment = 0;
let baseDialSeconds = 0;
let lastAudibleMinuteTick = 0;

window.isUserInteracting = () => Boolean(isDraggingTask || isDraggingOuterDial);

// Navigation Drawer Swipe State (Shared across nav drawer and rotary dial handlers)
let isNavSwiping = false;
let navTouchStartX = null;
let navTouchStartY = null;

// Today's Tasks Drawer Touch/Pull State (Global so nav menu gestures can inspect drawer interaction)
let isDrawerTouching = false;
let isDrawerPullingDown = false;
let isDrawerPullingUp = false;

// Today's Tasks Drawer Actions (Shared across setupControls, navigation, and mobile back button)
let openTaskDrawer = null;
let closeTaskDrawer = null;
let toggleTaskDrawer = null;

// Universal Lifecycle Gesture & Transient State Reset
// Resets all touch, swipe, pull, and dial interaction flags on app launch, blur, backgrounding, or BFCache restore
function resetTransientGestureState() {
  navTouchStartX = null;
  navTouchStartY = null;
  isNavSwiping = false;
  isDrawerTouching = false;
  isDrawerPullingUp = false;
  isDrawerPullingDown = false;
  isDraggingOuterDial = false;
  isScrubbingGreenLine = false;
  isDraggingTask = false;
  isSwipingCardToDelete = false;
  isCalendarModalPullingDown = false;

  const drawer = document.getElementById('taskDrawer');
  const drawerBackdrop = document.getElementById('taskDrawerBackdrop');
  if (drawer && drawer.classList.contains('collapsed')) {
    drawer.classList.remove('will-minimise', 'will-open');
    drawer.style.removeProperty('transform');
    drawer.style.removeProperty('transition');
    if (drawerBackdrop) drawerBackdrop.classList.add('hidden');
  }

  const nav = document.getElementById('navDrawer');
  const navBackdrop = document.getElementById('navDrawerBackdrop');
  if (nav && !nav.classList.contains('open')) {
    nav.style.removeProperty('transform');
    nav.style.removeProperty('transition');
    nav.style.removeProperty('visibility');
    if (navBackdrop) {
      navBackdrop.style.removeProperty('opacity');
      navBackdrop.style.removeProperty('transition');
      navBackdrop.classList.add('hidden');
    }
  }

  if (document.body) {
    document.body.classList.remove('is-dragging-dial', 'is-scrubbing');
  }
  const previewBadge = document.getElementById('rotaryPreviewBadge');
  if (previewBadge) {
    previewBadge.classList.add('hidden');
  }
  const rotaryDial = document.getElementById('rotaryDialGroup');
  if (rotaryDial) {
    rotaryDial.setAttribute('transform', 'rotate(0 160 160)');
  }
  accumulatedDialAngleDeltaDeg = 0;
  currentDialRotationDeg = 0;
  pendingMinuteAdjustment = 0;

  const exitModal = document.getElementById('confirmExitAppModalBackdrop');
  if (exitModal && !exitModal.classList.contains('hidden')) {
    exitModal.classList.add('hidden');
  }
}
window.resetTransientGestureState = resetTransientGestureState;

// Schedule Mode & Timespans Toggle UI (Module Scope to prevent ReferenceErrors on openCalendar)
let updateTimespansButtonUI = function() {
  const isChronological = (typeof taskStore !== 'undefined' && typeof taskStore.getTimespansEnabled === 'function')
    ? taskStore.getTimespansEnabled()
    : true;
  const btnModeChronological = document.getElementById('btnModeChronological');
  const btnModeSequential = document.getElementById('btnModeSequential');
  const calModeChrono = document.getElementById('btnCalModeChronological');
  const calModeSeq = document.getElementById('btnCalModeSequential');
  if (btnModeChronological) {
    btnModeChronological.classList.toggle('active', isChronological);
  }
  if (btnModeSequential) {
    btnModeSequential.classList.toggle('active', !isChronological);
  }
  if (calModeChrono) {
    calModeChrono.classList.toggle('active', isChronological);
  }
  if (calModeSeq) {
    calModeSeq.classList.toggle('active', !isChronological);
  }
};
window.updateTimespansButtonUI = updateTimespansButtonUI;

let setScheduleMode = function(isChronological) {
  if (typeof taskStore !== 'undefined' && typeof taskStore.setTimespansEnabled === 'function') {
    taskStore.setTimespansEnabled(isChronological);
  }
  updateTimespansButtonUI();
  if (runtime) {
    runtime.recalculate();
    renderTaskList(((runtime.currentSchedule && runtime.currentSchedule.tasks) || []) || taskStore.getTasks());
    renderCalendarModal();
    updateScheduleUI(runtime.currentSchedule);
    updateActiveTaskDisplay();
  }
  mobileServices.hapticTap();
  showToastNotification(isChronological ? '🕒 Chronological mode active' : '📋 Sequential plan mode active');
};
window.setScheduleMode = setScheduleMode;

// Initialize Timer Runtime
let runtime = null;

function updateHardStopPillsUI(enabled) {
  if (hardStopPill) {
    if (enabled) {
      hardStopPill.classList.remove('is-disabled');
      hardStopPill.title = "Hard Stop: all tasks automatically shrink to finish by this time";
    } else {
      hardStopPill.classList.add('is-disabled');
      hardStopPill.title = "Hard Stop disabled (tasks run for full planned durations)";
    }
  }
  if (calendarFinishLine) {
    const sub = calendarFinishLine.querySelector('.finish-line-sub');
    if (enabled) {
      calendarFinishLine.classList.remove('is-disabled');
      calendarFinishLine.title = "Finish Line / Hard Stop: Click anywhere to set target finish time";
      if (sub) sub.textContent = "TARGET HARD STOP";
    } else {
      calendarFinishLine.classList.add('is-disabled');
      calendarFinishLine.title = "Finish Line disabled in Settings";
      if (sub) sub.textContent = "HARD STOP DISABLED";
    }
  }
  const todayFinishLine = document.getElementById('todayFinishLine');
  if (todayFinishLine) {
    if (enabled) {
      todayFinishLine.classList.remove('is-disabled');
      todayFinishLine.title = "Finish Line / Hard Stop Active";
    } else {
      todayFinishLine.classList.add('is-disabled');
      todayFinishLine.title = "Finish Line disabled in Settings";
    }
  }
}

function refreshAppScheduleFromStore() {
  const todayStr = (typeof taskStore.getTodayDateString === 'function')
    ? taskStore.getTodayDateString()
    : new Date().toISOString().split('T')[0];
  if (typeof taskStore.syncScheduleAndCalendar === 'function') {
    taskStore.syncScheduleAndCalendar(todayStr);
  }
  if (runtime) {
    runtime.initialTasks = taskStore.getTasks();
    runtime.recalculate();
    if (typeof updateScheduleUI === 'function') {
      updateScheduleUI(runtime.currentSchedule);
    }
    if (typeof updateActiveTaskDisplay === 'function') {
      updateActiveTaskDisplay();
    }
    if (typeof renderTaskList === 'function') {
      renderTaskList(((runtime.currentSchedule && runtime.currentSchedule.tasks) || []) || taskStore.getTasks());
    }
  }
  if (typeof renderCalendarModal === 'function') {
    renderCalendarModal();
  }
  if (calendarView && typeof calendarView.render === 'function') {
    calendarView.render();
  }
}
window.refreshAppScheduleFromStore = refreshAppScheduleFromStore;

function initApp() {
  try {
    resetTransientGestureState();
    const currentMode = (typeof taskStore !== 'undefined' && typeof taskStore.getAppMode === 'function')
      ? taskStore.getAppMode()
      : 'advanced';
    const isSimpleMode = currentMode === 'simple';
    if (document.body) {
      document.body.classList.toggle('simple-mode-active', isSimpleMode);
    }
    const modeSliderWrap = document.getElementById('modeSliderWrap');
    const modeSliderTrack = document.getElementById('modeSliderTrack');
    const modeSliderLabel = document.getElementById('modeSliderLabel');
    if (modeSliderWrap) modeSliderWrap.classList.toggle('is-simple', isSimpleMode);
    if (modeSliderTrack) modeSliderTrack.classList.toggle('is-simple', isSimpleMode);
    if (modeSliderLabel) {
      modeSliderLabel.textContent = 'Simple';
      modeSliderLabel.classList.toggle('is-simple', isSimpleMode);
    }

    taskStore.syncScheduleAndCalendar();

    const savedHardStop = taskStore.getHardStop();
    if (hardStopInput) hardStopInput.value = savedHardStop;
    if (calendarHardStopInput) calendarHardStopInput.value = savedHardStop;
    const todayFinishLineTime = document.getElementById('todayFinishLineTime');
    if (todayFinishLineTime) todayFinishLineTime.textContent = savedHardStop;

    const isHardStopEnabled = taskStore.getHardStopEnabled();

    const tasks = taskStore.getTasks();

    runtime = new TimerRuntime({
      hardStop: savedHardStop,
      tasks: tasks,
      isLoopEnabled: isSimpleMode && typeof taskStore.getSimpleLoopEnabled === 'function' ? taskStore.getSimpleLoopEnabled() : false
    });
    window.runtime = runtime;
    runtime.setHardStopEnabled(isSimpleMode ? false : isHardStopEnabled);
    updateHardStopPillsUI(isSimpleMode ? false : isHardStopEnabled);

    initTheme();
    renderDialTicks();
    setupRuntimeEvents();
    setupControls();
    setupRotaryWheel();
    setupTaskPipeline();
    setupNavigationAndModals();
    calendarView.init();
    setupScheduleConflictModal();

    if (typeof telemetrySync !== 'undefined' && telemetrySync && typeof telemetrySync.init === 'function') {
      telemetrySync.init();
    }

    if (typeof taskStore !== 'undefined' && typeof taskStore.getKeepScreenAwake === 'function' && taskStore.getKeepScreenAwake()) {
      mobileServices.enableWakeLock();
    }

    if (typeof calendarSyncService !== 'undefined' && calendarSyncService && typeof calendarSyncService.init === 'function') {
      calendarSyncService.init();
      calendarSyncService.onSyncStatusChange((isSyncing, details) => {
        if (calendarView && typeof calendarView.updateProviderToggleUI === 'function') {
          calendarView.updateProviderToggleUI();
        }
        if (typeof window.syncCalendarSettingsUI === 'function') {
          window.syncCalendarSettingsUI();
        }
        if (!isSyncing && typeof refreshAppScheduleFromStore === 'function') {
          refreshAppScheduleFromStore();
        }
      });
    }

    // Startup Onboarding Prompt (only for first-time users who have never connected a calendar and not skipped)
    const skipPrompt = (typeof taskStore.getSkipConnectPrompt === 'function') ? taskStore.getSkipConnectPrompt() : false;
    const googleConn = (typeof taskStore.getGoogleCalendarConnected === 'function') ? taskStore.getGoogleCalendarConnected() : false;
    const msConn = (typeof taskStore.getMicrosoftCalendarConnected === 'function') ? taskStore.getMicrosoftCalendarConnected() : false;
    const googleEmail = (typeof taskStore.getGoogleUserEmail === 'function') ? taskStore.getGoogleUserEmail() : null;
    const msEmail = (typeof taskStore.getMicrosoftUserEmail === 'function') ? taskStore.getMicrosoftUserEmail() : null;
    if (!skipPrompt && !googleConn && !msConn && !googleEmail && !msEmail) {
      setTimeout(() => {
        if (calendarView && typeof calendarView.openConnectModal === 'function') {
          calendarView.openConnectModal();
        }
      }, 700);
    }

    taskStore.onChange(() => {
      if (runtime) {
        const storedTasks = taskStore.getTasks();
        const currentIds = (runtime.initialTasks || []).map(t => t.id).join(',');
        const storedIds = storedTasks.map(t => t.id).join(',');
        if (currentIds !== storedIds || JSON.stringify(storedTasks) !== JSON.stringify(runtime.initialTasks)) {
          const storedIdSet = new Set(storedTasks.map(t => t.id));
          const removedTasks = (runtime.initialTasks || []).filter(t => !storedIdSet.has(t.id));
          removedTasks.forEach(t => {
            runtime.deleteTask(t.id);
          });
          runtime.initialTasks = storedTasks;
          runtime.recalculate();
          updateScheduleUI(runtime.currentSchedule);
          updateActiveTaskDisplay();
          renderTaskList(((runtime.currentSchedule && runtime.currentSchedule.tasks) || []) || storedTasks);
          renderCalendarModal();
          updateTotalMinutesDisplay();
          const activeTask = runtime.getActiveTask();
          if (activeTask) {
            renderClockTime(runtime.getRemainingSeconds());
          } else {
            renderClockTime(0);
            updateWheelProgress(0);
          }
        }
      }
      if (calendarView && typeof calendarView.render === 'function' && calendarView.isOpen && calendarView.isOpen()) {
        calendarView.render();
      }
    });

    // Initial render: calculate schedule and populate all lists immediately
    runtime.recalculate();
    syncDynamicScheduleTimesToCalendar();

    // Check for saved timer session to restore continuity across app close/reopen
    const savedSession = (typeof taskStore !== 'undefined' && typeof taskStore.getTimerSession === 'function')
      ? taskStore.getTimerSession()
      : null;
    let sessionRestored = false;
    if (savedSession) {
      sessionRestored = runtime.restoreSessionState(savedSession);
    }

    updateScheduleUI(runtime.currentSchedule);
    renderTaskList(((runtime.currentSchedule && runtime.currentSchedule.tasks) || []) || tasks);
    updateActiveTaskDisplay();
    if (typeof updateTimespansButtonUI === 'function') updateTimespansButtonUI();
    updateResetButtonUI();
    updateNotifToggleUI();
    updateTimeBankDisplay();
    updateTotalMinutesDisplay();
    renderTodoList();

    const initActiveTask = runtime.getActiveTask();
    const initDurSec = (sessionRestored && (runtime.status === TimerStatus.RUNNING || runtime.status === TimerStatus.PAUSED))
      ? runtime.getRemainingSeconds()
      : (((initActiveTask ? initActiveTask.allocatedDuration : 0) || (initActiveTask ? initActiveTask.plannedDuration : 0) || 30) * 60);

    updateFinishEarlyButtonText(initDurSec);
    renderClockTime(initDurSec);
    const initProgress = (sessionRestored && (runtime.status === TimerStatus.RUNNING || runtime.status === TimerStatus.PAUSED))
      ? runtime.getProgress()
      : 0;
    updateWheelProgress(initProgress);

    if (sessionRestored) {
      if (runtime.status === TimerStatus.RUNNING) {
        iconPlay.classList.add('hidden');
        iconPause.classList.remove('hidden');
        startContinuousWheelAnimation();
      } else if (runtime.status === TimerStatus.PAUSED) {
        iconPlay.classList.remove('hidden');
        iconPause.classList.add('hidden');
        stopContinuousWheelAnimation();
      }
    }

    resetTransientGestureState();
  } catch (err) {
    console.error('Fatal initialization error in initApp:', err);
    showToastNotification('⚠️ Init Error: ' + err.message);
  }
}

function updateNotifToggleUI() {
  const isEnabled = taskStore.getAlertsEnabled();
  const toggleAlerts = document.getElementById('toggleAlertsEnabled');
  if (toggleAlerts) toggleAlerts.checked = isEnabled;

  if (!btnNotifToggle || !notifStatusText) return;
  const hasPerm = mobileServices.hasNotificationPermission();

  if (isEnabled) {
    btnNotifToggle.classList.add('granted');
    notifStatusText.textContent = 'Alerts On';
    btnNotifToggle.title = hasPerm
      ? 'Android notification panel countdown & sounds active (tap to toggle)'
      : 'In-app audio chimes & countdown alerts active (tap to toggle)';
  } else {
    btnNotifToggle.classList.remove('granted');
    notifStatusText.textContent = 'Alerts Off';
    btnNotifToggle.title = 'Alerts muted (tap to enable)';
  }
}

/**
 * Renders 60 tick notches around the outer rotary wheel dial
 */
function renderDialTicks() {
  if (!dialTicksGroup) return;
  if (dialTicksGroup.children && dialTicksGroup.children.length === 60) return;
  dialTicksGroup.innerHTML = '';
  for (let i = 0; i < 60; i++) {
    const isMajor = i % 5 === 0;
    const angleRad = (i * 6 - 90) * (Math.PI / 180);
    const r1 = isMajor ? 132 : 138;
    const r2 = 152;
    const x1 = 160 + r1 * Math.cos(angleRad);
    const y1 = 160 + r1 * Math.sin(angleRad);
    const x2 = 160 + r2 * Math.cos(angleRad);
    const y2 = 160 + r2 * Math.sin(angleRad);

    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', x1);
    line.setAttribute('y1', y1);
    line.setAttribute('x2', x2);
    line.setAttribute('y2', y2);
    line.setAttribute('class', `dial-tick ${isMajor ? 'major' : ''}`);
    dialTicksGroup.appendChild(line);
  }
}

/**
 * Calculates the total work minutes completed today (excluding breaks)
 */
function calculateTotalMinutesToday() {
  const todayStr = (typeof taskStore !== 'undefined' && typeof taskStore.getTodayDateString === 'function')
    ? taskStore.getTodayDateString()
    : new Date().toISOString().split('T')[0];
  const tasks = (typeof taskStore !== 'undefined' && typeof taskStore.getTasks === 'function')
    ? taskStore.getTasks()
    : [];
  let totalMin = 0;

  function isBreak(t) {
    if (!t) return false;
    const cat = (t.category || '').toLowerCase();
    const title = (t.title || '').toLowerCase();
    return cat === 'break' || title === 'break';
  }

  tasks.forEach(t => {
    if (t && t.isCompleted && (!t.completedDate || t.completedDate === todayStr) && !isBreak(t)) {
      totalMin += Math.round(t.allocatedDuration || t.plannedDuration || 0);
    }
  });

  if (runtime && (runtime.status === TimerStatus.RUNNING || runtime.status === TimerStatus.PAUSED) && runtime.activeTaskIndex > 0) {
    const schedTasks = (runtime.currentSchedule && runtime.currentSchedule.tasks) || [];
    for (let i = 0; i < runtime.activeTaskIndex && i < schedTasks.length; i++) {
      const st = schedTasks[i];
      if (!isBreak(st)) {
        const isAlreadyCounted = tasks.some(t => t.id === st.id && t.isCompleted && (!t.completedDate || t.completedDate === todayStr));
        if (!isAlreadyCounted) {
          totalMin += Math.round(st.allocatedDuration || st.plannedDuration || 0);
        }
      }
    }
  }

  return totalMin;
}

function updateTotalMinutesDisplay() {
  const totalMinEl = document.getElementById('totalMinutesAmount');
  if (!totalMinEl) return;
  const totalMin = calculateTotalMinutesToday();
  if (totalMin >= 60) {
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    totalMinEl.textContent = m > 0 ? `${h}h ${m}m` : `${h}h`;
  } else {
    totalMinEl.textContent = `${totalMin}m`;
  }
}
window.updateTotalMinutesDisplay = updateTotalMinutesDisplay;

// ==========================================
// Event Bindings for TimerRuntime
// ==========================================
function setupRuntimeEvents() {
  runtime.on('tick', (data) => {
    // Only update digital clock from tick if user is NOT currently scrubbing
    if (!isScrubbingGreenLine) {
      if (isDraggingOuterDial || pendingMinuteAdjustment !== 0) {
        const adjustedSeconds = Math.max(1, data.remainingSeconds + pendingMinuteAdjustment * 60);
        renderClockTime(adjustedSeconds);
        updateActiveTaskTimeSpanDynamic(adjustedSeconds);
      } else {
        renderClockTime(data.remainingSeconds);
        updateActiveTaskTimeSpanDynamic(data.remainingSeconds);
      }
      updateTimerQuickToggles(data.isOverrunning);
      // Continuous rAF drives smooth wheel during RUNNING; update here when paused, idle, or seeking
      if (runtime.status !== TimerStatus.RUNNING) {
        if (isDraggingOuterDial || pendingMinuteAdjustment !== 0) {
          const adjustedSeconds = Math.max(1, data.remainingSeconds + pendingMinuteAdjustment * 60);
          const elapsedSec = runtime.getElapsedSeconds();
          const totalSec = elapsedSec + adjustedSeconds;
          const previewProgress = totalSec > 0 ? Math.min(1, Math.max(0, elapsedSec / totalSec)) : 0;
          updateWheelProgress(previewProgress);
        } else {
          updateWheelProgress(data.isOverrunning ? data.progress : data.progressRatio);
        }
      }
    }

    updateTimeBankDisplay();

    // Android notification panel live countdown update
    if (runtime.status === TimerStatus.RUNNING) {
      const nextTask = ((runtime.currentSchedule && runtime.currentSchedule.tasks) || [])[runtime.activeTaskIndex + 1] || null;
      mobileServices.updateLiveNotification({
        activeTask: data.activeTask,
        remainingSeconds: data.remainingSeconds,
        nextTask,
        isPaused: false
      });
    }

    // Dynamic intuitive text: Finish Early & Send X To Time Bank
    updateFinishEarlyButtonText(data.remainingSeconds);
    syncPastTasksCompletion();
  });

  runtime.on('hardStopReached', (data) => {
    analytics.recordSessionEvent('complete_hard_stop', { hardStop: data && data.hardStop });
    audioManager.playChime();
    mobileServices.hapticBuzz();
    showToastNotification(`🛑 Hard Stop reached (${data.hardStop || 'target time'})! Time to stop working.`);
    renderClockTime(0);
    updateWheelProgress(1);
    updateActiveTaskDisplay();
  });

  runtime.on('taskOverrunStart', (data) => {
    analytics.recordTaskBankEvent(0, data && data.secondsConsumed ? data.secondsConsumed : 0);
    audioManager.playTumblingCoinsSound();
    mobileServices.hapticCelebration();
    updateTimeBankDisplay();
    if (statusBanner) statusBanner.classList.add('compressed');
    if (statusText) statusText.textContent = '🪙 Using Time Bank excess time';
    showToastNotification('🪙 Task overdue! Consuming excess time from Time Bank');
    renderTaskList(((runtime.currentSchedule && runtime.currentSchedule.tasks) || []) || []);
    const calBackdrop = document.getElementById('calendarModalBackdrop');
    if (calBackdrop && !calBackdrop.classList.contains('hidden')) {
      renderCalendarModal();
    }
  });

  runtime.on('timeBankDeposit', (data) => {
    analytics.recordTaskBankEvent(data && data.secondsDeposited ? data.secondsDeposited : 0, 0);
    updateTimeBankDisplay();
    const mins = Math.round(data.secondsDeposited / 60);
    if (mins > 0) {
      showToastNotification(`🪙 +${mins}m deposited to Time Bank!`);
    }
  });

  runtime.on('timeBankExhausted', (data) => {
    updateTimeBankDisplay();
    audioManager.playTaskCompleteChime();
    showToastNotification('⚠️ Time Bank exhausted!');
    renderTaskList(((runtime.currentSchedule && runtime.currentSchedule.tasks) || []) || []);
    const calBackdrop = document.getElementById('calendarModalBackdrop');
    if (calBackdrop && !calBackdrop.classList.contains('hidden')) {
      renderCalendarModal();
    }
  });

  runtime.on('taskStart', (data) => {
    const actTask = data && data.activeTask ? data.activeTask : runtime.getActiveTask();
    analytics.startTaskMetric(actTask, { index: runtime.activeTaskIndex });
    startContinuousWheelAnimation();
    updateActiveTaskDisplay();
    updateFinishEarlyButtonText(data.totalDurationSeconds);
    renderTaskList(((runtime.currentSchedule && runtime.currentSchedule.tasks) || []) || []);
    if (calendarView && typeof calendarView.render === 'function' && calendarView.isOpen && calendarView.isOpen()) {
      calendarView.render();
    }
    if (typeof checkActiveTaskTimerConflict === 'function') {
      checkActiveTaskTimerConflict(actTask);
    }
  });

  runtime.on('taskSkipped', (data) => {
    analytics.finalizeTaskMetric('skipped', runtime.getElapsedSeconds ? runtime.getElapsedSeconds() : 0);
    updateActiveTaskDisplay();
    const activeTask = runtime.getActiveTask();
    const durSec = runtime.status === TimerStatus.IDLE
      ? ((activeTask ? activeTask.allocatedDuration : 0) || (activeTask ? activeTask.plannedDuration : 0) || 25) * 60
      : runtime.getRemainingSeconds();
    renderClockTime(durSec);
    updateWheelProgress(runtime.getProgress());
    updateFinishEarlyButtonText(durSec);
    renderTaskList(((runtime.currentSchedule && runtime.currentSchedule.tasks) || []) || []);
    if (calendarView && typeof calendarView.render === 'function' && calendarView.isOpen && calendarView.isOpen()) {
      calendarView.render();
    }
  });

  runtime.on('taskComplete', (data) => {
    const isEarly = data && Boolean(data.completedEarly);
    const statusStr = isEarly ? 'completed_early' : (runtime.isOverrunning ? 'overrun' : 'completed');
    analytics.finalizeTaskMetric(statusStr, runtime.getElapsedSeconds ? runtime.getElapsedSeconds() : 0);
    stopContinuousWheelAnimation();
    audioManager.playTaskCompleteChime();
    mobileServices.hapticCelebration();
    const nextTask = ((runtime.currentSchedule && runtime.currentSchedule.tasks) || [])[runtime.activeTaskIndex + 1] || null;
    mobileServices.notifyTaskComplete({
      completedTask: data.task,
      nextTask
    });

    if (data && data.task && data.task.id) {
      const todayStr = (typeof taskStore !== 'undefined' && typeof taskStore.getTodayDateString === 'function')
        ? taskStore.getTodayDateString()
        : new Date().toISOString().split('T')[0];
      data.task.isCompleted = true;
      data.task.completedDate = todayStr;
      if (typeof taskStore !== 'undefined' && typeof taskStore.updateTask === 'function') {
        taskStore.updateTask(data.task.id, {
          isCompleted: true,
          completedDate: todayStr
        });
      }
      // Preserve in calendar events history permanently
      if (typeof taskStore !== 'undefined' && typeof taskStore.updateCalendarEvent === 'function') {
        taskStore.updateCalendarEvent(data.task.id, {
          isCompleted: true,
          completedDate: todayStr
        });
      }
      // If multi-session child block, roll tracked minutes into master task
      if (data.task.masterTaskId && typeof taskStore !== 'undefined') {
        const match = taskStore.findTaskAnywhere(data.task.masterTaskId);
        if (match && match.task) {
          const master = match.task;
          const sessionMin = Math.round(data.task.allocatedDuration || data.task.plannedDuration || 0);
          const currentMins = master.completedMinutes || 0;
          const newMins = currentMins + sessionMin;
          const masterUpdates = { completedMinutes: newMins };

          // Check if all sessions for this master task are now complete
          const allSessions = taskStore.getTasks().filter(t => t.masterTaskId === master.id || t.id === master.id);
          const allDone = allSessions.every(s => (s.id === data.task.id ? true : s.isCompleted));
          if (allDone && (master.sessionCount && allSessions.length >= master.sessionCount)) {
            masterUpdates.isCompleted = true;
            masterUpdates.completedDate = todayStr;
          }

          if (match.source === 'todo') {
            taskStore.updateTodoTask(master.id, masterUpdates);
          } else {
            taskStore.updateTask(master.id, masterUpdates);
          }
        }
      }
    }
    updateTotalMinutesDisplay();
    updateActiveTaskDisplay();
    renderTaskList(((runtime.currentSchedule && runtime.currentSchedule.tasks) || []) || []);
    if (calendarView && typeof calendarView.render === 'function' && calendarView.isOpen && calendarView.isOpen()) {
      calendarView.render();
    }
  });

  runtime.on('allTasksCompleted', () => {
    stopContinuousWheelAnimation();
    mobileServices.disableWakeLock();
    mobileServices.clearLiveNotification();
    updateTotalMinutesDisplay();
    updateActiveTaskDisplay();
    if (typeof updateTimespansButtonUI === 'function') updateTimespansButtonUI();
    updateResetButtonUI();
    renderTaskList(((runtime.currentSchedule && runtime.currentSchedule.tasks) || []) || []);
    if (calendarView && typeof calendarView.render === 'function' && calendarView.isOpen && calendarView.isOpen()) {
      calendarView.render();
    }
  });

  runtime.on('loopRestarted', (data) => {
    updateActiveTaskDisplay();
    updateTotalMinutesDisplay();
    renderTaskList(((runtime.currentSchedule && runtime.currentSchedule.tasks) || []) || []);
    if (calendarView && typeof calendarView.render === 'function' && calendarView.isOpen && calendarView.isOpen()) {
      calendarView.render();
    }
    audioManager.playChime();
    mobileServices.hapticTap();
    showToastNotification('🔁 Simple Mode schedule looped to start');
  });

  runtime.on('scheduleUpdate', (schedule) => {
    updateScheduleUI(schedule);
  });

  runtime.on('taskAdjusted', (data) => {
    if (data && typeof data.deltaMinutes === 'number') {
      analytics.recordTaskAdjustment(data.deltaMinutes);
    }
    const durSec = data.newRemainingSeconds !== undefined
      ? data.newRemainingSeconds
      : (data.targetMinutes || 25) * 60;
    updateFinishEarlyButtonText(durSec);
    renderClockTime(durSec);
  });

  runtime.on('seek', (data) => {
    updateFinishEarlyButtonText(data.remainingSeconds);
  });

  runtime.on('statusChange', (status) => {
    if (status === TimerStatus.RUNNING) {
      analytics.recordTaskPause(false);
      startContinuousWheelAnimation();
      iconPlay.classList.add('hidden');
      iconPause.classList.remove('hidden');
      mobileServices.enableWakeLock();
      const activeTask = runtime.getActiveTask();
      const nextTask = ((runtime.currentSchedule && runtime.currentSchedule.tasks) || [])[runtime.activeTaskIndex + 1] || null;
      mobileServices.updateLiveNotification({
        activeTask,
        remainingSeconds: runtime.getRemainingSeconds(),
        nextTask,
        isPaused: false
      });
    } else if (status === TimerStatus.PAUSED) {
      analytics.recordTaskPause(true);
      stopContinuousWheelAnimation();
      iconPlay.classList.remove('hidden');
      iconPause.classList.add('hidden');
      mobileServices.disableWakeLock();
      const activeTask = runtime.getActiveTask();
      const nextTask = ((runtime.currentSchedule && runtime.currentSchedule.tasks) || [])[runtime.activeTaskIndex + 1] || null;
      mobileServices.updateLiveNotification({
        activeTask,
        remainingSeconds: runtime.getRemainingSeconds(),
        nextTask,
        isPaused: true
      });
    } else {
      stopContinuousWheelAnimation();
      iconPlay.classList.remove('hidden');
      iconPause.classList.add('hidden');
      mobileServices.disableWakeLock();
      mobileServices.clearLiveNotification();
    }
    updateResetButtonUI();
    renderTaskList(((runtime.currentSchedule && runtime.currentSchedule.tasks) || []) || []);
    if (calendarView && typeof calendarView.render === 'function' && calendarView.isOpen && calendarView.isOpen()) {
      calendarView.render();
    }
  });

  runtime.on('error', (err) => {
    if (err.code === 'LOCKED_TASKS_EXCEED_TIME') {
      if (warningAlertCard) warningAlertCard.classList.remove('hidden');
      if (warningDesc) warningDesc.textContent = err.message;
      if (statusBanner) statusBanner.classList.add('compressed');
      if (statusText) statusText.textContent = 'Locked tasks exceed Hard Stop!';
    } else {
      if (statusText) statusText.textContent = err.message;
    }
  });
}

function updateFinishEarlyButtonText(remainingSeconds) {
  if (!finishEarlyText) return;
  const sec = Math.max(0, Math.round(remainingSeconds || 0));
  if (sec > 0 && sec < 60) {
    finishEarlyText.textContent = `Finish Early & Send ${sec}s To Time Bank`;
  } else {
    const mins = Math.floor(sec / 60);
    finishEarlyText.textContent = `Finish Early & Send ${mins}m To Time Bank`;
  }
}

// 60fps/120fps continuous wheel & bead animation loop
let continuousAnimFrameId = null;

function startContinuousWheelAnimation() {
  if (continuousAnimFrameId) return;

  function step() {
    if (runtime && runtime.status === TimerStatus.RUNNING) {
      if (!isScrubbingGreenLine) {
        if (runtime.isOverrunning) {
          const overrunElapsedSec = (Date.now() - runtime.overrunStartTime) / 1000;
          const totalBankSec = runtime.initialOverrunBankSeconds || 1;
          const progress = Math.min(1, Math.max(0, overrunElapsedSec / totalBankSec));
          updateWheelProgress(progress);
        } else if (isDraggingOuterDial || pendingMinuteAdjustment !== 0) {
          const currentRemaining = runtime.getRemainingSeconds();
          const adjustedSeconds = Math.max(1, currentRemaining + pendingMinuteAdjustment * 60);
          const elapsedSec = runtime.getElapsedSeconds();
          const totalSec = elapsedSec + adjustedSeconds;
          const progress = totalSec > 0 ? Math.min(1, Math.max(0, elapsedSec / totalSec)) : 0;
          updateWheelProgress(progress);
        } else {
          const progress = runtime.getProgress();
          updateWheelProgress(progress);
        }
      }
      continuousAnimFrameId = requestAnimationFrame(step);
    } else {
      continuousAnimFrameId = null;
    }
  }

  continuousAnimFrameId = requestAnimationFrame(step);
}

function stopContinuousWheelAnimation() {
  if (continuousAnimFrameId) {
    cancelAnimationFrame(continuousAnimFrameId);
    continuousAnimFrameId = null;
  }
}

function renderClockTime(secondsLeft) {
  const mins = Math.floor(secondsLeft / 60);
  const secs = secondsLeft % 60;
  digitalClock.textContent = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function updateWheelProgress(progressRatio) {
  const clamped = Math.min(1, Math.max(0, progressRatio));

  // 1. Progress arc sweeps clockwise from top (12 o'clock)
  const offset = CIRCUMFERENCE * (1 - clamped);
  trackProgress.style.strokeDashoffset = offset;

  // 2. Revolving Circle: starts at TOP (12 o'clock, 0 deg) and rotates clockwise 360 deg
  const angleDeg = clamped * 360;
  const angleRad = (angleDeg - 90) * (Math.PI / 180);
  const cx = 160 + CIRCLE_RADIUS * Math.cos(angleRad);
  const cy = 160 + CIRCLE_RADIUS * Math.sin(angleRad);

  if (revolvingCircle) {
    revolvingCircle.setAttribute('cx', cx);
    revolvingCircle.setAttribute('cy', cy);
  }
  if (revolvingGlow) {
    revolvingGlow.setAttribute('cx', cx);
    revolvingGlow.setAttribute('cy', cy);
  }
  if (revolvingHitbox) {
    revolvingHitbox.setAttribute('cx', cx);
    revolvingHitbox.setAttribute('cy', cy);
  }
}

function updateActiveTaskTimeSpanDynamic(remainingSec) {
  if (!activeTaskTimeSpan) return;
  const activeTask = (runtime ? runtime.getActiveTask() : null);
  const totalDurEl = document.getElementById('activeTaskTotalDuration');

  const isSimple = (typeof taskStore !== 'undefined' && typeof taskStore.getAppMode === 'function')
    ? taskStore.getAppMode() === 'simple'
    : false;

  const isTimespans = !isSimple && ((typeof taskStore !== 'undefined' && typeof taskStore.getTimespansEnabled === 'function')
    ? taskStore.getTimespansEnabled()
    : true);

  const showTimeSpansSequential = (typeof taskStore !== 'undefined' && typeof taskStore.getShowTimeSpansInSequential === 'function')
    ? taskStore.getShowTimeSpansInSequential()
    : false;

  const isRunning = runtime && runtime.status === TimerStatus.RUNNING;
  const isPaused = runtime && runtime.status === TimerStatus.PAUSED;
  const isIdle = !runtime || runtime.status === TimerStatus.IDLE || !runtime.taskStartedAt;

  // When turning or scrubbing the rotary dial, dynamically preview the finish time
  const isDialPreviewActive = Boolean(isDraggingOuterDial || pendingMinuteAdjustment !== 0 || isScrubbingGreenLine);
  if (isDialPreviewActive) {
    const fallbackPreviewSec = (isDraggingOuterDial || pendingMinuteAdjustment !== 0)
      ? Math.max(60, ((isIdle ? baseDialSeconds : (runtime ? runtime.getRemainingSeconds() : 1800)) || 1800) + pendingMinuteAdjustment * 60)
      : (runtime ? runtime.getRemainingSeconds() : 1800);
    const activePreviewSec = (remainingSec !== undefined) ? remainingSec : fallbackPreviewSec;
    const previewMin = Math.max(1, Math.round(activePreviewSec / 60));
    const now = new Date();
    const nowMin = (now.getHours() * 60) + now.getMinutes();
    const startMin = (isRunning || isPaused)
      ? (runtime && runtime.taskStartedAt ? parseTimeToMinutes(new Date(runtime.taskStartedAt)) : nowMin)
      : nowMin;
    const endMin = (nowMin + previewMin) % 1440;
    const startStr = formatMinutesToTime(startMin);
    const endStr = formatMinutesToTime(endMin);

    if (isTimespans) {
      activeTaskTimeSpan.textContent = `${startStr} → ${endStr}`;
      if (totalDurEl) {
        totalDurEl.textContent = `(${previewMin}m)`;
        totalDurEl.style.display = '';
      }
    } else {
      activeTaskTimeSpan.textContent = `${previewMin}m`;
      if (totalDurEl) {
        if (showTimeSpansSequential) {
          totalDurEl.textContent = `(${startStr} → ${endStr})`;
          totalDurEl.style.display = '';
        } else {
          totalDurEl.textContent = '';
          totalDurEl.style.display = 'none';
        }
      }
    }
    return;
  }

  if (!activeTask || (runtime && runtime.status === TimerStatus.COMPLETED)) {
    // Idle/No task state: Live digital clock start time, end time = now + 30m
    const d = new Date();
    const startMinutes = d.getHours() * 60 + d.getMinutes();
    const endMinutes = (startMinutes + 30) % 1440;
    const startStr = formatMinutesToTime(startMinutes);
    const endStr = formatMinutesToTime(endMinutes);
    if (isTimespans) {
      activeTaskTimeSpan.textContent = `${startStr} → ${endStr}`;
      if (totalDurEl) {
        totalDurEl.textContent = '(30m)';
        totalDurEl.style.display = '';
      }
    } else {
      activeTaskTimeSpan.textContent = '30m';
      if (totalDurEl) {
        if (showTimeSpansSequential) {
          totalDurEl.textContent = `(${startStr} → ${endStr})`;
          totalDurEl.style.display = '';
        } else {
          totalDurEl.textContent = '';
          totalDurEl.style.display = 'none';
        }
      }
    }
    return;
  }

  if (isTimespans) {
    // Chronological Mode
    const origTask = (runtime && runtime.initialTasks && activeTask)
      ? runtime.initialTasks.find(t => t.id === activeTask.id)
      : null;
    const isDialAdjusted = Boolean((activeTask && activeTask.dialAdjusted) || (origTask && origTask.dialAdjusted));
    const isLockedTask = Boolean(activeTask.isLocked);
    const hasDefinedEndTime = Boolean(activeTask.fixedEndTime) && !isDialAdjusted;

    if (isLockedTask && activeTask.startTime && activeTask.endTime) {
      const sMin = parseTimeToMinutes(activeTask.startTime);
      let eMin = parseTimeToMinutes(activeTask.endTime);
      if (eMin <= sMin) eMin += 1440;
      const now = new Date();
      const nowMin = (now.getHours() * 60) + now.getMinutes();

      if ((isRunning || isPaused) && nowMin > sMin && nowMin < eMin) {
        const startMinutesVal = runtime.taskStartedAt ? parseTimeToMinutes(new Date(runtime.taskStartedAt)) : nowMin;
        const remDurMin = Math.max(1, eMin - startMinutesVal);
        activeTaskTimeSpan.textContent = `${formatMinutesToTime(startMinutesVal)} → ${activeTask.endTime}`;
        if (totalDurEl) totalDurEl.textContent = `(${remDurMin}m)`;
        return;
      } else {
        const fullDur = activeTask.allocatedDuration || activeTask.plannedDuration || (eMin - sMin);
        activeTaskTimeSpan.textContent = `${activeTask.startTime} → ${activeTask.endTime}`;
        if (totalDurEl) totalDurEl.textContent = `(${fullDur}m)`;
        return;
      }
    }

    // Padlock NOT enabled in Chronological mode, but explicit fixed end time has been defined
    if (!isLockedTask && hasDefinedEndTime) {
      const now = new Date();
      const nowMin = (now.getHours() * 60) + now.getMinutes();
      const startStr = formatMinutesToTime(nowMin);
      const endStr = activeTask.fixedEndTime;
      const endMin = parseTimeToMinutes(endStr);
      let diffMin = endMin - nowMin;
      if (diffMin <= 0 && endMin < 360) diffMin += 1440;
      const dynDurMin = Math.max(1, diffMin);

      if (isIdle) {
        activeTaskTimeSpan.textContent = `${startStr} → ${endStr}`;
        if (totalDurEl) totalDurEl.textContent = `(${dynDurMin}m)`;
        if (remainingSec === undefined) {
          renderClockTime(dynDurMin * 60);
        }
      } else {
        const taskStartMin = runtime.taskStartedAt ? parseTimeToMinutes(new Date(runtime.taskStartedAt)) : nowMin;
        const runningStartStr = formatMinutesToTime(taskStartMin);
        const remSec = (remainingSec !== undefined) ? remainingSec : runtime.getRemainingSeconds();
        const remMin = Math.max(1, Math.round(remSec / 60));
        activeTaskTimeSpan.textContent = `${runningStartStr} → ${endStr}`;
        if (totalDurEl) totalDurEl.textContent = `(${remMin}m)`;
      }
      return;
    }

    // Padlock NOT enabled and end time hasn't been defined:
    // The defined duration is preserved without shrinking.
    // The end time span is free to change dynamically as time moves!
    const taskDur = (isIdle && runtime && runtime.taskDurationMs > 0)
      ? Math.max(1, Math.round(runtime.getRemainingSeconds() / 60))
      : (activeTask.allocatedDuration || activeTask.plannedDuration || 30);
    const now = new Date();
    const nowMin = (now.getHours() * 60) + now.getMinutes();

    if (isIdle) {
      const startMin = nowMin;
      const endMin = (startMin + taskDur) % 1440;
      const startStr = formatMinutesToTime(startMin);
      const endStr = formatMinutesToTime(endMin);

      activeTaskTimeSpan.textContent = `${startStr} → ${endStr}`;
      if (totalDurEl) totalDurEl.textContent = `(${taskDur}m)`;
      if (remainingSec === undefined) {
        const clockSec = (runtime && runtime.taskDurationMs > 0) ? runtime.getRemainingSeconds() : (taskDur * 60);
        renderClockTime(clockSec);
      }
    } else {
      const taskStartMin = runtime.taskStartedAt ? parseTimeToMinutes(new Date(runtime.taskStartedAt)) : nowMin;
      const runningStartStr = formatMinutesToTime(taskStartMin);
      const remSec = (remainingSec !== undefined) ? remainingSec : runtime.getRemainingSeconds();
      const remMin = Math.max(1, Math.round(remSec / 60));

      let endMin;
      if (runtime && runtime.isOverrunning) {
        // Overrun support: shifts dynamically to current time + overrun
        endMin = (nowMin + remMin) % 1440;
      } else if (isPaused) {
        endMin = (nowMin + remMin) % 1440;
      } else {
        const anchorMin = runtime.lastResumeTimestamp ? parseTimeToMinutes(new Date(runtime.lastResumeTimestamp)) : taskStartMin;
        const remFromAnchorMs = runtime.taskDurationMs > 0
          ? Math.max(0, runtime.taskDurationMs - (runtime.accumulatedElapsedMs || 0))
          : (remMin * 60000);
        const remFromAnchorMin = Math.max(1, Math.round(remFromAnchorMs / 60000));
        endMin = (anchorMin + remFromAnchorMin) % 1440;
      }
      const endStr = formatMinutesToTime(endMin);

      activeTaskTimeSpan.textContent = `${runningStartStr} → ${endStr}`;
      if (totalDurEl) totalDurEl.textContent = `(${remMin}m)`;
    }
  } else {
    // Sequential Mode: duration first, dynamic timespan in brackets
    let totalMinutes;
    if (isIdle) {
      if (remainingSec !== undefined) {
        totalMinutes = Math.max(1, Math.round(remainingSec / 60));
      } else if (runtime && runtime.taskDurationMs > 0) {
        totalMinutes = Math.max(1, Math.round(runtime.taskDurationMs / 60000));
      } else {
        totalMinutes = Math.max(1, (activeTask.allocatedDuration || activeTask.plannedDuration || 30));
      }
    } else {
      const elapsedSec = (runtime.getElapsedSeconds && typeof runtime.getElapsedSeconds === 'function')
        ? runtime.getElapsedSeconds()
        : 0;
      const rem = (remainingSec !== undefined) ? remainingSec : runtime.getRemainingSeconds();
      const totalSec = Math.max(60, elapsedSec + rem);
      totalMinutes = Math.max(1, Math.round(totalSec / 60));
    }

    const now = new Date();
    let startMinutes;
    if (!isIdle && runtime.taskStartedAt) {
      const d = new Date(runtime.taskStartedAt);
      startMinutes = d.getHours() * 60 + d.getMinutes();
    } else {
      startMinutes = now.getHours() * 60 + now.getMinutes();
    }

    const endMinutes = (startMinutes + totalMinutes) % 1440;
    const startStr = formatMinutesToTime(startMinutes);
    const endStr = formatMinutesToTime(endMinutes);

    activeTaskTimeSpan.textContent = `${totalMinutes}m`;
    if (totalDurEl) {
      if (showTimeSpansSequential) {
        totalDurEl.textContent = `(${startStr} → ${endStr})`;
        totalDurEl.style.display = '';
      } else {
        totalDurEl.textContent = '';
        totalDurEl.style.display = 'none';
      }
    }
  }
}

function updateTimerQuickToggles(isOverrunning = false) {
  const togglesContainer = document.getElementById('timerQuickToggles');
  const piggyBtn = document.getElementById('timerScreenPiggyBtn');
  const lockIcon = document.getElementById('timerScreenLockIcon');
  if (!togglesContainer || !piggyBtn || !lockIcon) return;

  const activeTask = runtime ? runtime.getActiveTask() : null;
  togglesContainer.classList.remove('hidden');

  const overrunning = Boolean(isOverrunning || (runtime && runtime.isOverrunning));
  const hasTimeBank = activeTask ? (activeTask.useTimeBank !== false) : true;

  piggyBtn.innerHTML = getPiggyBankSvg(overrunning);
  piggyBtn.classList.toggle('cracked', overrunning);
  piggyBtn.classList.toggle('active', !overrunning && hasTimeBank);
  if (overrunning) {
    piggyBtn.title = 'Overrunning into Time Bank';
  } else if (hasTimeBank) {
    piggyBtn.title = 'Time Bank enabled: taps into saved surplus time if overdue (tap to disable)';
  } else {
    piggyBtn.title = 'Time Bank disabled (tap to enable)';
  }

  const isLocked = activeTask ? Boolean(activeTask.isLocked) : false;
  lockIcon.classList.remove('hidden');
  lockIcon.classList.toggle('locked', isLocked);
  lockIcon.classList.toggle('unlocked', !isLocked);
  if (isLocked) {
    lockIcon.title = 'Duration is locked (tap to unlock)';
    lockIcon.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
        <path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z"/>
      </svg>
    `;
  } else {
    lockIcon.title = 'Duration is unlocked (tap to lock)';
    lockIcon.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 17c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm6-9h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6h1.9c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm0 12H6V10h12v10z"/>
      </svg>
    `;
  }
}

function updateActiveTaskDisplay() {
  const activeTask = runtime.getActiveTask();
  const sessionPill = document.getElementById('activeSessionProgressPill');

  if (!activeTask || runtime.status === TimerStatus.COMPLETED) {
    if (sessionPill) sessionPill.classList.add('hidden');
    activeCategoryChip.textContent = 'TASK';
    activeTaskTitle.textContent = 'Add Task';
    activeTaskTitle.style.cursor = 'pointer';
    updateActiveTaskTimeSpanDynamic();
    updateTimerQuickToggles(false);
    if (wheelContainer) wheelContainer.classList.remove('is-break-mode');
    document.body.classList.remove('is-break-mode');
    renderClockTime(1800); // Default 30:00
    updateWheelProgress(0);
    return;
  }

  activeTaskTitle.style.cursor = 'default';
  const isBreak = Boolean(
    (activeTask.category && (activeTask.category.toLowerCase() === 'break' || activeTask.category.toLowerCase() === 'rest')) ||
    (activeTask.title && (activeTask.title.toLowerCase().indexOf('break') !== -1 || activeTask.title.toLowerCase().indexOf('rest') !== -1))
  );

  if (wheelContainer) wheelContainer.classList.toggle('is-break-mode', Boolean(isBreak));
  document.body.classList.toggle('is-break-mode', Boolean(isBreak));

  activeCategoryChip.textContent = (activeTask.category || 'Focus').toUpperCase();
  activeTaskTitle.textContent = activeTask.title;
  updateActiveTaskTimeSpanDynamic();
  updateTimerQuickToggles();

  if (sessionPill) {
    const isMulti = Boolean(activeTask.isMultiSession);
    const subtasks = (typeof taskStore !== 'undefined' && typeof taskStore.getSubtasks === 'function')
      ? taskStore.getSubtasks(activeTask.id)
      : (Array.isArray(activeTask.subtasks) ? activeTask.subtasks : []);
    const prog = (typeof taskStore !== 'undefined' && typeof taskStore.getTaskProgress === 'function')
      ? taskStore.getTaskProgress(activeTask)
      : { completed: 0, total: 0, percent: 0 };

    if (isMulti || subtasks.length > 0) {
      let text = '';
      if (isMulti) {
        const sIdx = typeof activeTask.sessionIndex === 'number' ? activeTask.sessionIndex : 1;
        const sTot = activeTask.sessionCount || 1;
        text = `Session ${sIdx} of ${sTot}`;
        if (prog.total > 0) {
          text += ` • Steps: ${prog.completed}/${prog.total}`;
        }
      } else {
        text = `Steps: ${prog.completed}/${prog.total}`;
      }
      sessionPill.textContent = text;
      sessionPill.classList.remove('hidden');
    } else {
      sessionPill.classList.add('hidden');
    }
  }
}

function updateScheduleUI(schedule) {
  if (!schedule || !schedule.success) return;

  if (warningAlertCard) warningAlertCard.classList.add('hidden');

  const isTimespans = (typeof taskStore !== 'undefined' && typeof taskStore.getTimespansEnabled === 'function')
    ? taskStore.getTimespansEnabled()
    : true;

  const todayFinishLine = document.getElementById('todayFinishLine');
  if (todayFinishLine) {
    todayFinishLine.style.display = 'block';
    const timeEl = document.getElementById('todayFinishLineTime');
    if (timeEl) {
      timeEl.textContent = (typeof taskStore !== 'undefined' && typeof taskStore.getHardStop === 'function')
        ? (taskStore.getHardStop() || '18:00')
        : '18:00';
    }
  }

  if (schedule.isCompressed) {
    if (statusBanner) statusBanner.classList.add('compressed');
    const pct = Math.round(schedule.compressionRatio * 100);
    if (statusText) statusText.textContent = `⚡ Compressed to ${pct}% to meet Hard Stop`;
  } else {
    if (statusBanner) statusBanner.classList.remove('compressed');
    if (statusText) statusText.textContent = `✓ On track · ${schedule.bufferMinutes}m buffer before Hard Stop`;
  }

  renderTaskList(schedule.tasks || []);
}

// ==========================================
// Dual Interactive Wheel Controls:
// 1. Moving Green Line Bead = 1-second precision scrubbing back & forth (360 deg = 1 minute)
// 2. Outer Tick Dial = Adds / takes away total task time in minutes with live timer preview
// ==========================================
function setupRotaryWheel() {
  function getAngleFromEvent(e) {
    const rect = ((rotarySvg || wheelContainer) ? (rotarySvg || wheelContainer).getBoundingClientRect() : null) || { left: 0, top: 0, width: 320, height: 320 };
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;

    const clientX = e.touches && e.touches.length > 0 ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches && e.touches.length > 0 ? e.touches[0].clientY : e.clientY;

    return Math.atan2(clientY - centerY, clientX - centerX);
  }

  // Updates green circle & progress track immediately to a given angle with ZERO LAG
  function updateCircleToAngle(angleRad) {
    const cx = 160 + CIRCLE_RADIUS * Math.cos(angleRad);
    const cy = 160 + CIRCLE_RADIUS * Math.sin(angleRad);

    if (revolvingCircle) {
      revolvingCircle.setAttribute('cx', cx);
      revolvingCircle.setAttribute('cy', cy);
    }
    if (revolvingGlow) {
      revolvingGlow.setAttribute('cx', cx);
      revolvingGlow.setAttribute('cy', cy);
    }
    if (revolvingHitbox) {
      revolvingHitbox.setAttribute('cx', cx);
      revolvingHitbox.setAttribute('cy', cy);
    }

    // Arc sweeps clockwise from top (12 o'clock, -90 deg) to cursor angle
    let clockDeg = (angleRad * (180 / Math.PI) + 90) % 360;
    if (clockDeg < 0) clockDeg += 360;

    const offset = CIRCUMFERENCE * (1 - (clockDeg / 360));
    if (trackProgress) {
      trackProgress.style.strokeDashoffset = offset;
    }
  }

  let lastScrubbedSecond = -1;

  // Green line scrubbing state (countdown reduction scrubber)
  let scrubStartAngleRad = 0;
  let baseRemainingSecAtScrubStart = 0;
  let initialBeadDegAtStart = 0;
  let currentBeadDeg = 0;
  let activeTotalSec = 0;

  // Outer dial state
  let dialStartAngleRad = 0;
  let accumulatedDialAngleDeltaDeg = 0;
  baseDialSeconds = 0;

  // -------------------------------------------------------------
  // Mode 1: Scrub Green Line Handle (Countdown reduction scrubber)
  // 360 degrees around center = timer counts down to 0!
  // Strictly used to reduce time. Dragging to a location leaves it in that position.
  // -------------------------------------------------------------
  function onScrubStart(e) {
    if (isNavSwiping) return;
    const activeTask = runtime ? runtime.getActiveTask() : null;
    if (!activeTask || (runtime && runtime.status === TimerStatus.COMPLETED)) {
      if (e && e.type === 'mousedown') {
        mobileServices.hapticWarning();
        showToastNotification('Please create a task first before adjusting the timer.');
      }
      return;
    }
    if (activeTask && activeTask.isLocked) {
      if (e && e.type === 'mousedown') {
        mobileServices.hapticWarning();
        showToastNotification('Task duration is locked. Tap the padlock on the timer to unlock and adjust time.');
      }
      return;
    }

    isScrubbingGreenLine = true;
    document.body.classList.add('is-scrubbing');

    scrubStartAngleRad = getAngleFromEvent(e);

    activeTotalSec = runtime.taskDurationMs > 0
      ? Math.round(runtime.taskDurationMs / 1000)
      : (((activeTask ? activeTask.allocatedDuration : 0) || (activeTask ? activeTask.plannedDuration : 0) || 30) * 60);
    baseRemainingSecAtScrubStart = runtime.getRemainingSeconds();

    // The starting angular position of the bead corresponds to current elapsed progress
    const currentProgress = activeTotalSec > 0
      ? Math.max(0, Math.min(1, (activeTotalSec - baseRemainingSecAtScrubStart) / activeTotalSec))
      : 0;
    initialBeadDegAtStart = currentProgress * 360;
    currentBeadDeg = initialBeadDegAtStart;
    lastScrubbedSecond = baseRemainingSecAtScrubStart;

    // Instantly orient to angle
    const angleRad = (currentBeadDeg - 90) * (Math.PI / 180);
    updateCircleToAngle(angleRad);
  }

  function handleScrubMove(e) {
    if (!isScrubbingGreenLine || isNavSwiping) return;

    const currentAngleRad = getAngleFromEvent(e);
    let delta = (currentAngleRad - scrubStartAngleRad) * (180 / Math.PI);

    // Normalize angular step across -180 / +180
    if (delta > 180) delta -= 360;
    if (delta < -180) delta += 360;

    scrubStartAngleRad = currentAngleRad;

    // Green dot can move clockwise towards 360 deg (0 seconds) to reduce time,
    // or be held and dragged counter-clockwise towards 0 deg to add seconds back smoothly!
    currentBeadDeg = Math.min(360, Math.max(0, currentBeadDeg + delta));

    // Progress ratio from 0 to 1 across 360 degrees
    const progressRatio = currentBeadDeg / 360;
    const targetRemainingSec = Math.max(0, Math.min(activeTotalSec, Math.round(activeTotalSec * (1 - progressRatio))));

    // Instantly update visual bead position and track arc
    const angleRad = (currentBeadDeg - 90) * (Math.PI / 180);
    updateCircleToAngle(angleRad);

    // Live update digital clock as you drag
    renderClockTime(targetRemainingSec);
    updateActiveTaskTimeSpanDynamic(targetRemainingSec);

    if (targetRemainingSec !== lastScrubbedSecond) {
      lastScrubbedSecond = targetRemainingSec;
      audioManager.playRotaryTick();
      mobileServices.hapticTick();
    }
  }

  function onScrubEnd() {
    if (!isScrubbingGreenLine) return;
    isScrubbingGreenLine = false;
    document.body.classList.remove('is-scrubbing');

    if (lastScrubbedSecond >= 0) {
      runtime.seek(lastScrubbedSecond);
    }
    const finalRatio = activeTotalSec > 0 ? (activeTotalSec - (lastScrubbedSecond >= 0 ? lastScrubbedSecond : 0)) / activeTotalSec : 0;
    updateWheelProgress(Math.min(1, Math.max(0, finalRatio)));
    updateActiveTaskTimeSpanDynamic(lastScrubbedSecond >= 0 ? lastScrubbedSecond : runtime.getRemainingSeconds());

    syncDynamicScheduleTimesToCalendar();
    updateScheduleUI(runtime.currentSchedule);
    renderTaskList(((runtime.currentSchedule && runtime.currentSchedule.tasks) || []) || []);
    renderCalendarModal();
    if (calendarView && typeof calendarView.render === 'function' && typeof calendarView.isOpen === 'function' && calendarView.isOpen()) {
      calendarView.render();
    }
    dismissedOverlapPairs.clear();
    checkAndPromptScheduleConflict((runtime.currentSchedule && runtime.currentSchedule.tasks) || taskStore.getTasks());

    if (runtime.status === TimerStatus.RUNNING) {
      startContinuousWheelAnimation();
    }
  }

  // Bind scrub listeners to green line handle and track
  if (revolvingCircleGroup) {
    revolvingCircleGroup.addEventListener('mousedown', onScrubStart);
    revolvingCircleGroup.addEventListener('touchstart', onScrubStart, { passive: false });
  }
  if (trackProgress) {
    trackProgress.addEventListener('mousedown', onScrubStart);
    trackProgress.addEventListener('touchstart', onScrubStart, { passive: false });
  }

  // -------------------------------------------------------------
  // Mode 2: Outer Tick Dial (Add / Subtract task minutes)
  // Adjusts the timer live so you can see what the next time would be if applied!
  // -------------------------------------------------------------
  function onDialStart(e) {
    if (isScrubbingGreenLine || isNavSwiping) return;
    if (rotaryConfirmPill && !rotaryConfirmPill.classList.contains('hidden')) return;

    const activeTask = runtime ? runtime.getActiveTask() : null;
    if (!activeTask || (runtime && runtime.status === TimerStatus.COMPLETED)) {
      if (e && e.type === 'mousedown') {
        mobileServices.hapticWarning();
        showToastNotification('Please create a task first before adjusting the timer.');
      }
      return;
    }
    if (activeTask && activeTask.isLocked) {
      if (e && e.type === 'mousedown') {
        mobileServices.hapticWarning();
        showToastNotification('Task duration is locked. Tap the padlock on the timer to unlock and adjust time.');
      }
      return;
    }

    isDraggingOuterDial = true;
    document.body.classList.add('is-dragging-dial');
    dialStartAngleRad = getAngleFromEvent(e);
    accumulatedDialAngleDeltaDeg = 0;
    pendingMinuteAdjustment = 0;
    lastAudibleMinuteTick = 0;

    baseDialSeconds = runtime.getRemainingSeconds()
      || (((runtime && runtime.getActiveTask()) ? (runtime.getActiveTask().allocatedDuration || runtime.getActiveTask().plannedDuration) : 0) || 30) * 60;

    rotaryPreviewBadge.classList.remove('hidden');
    rotaryPreviewBadge.textContent = '+0m';
  }

  function handleDialMove(e) {
    if (!isDraggingOuterDial || isNavSwiping) return;

    const currentAngleRad = getAngleFromEvent(e);
    let diff = (currentAngleRad - dialStartAngleRad) * (180 / Math.PI);

    if (diff > 180) diff -= 360;
    if (diff < -180) diff += 360;

    dialStartAngleRad = currentAngleRad;
    accumulatedDialAngleDeltaDeg += diff;
    currentDialRotationDeg += diff;

    if (Math.abs(accumulatedDialAngleDeltaDeg) > 4) {
      navTouchStartX = null;
      navTouchStartY = null;
    }

    // Physically rotate outer bezel dial
    if (rotaryDialGroup) {
      rotaryDialGroup.setAttribute('transform', `rotate(${currentDialRotationDeg} 160 160)`);
    }

    // 6 degrees of rotation = 1 minute
    const minutesDelta = Math.round(accumulatedDialAngleDeltaDeg / 6);

    if (minutesDelta !== pendingMinuteAdjustment) {
      pendingMinuteAdjustment = minutesDelta;

      if (Math.abs(pendingMinuteAdjustment - lastAudibleMinuteTick) >= 1) {
        audioManager.playRotaryTick();
        mobileServices.hapticTick();
        lastAudibleMinuteTick = pendingMinuteAdjustment;
        analytics.trackInteraction('dial_rotate', 'timer_dial', { deltaMinutes: pendingMinuteAdjustment });
      }

      const sign = pendingMinuteAdjustment > 0 ? '+' : '';
      rotaryPreviewBadge.textContent = `${sign}${pendingMinuteAdjustment}m`;

      // LIVE TIMER ADJUSTMENT: User sees what the next time would be if applied!
      const currentRemaining = runtime.status === TimerStatus.IDLE
        ? baseDialSeconds
        : runtime.getRemainingSeconds();
      const previewSeconds = Math.max(60, currentRemaining + pendingMinuteAdjustment * 60);
      renderClockTime(previewSeconds);
      updateActiveTaskTimeSpanDynamic(previewSeconds);

      // Dynamically calculate the angle required to complete the task and update green circle & arc!
      let previewProgress = 0;
      if (runtime.status === TimerStatus.RUNNING || runtime.status === TimerStatus.PAUSED) {
        const elapsedSec = runtime.getElapsedSeconds();
        const totalSec = elapsedSec + previewSeconds;
        previewProgress = totalSec > 0 ? Math.min(1, Math.max(0, elapsedSec / totalSec)) : 0;
      } else {
        previewProgress = 0;
      }
      updateWheelProgress(previewProgress);
    }
  }

  function applyPendingDialAdjustment() {
    rotaryConfirmPill.classList.add('hidden');
    if (pendingMinuteAdjustment !== 0) {
      mobileServices.hapticTap();

      const appliedDeltaMinutes = pendingMinuteAdjustment;
      // Compute exact preview target seconds based on live remaining seconds
      const currentRemaining = runtime.status === TimerStatus.IDLE
        ? baseDialSeconds
        : runtime.getRemainingSeconds();
      const targetSeconds = Math.max(60, currentRemaining + appliedDeltaMinutes * 60);

      // Clear pendingMinuteAdjustment before store update so re-entrant UI updates see the committed state
      pendingMinuteAdjustment = 0;

      // Lock task to this exact target seconds so it preserves seconds and doesn't round to a whole minute!
      runtime.setActiveTaskTargetSeconds(targetSeconds, appliedDeltaMinutes);

      const activeTask = runtime.getActiveTask();
      if (activeTask) {
        const initTask = (runtime && runtime.initialTasks) ? runtime.initialTasks.find(t => t.id === activeTask.id) : null;
        const preserveLock = initTask ? Boolean(initTask.isLocked) : Boolean(activeTask.isLocked);
        activeTask.isLocked = preserveLock;
        activeTask.fixedEndTime = null;
        activeTask.dialAdjusted = true;
        taskStore.updateTask(activeTask.id, {
          plannedDuration: activeTask.plannedDuration,
          isLocked: preserveLock,
          fixedEndTime: null,
          fixedStartTime: preserveLock ? activeTask.fixedStartTime : null
        });
      }

      currentDialRotationDeg = 0;
      if (rotaryDialGroup) {
        rotaryDialGroup.setAttribute('transform', 'rotate(0 160 160)');
      }
      updateActiveTaskDisplay();
      const remainingSec = runtime.status === TimerStatus.IDLE
        ? targetSeconds
        : runtime.getRemainingSeconds();
      renderClockTime(remainingSec);
      updateActiveTaskTimeSpanDynamic(remainingSec);
      updateWheelProgress(runtime.getProgress());
      updateFinishEarlyButtonText(remainingSec);
      syncDynamicScheduleTimesToCalendar();
      updateScheduleUI(runtime.currentSchedule);
      renderTaskList(((runtime.currentSchedule && runtime.currentSchedule.tasks) || []) || []);
      renderCalendarModal();
      if (calendarView && typeof calendarView.render === 'function' && calendarView.isOpen()) {
        calendarView.render();
      }

      if (runtime.status === TimerStatus.RUNNING) {
        startContinuousWheelAnimation();
      }
    }
  }

  function onDialEnd() {
    if (!isDraggingOuterDial) return;
    isDraggingOuterDial = false;
    document.body.classList.remove('is-dragging-dial');
    rotaryPreviewBadge.classList.add('hidden');

    if (pendingMinuteAdjustment !== 0) {
      const needsConfirmation = taskStore.getConfirmAdjustments();

      if (needsConfirmation) {
        const currentRemaining = runtime.status === TimerStatus.IDLE
          ? baseDialSeconds
          : runtime.getRemainingSeconds();
        const previewSeconds = Math.max(60, currentRemaining + pendingMinuteAdjustment * 60);
        const sign = pendingMinuteAdjustment > 0 ? '+' : '';
        const previewMins = Math.floor(previewSeconds / 60);
        const previewSecs = previewSeconds % 60;
        const formattedTime = `${String(previewMins).padStart(2, '0')}:${String(previewSecs).padStart(2, '0')}`;

        rotaryConfirmText.textContent = `Apply ${formattedTime} (${sign}${pendingMinuteAdjustment}m)?`;
        rotaryConfirmPill.classList.remove('hidden');
        renderClockTime(previewSeconds);
      } else {
        // Auto-apply immediately without asking for confirmation (default)
        applyPendingDialAdjustment();
      }
    } else {
      currentDialRotationDeg = 0;
      if (rotaryDialGroup) {
        rotaryDialGroup.setAttribute('transform', 'rotate(0 160 160)');
      }
      const currentRemaining = runtime.status === TimerStatus.IDLE
        ? baseDialSeconds
        : runtime.getRemainingSeconds();
      renderClockTime(currentRemaining);
      updateActiveTaskTimeSpanDynamic(currentRemaining);
      if (runtime.status === TimerStatus.RUNNING) {
        startContinuousWheelAnimation();
      }
    }
  }

  // Bind to hit ring and dial group
  const dialTargets = [dialHitRing, rotaryDialGroup].filter(Boolean);
  dialTargets.forEach(target => {
    target.addEventListener('mousedown', onDialStart);
    target.addEventListener('touchstart', onDialStart, { passive: false });
  });

  // Global pointer move & up
  window.addEventListener('mousemove', (e) => {
    if (isScrubbingGreenLine) {
      handleScrubMove(e);
    } else if (isDraggingOuterDial) {
      handleDialMove(e);
    }
  });

  window.addEventListener('touchmove', (e) => {
    if (isScrubbingGreenLine) {
      handleScrubMove(e);
    } else if (isDraggingOuterDial) {
      handleDialMove(e);
    }
  }, { passive: false });

  window.addEventListener('mouseup', () => {
    if (isScrubbingGreenLine) onScrubEnd();
    if (isDraggingOuterDial) onDialEnd();
  });

  window.addEventListener('touchend', () => {
    if (isScrubbingGreenLine) onScrubEnd();
    if (isDraggingOuterDial) onDialEnd();
  });

  // Confirmation actions
  btnConfirmAdjust.addEventListener('click', () => {
    applyPendingDialAdjustment();
  });

  btnCancelAdjust.addEventListener('click', () => {
    mobileServices.hapticTap();
    rotaryConfirmPill.classList.add('hidden');
    pendingMinuteAdjustment = 0;
    currentDialRotationDeg = 0;
    if (rotaryDialGroup) {
      rotaryDialGroup.setAttribute('transform', 'rotate(0 160 160)');
    }
    // Revert clock display back to live remaining time!
    const currentRemaining = runtime.status === TimerStatus.IDLE
      ? baseDialSeconds
      : runtime.getRemainingSeconds();
    renderClockTime(currentRemaining);
    updateActiveTaskTimeSpanDynamic(currentRemaining);
    updateWheelProgress(runtime.getProgress());
    if (runtime.status === TimerStatus.RUNNING) {
      startContinuousWheelAnimation();
    }
  });
}

// ==========================================
// Control Buttons (Reset Day vs Exit / Play-Pause / Skip)
// ==========================================
function updateResetButtonUI() {
  const isRunning = runtime && runtime.status === TimerStatus.RUNNING;
  const stopTimeIcon = document.getElementById('stopTimeIcon');
  const stopTimeLabel = document.getElementById('stopTimeLabel');

  if (isRunning) {
    btnStopTime.classList.add('btn-exit-mode');
    btnStopTime.title = 'Stop current task and reset timer';
    if (stopTimeIcon) {
      stopTimeIcon.innerHTML = `
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
          <polyline points="16 17 21 12 16 7"/>
          <line x1="21" y1="12" x2="9" y2="12"/>
        </svg>
      `;
    }
    if (stopTimeLabel) stopTimeLabel.textContent = 'Exit';
  } else {
    btnStopTime.classList.remove('btn-exit-mode');
    btnStopTime.title = 'Reset all events for the day';
    if (stopTimeIcon) {
      stopTimeIcon.innerHTML = `
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/>
          <path d="M3 3v5h5"/>
        </svg>
      `;
    }
    if (stopTimeLabel) stopTimeLabel.textContent = 'Reset';
  }
}

function resetWholeDay() {
  analytics.recordSessionEvent('reset_day');
  analytics.trackInteraction('btn_click', 'resetWholeDay');
  stopContinuousWheelAnimation();
  mobileServices.disableWakeLock();
  mobileServices.clearLiveNotification();
  runtime.reset();
  runtime.activeTaskIndex = 0;
  // Reset clears Time Bank back to zero (strictly on reset, not on exit)
  taskStore.setTimeBankSeconds(0);
  updateTimeBankDisplay();
  const tasks = taskStore.getTasks().map(t => Object.assign({}, t, { isCompleted: false, completedDate: null }));
  taskStore.saveTasks(tasks);
  updateTotalMinutesDisplay();
  currentDialRotationDeg = 0;
  if (rotaryDialGroup) {
    rotaryDialGroup.setAttribute('transform', 'rotate(0 160 160)');
  }
  updateActiveTaskDisplay();
  const firstTask = runtime.getActiveTask();
  const durSec = firstTask ? ((firstTask.allocatedDuration || firstTask.plannedDuration || 30) * 60) : 1800;
  renderClockTime(durSec);
  updateWheelProgress(0);
  updateFinishEarlyButtonText(durSec);
  updateScheduleUI(runtime.currentSchedule);
  updateResetButtonUI();
  renderTaskList(((runtime.currentSchedule && runtime.currentSchedule.tasks) || []) || []);
}

function setupControls() {
  const alertsModalBackdrop = document.getElementById('alertsModalBackdrop');
  const alertsModalToggle = document.getElementById('alertsModalToggle');
  const alertsModalStatusLabel = document.getElementById('alertsModalStatusLabel');
  const btnCloseAlertsModal = document.getElementById('btnCloseAlertsModal');

  function openAlertsModal() {
    if (!alertsModalBackdrop) return;
    const isEnabled = taskStore.getAlertsEnabled();
    const hasPerm = mobileServices.hasNotificationPermission();
    if (alertsModalToggle) alertsModalToggle.checked = isEnabled;
    if (alertsModalStatusLabel) {
      if (isEnabled) {
        alertsModalStatusLabel.textContent = hasPerm ? 'Notifications Active' : 'In-App Alerts Active';
      } else {
        alertsModalStatusLabel.textContent = 'Notifications Muted';
      }
    }
    alertsModalBackdrop.classList.remove('hidden');
    mobileServices.hapticTap();
  }

  function closeAlertsModal() {
    if (alertsModalBackdrop) alertsModalBackdrop.classList.add("hidden");
  }

  if (btnNotifToggle) {
    btnNotifToggle.addEventListener('click', openAlertsModal);
  }

  if (btnCloseAlertsModal) btnCloseAlertsModal.addEventListener('click', closeAlertsModal);
  if (alertsModalBackdrop) {
    alertsModalBackdrop.addEventListener('click', (e) => {
      if (e.target === alertsModalBackdrop) closeAlertsModal();
    });
  }

  if (alertsModalToggle) {
    alertsModalToggle.addEventListener('change', async () => {
      mobileServices.hapticTap();
      if (alertsModalToggle.checked) {
        taskStore.setAlertsEnabled(true);
        if ('Notification' in window && Notification.permission === 'default') {
          await mobileServices.requestNotificationPermission();
        }
        const hasPerm = mobileServices.hasNotificationPermission();
        if (alertsModalStatusLabel) {
          alertsModalStatusLabel.textContent = hasPerm ? 'Notifications Active' : 'In-App Alerts Active';
        }
      } else {
        taskStore.setAlertsEnabled(false);
        mobileServices.cancelLiveNotification();
        if (alertsModalStatusLabel) alertsModalStatusLabel.textContent = 'Notifications Muted';
      }
      updateNotifToggleUI();
      if (taskStore.getAlertsEnabled() && mobileServices.hasNotificationPermission() && runtime) {
        const activeTask = runtime.getActiveTask();
        if (activeTask) {
          const nextTask = ((runtime.currentSchedule && runtime.currentSchedule.tasks) || [])[runtime.activeTaskIndex + 1] || null;
          mobileServices.updateLiveNotification({
            activeTask,
            remainingSeconds: runtime.status === TimerStatus.IDLE
              ? (activeTask.allocatedDuration || 30) * 60
              : runtime.getRemainingSeconds(),
            nextTask,
            isPaused: runtime.status !== TimerStatus.RUNNING
          });
        }
      }
    });
  }

  btnPlayPause.addEventListener('click', () => {
    if (runtime.status === TimerStatus.RUNNING) {
      mobileServices.hapticTap();
      analytics.trackInteraction('btn_click', 'btnPlayPause', { action: 'pause' });
      runtime.pause();
    } else {
      const activeTask = runtime ? runtime.getActiveTask() : null;
      const hasTasks = Boolean(
        activeTask &&
        runtime.initialTasks &&
        runtime.initialTasks.length > 0 &&
        runtime.status !== TimerStatus.COMPLETED
      );
      if (!hasTasks) {
        mobileServices.hapticWarning();
        showToastNotification('Please create a task first before starting the timer.');
        if (typeof openAddTaskModal === 'function') {
          openAddTaskModal('work');
        }
        return;
      }
      mobileServices.hapticTap();
      analytics.trackInteraction('btn_click', 'btnPlayPause', { action: 'start' });
      if ('Notification' in window && Notification.permission === 'default' && taskStore.getAlertsEnabled()) {
        mobileServices.requestNotificationPermission();
      }
      runtime.start();
    }
  });

  // Left button:
  // - While timer is running -> Exit button: stops current task, resets timer for that task, reverts to Reset button
  // - While timer is not running -> Reset button: resets the whole day of events
  btnStopTime.addEventListener('click', () => {
    mobileServices.hapticTap();
    analytics.trackInteraction('btn_click', 'btnStopTime', { isRunning: runtime.status === TimerStatus.RUNNING });
    if (runtime.status === TimerStatus.RUNNING) {
      stopContinuousWheelAnimation();
      runtime.resetCurrentTask();
      updateActiveTaskDisplay();
      const activeTask = runtime.getActiveTask();
      const durSec = ((activeTask ? activeTask.allocatedDuration : 0) || (activeTask ? activeTask.plannedDuration : 0) || 25) * 60;
      renderClockTime(durSec);
      updateWheelProgress(0);
      updateFinishEarlyButtonText(durSec);
      updateResetButtonUI();
      renderTaskList(((runtime.currentSchedule && runtime.currentSchedule.tasks) || []) || []);
    } else {
      resetWholeDay();
    }
  });

  btnSkipTask.addEventListener('click', () => {
    mobileServices.hapticTap();
    analytics.trackInteraction('btn_click', 'btnSkipTask');
    runtime.skipCurrentTask();
  });

  const timerCenterDisplay = document.querySelector('.timer-center-display');
  if (timerCenterDisplay) {
    let tStartX = 0;
    let tStartY = 0;
    timerCenterDisplay.addEventListener('touchstart', (e) => {
      if (e.target.closest('#timerQuickToggles, .timer-quick-btn, #rotaryPreviewBadge')) return;
      if (!e.touches || e.touches.length !== 1) return;
      tStartX = e.touches[0].clientX;
      tStartY = e.touches[0].clientY;
    }, { passive: true });

    timerCenterDisplay.addEventListener('touchend', (e) => {
      if (!tStartX) return;
      const endX = (e.changedTouches && e.changedTouches[0]) ? e.changedTouches[0].clientX : 0;
      const endY = (e.changedTouches && e.changedTouches[0]) ? e.changedTouches[0].clientY : 0;
      const diffX = endX - tStartX;
      const diffY = endY - tStartY;
      tStartX = 0;
      tStartY = 0;

      if (Math.abs(diffX) >= 45 && Math.abs(diffX) > Math.abs(diffY) * 1.3) {
        if (diffX > 0) {
          // Swiped RIGHT: Go back to previous task
          if (runtime && typeof runtime.previousTask === 'function') {
            const prev = runtime.previousTask();
            if (prev) {
              updateActiveTaskDisplay();
              const durSec = ((prev.allocatedDuration || prev.plannedDuration || 25) * 60);
              renderClockTime(durSec);
              updateWheelProgress(0);
              updateFinishEarlyButtonText(durSec);
              renderTaskList(((runtime.currentSchedule && runtime.currentSchedule.tasks) || []) || []);
              renderCalendarModal();
              showToastNotification('◀ Returned to "' + prev.title + '"');
              mobileServices.hapticTap();
            } else {
              showToastNotification('Already at first task');
              mobileServices.hapticWarning();
            }
          }
        } else {
          // Swiped LEFT: Skip to next task
          if (runtime && typeof runtime.skipCurrentTask === 'function') {
            mobileServices.hapticTap();
            runtime.skipCurrentTask();
          }
        }
      }
    }, { passive: true });
  }

  btnFinishEarly.addEventListener('click', () => {
    mobileServices.hapticTap();
    analytics.trackInteraction('btn_click', 'btnFinishEarly');
    runtime.completeCurrentTaskEarly();
  });

  function handleTimerPiggyToggle(e) {
    if (e) {
      e.stopPropagation();
      if (e.preventDefault) e.preventDefault();
    }
    const activeTask = runtime ? runtime.getActiveTask() : null;
    if (!activeTask) {
      showToastNotification('Add a task first to toggle Time Bank.');
      return;
    }
    mobileServices.hapticTap();
    const currentVal = activeTask.useTimeBank !== false;
    const nextVal = !currentVal;
    activeTask.useTimeBank = nextVal;

    taskStore.updateTask(activeTask.id, { useTimeBank: nextVal });
    const initTask = (runtime && runtime.initialTasks) ? runtime.initialTasks.find(t => t.id === activeTask.id) : null;
    if (initTask) initTask.useTimeBank = nextVal;

    if (!nextVal && runtime.isOverrunning) {
      runtime.isOverrunning = false;
      runtime.overrunStartTime = null;
      showToastNotification('Time Bank disabled — moving to next task');
      runtime._advanceToNextTask();
      return;
    }

    showToastNotification(nextVal ? 'Time Bank enabled for this task' : 'Time Bank disabled for this task');
    updateTimerQuickToggles();
    renderTaskList(((runtime.currentSchedule && runtime.currentSchedule.tasks) || []) || []);
    const calBackdrop = document.getElementById('calendarModalBackdrop');
    if (calBackdrop && !calBackdrop.classList.contains('hidden')) {
      renderCalendarModal();
    }
  }

  let lastLockToggleTimestamp = 0;

  function handleTimerLockToggle(e) {
    if (e) {
      e.stopPropagation();
      if (e.preventDefault) e.preventDefault();
    }
    const now = Date.now();
    if (now - lastLockToggleTimestamp < 350) return;
    lastLockToggleTimestamp = now;

    const activeTask = runtime ? runtime.getActiveTask() : null;
    if (!activeTask) {
      showToastNotification('Add a task first to toggle Lock.');
      return;
    }
    mobileServices.hapticTap();
    const currentLocked = Boolean(activeTask.isLocked);
    const nextLock = !currentLocked;
    const fixedStartTime = nextLock ? (activeTask.fixedStartTime || activeTask.startTime || null) : null;
    activeTask.isLocked = nextLock;
    activeTask.fixedStartTime = fixedStartTime;

    taskStore.updateTask(activeTask.id, { isLocked: nextLock, fixedStartTime: fixedStartTime });
    const initTask = (runtime && runtime.initialTasks) ? runtime.initialTasks.find(t => t.id === activeTask.id) : null;
    if (initTask) {
      initTask.isLocked = nextLock;
      initTask.fixedStartTime = fixedStartTime;
    }

    if (runtime && runtime.currentSchedule && runtime.currentSchedule.tasks) {
      const schedTask = runtime.currentSchedule.tasks.find(t => t.id === activeTask.id);
      if (schedTask) {
        schedTask.isLocked = nextLock;
        schedTask.fixedStartTime = fixedStartTime;
      }
    }

    runtime.recalculate();
    syncDynamicScheduleTimesToCalendar();
    showToastNotification(nextLock ? 'Task duration locked' : 'Task duration unlocked');
    updateTimerQuickToggles();
    renderTaskList(((runtime.currentSchedule && runtime.currentSchedule.tasks) || []) || []);
    renderCalendarModal();
  }

  const timerScreenPiggyBtn = document.getElementById('timerScreenPiggyBtn');
  if (timerScreenPiggyBtn) {
    timerScreenPiggyBtn.addEventListener('click', handleTimerPiggyToggle);
  }

  const timerScreenLockIcon = document.getElementById('timerScreenLockIcon');
  if (timerScreenLockIcon) {
    timerScreenLockIcon.addEventListener('click', handleTimerLockToggle);
  }

  function triggerTimePicker(inputEl) {
    if (!inputEl) return;
    try {
      if (typeof inputEl.showPicker === 'function') {
        inputEl.showPicker();
        return;
      }
    } catch (_) {}
    inputEl.focus();
    inputEl.click();
  }

  function syncHardStopValue(newStop) {
    if (!newStop) return;
    taskStore.saveHardStop(newStop);
    if (hardStopInput && hardStopInput.value !== newStop) hardStopInput.value = newStop;
    if (calendarHardStopInput && calendarHardStopInput.value !== newStop) calendarHardStopInput.value = newStop;
    const todayFinishLineTime = document.getElementById('todayFinishLineTime');
    if (todayFinishLineTime) todayFinishLineTime.textContent = newStop;
    runtime.updateHardStop(newStop);
  }

  const hardStopModalBackdrop = document.getElementById('hardStopModalBackdrop');
  const hardStopModalToggle = document.getElementById('hardStopModalToggle');
  const hardStopModalToggleLabel = document.getElementById('hardStopModalToggleLabel');
  const btnCloseHardStopModal = document.getElementById('btnCloseHardStopModal');
  const btnSaveHardStopModal = document.getElementById('btnSaveHardStopModal');
  const hardStopHourInput = document.getElementById('hardStopHourInput');
  const hardStopMinInput = document.getElementById('hardStopMinInput');
  const btnHardStopHourUp = document.getElementById('btnHardStopHourUp');
  const btnHardStopHourDown = document.getElementById('btnHardStopHourDown');
  const btnHardStopMinUp = document.getElementById('btnHardStopMinUp');
  const btnHardStopMinDown = document.getElementById('btnHardStopMinDown');

  function openHardStopModal() {
    if (!hardStopModalBackdrop) return;
    const isEnabled = taskStore.getHardStopEnabled();
    if (hardStopModalToggle) hardStopModalToggle.checked = isEnabled;
    if (hardStopModalToggleLabel) hardStopModalToggleLabel.textContent = isEnabled ? 'Enabled' : 'Disabled';

    const currentStop = taskStore.getHardStop() || '18:00';
    const [h, m] = currentStop.split(':');
    if (hardStopHourInput) hardStopHourInput.value = (h || '18').padStart(2, '0');
    if (hardStopMinInput) hardStopMinInput.value = (m || '00').padStart(2, '0');

    hardStopModalBackdrop.classList.remove('hidden');
    mobileServices.hapticTap();
  }

  function closeHardStopModal() {
    if (hardStopModalBackdrop) hardStopModalBackdrop.classList.add("hidden");
  }

  if (hardStopModalToggle) {
    hardStopModalToggle.addEventListener('change', () => {
      const enabled = hardStopModalToggle.checked;
      if (hardStopModalToggleLabel) {
        hardStopModalToggleLabel.textContent = enabled ? 'Enabled' : 'Disabled';
      }
    });
  }

  if (btnHardStopHourUp) {
    btnHardStopHourUp.addEventListener('click', () => {
      mobileServices.hapticTick();
      const cur = parseInt((hardStopHourInput ? hardStopHourInput.value : "0"), 10) || 0;
      if (hardStopHourInput) hardStopHourInput.value = String((cur + 1) % 24).padStart(2, '0');
    });
  }

  if (btnHardStopHourDown) {
    btnHardStopHourDown.addEventListener('click', () => {
      mobileServices.hapticTick();
      const cur = parseInt((hardStopHourInput ? hardStopHourInput.value : "0"), 10) || 0;
      if (hardStopHourInput) hardStopHourInput.value = String((cur - 1 + 24) % 24).padStart(2, '0');
    });
  }

  if (btnHardStopMinUp) {
    btnHardStopMinUp.addEventListener('click', () => {
      mobileServices.hapticTick();
      const cur = parseInt((hardStopMinInput ? hardStopMinInput.value : "0"), 10) || 0;
      if (hardStopMinInput) hardStopMinInput.value = String((cur + 5) % 60).padStart(2, '0');
    });
  }

  if (btnHardStopMinDown) {
    btnHardStopMinDown.addEventListener('click', () => {
      mobileServices.hapticTick();
      const cur = parseInt((hardStopMinInput ? hardStopMinInput.value : "0"), 10) || 0;
      if (hardStopMinInput) hardStopMinInput.value = String((cur - 5 + 60) % 60).padStart(2, '0');
    });
  }

  document.querySelectorAll('.hard-stop-presets .preset-pill').forEach(btn => {
    btn.addEventListener('click', () => {
      mobileServices.hapticTap();
      const timeVal = btn.getAttribute('data-time');
      if (timeVal.startsWith('+')) {
        const addMin = parseInt(timeVal.replace('+', ''), 10);
        const curH = parseInt((hardStopHourInput ? hardStopHourInput.value : "0"), 10) || 0;
        const curM = parseInt((hardStopMinInput ? hardStopMinInput.value : "0"), 10) || 0;
        const total = (curH * 60 + curM + addMin) % 1440;
        if (hardStopHourInput) hardStopHourInput.value = String(Math.floor(total / 60)).padStart(2, '0');
        if (hardStopMinInput) hardStopMinInput.value = String(total % 60).padStart(2, '0');
      } else {
        const [h, m] = timeVal.split(':');
        if (hardStopHourInput) hardStopHourInput.value = (h || '18').padStart(2, '0');
        if (hardStopMinInput) hardStopMinInput.value = (m || '00').padStart(2, '0');
      }
    });
  });

  if (btnSaveHardStopModal) {
    btnSaveHardStopModal.addEventListener('click', () => {
      mobileServices.hapticTap();
      const h = String(Math.max(0, Math.min(23, parseInt((hardStopHourInput ? hardStopHourInput.value : "0"), 10) || 0))).padStart(2, '0');
      const m = String(Math.max(0, Math.min(59, parseInt((hardStopMinInput ? hardStopMinInput.value : "0"), 10) || 0))).padStart(2, '0');
      const newStop = `${h}:${m}`;
      const isEnabled = hardStopModalToggle ? hardStopModalToggle.checked : true;

      taskStore.saveHardStop(newStop);
      taskStore.setHardStopEnabled(isEnabled);
      runtime.setHardStopEnabled(isEnabled);
      syncHardStopValue(newStop);
      updateHardStopPillsUI(isEnabled);
      closeHardStopModal();
      showToastNotification(`Hard Stop set to ${newStop} (${isEnabled ? 'Enabled' : 'Disabled'})`);
    });
  }

  if (btnCloseHardStopModal) btnCloseHardStopModal.addEventListener('click', closeHardStopModal);
  if (hardStopModalBackdrop) {
    hardStopModalBackdrop.addEventListener('click', (e) => {
      if (e.target === hardStopModalBackdrop) closeHardStopModal();
    });
  }

  if (hardStopPill) {
    hardStopPill.addEventListener('click', () => {
      openHardStopModal();
    });
  }

  if (calendarFinishLine) {
    calendarFinishLine.addEventListener('click', () => {
      openHardStopModal();
    });
  }

  const todayFinishLine = document.getElementById('todayFinishLine');
  if (todayFinishLine) {
    todayFinishLine.addEventListener('click', () => {
      openHardStopModal();
    });
  }

  if (hardStopInput) {
    hardStopInput.addEventListener('change', (e) => {
      syncHardStopValue(e.target.value);
    });
  }

  if (calendarHardStopInput) {
    calendarHardStopInput.addEventListener('change', (e) => {
      syncHardStopValue(e.target.value);
    });
  }

  // Themed Single Task Delete Confirmation Modal
  const confirmDeleteTaskModalBackdrop = document.getElementById('confirmDeleteTaskModalBackdrop');
  const confirmDeleteTaskTitle = document.getElementById('confirmDeleteTaskTitle');
  const confirmDeleteTaskDesc = document.getElementById('confirmDeleteTaskDesc');
  const btnCancelDeleteTask = document.getElementById('btnCancelDeleteTask');
  const btnConfirmDeleteTask = document.getElementById('btnConfirmDeleteTask');

  let pendingDeleteTaskId = null;
  let pendingDeleteTaskTitle = '';

  function openConfirmDeleteTaskModal(taskId, taskTitle) {
    pendingDeleteTaskId = taskId;
    pendingDeleteTaskTitle = taskTitle || 'this task';
    const taskObj = taskStore.getTasks().find(t => t.id === taskId);
    const isExternalTask = Boolean(
      taskObj && (
        taskObj.origin === 'external' ||
        taskObj.createdInApp === false ||
        taskObj.source === 'google' ||
        taskObj.source === 'microsoft' ||
        taskObj.googleEventId ||
        taskObj.microsoftEventId
      )
    );

    if (confirmDeleteTaskTitle) confirmDeleteTaskTitle.textContent = `Delete "${pendingDeleteTaskTitle}"?`;
    if (confirmDeleteTaskDesc) {
      if (isExternalTask) {
        confirmDeleteTaskDesc.textContent = `Are you sure you want to remove "${pendingDeleteTaskTitle}" from today's schedule? (Your external Google/Microsoft Calendar will not be affected.)`;
      } else {
        confirmDeleteTaskDesc.textContent = `Are you sure you want to remove "${pendingDeleteTaskTitle}" from today's schedule?`;
      }
    }
    if (confirmDeleteTaskModalBackdrop) confirmDeleteTaskModalBackdrop.classList.remove('hidden');
    mobileServices.hapticWarning();
  }
  window.openConfirmDeleteTaskModal = openConfirmDeleteTaskModal;

  function closeConfirmDeleteTaskModal() {
    if (confirmDeleteTaskModalBackdrop) confirmDeleteTaskModalBackdrop.classList.add('hidden');
    pendingDeleteTaskId = null;
    pendingDeleteTaskTitle = '';
  }

  if (btnCancelDeleteTask) {
    btnCancelDeleteTask.addEventListener('click', closeConfirmDeleteTaskModal);
  }
  if (confirmDeleteTaskModalBackdrop) {
    confirmDeleteTaskModalBackdrop.addEventListener('click', (e) => {
      if (e.target === confirmDeleteTaskModalBackdrop) closeConfirmDeleteTaskModal();
    });
  }
  if (btnConfirmDeleteTask) {
    btnConfirmDeleteTask.addEventListener('click', () => {
      const id = pendingDeleteTaskId;
      const title = pendingDeleteTaskTitle;
      closeConfirmDeleteTaskModal();
      if (id) {
        executeDeleteTask(id, title);
      }
    });
  }

  // Centralized Unified Task Deletion
  function executeDeleteTask(taskId, taskTitle = 'Task') {
    const rawTaskObj = taskStore.getTasks().find(t => t.id === taskId);
    const calEvObj = (typeof taskStore.getCalendarEventById === 'function')
      ? taskStore.getCalendarEventById(taskId)
      : null;
    const taskObj = (rawTaskObj && calEvObj)
      ? Object.assign({}, calEvObj, rawTaskObj, {
          isCalentimerMirror: Boolean(rawTaskObj.isCalentimerMirror || calEvObj.isCalentimerMirror),
          externalCalendarId: rawTaskObj.externalCalendarId || calEvObj.externalCalendarId || null,
          externalId: rawTaskObj.externalId || calEvObj.externalId || null,
          googleEventId: rawTaskObj.googleEventId || calEvObj.googleEventId || null,
          microsoftEventId: rawTaskObj.microsoftEventId || calEvObj.microsoftEventId || null
        })
      : (rawTaskObj || calEvObj || null);
    if (taskObj && taskObj.externalId && typeof taskStore.addDeletedId === 'function') {
      taskStore.addDeletedId(taskObj.externalId);
    }

    const googleCalentimerId = (typeof taskStore !== 'undefined' && typeof taskStore.getGoogleCalentimerCalendarId === 'function')
      ? taskStore.getGoogleCalentimerCalendarId()
      : null;
    const msCalentimerId = (typeof taskStore !== 'undefined' && typeof taskStore.getMicrosoftCalentimerCalendarId === 'function')
      ? taskStore.getMicrosoftCalentimerCalendarId()
      : null;
    const isCalentimerMirror = Boolean(
      taskObj && (
        taskObj.isCalentimerMirror ||
        (googleCalentimerId && taskObj.externalCalendarId === googleCalentimerId) ||
        (msCalentimerId && taskObj.externalCalendarId === msCalentimerId)
      )
    );
    const isCreatedInApp = Boolean(
      taskObj && (
        (taskObj.origin === 'local' || taskObj.createdInApp === true) ||
        (taskObj.id && (taskObj.id.indexOf('task-') === 0 || taskObj.id.indexOf('cal-event-') === 0))
      )
    );
    const isExplicitlyExternal = Boolean(
      taskObj && (
        taskObj.origin === 'external' ||
        taskObj.createdInApp === false ||
        (taskObj.id && (taskObj.id.indexOf('cal-gcal-') === 0 || taskObj.id.indexOf('cal-ms-') === 0 || taskObj.id.indexOf('cal-sync-') === 0))
      )
    );

    if ((isCreatedInApp && !isExplicitlyExternal) || isCalentimerMirror) {
      if (typeof calendarSyncService !== 'undefined' && calendarSyncService && typeof calendarSyncService.pushEventDelete === 'function') {
        calendarSyncService.pushEventDelete(taskObj);
      }
    }

    taskStore.deleteTask(taskId);
    if (runtime) {
      runtime.deleteTask(taskId);
      updateActiveTaskDisplay();
      renderTaskList(((runtime.currentSchedule && runtime.currentSchedule.tasks) || []) || []);
      renderCalendarModal();
      updateScheduleUI(runtime.currentSchedule);
      updateResetButtonUI();
      const activeTask = runtime.getActiveTask();
      if (activeTask) {
        renderClockTime(runtime.getRemainingSeconds());
      } else {
        renderClockTime(0);
        updateWheelProgress(0);
      }
    }
    if (calendarView && typeof calendarView.render === 'function') {
      calendarView.render();
    }
    mobileServices.hapticBuzz();
    const isExternalProtected = Boolean(
      taskObj &&
      (taskObj.origin === 'external' || taskObj.source === 'google' || taskObj.source === 'microsoft') &&
      !isCalentimerMirror &&
      !(isCreatedInApp && !isExplicitlyExternal)
    );
    if (isExternalProtected) {
      showToastNotification(`✓ Removed "${taskTitle}" (external calendar unchanged)`);
    } else {
      showToastNotification(`✓ Deleted "${taskTitle}"`);
    }
  }
  window.executeDeleteTask = executeDeleteTask;

  // Themed Clear Schedule Confirmation Modal
  const confirmClearModalBackdrop = document.getElementById('confirmClearModalBackdrop');
  const btnCancelClearSchedule = document.getElementById('btnCancelClearSchedule');
  const btnConfirmClearSchedule = document.getElementById('btnConfirmClearSchedule');

  function openConfirmClearModal() {
    if (confirmClearModalBackdrop) confirmClearModalBackdrop.classList.remove('hidden');
    mobileServices.hapticWarning();
  }

  function closeConfirmClearModal() {
    if (confirmClearModalBackdrop) confirmClearModalBackdrop.classList.add('hidden');
  }

  if (btnClearCalendarSchedule) {
    btnClearCalendarSchedule.addEventListener('click', (e) => {
      e.stopPropagation();
      openConfirmClearModal();
    });
  }

  const btnClearDrawerSchedule = document.getElementById('btnClearDrawerSchedule');
  if (btnClearDrawerSchedule) {
    btnClearDrawerSchedule.addEventListener('click', (e) => {
      e.stopPropagation();
      openConfirmClearModal();
    });
  }

  if (btnCancelClearSchedule) {
    btnCancelClearSchedule.addEventListener('click', closeConfirmClearModal);
  }

  if (confirmClearModalBackdrop) {
    confirmClearModalBackdrop.addEventListener('click', (e) => {
      if (e.target === confirmClearModalBackdrop) closeConfirmClearModal();
    });
  }

  if (btnConfirmClearSchedule) {
    btnConfirmClearSchedule.addEventListener('click', () => {
      closeConfirmClearModal();
      taskStore.clearAllTasks();
      runtime.initialTasks = [];
      runtime.reset();
      runtime.recalculate();
      updateActiveTaskDisplay();
      renderTaskList([]);
      renderCalendarModal();
      updateScheduleUI(runtime.currentSchedule);
      renderClockTime(0);
      updateWheelProgress(0);
      updateTotalMinutesDisplay();
      if (calendarView && typeof calendarView.render === 'function') {
        calendarView.render();
      }
      mobileServices.hapticBuzz();
      showToastNotification("✓ Cleared today's schedule");
    });
  }

  const taskDrawerBackdrop = document.getElementById('taskDrawerBackdrop');
  const btnDrawerToggle = document.getElementById('btnDrawerToggle');
  const btnModeChronological = document.getElementById('btnModeChronological');
  const btnModeSequential = document.getElementById('btnModeSequential');
  const btnCalModeChronological = document.getElementById('btnCalModeChronological');
  const btnCalModeSequential = document.getElementById('btnCalModeSequential');

  updateTimespansButtonUI();

  if (btnModeChronological) {
    btnModeChronological.addEventListener('click', (e) => {
      e.stopPropagation();
      setScheduleMode(true);
    });
  }

  if (btnModeSequential) {
    btnModeSequential.addEventListener('click', (e) => {
      e.stopPropagation();
      setScheduleMode(false);
    });
  }

  if (btnCalModeChronological) {
    btnCalModeChronological.addEventListener('click', (e) => {
      e.stopPropagation();
      setScheduleMode(true);
    });
  }

  if (btnCalModeSequential) {
    btnCalModeSequential.addEventListener('click', (e) => {
      e.stopPropagation();
      setScheduleMode(false);
    });
  }

  function scrollToCenterActiveTask() {
    const drawerContent = document.getElementById('drawerContent');
    if (!drawerContent) return;
    const activeCard = drawerContent.querySelector('.task-card.task-current') || drawerContent.querySelector('.task-card');
    if (!activeCard) return;
    const cHeight = drawerContent.clientHeight || 400;
    const cardTop = activeCard.offsetTop;
    const cardHeight = activeCard.offsetHeight || 60;
    drawerContent.scrollTop = Math.max(0, cardTop - (cHeight / 2) + (cardHeight / 2));
  }

  openTaskDrawer = function() {
    ensureHistoryBuffer();
    if (!runtime || runtime.status === TimerStatus.IDLE) {
      taskStore.syncScheduleAndCalendar();
      runtime.initialTasks = taskStore.getTasks();
      runtime.recalculate();
    }
    renderTaskList(((runtime.currentSchedule && runtime.currentSchedule.tasks) || []) || taskStore.getTasks());
    renderCalendarModal();
    updateScheduleUI(runtime.currentSchedule);
    updateActiveTaskDisplay();
    updateTimespansButtonUI();
    if (typeof updateSimpleLoopUI === 'function') updateSimpleLoopUI();
    taskDrawer.style.removeProperty('transform');
    taskDrawer.classList.remove('collapsed');
    taskDrawer.classList.remove('will-minimise', 'will-open');
    if (taskDrawerBackdrop) taskDrawerBackdrop.classList.remove('hidden');
    scrollToCenterActiveTask();
    mobileServices.hapticTap();
  };

  closeTaskDrawer = function() {
    taskDrawer.style.removeProperty('transform');
    taskDrawer.classList.add('collapsed');
    taskDrawer.classList.remove('will-minimise', 'will-open');
    if (taskDrawerBackdrop) taskDrawerBackdrop.classList.add('hidden');
    if (runtime && runtime.status === TimerStatus.IDLE) {
      runtime.initialTasks = taskStore.getTasks();
      runtime.recalculate();
      updateActiveTaskDisplay();
    }
  };

  toggleTaskDrawer = function() {
    if (taskDrawer.classList.contains('collapsed')) {
      openTaskDrawer();
    } else {
      closeTaskDrawer();
    }
  };

  window.openTaskDrawer = openTaskDrawer;
  window.closeTaskDrawer = closeTaskDrawer;
  window.toggleTaskDrawer = toggleTaskDrawer;

  if (drawerHeader) drawerHeader.addEventListener('click', toggleTaskDrawer);
  if (btnDrawerToggle) {
    btnDrawerToggle.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleTaskDrawer();
    });
  }
  if (taskDrawerBackdrop) taskDrawerBackdrop.addEventListener('click', closeTaskDrawer);

  // Swipe up to open Today's Tasks tab; swipe down to minimise it (with live rubberband)
  let drawerTouchStartY = 0;
  let drawerTouchStartX = 0;
  let drawerTouchStartTime = 0;
  isDrawerTouching = false;
  isDrawerPullingDown = false;
  isDrawerPullingUp = false;

  function onDrawerTouchStart(e) {
    if (isNavSwiping) return;
    if (isDraggingTask) {
      isDrawerTouching = false;
      isDrawerPullingDown = false;
      isDrawerPullingUp = false;
      return;
    }
    if (!e.touches || e.touches.length !== 1) return;
    drawerTouchStartY = e.touches[0].clientY;
    drawerTouchStartX = e.touches[0].clientX;
    drawerTouchStartTime = Date.now();
    isDrawerTouching = true;
    isDrawerPullingDown = false;
    isDrawerPullingUp = false;
  }

  function onDrawerTouchMove(e) {
    if (isNavSwiping) {
      if (isDrawerPullingDown || isDrawerPullingUp) {
        taskDrawer.style.removeProperty('transform');
        taskDrawer.classList.remove('will-minimise', 'will-open');
        isDrawerPullingDown = false;
        isDrawerPullingUp = false;
      }
      isDrawerTouching = false;
      return;
    }
    if (isDraggingTask) {
      isDrawerTouching = false;
      if (isDrawerPullingDown || isDrawerPullingUp) {
        taskDrawer.style.removeProperty('transform');
        taskDrawer.classList.remove('will-minimise', 'will-open');
        isDrawerPullingDown = false;
        isDrawerPullingUp = false;
      }
      return;
    }
    if (!isDrawerTouching || !e.touches || e.touches.length !== 1) return;
    const currentY = e.touches[0].clientY;
    const currentX = e.touches[0].clientX;

    if (!taskDrawer.classList.contains('collapsed')) {
      const drawerContentEl = document.getElementById('drawerContent');
      const isHeaderTouch = Boolean(e.target.closest('#drawerHeader, .drawer-header'));
      const isAtTop = !drawerContentEl || drawerContentEl.scrollTop <= 0;

      // If user is scrolling inside drawer content and not yet at the top, continually anchor
      // the touch start position to current finger position. When they finally reach the top,
      // downward pull resistance starts fresh from that exact point (requiring the full 65px drag
      // rather than jumping directly into minimisation).
      if (!isHeaderTouch && !isAtTop) {
        drawerTouchStartY = currentY;
        drawerTouchStartX = currentX;
        drawerTouchStartTime = Date.now();
        if (isDrawerPullingDown) {
          isDrawerPullingDown = false;
          taskDrawer.classList.remove('will-minimise');
          taskDrawer.style.removeProperty('transform');
        }
        return;
      }
    }

    const deltaY = currentY - drawerTouchStartY;
    const deltaX = currentX - drawerTouchStartX;

    // Only respond to predominantly vertical swipes
    if (Math.abs(deltaY) > Math.abs(deltaX) && Math.abs(deltaY) > 10) {
      if (taskDrawer.classList.contains('collapsed')) {
        // Swiping UP when collapsed with resistance and 180 deg rotating arrow
        if (deltaY < 0) {
          isDrawerPullingUp = true;
          // Live rubberband upward pull with resistance (0.45 damping)
          const rubberbandY = -Math.min(Math.abs(deltaY) * 0.45, 90);
          taskDrawer.style.transition = 'none';
          taskDrawer.style.setProperty('transform', `translateY(calc(100% - 56px + ${rubberbandY}px))`, 'important');

          // When swiped with enough resistance (>= 60px), rotate arrow 180 deg to point up; rotate back if pulled down
          if (Math.abs(deltaY) >= 60) {
            taskDrawer.classList.add('will-open');
          } else {
            taskDrawer.classList.remove('will-open');
          }
        } else if (deltaY >= 0 && isDrawerPullingUp) {
          taskDrawer.classList.remove('will-open');
        }
      } else {
        // Swiping DOWN when expanded: only allow when user is at the top of drawer content (scrollTop <= 0) or touching the header
        const drawerContentEl = document.getElementById('drawerContent');
        const isHeaderTouch = e.target.closest('#drawerHeader, .drawer-header');
        const isAtTop = !drawerContentEl || drawerContentEl.scrollTop <= 0;

        if ((isHeaderTouch || isAtTop) && deltaY > 0) {
          isDrawerPullingDown = true;
          // Live rubberband pull visual
          const rubberbandY = Math.min(deltaY * 0.45, 120);
          taskDrawer.style.transition = 'none';
          taskDrawer.style.setProperty('transform', `translateY(${rubberbandY}px)`, 'important');

          // Rotate arrow 180° clockwise when swiped >= 65px to indicate release will minimise; rotate back if pulled back
          if (deltaY >= 65) {
            taskDrawer.classList.add('will-minimise');
          } else {
            taskDrawer.classList.remove('will-minimise');
          }
        } else if (deltaY <= 0 && isDrawerPullingDown) {
          isDrawerPullingDown = false;
          taskDrawer.classList.remove('will-minimise');
          taskDrawer.style.removeProperty('transform');
        }
      }
    }
  }

  function onDrawerTouchEnd(e) {
    const currentY = (e.changedTouches && e.changedTouches[0]) ? e.changedTouches[0].clientY : 0;
    const deltaY = currentY - drawerTouchStartY;
    const elapsedMs = Math.max(1, Date.now() - drawerTouchStartTime);
    const flickVelocity = Math.abs(deltaY) / elapsedMs; // px per ms

    if (isDrawerPullingUp) {
      taskDrawer.style.transition = '';
      // Opens when either flicked up (deltaY < -30 with speed) or swiped with enough resistance (deltaY <= -60)
      if (deltaY <= -60 || (deltaY < -30 && flickVelocity > 0.35)) {
        taskDrawer.classList.remove('will-open');
        taskDrawer.style.removeProperty('transform');
        openTaskDrawer();
      } else {
        // Snap back to collapsed state
        taskDrawer.classList.remove('will-open');
        taskDrawer.style.transition = 'transform 0.28s cubic-bezier(0.16, 1, 0.3, 1)';
        taskDrawer.style.removeProperty('transform');
      }
    }

    if (isDrawerPullingDown) {
      taskDrawer.style.transition = '';
      if (deltaY > 65 || (deltaY > 30 && flickVelocity > 0.35)) {
        taskDrawer.classList.remove('will-minimise');
        taskDrawer.style.removeProperty('transform');
        closeTaskDrawer();
      } else {
        taskDrawer.classList.remove('will-minimise');
        taskDrawer.style.transition = 'transform 0.28s cubic-bezier(0.16, 1, 0.3, 1)';
        taskDrawer.style.removeProperty('transform');
      }
    }

    if (isDrawerPullingUp || isDrawerPullingDown) {
      const suppressClick = (clickEv) => {
        clickEv.stopPropagation();
        clickEv.preventDefault();
        window.removeEventListener('click', suppressClick, true);
      };
      window.addEventListener('click', suppressClick, true);
      setTimeout(() => {
        window.removeEventListener('click', suppressClick, true);
      }, 350);
    }

    taskDrawer.classList.remove('will-minimise', 'will-open');
    isDrawerTouching = false;
    isDrawerPullingDown = false;
    isDrawerPullingUp = false;
  }

  function onDrawerTouchCancel() {
    if (taskDrawer) {
      taskDrawer.classList.remove('will-minimise', 'will-open');
      taskDrawer.style.removeProperty('transform');
      taskDrawer.style.removeProperty('transition');
      if (taskDrawer.classList.contains('collapsed') && taskDrawerBackdrop) {
        taskDrawerBackdrop.classList.add('hidden');
      }
    }
    isDrawerTouching = false;
    isDrawerPullingDown = false;
    isDrawerPullingUp = false;
  }
  window.onDrawerTouchCancel = onDrawerTouchCancel;

  if (drawerHeader) {
    drawerHeader.addEventListener('touchstart', onDrawerTouchStart, { passive: true });
    drawerHeader.addEventListener('touchmove', onDrawerTouchMove, { passive: true });
    drawerHeader.addEventListener('touchend', onDrawerTouchEnd, { passive: true });
    drawerHeader.addEventListener('touchcancel', onDrawerTouchCancel, { passive: true });
  }

  if (taskDrawer) {
    taskDrawer.addEventListener('touchstart', onDrawerTouchStart, { passive: true });
    taskDrawer.addEventListener('touchmove', onDrawerTouchMove, { passive: true });
    taskDrawer.addEventListener('touchend', onDrawerTouchEnd, { passive: true });
    taskDrawer.addEventListener('touchcancel', onDrawerTouchCancel, { passive: true });
  }
}

// ==========================================
// Toast Notification System
// ==========================================
let toastShowTimer = null;
let toastExitTimer = null;
function showToastNotification(msg) {
  const toast = document.getElementById('toastNotification');
  if (!toast) return;
  if (toastShowTimer) {
    clearTimeout(toastShowTimer);
    toastShowTimer = null;
  }
  if (toastExitTimer) {
    clearTimeout(toastExitTimer);
    toastExitTimer = null;
  }
  toast.style.removeProperty('background');
  toast.style.removeProperty('color');
  toast.textContent = msg;
  toast.classList.remove('is-visible');
  toast.classList.remove('hidden');
  void toast.offsetHeight;
  toast.classList.add('is-visible');
  toastShowTimer = setTimeout(() => {
    toast.classList.remove('is-visible');
    toastExitTimer = setTimeout(() => {
      toast.classList.add('hidden');
      toast.style.removeProperty('background');
      toast.style.removeProperty('color');
      toastExitTimer = null;
    }, 280);
    toastShowTimer = null;
  }, 1400);
}
window.showToastNotification = showToastNotification;

// ==========================================
// Break Option Logic
// ==========================================
function addBreakTask(duration = 10) {
  taskStore.addTask({
    title: 'Break',
    plannedDuration: duration,
    category: 'Break',
    tags: ['rest', 'recharge'],
    emoji: '☕',
    isLocked: false,
    useTimeBank: false
  });
  runtime.initialTasks = taskStore.getTasks();
  runtime.recalculate();
  updateActiveTaskDisplay();
  renderTaskList(((runtime.currentSchedule && runtime.currentSchedule.tasks) || []) || []);
  const calBackdrop = document.getElementById('calendarModalBackdrop');
  if (calBackdrop && !calBackdrop.classList.contains('hidden')) {
    renderCalendarModal();
  }
  mobileServices.hapticTap();
  showToastNotification('☕ 10m Break added to schedule');
}

// ==========================================
// Locked Drag Attempt Press-Hold Handler
// ==========================================
function attachLockedDragHoldWarning(lockedDrag) {
  if (!lockedDrag) return;
  let holdTimer = null;
  let startX = 0;
  let startY = 0;

  const clear = () => {
    if (holdTimer) {
      clearTimeout(holdTimer);
      holdTimer = null;
    }
  };

  const onHoldSuccess = () => {
    clear();
    mobileServices.hapticWarning();
    showToastNotification('🔒 This task is locked and cannot be moved.');
  };

  lockedDrag.addEventListener('touchstart', (e) => {
    if (!e.touches || e.touches.length !== 1) return;
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
    clear();
    holdTimer = setTimeout(onHoldSuccess, 220);
  }, { passive: true });

  lockedDrag.addEventListener('touchmove', (e) => {
    if (!holdTimer || !e.touches || e.touches.length !== 1) return;
    const dx = e.touches[0].clientX - startX;
    const dy = e.touches[0].clientY - startY;
    if (Math.hypot(dx, dy) > 8) {
      clear();
    }
  }, { passive: true });

  lockedDrag.addEventListener('touchend', clear, { passive: true });
  lockedDrag.addEventListener('touchcancel', clear, { passive: true });

  lockedDrag.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    startX = e.clientX;
    startY = e.clientY;
    clear();
    holdTimer = setTimeout(onHoldSuccess, 220);

    const onMove = (me) => {
      if (Math.hypot(me.clientX - startX, me.clientY - startY) > 8) {
        clear();
      }
    };
    const onUp = () => {
      clear();
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  });

  lockedDrag.addEventListener('click', (e) => {
    e.stopPropagation();
    e.preventDefault();
  });
}

// ==========================================
// Today's Schedule Modal Pull-to-Dismiss Gesture
// ==========================================
function setupCalendarModalPullToDismiss() {
  const modal = document.getElementById('calendarModal');
  const backdrop = document.getElementById('calendarModalBackdrop');
  if (!modal || !backdrop) return;

  let touchStartY = 0;
  let touchStartX = 0;
  let isPullingDown = false;
  let didPullDown = false;

  const onTouchStart = (e) => {
    // If user is actively dragging to reorder tasks or swiping horizontally to delete, do not start pull-down
    if (isDraggingTask || isSwipingCardToDelete) return;
    if (e.target.closest('.btn-swipe-delete')) return;
    if (!e.touches || e.touches.length !== 1) return;

    touchStartY = e.touches[0].clientY;
    touchStartX = e.touches[0].clientX;
    isPullingDown = false;
    didPullDown = false;
  };

  const onTouchMove = (e) => {
    if (!touchStartY || !e.touches || e.touches.length !== 1) return;
    if (isDraggingTask || isSwipingCardToDelete) {
      if (isPullingDown) {
        modal.style.removeProperty('transform');
        modal.classList.remove('will-minimise');
        isPullingDown = false;
        isCalendarModalPullingDown = false;
      }
      return;
    }
    const currentY = e.touches[0].clientY;
    const currentX = e.touches[0].clientX;
    const deltaY = currentY - touchStartY;
    const deltaX = currentX - touchStartX;

    // If gesture is horizontal (user swiping on a task card to open delete button), abort pull-down
    if (Math.abs(deltaX) > 8 && Math.abs(deltaX) * 1.2 >= Math.abs(deltaY)) {
      if (isPullingDown) {
        modal.style.removeProperty('transform');
        modal.classList.remove('will-minimise');
        isPullingDown = false;
        isCalendarModalPullingDown = false;
      }
      return;
    }

    if (deltaY > 10 && deltaY > Math.abs(deltaX) * 1.3) {
      const activeScroll = modal.querySelector('.modal-body');
      const isAtTop = !activeScroll || activeScroll.scrollTop <= 0;
      const isHeaderTouch = Boolean(e.target.closest('.calendar-modal-header, .cal-drag-handle-bar, #calendarScheduleModeSegment, .schedule-mode-segment-control'));

      if (isAtTop || isHeaderTouch) {
        isPullingDown = true;
        didPullDown = true;
        isCalendarModalPullingDown = true;
        if (e.cancelable) e.preventDefault();
        const rubberbandY = Math.min(deltaY * 0.28, 140);
        modal.style.transition = 'none';
        modal.style.transform = `translate3d(0, ${rubberbandY}px, 0)`;

        if (deltaY >= 110) {
          modal.classList.add('will-minimise');
          const closeBtn = modal.querySelector('.btn-close-modal');
          if (closeBtn) closeBtn.classList.add('will-minimise');
        } else {
          modal.classList.remove('will-minimise');
          const closeBtn = modal.querySelector('.btn-close-modal');
          if (closeBtn) closeBtn.classList.remove('will-minimise');
        }
      }
    } else if (deltaY <= 0 && isPullingDown) {
      modal.classList.remove('will-minimise');
      const closeBtn = modal.querySelector('.btn-close-modal');
      if (closeBtn) closeBtn.classList.remove('will-minimise');
    }
  };

  const onTouchEnd = () => {
    isCalendarModalPullingDown = false;
    if (didPullDown) {
      const suppressClick = (clickEv) => {
        clickEv.stopPropagation();
        clickEv.preventDefault();
        window.removeEventListener('click', suppressClick, true);
      };
      window.addEventListener('click', suppressClick, true);
      setTimeout(() => {
        window.removeEventListener('click', suppressClick, true);
      }, 350);
    }

    if (!isPullingDown) {
      touchStartY = 0;
      touchStartX = 0;
      didPullDown = false;
      modal.classList.remove('will-minimise');
      const closeBtn = modal.querySelector('.btn-close-modal');
      if (closeBtn) closeBtn.classList.remove('will-minimise');
      return;
    }
    isPullingDown = false;
    const willMinimise = modal.classList.contains('will-minimise');
    modal.classList.remove('will-minimise');
    const closeBtn = modal.querySelector('.btn-close-modal');
    if (closeBtn) closeBtn.classList.remove('will-minimise');

    touchStartY = 0;
    touchStartX = 0;

    if (willMinimise) {
      modal.style.transition = 'transform 0.28s cubic-bezier(0.16, 1, 0.3, 1)';
      modal.style.transform = 'translate3d(0, 100vh, 0)';
      mobileServices.hapticBuzz();

      // Immediately un-highlight Calendar and return active highlight to Timer
      const navItemTimer = document.getElementById('navItemTimer');
      const navItemCalendar = document.getElementById('navItemCalendar');
      const navItemFullCalendar = document.getElementById('navItemFullCalendar');
      if (navItemCalendar) {
        navItemCalendar.classList.remove('active');
        if (typeof navItemCalendar.blur === 'function') navItemCalendar.blur();
      }
      if (navItemFullCalendar) {
        navItemFullCalendar.classList.remove('active');
        if (typeof navItemFullCalendar.blur === 'function') navItemFullCalendar.blur();
      }
      if (navItemTimer) navItemTimer.classList.add('active');

      setTimeout(() => {
        modal.classList.remove('will-minimise');
        const closeBtn = modal.querySelector('.btn-close-modal');
        if (closeBtn) closeBtn.classList.remove('will-minimise');
        modal.style.removeProperty('transform');
        modal.style.removeProperty('transition');
        closeCalendar();
      }, 270);
    } else {
      modal.style.transition = 'transform 0.25s cubic-bezier(0.16, 1, 0.3, 1)';
      modal.style.transform = 'translate3d(0, 0, 0)';
      setTimeout(() => {
        modal.style.removeProperty('transform');
        modal.style.removeProperty('transition');
      }, 250);
    }
  };

  modal.addEventListener('touchstart', onTouchStart, { passive: true });
  modal.addEventListener('touchmove', onTouchMove, { passive: false });
  modal.addEventListener('touchend', onTouchEnd, { passive: true });
  modal.addEventListener('touchcancel', onTouchEnd, { passive: true });
}

// ==========================================
// Universal Modal Pull-to-Dismiss Gesture
// (Matches Today's Schedule & Drawer pull down resistance and animation)
// ==========================================
function setupModalPullToDismiss(modal, onDismiss) {
  if (!modal || modal._hasPullToDismiss) return;
  modal._hasPullToDismiss = true;

  let touchStartY = 0;
  let touchStartX = 0;
  let isPullingDown = false;
  let didPullDown = false;

  const onTouchStart = (e) => {
    if (isDraggingTask || isSwipingCardToDelete) return;
    // Only exclude horizontal range sliders (e.g. volume slider) so moving sliders left/right doesn't pull down
    if (e.target.closest('input[type="range"]')) {
      return;
    }
    if (!e.touches || e.touches.length !== 1) return;

    touchStartY = e.touches[0].clientY;
    touchStartX = e.touches[0].clientX;
    isPullingDown = false;
    didPullDown = false;
  };

  const onTouchMove = (e) => {
    if (!touchStartY || !e.touches || e.touches.length !== 1) return;
    if (isDraggingTask || isSwipingCardToDelete) {
      if (isPullingDown) {
        modal.style.removeProperty('transform');
        modal.classList.remove('will-minimise');
        isPullingDown = false;
      }
      return;
    }
    const currentY = e.touches[0].clientY;
    const currentX = e.touches[0].clientX;

    // Check if user is touching inside a category chips list that is actively scrolled down
    const chipsList = e.target.closest('.category-chips-list');
    if (chipsList && chipsList.scrollTop > 0) {
      touchStartY = currentY;
      touchStartX = currentX;
      return;
    }

    const allScrolls = Array.from(modal.querySelectorAll('.modal-body'));
    const visibleScroll = allScrolls.find(el => el.offsetParent !== null) || modal;
    const activeScroll = e.target.closest('.modal-body') || visibleScroll;
    const isAtTop = !activeScroll || activeScroll.scrollTop <= 0;
    const isHeaderOrFooterTouch = Boolean(e.target.closest('.modal-header, .cal-drag-handle-bar, .calendar-modal-header, .settings-sub-header, .edit-modal-footer, .btn-close-modal, .edit-task-emoji-badge, .insights-modal-header, .insights-range-bar'));

    if (!isHeaderOrFooterTouch && !isAtTop && !isPullingDown) {
      touchStartY = currentY;
      touchStartX = currentX;
      return;
    }

    const deltaY = currentY - touchStartY;
    const deltaX = currentX - touchStartX;

    // If gesture is horizontal, abort pull down
    if (Math.abs(deltaX) > 8 && Math.abs(deltaX) * 1.2 >= Math.abs(deltaY)) {
      if (isPullingDown) {
        modal.style.removeProperty('transform');
        modal.classList.remove('will-minimise');
        isPullingDown = false;
      }
      return;
    }

    const isCenteredX = modal.classList.contains('insights-modal');

    if (deltaY > 10 && deltaY > Math.abs(deltaX) * 1.3) {
      if (isAtTop || isHeaderOrFooterTouch || Boolean(chipsList)) {
        if (!isPullingDown && document.activeElement && modal.contains(document.activeElement) && typeof document.activeElement.blur === 'function') {
          document.activeElement.blur();
        }
        isPullingDown = true;
        didPullDown = true;
        if (e.cancelable) e.preventDefault();
        const rubberbandY = Math.min(deltaY * 0.28, 140);
        modal.style.transition = 'none';
        modal.style.transform = isCenteredX
          ? 'translate3d(-50%, ' + rubberbandY + 'px, 0)'
          : 'translate3d(0, ' + rubberbandY + 'px, 0)';

        if (deltaY >= 65) {
          modal.classList.add('will-minimise');
          const closeBtn = modal.querySelector('.btn-close-modal');
          if (closeBtn) closeBtn.classList.add('will-minimise');
        } else {
          modal.classList.remove('will-minimise');
          const closeBtn = modal.querySelector('.btn-close-modal');
          if (closeBtn) closeBtn.classList.remove('will-minimise');
        }
      }
    } else if (deltaY <= 0 && isPullingDown) {
      modal.classList.remove('will-minimise');
      const closeBtn = modal.querySelector('.btn-close-modal');
      if (closeBtn) closeBtn.classList.remove('will-minimise');
    }
  };

  const onTouchEnd = () => {
    if (didPullDown) {
      const suppressClick = (clickEv) => {
        clickEv.stopPropagation();
        clickEv.preventDefault();
        window.removeEventListener('click', suppressClick, true);
      };
      window.addEventListener('click', suppressClick, true);
      setTimeout(() => {
        window.removeEventListener('click', suppressClick, true);
      }, 350);
    }

    if (!isPullingDown) {
      touchStartY = 0;
      touchStartX = 0;
      didPullDown = false;
      modal.classList.remove('will-minimise');
      const closeBtn = modal.querySelector('.btn-close-modal');
      if (closeBtn) closeBtn.classList.remove('will-minimise');
      return;
    }
    isPullingDown = false;
    const willMinimise = modal.classList.contains('will-minimise');
    modal.classList.remove('will-minimise');
    const closeBtn = modal.querySelector('.btn-close-modal');
    if (closeBtn) closeBtn.classList.remove('will-minimise');

    touchStartY = 0;
    touchStartX = 0;

    const isCenteredX = modal.classList.contains('insights-modal');

    if (willMinimise) {
      modal.style.transition = 'transform 0.28s cubic-bezier(0.16, 1, 0.3, 1)';
      modal.style.transform = isCenteredX
        ? 'translate3d(-50%, 100vh, 0)'
        : 'translate3d(0, 100vh, 0)';
      mobileServices.hapticBuzz();

      // Immediately restore active tab in drawer to Timer
      const navItemTimer = document.getElementById('navItemTimer');
      const navItemFullCalendar = document.getElementById('navItemFullCalendar');
      const navItemCalendar = document.getElementById('navItemCalendar');
      const navItemTodo = document.getElementById('navItemTodo');
      const navItemInsights = document.getElementById('navItemInsights');
      const navItemSettings = document.getElementById('navItemSettings');
      if (navItemFullCalendar) {
        navItemFullCalendar.classList.remove('active');
        if (typeof navItemFullCalendar.blur === 'function') navItemFullCalendar.blur();
      }
      if (navItemCalendar) {
        navItemCalendar.classList.remove('active');
        if (typeof navItemCalendar.blur === 'function') navItemCalendar.blur();
      }
      if (navItemTodo) {
        navItemTodo.classList.remove('active');
        if (typeof navItemTodo.blur === 'function') navItemTodo.blur();
      }
      if (navItemInsights) {
        navItemInsights.classList.remove('active');
        if (typeof navItemInsights.blur === 'function') navItemInsights.blur();
      }
      if (navItemSettings) {
        navItemSettings.classList.remove('active');
        if (typeof navItemSettings.blur === 'function') navItemSettings.blur();
      }
      if (navItemTimer) navItemTimer.classList.add('active');

      setTimeout(() => {
        modal.classList.remove('will-minimise');
        const closeBtn = modal.querySelector('.btn-close-modal');
        if (closeBtn) closeBtn.classList.remove('will-minimise');
        modal.style.removeProperty('transform');
        modal.style.removeProperty('transition');
        if (typeof onDismiss === 'function') {
          onDismiss();
        }
      }, 270);
    } else {
      modal.style.transition = 'transform 0.25s cubic-bezier(0.16, 1, 0.3, 1)';
      modal.style.transform = isCenteredX
        ? 'translate3d(-50%, 0, 0)'
        : 'translate3d(0, 0, 0)';
      setTimeout(() => {
        modal.style.removeProperty('transform');
        modal.style.removeProperty('transition');
      }, 250);
    }
  };

  modal.addEventListener('touchstart', onTouchStart, { passive: true });
  modal.addEventListener('touchmove', onTouchMove, { passive: false });
  modal.addEventListener('touchend', onTouchEnd, { passive: true });
  modal.addEventListener('touchcancel', onTouchEnd, { passive: true });
}

// ==========================================
// Today's Schedule Horizontal Swipe Toggle (Chronological <-> Sequential)
// ==========================================
function setupScheduleHorizontalSwipeToggle(container) {
  if (!container || container._hasHSwipeToggle) return;
  container._hasHSwipeToggle = true;

  const isSlideUpDrawer = container.id === 'taskDrawer' || Boolean(container.closest && container.closest('#taskDrawer'));

  let touchStartX = 0;
  let touchStartY = 0;
  let isHSwiping = false;
  let touchOnTask = false;

  container.addEventListener('touchstart', (e) => {
    if (isDraggingTask) return;
    if (!e.touches || e.touches.length !== 1) return;

    if (!isSlideUpDrawer) {
      // In calendarModal (menu bar tab), tasks have swipe-to-delete, so swiping on a task card
      // is reserved for swipe-to-delete and must not trigger chronological/sequential toggle.
      if (e.target.closest('.task-card, .calendar-item-wrapper, .calendar-block, .todo-block, .todo-item-wrapper')) {
        touchOnTask = true;
        isHSwiping = false;
        return;
      }
    }

    touchOnTask = false;
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
    isHSwiping = false;
  }, { passive: true });

  container.addEventListener('touchmove', (e) => {
    if (isDraggingTask || touchOnTask) {
      isHSwiping = false;
      return;
    }
    if (!e.touches || e.touches.length !== 1) return;
    const diffX = e.touches[0].clientX - touchStartX;
    const diffY = e.touches[0].clientY - touchStartY;

    if (Math.abs(diffX) >= 35 && Math.abs(diffX) > Math.abs(diffY) * 1.3) {
      isHSwiping = true;
    }
  }, { passive: true });

  container.addEventListener('touchend', (e) => {
    if (!isHSwiping || isDraggingTask || touchOnTask) {
      isHSwiping = false;
      touchOnTask = false;
      return;
    }
    const touch = (e.changedTouches && e.changedTouches[0]) ? e.changedTouches[0] : null;
    if (!touch) {
      isHSwiping = false;
      return;
    }
    const diffX = touch.clientX - touchStartX;
    const diffY = touch.clientY - touchStartY;

    if (Math.abs(diffX) >= 35 && Math.abs(diffX) > Math.abs(diffY) * 1.3) {
      const suppressClick = () => {
        const handler = (ev) => {
          ev.stopPropagation();
          ev.preventDefault();
          window.removeEventListener('click', handler, true);
        };
        window.addEventListener('click', handler, true);
        setTimeout(() => {
          window.removeEventListener('click', handler, true);
        }, 350);
      };

      const currentMode = (typeof taskStore !== 'undefined' && typeof taskStore.getAppMode === 'function')
        ? taskStore.getAppMode()
        : 'advanced';

      if (currentMode === 'simple') {
        // Simple Mode: Loop (left, true) vs End (right, false)
        const isLoop = (typeof taskStore !== 'undefined' && typeof taskStore.getSimpleLoopEnabled === 'function')
          ? taskStore.getSimpleLoopEnabled()
          : true;

        if (isLoop && diffX >= 35) {
          suppressClick();
          if (typeof window.setSimpleLoopOption === 'function') {
            window.setSimpleLoopOption(false);
          }
        } else if (!isLoop && diffX <= -35) {
          suppressClick();
          if (typeof window.setSimpleLoopOption === 'function') {
            window.setSimpleLoopOption(true);
          }
        }
      } else {
        // Standard Mode: Chronological (left, true) vs Sequential (right, false)
        const isChrono = (typeof taskStore !== 'undefined' && typeof taskStore.getTimespansEnabled === 'function')
          ? taskStore.getTimespansEnabled()
          : true;

        if (isChrono && diffX >= 35) {
          suppressClick();
          setScheduleMode(false);
        } else if (!isChrono && diffX <= -35) {
          suppressClick();
          setScheduleMode(true);
        }
      }
    }
    isHSwiping = false;
    touchOnTask = false;
  }, { passive: true });

  container.addEventListener('touchcancel', () => {
    isHSwiping = false;
    touchOnTask = false;
  }, { passive: true });
}

// ==========================================
// Interactive Live Drag Reordering (Mobile Touch + Desktop Pointer)
// ==========================================
function setupInteractiveTaskDrag(container) {
  if (!container || container._hasInteractiveDrag) return;
  container._hasInteractiveDrag = true;

  container.addEventListener('pointerdown', (e) => {
    // Only accept primary pointer (left mouse click or touch)
    if (e.button !== undefined && e.button !== 0) return;

    // Reject all drag interactions if drawer is collapsed or modal is pulling down to dismiss
    const drawer = container.closest('#taskDrawer');
    if (drawer && drawer.classList.contains('collapsed')) return;
    if (isCalendarModalPullingDown || isDrawerPullingDown || isSwipingCardToDelete) return;

    // Drag can begin on the 3x2 dots drag handle OR the left gutter area of the card (left of dots up to task border)
    const isEmoji = e.target.closest('.task-emoji-btn, .calendar-emoji-btn, [data-action="pick-emoji"], [data-action="pick-calendar-emoji"]');
    if (isEmoji) return;
    let handle = e.target.closest('[data-action="drag-handle"], .drag-handle, .drag-handle-compact, .calendar-block-left');
    if (!handle) {
      const cardEl = e.target.closest('.task-card, .calendar-item-wrapper, .calendar-block');
      if (cardEl) {
        const rect = cardEl.getBoundingClientRect();
        if (e.clientX - rect.left <= 44) {
          handle = cardEl.querySelector('[data-action="drag-handle"], .drag-handle, .drag-handle-compact, .calendar-block-left');
        }
      }
    }
    if (!handle) return;

    const card = e.target.closest('.task-card, .calendar-item-wrapper, .calendar-block');
    if (!card) return;

    const dragCard = card.closest('.calendar-item-wrapper') || card;

    const allCards = Array.from(container.children).filter(c => c.matches('.task-card, .calendar-item-wrapper, .calendar-block'));
    const fromIndex = allCards.indexOf(dragCard);
    if (fromIndex === -1) return;

    const activeIdx = runtime && runtime.activeTaskIndex >= 0 ? runtime.activeTaskIndex : 0;
    const isRunning = runtime && runtime.status === TimerStatus.RUNNING;
    const isPaused = runtime && runtime.status === TimerStatus.PAUSED;

    const activePointerId = e.pointerId;
    const startX = e.clientX;
    const startY = e.clientY;

    let holdTimer = null;
    let isDragActive = false;
    let currentSlotIndex = fromIndex;
    let cardSlotPositions = [];
    let initialCardTop = 0;
    let slotSpacing = 68;

    const draggedCard = dragCard;
    const draggedTaskId = draggedCard.getAttribute('data-id') || (() => { const _q = draggedCard.querySelector("[data-id]"); return _q ? _q.getAttribute("data-id") : null; })();

    // 200ms HOLD REQUIRED before drag or locked/running warnings engage!
    // Simply swiping across or touching the 3x2 dots does NOT block scrolling or show warnings.
    holdTimer = setTimeout(() => {
      holdTimer = null;

      // 1. If task is locked, notify user on press-hold
      if (dragCard.querySelector('.is-locked-task') || dragCard.classList.contains('is-locked-task')) {
        mobileServices.hapticWarning();
        showToastNotification('🔒 This task is locked and cannot be moved.');
        if (handle) handle.classList.remove('is-holding');
        draggedCard.querySelectorAll('.is-holding').forEach(el => el.classList.remove('is-holding'));
        return;
      }

      // 2. In RUNNING state: current active task or past tasks cannot be moved!
      // Future tasks (> activeIdx) that don't affect the current active task ARE allowed to be moved!
      if (isRunning && fromIndex <= activeIdx) {
        mobileServices.hapticWarning();
        showToastNotification('Active task is running. Pause timer to reorder.');
        if (handle) handle.classList.remove('is-holding');
        draggedCard.querySelectorAll('.is-holding').forEach(el => el.classList.remove('is-holding'));
        return;
      }

      // 3. In PAUSED state: if active task is locked, notify user to deselect padlock first
      if (isPaused && fromIndex === activeIdx && (dragCard.querySelector('.is-locked-task') || dragCard.classList.contains('is-locked-task'))) {
        mobileServices.hapticWarning();
        showToastNotification('Deselect the padlock to unlock active task first.');
        if (handle) handle.classList.remove('is-holding');
        draggedCard.querySelectorAll('.is-holding').forEach(el => el.classList.remove('is-holding'));
        return;
      }

      isDragActive = true;
      isDraggingTask = true;
      if (handle) handle.classList.add('is-holding');
      const dotsEl = draggedCard.querySelector('[data-action="drag-handle"], .drag-handle, .drag-handle-compact');
      if (dotsEl) dotsEl.classList.add('is-holding');

      try {
        handle.setPointerCapture(activePointerId);
      } catch (_) {}

      const draggedRect = draggedCard.getBoundingClientRect();
      initialCardTop = draggedRect.top;
      slotSpacing = draggedRect.height + 8;

      cardSlotPositions = allCards.map((c, idx) => {
        const r = c.getBoundingClientRect();
        const id = c.getAttribute('data-id') || (() => { const _q = c.querySelector("[data-id]"); return _q ? _q.getAttribute("data-id") : null; })();
        return {
          card: c,
          id: id,
          index: idx,
          top: r.top,
          height: r.height,
          midY: r.top + r.height / 2
        };
      });

      draggedCard.classList.add('is-live-dragging');
      const innerBlock = draggedCard.querySelector('.calendar-block');
      if (innerBlock) innerBlock.classList.add('is-live-dragging');

      allCards.forEach(c => {
        if (c !== draggedCard) {
          c.classList.add('is-drag-sibling');
        }
      });

      mobileServices.hapticTap();
    }, 200);

    const onPointerMove = (moveEv) => {
      if (moveEv.pointerId !== activePointerId) return;

      if (!isDragActive) {
        if (isCalendarModalPullingDown || isDrawerPullingDown || isSwipingCardToDelete) {
          if (holdTimer) {
            clearTimeout(holdTimer);
            holdTimer = null;
          }
          if (handle) handle.classList.remove('is-holding');
          draggedCard.querySelectorAll('.is-holding').forEach(el => el.classList.remove('is-holding'));
          return;
        }
        // Cancel hold if finger moves before 200ms (user is swiping/scrolling)
        if (Math.hypot(moveEv.clientX - startX, moveEv.clientY - startY) > 8) {
          if (holdTimer) {
            clearTimeout(holdTimer);
            holdTimer = null;
          }
          if (handle) handle.classList.remove('is-holding');
          draggedCard.querySelectorAll('.is-holding').forEach(el => el.classList.remove('is-holding'));
        }
        return;
      }

      moveEv.preventDefault();
      const deltaY = moveEv.clientY - startY;
      draggedCard.style.transform = `translate3d(0, ${deltaY}px, 0) scale(1.03)`;

      if (Math.abs(deltaY) < 10) {
        if (currentSlotIndex !== fromIndex) {
          currentSlotIndex = fromIndex;
          cardSlotPositions.forEach(({ card: siblingCard }) => {
            siblingCard.style.transform = 'translate3d(0, 0, 0)';
          });
        }
        return;
      }

      const currentCenterY = initialCardTop + ((cardSlotPositions[fromIndex] ? cardSlotPositions[fromIndex].height : 60) || 60) / 2 + deltaY;
      let closestSlot = fromIndex;
      let minDistance = Infinity;
      cardSlotPositions.forEach((slot, idx) => {
        if (isRunning && idx <= activeIdx) return;
        const dist = Math.abs(currentCenterY - slot.midY);
        if (dist < minDistance) {
          minDistance = dist;
          closestSlot = idx;
        }
      });

      let targetSlot = closestSlot;
      if (isRunning) {
        targetSlot = Math.max(activeIdx + 1, Math.min(cardSlotPositions.length - 1, closestSlot));
      } else {
        targetSlot = Math.max(0, Math.min(cardSlotPositions.length - 1, closestSlot));
      }

      if (targetSlot !== currentSlotIndex) {
        currentSlotIndex = targetSlot;
        mobileServices.hapticTap();

        cardSlotPositions.forEach(({ card: siblingCard, index }) => {
          if (index === fromIndex) return;

          if (fromIndex < currentSlotIndex) {
            if (index > fromIndex && index <= currentSlotIndex) {
              siblingCard.style.transform = `translate3d(0, -${slotSpacing}px, 0)`;
            } else {
              siblingCard.style.transform = 'translate3d(0, 0, 0)';
            }
          } else if (fromIndex > currentSlotIndex) {
            if (index < fromIndex && index >= currentSlotIndex) {
              siblingCard.style.transform = `translate3d(0, ${slotSpacing}px, 0)`;
            } else {
              siblingCard.style.transform = 'translate3d(0, 0, 0)';
            }
          } else {
            siblingCard.style.transform = 'translate3d(0, 0, 0)';
          }
        });
      }
    };

    const onPointerUp = (upEv) => {
      if (upEv.pointerId !== activePointerId) return;

      if (holdTimer) {
        clearTimeout(holdTimer);
        holdTimer = null;
      }
      if (handle) handle.classList.remove('is-holding');
      draggedCard.querySelectorAll('.is-holding').forEach(el => el.classList.remove('is-holding'));

      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);

      if (!isDragActive) {
        return;
      }

      isDragActive = false;
      isDraggingTask = false;

      try {
        handle.releasePointerCapture(activePointerId);
      } catch (_) {}

      const targetTaskId = (cardSlotPositions[currentSlotIndex] ? cardSlotPositions[currentSlotIndex].id : null);

      allCards.forEach(c => {
        c.classList.remove('is-live-dragging', 'is-drag-sibling');
        c.style.transform = '';
        const b = c.querySelector('.calendar-block');
        if (b) b.classList.remove('is-live-dragging');
      });
      if (handle) handle.classList.remove('is-holding');

      if (draggedTaskId && targetTaskId && draggedTaskId !== targetTaskId) {
        taskStore.reorderTaskById(draggedTaskId, targetTaskId);
        runtime.initialTasks = taskStore.getTasks();
        runtime.recalculate();
        syncDynamicScheduleTimesToCalendar();
        if (runtime.status === TimerStatus.IDLE) {
          runtime.activeTaskIndex = 0;
        }
        updateActiveTaskDisplay();
        renderTaskList(((runtime.currentSchedule && runtime.currentSchedule.tasks) || []) || []);
        renderCalendarModal();
        updateScheduleUI(runtime.currentSchedule);
        const activeTask = runtime.getActiveTask();
        if (activeTask && runtime.status === TimerStatus.IDLE) {
          renderClockTime(activeTask.allocatedDuration * 60 || 1500);
          updateWheelProgress(0);
        }
        mobileServices.hapticBuzz();
        showToastNotification('✓ Task moved');
        if (typeof calendarSyncService !== 'undefined' && typeof calendarSyncService.triggerOutboundSyncDebounced === 'function') {
          calendarSyncService.triggerOutboundSyncDebounced();
        }
      }
    };

    window.addEventListener('pointermove', onPointerMove, { passive: false });
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
  });
}

// ==========================================
// Time Bank & Piggy Bank Helpers
// ==========================================
function getPiggyBankSvg(isCracked = false) {
  if (isCracked) {
    return `
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M11 3C8 3 5.5 5 4.5 7.5L3 11c0 4 3 7 7 7.5v2.5h2v-2.5l-2-2 3-3-3-3 2-3-2-2.5C10.5 4.2 10.7 3.5 11 3z"/>
        <path d="M15 3c2.5.5 4.5 2.5 5 5 .5 1.5.5 3 0 4.5-1 2.5-3 4-5.5 4.5v3h-2v-3l2-2-3-3 3-3-2-3 2-2.5c-.5-.3-1-.5-1.5-.5z"/>
        <line x1="12" y1="1" x2="12" y2="4"/>
        <circle cx="7" cy="9" r="1" fill="currentColor"/>
      </svg>
    `;
  }
  return `
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M19 12c.7-1.3 1-2.8 1-4.2C20 4.6 17.4 2 14.2 2c-1.3 0-2.5.4-3.5 1.1L8.5 2H6v3.2L4.7 6.4C3.6 7.6 3 9.2 3 11c0 4.4 3.6 8 8 8h1v2h2v-2h2v2h2v-2.2c2.4-1.2 4-3.7 4-6.8z"/>
      <circle cx="8" cy="9" r="1" fill="currentColor"/>
      <line x1="12" y1="6" x2="15" y2="6"/>
    </svg>
  `;
}

function formatBankTime(totalSeconds) {
  const sec = Math.max(0, totalSeconds || 0);
  const min = Math.floor(sec / 60);
  const remSec = sec % 60;
  if (min >= 60) {
    const hours = Math.floor(min / 60);
    const remMin = min % 60;
    return `${hours}h ${remMin}m`;
  }
  if (min === 0) {
    return `${remSec}s`;
  }
  if (remSec === 0) {
    return `${min}m`;
  }
  return `${min}m ${remSec}s`;
}

function updateTimeBankDisplay() {
  const bankAmountEl = document.getElementById('timeBankAmount');
  const bankPillEl = document.getElementById('timeBankPill');
  if (bankAmountEl) {
    const sec = taskStore.getTimeBankSeconds();
    bankAmountEl.textContent = formatBankTime(sec);
  }
  if (bankPillEl) {
    if (runtime && runtime.isOverrunning) {
      bankPillEl.classList.add('is-active-overrun');
    } else {
      bankPillEl.classList.remove('is-active-overrun');
    }
  }
}

function setupTimeBankInfoModal() {
  const bankPillEl = document.getElementById('timeBankPill');
  const modalBackdrop = document.getElementById('timeBankInfoModalBackdrop');
  const btnClose = document.getElementById('btnCloseTimeBankInfo');
  const balanceText = document.getElementById('timeBankModalBalance');

  if (bankPillEl) {
    bankPillEl.addEventListener('click', () => {
      mobileServices.hapticTap();
      if (balanceText) {
        const sec = taskStore.getTimeBankSeconds();
        balanceText.textContent = `Current balance: ${formatBankTime(sec)}`;
      }
      if (modalBackdrop) modalBackdrop.classList.remove("hidden");
    });
  }

  if (btnClose) {
    btnClose.addEventListener('click', () => {
      if (modalBackdrop) modalBackdrop.classList.add("hidden");
    });
  }

  if (modalBackdrop) {
    modalBackdrop.addEventListener('click', (e) => {
      if (e.target === modalBackdrop) {
        modalBackdrop.classList.add('hidden');
      }
    });
  }
}

// ==========================================
// Dynamic Schedule & Calendar Synchronization
// ==========================================
function syncDynamicScheduleTimesToCalendar() {
  if (!runtime || !runtime.currentSchedule || !runtime.currentSchedule.tasks) return;
  const todayStr = taskStore.getTodayDateString();
  const scheduledTasks = runtime.currentSchedule.tasks;
  const calEvents = taskStore.getCalendarEvents();
  const storeTasks = taskStore.getTasks();
  let updatedAnyCal = false;
  let updatedAnyTask = false;

  scheduledTasks.forEach(schedTask => {
    const calEvent = calEvents.find(e => e.id === schedTask.id && e.date === todayStr);
    if (calEvent) {
      if (calEvent.startTime !== schedTask.startTime || calEvent.endTime !== schedTask.endTime || calEvent.plannedDuration !== schedTask.plannedDuration) {
        calEvent.startTime = schedTask.startTime;
        calEvent.endTime = schedTask.endTime;
        calEvent.plannedDuration = schedTask.plannedDuration;
        const isCreating = (typeof calendarSyncService !== 'undefined' && typeof calendarSyncService.isCreatingEvent === 'function' && calendarSyncService.isCreatingEvent(schedTask.id));
        if (!isCreating) {
          calEvent.isDirty = true;
        }
        calEvent.lastModified = Date.now();
        if (typeof calendarSyncService !== 'undefined' && typeof calendarSyncService.computeSyncHash === 'function') {
          calEvent.syncHash = calendarSyncService.computeSyncHash(calEvent);
        }
        updatedAnyCal = true;
      }
    } else {
      const isCreating = (typeof calendarSyncService !== 'undefined' && typeof calendarSyncService.isCreatingEvent === 'function' && calendarSyncService.isCreatingEvent(schedTask.id));
      const hasExtId = Boolean(schedTask.externalId || schedTask.googleEventId || schedTask.microsoftEventId);
      calEvents.push({
        id: schedTask.id,
        title: schedTask.title,
        date: todayStr,
        startTime: schedTask.startTime || '09:00',
        endTime: schedTask.endTime || '10:00',
        plannedDuration: schedTask.plannedDuration || 30,
        isLocked: Boolean(schedTask.isLocked),
        useTimeBank: schedTask.useTimeBank !== false,
        emoji: schedTask.emoji || '📌',
        category: schedTask.category || 'General',
        color: schedTask.color || (typeof classifierGetCategoryColor === 'function' ? classifierGetCategoryColor(schedTask.category) : '#3b82f6'),
        colorId: schedTask.colorId || null,
        source: schedTask.source || 'local',
        origin: schedTask.origin || 'local',
        createdInApp: schedTask.createdInApp !== undefined ? Boolean(schedTask.createdInApp) : true,
        isDirty: (!isCreating && !hasExtId) ? Boolean(schedTask.isDirty) : false,
        googleEventId: schedTask.googleEventId || null,
        microsoftEventId: schedTask.microsoftEventId || null,
        externalId: schedTask.externalId || schedTask.googleEventId || schedTask.microsoftEventId || null,
        externalCalendarId: schedTask.externalCalendarId || null,
        isCalentimerMirror: Boolean(schedTask.isCalentimerMirror),
        provider: schedTask.provider || 'local',
        lastModified: Date.now()
      });
      updatedAnyCal = true;
    }

    const t = storeTasks.find(item => item.id === schedTask.id);
    if (t) {
      if (t.isLocked && (t.fixedStartTime || t.startTime) && (t.fixedEndTime || t.endTime)) {
        // Locked tasks must strictly preserve their fixed timespan
        const lockedStart = t.fixedStartTime || t.startTime;
        const lockedEnd = t.fixedEndTime || t.endTime;
        if (t.startTime !== lockedStart || t.endTime !== lockedEnd) {
          t.startTime = lockedStart;
          t.endTime = lockedEnd;
          updatedAnyTask = true;
        }
      } else if (t.startTime !== schedTask.startTime || t.endTime !== schedTask.endTime || t.plannedDuration !== schedTask.plannedDuration) {
        t.startTime = schedTask.startTime;
        t.endTime = schedTask.endTime;
        t.plannedDuration = schedTask.plannedDuration;
        updatedAnyTask = true;
      }
    }
  });

  if (updatedAnyTask) {
    taskStore.saveTasks(storeTasks, true);
  }
  if (updatedAnyCal) {
    taskStore.saveCalendarEvents(calEvents, true);
    if (calendarView && typeof calendarView.render === 'function' && typeof calendarView.isOpen === 'function' && calendarView.isOpen()) {
      calendarView.render();
    }
    if (typeof calendarSyncService !== 'undefined' && typeof calendarSyncService.triggerOutboundSyncDebounced === 'function') {
      calendarSyncService.triggerOutboundSyncDebounced();
    }
  }
}

// ==========================================
// Schedule Overlap Conflict Resolution Modal
// ==========================================
let dismissedOverlapPairs = new Set();
let currentConflictData = null;

function checkActiveTaskTimerConflict(activeTask) {
  const isSimple = (typeof taskStore !== 'undefined' && typeof taskStore.getSimpleModeEnabled === 'function') && taskStore.getSimpleModeEnabled();
  const isTimespans = (typeof taskStore !== 'undefined' && typeof taskStore.getTimespansEnabled === 'function') ? taskStore.getTimespansEnabled() : true;
  if (isSimple || !isTimespans) return;
  if (!activeTask || activeTask.isCompleted || !activeTask.startTime || !activeTask.endTime) return;
  const tasks = ((runtime && runtime.currentSchedule && runtime.currentSchedule.tasks) || taskStore.getTasks()) || [];
  if (tasks.length < 2) return;

  const aStart = parseTimeToMinutes(activeTask.startTime);
  let aEnd = parseTimeToMinutes(activeTask.endTime);
  if (aEnd <= aStart) aEnd += 1440;

  for (let i = 0; i < tasks.length; i++) {
    const other = tasks[i];
    if (other.id === activeTask.id) continue;
    if (other.isCompleted) continue;
    if (!other.startTime || !other.endTime) continue;
    const bStart = parseTimeToMinutes(other.startTime);
    let bEnd = parseTimeToMinutes(other.endTime);
    if (bEnd <= bStart) bEnd += 1440;

    if (aStart < bEnd && bStart < aEnd) {
      const pairKey = `${activeTask.id}_${other.id}`;
      const reverseKey = `${other.id}_${activeTask.id}`;
      const timeKey = `${activeTask.id}:${activeTask.startTime}-${activeTask.endTime}__${other.id}:${other.startTime}-${other.endTime}`;
      const altTimeKey = `${other.id}:${other.startTime}-${other.endTime}__${activeTask.id}:${activeTask.startTime}-${activeTask.endTime}`;
      if (!dismissedOverlapPairs.has(pairKey) && !dismissedOverlapPairs.has(reverseKey) && !dismissedOverlapPairs.has(timeKey) && !dismissedOverlapPairs.has(altTimeKey)) {
        const idxA = tasks.findIndex(t => t.id === activeTask.id);
        const idxB = i;
        openScheduleConflictModal(activeTask, other, idxA, idxB);
        return;
      }
    }
  }
}
window.checkActiveTaskTimerConflict = checkActiveTaskTimerConflict;

function handleSwapOverlapPriority(taskId, dir) {
  const currentTasks = taskStore.getTasks();
  const idx = currentTasks.findIndex(t => t.id === taskId);
  if (idx === -1) return;
  const currentTask = currentTasks[idx];

  // Find partner overlapping task
  let partnerTask = null;
  let partnerIdx = -1;
  const curStart = parseTimeToMinutes(currentTask.startTime || currentTask.fixedStartTime || '00:00');
  let curEnd = parseTimeToMinutes(currentTask.endTime || '23:59');
  if (curEnd <= curStart) curEnd += 1440;

  for (let i = 0; i < currentTasks.length; i++) {
    if (i === idx) continue;
    const t = currentTasks[i];
    const tStartStr = t.startTime || t.fixedStartTime;
    if (!tStartStr || !t.endTime) continue;
    const oStart = parseTimeToMinutes(tStartStr);
    let oEnd = parseTimeToMinutes(t.endTime);
    if (oEnd <= oStart) oEnd += 1440;

    if (curStart < oEnd && oStart < curEnd) {
      partnerTask = t;
      partnerIdx = i;
      break;
    }
  }

  if (!partnerTask) return;

  if (typeof taskStore.swapTasks === 'function') {
    taskStore.swapTasks(currentTask.id, partnerTask.id);
  } else {
    taskStore.reorderTaskById(currentTask.id, partnerTask.id);
  }

  runtime.initialTasks = taskStore.getTasks();
  if (runtime.status === TimerStatus.IDLE) {
    runtime.activeTaskIndex = -1;
  }
  runtime.recalculate();
  syncDynamicScheduleTimesToCalendar();
  updateScheduleUI(runtime.currentSchedule);
  updateActiveTaskDisplay();
  if (runtime.status === TimerStatus.IDLE) {
    renderClockTime(runtime.getRemainingSeconds());
  }
  renderTaskList(((runtime.currentSchedule && runtime.currentSchedule.tasks) || []) || taskStore.getTasks());
  renderCalendarModal();
  mobileServices.hapticTap();
  const promotedTask = idx > partnerIdx ? currentTask : partnerTask;
  showToastNotification(`✓ "${promotedTask.title}" set as active priority`);
}
window.handleSwapOverlapPriority = handleSwapOverlapPriority;

function checkAndPromptScheduleConflict(tasks) {
  const isSimple = (typeof taskStore !== 'undefined' && typeof taskStore.getSimpleModeEnabled === 'function') && taskStore.getSimpleModeEnabled();
  const isTimespans = (typeof taskStore !== 'undefined' && typeof taskStore.getTimespansEnabled === 'function') ? taskStore.getTimespansEnabled() : true;
  if (isSimple || !isTimespans) return;
  if (!tasks || tasks.length < 2) return;
  if (typeof calendarView !== 'undefined' && calendarView) {
    if ((typeof calendarView.isOpen === 'function' && calendarView.isOpen()) || calendarView.isDraggingEvent) {
      return;
    }
  }
  const modalBackdrop = document.getElementById('scheduleConflictModalBackdrop');
  if (!modalBackdrop) return;

  for (let i = 0; i < tasks.length; i++) {
    const tA = tasks[i];
    if (tA.isCompleted || !tA.startTime || !tA.endTime) continue;
    const aStart = parseTimeToMinutes(tA.startTime);
    let aEnd = parseTimeToMinutes(tA.endTime);
    if (aEnd <= aStart) aEnd += 1440;

    for (let j = i + 1; j < tasks.length; j++) {
      const tB = tasks[j];
      if (tB.isCompleted || !tB.startTime || !tB.endTime) continue;
      const bStart = parseTimeToMinutes(tB.startTime);
      let bEnd = parseTimeToMinutes(tB.endTime);
      if (bEnd <= bStart) bEnd += 1440;

      if (aStart < bEnd && bStart < aEnd) {
        const pairKey = `${tA.id}_${tB.id}`;
        const reverseKey = `${tB.id}_${tA.id}`;
        const timeKey = `${tA.id}:${tA.startTime}-${tA.endTime}__${tB.id}:${tB.startTime}-${tB.endTime}`;
        const altTimeKey = `${tB.id}:${tB.startTime}-${tB.endTime}__${tA.id}:${tA.startTime}-${tA.endTime}`;
        if (!dismissedOverlapPairs.has(pairKey) && !dismissedOverlapPairs.has(reverseKey) && !dismissedOverlapPairs.has(timeKey) && !dismissedOverlapPairs.has(altTimeKey)) {
          openScheduleConflictModal(tA, tB, i, j);
          return;
        }
      }
    }
  }
}

function promptConflictForTask(taskId, taskList) {
  if (!taskId) return;
  const isSimple = (typeof taskStore !== 'undefined' && typeof taskStore.getSimpleModeEnabled === 'function') && taskStore.getSimpleModeEnabled();
  const isTimespans = (typeof taskStore !== 'undefined' && typeof taskStore.getTimespansEnabled === 'function') ? taskStore.getTimespansEnabled() : true;
  if (isSimple || !isTimespans) {
    openTaskEditModal(taskId);
    return;
  }
  const tasks = taskList || ((runtime && runtime.currentSchedule && runtime.currentSchedule.tasks) || taskStore.getTasks()) || [];
  if (tasks.length < 2) {
    openTaskEditModal(taskId);
    return;
  }
  const targetTask = tasks.find(t => t.id === taskId);
  if (!targetTask || targetTask.isCompleted || !targetTask.startTime || !targetTask.endTime) {
    openTaskEditModal(taskId);
    return;
  }

  const tStart = parseTimeToMinutes(targetTask.startTime);
  let tEnd = parseTimeToMinutes(targetTask.endTime);
  if (tEnd <= tStart) tEnd += 1440;

  for (let i = 0; i < tasks.length; i++) {
    const other = tasks[i];
    if (other.id === taskId) continue;
    if (other.isCompleted || !other.startTime || !other.endTime) continue;
    const oStart = parseTimeToMinutes(other.startTime);
    let oEnd = parseTimeToMinutes(other.endTime);
    if (oEnd <= oStart) oEnd += 1440;

    if (tStart < oEnd && oStart < tEnd) {
      const idxTarget = tasks.findIndex(t => t.id === targetTask.id);
      const idxOther = tasks.findIndex(t => t.id === other.id);
      if (tStart <= oStart) {
        openScheduleConflictModal(targetTask, other, idxTarget, idxOther);
      } else {
        openScheduleConflictModal(other, targetTask, idxOther, idxTarget);
      }
      return;
    }
  }

  openTaskEditModal(taskId);
}

function openScheduleConflictModal(taskA, taskB, idxA, idxB) {
  const modalBackdrop = document.getElementById('scheduleConflictModalBackdrop');
  if (!modalBackdrop) return;

  currentConflictData = { taskA, taskB, idxA, idxB };

  const sub = document.getElementById('scheduleConflictSubtitle');
  if (sub) {
    sub.textContent = `"${taskA.title}" (${taskA.startTime} - ${taskA.endTime}) and "${taskB.title}" (${taskB.startTime} - ${taskB.endTime}) overlap. Select which task should run on the active timer:`;
  }

  const titleA = document.getElementById('conflictTitleA');
  const timeA = document.getElementById('conflictTimeA');
  const titleB = document.getElementById('conflictTitleB');
  const timeB = document.getElementById('conflictTimeB');

  if (titleA) titleA.textContent = taskA.title || 'Task A';
  if (timeA) timeA.textContent = `${taskA.startTime || '--:--'} - ${taskA.endTime || '--:--'} (${taskA.allocatedDuration || taskA.plannedDuration}m)`;
  if (titleB) titleB.textContent = taskB.title || 'Task B';
  if (timeB) timeB.textContent = `${taskB.startTime || '--:--'} - ${taskB.endTime || '--:--'} (${taskB.allocatedDuration || taskB.plannedDuration}m)`;

  const radioA = document.getElementById('conflictRadioA');
  const radioB = document.getElementById('conflictRadioB');
  const optA = document.getElementById('conflictTaskOptionA');
  const optB = document.getElementById('conflictTaskOptionB');

  if (radioA) radioA.checked = true;
  if (optA) optA.classList.add('active');
  if (optB) optB.classList.remove('active');

  // Cascade Overlap Check:
  // If Task B is pushed to start when Task A finishes, check if that new window collides with subsequent task C
  const allTasks = ((runtime && runtime.currentSchedule && runtime.currentSchedule.tasks) || taskStore.getTasks()) || [];
  const targetStartTime = taskA.endTime;
  const dur = taskB.plannedDuration || 30;
  const startMin = parseTimeToMinutes(targetStartTime);
  let endMin = (startMin + dur) % 1440;
  if (endMin <= startMin) endMin += 1440;
  const targetEndTime = formatMinutesToTime(endMin % 1440);

  let cascadingTask = null;
  for (let k = 0; k < allTasks.length; k++) {
    const tC = allTasks[k];
    if (tC.id === taskA.id || tC.id === taskB.id) continue;
    if (!tC.startTime || !tC.endTime) continue;
    const cStart = parseTimeToMinutes(tC.startTime);
    let cEnd = parseTimeToMinutes(tC.endTime);
    if (cEnd <= cStart) cEnd += 1440;

    if (startMin < cEnd && cStart < endMin) {
      cascadingTask = tC;
      break;
    }
  }

  const cascadeEl = document.getElementById('conflictCascadeWarning');
  const cascadeText = document.getElementById('conflictCascadeText');
  if (cascadeEl && cascadeText) {
    if (cascadingTask) {
      cascadeText.textContent = `Shifting "${taskB.title}" to ${targetStartTime} - ${targetEndTime} will cause it to overlap with "${cascadingTask.title}" (${cascadingTask.startTime} - ${cascadingTask.endTime}). You will be prompted to resolve that next.`;
      cascadeEl.classList.remove('hidden');
    } else {
      cascadeEl.classList.add('hidden');
    }
  }

  modalBackdrop.classList.remove('hidden');
  mobileServices.hapticWarning();
}

function closeScheduleConflictModal() {
  const modalBackdrop = document.getElementById('scheduleConflictModalBackdrop');
  if (modalBackdrop) modalBackdrop.classList.add('hidden');
  if (currentConflictData) {
    const tA = currentConflictData.taskA;
    const tB = currentConflictData.taskB;
    dismissedOverlapPairs.add(`${tA.id}_${tB.id}`);
    dismissedOverlapPairs.add(`${tB.id}_${tA.id}`);
    if (tA.startTime && tA.endTime && tB.startTime && tB.endTime) {
      dismissedOverlapPairs.add(`${tA.id}:${tA.startTime}-${tA.endTime}__${tB.id}:${tB.startTime}-${tB.endTime}`);
      dismissedOverlapPairs.add(`${tB.id}:${tB.startTime}-${tB.endTime}__${tA.id}:${tA.startTime}-${tA.endTime}`);
    }
  }
}

function setupScheduleConflictModal() {
  const modalBackdrop = document.getElementById('scheduleConflictModalBackdrop');
  const optA = document.getElementById('conflictTaskOptionA');
  const optB = document.getElementById('conflictTaskOptionB');
  const radioA = document.getElementById('conflictRadioA');
  const radioB = document.getElementById('conflictRadioB');
  const btnShift = document.getElementById('btnConflictShift');
  const btnKeep = document.getElementById('btnConflictKeep');

  if (optA) {
    optA.addEventListener('click', () => {
      if (radioA) radioA.checked = true;
      optA.classList.add('active');
      if (optB) optB.classList.remove('active');
    });
  }
  if (optB) {
    optB.addEventListener('click', () => {
      if (radioB) radioB.checked = true;
      optB.classList.add('active');
      if (optA) optA.classList.remove('active');
    });
  }

  // Choice A: Push Overlapping Task
  if (btnShift) {
    btnShift.addEventListener('click', () => {
      if (!currentConflictData) {
        closeScheduleConflictModal();
        return;
      }
      const taskA = currentConflictData.taskA;
      const taskB = currentConflictData.taskB;

      const targetStartTime = taskA.endTime;
      const dur = taskB.plannedDuration || 30;
      const startMin = parseTimeToMinutes(targetStartTime);
      const endMin = (startMin + dur) % 1440;
      const targetEndTime = formatMinutesToTime(endMin);

      const wasLocked = Boolean(taskB.isLocked);
      taskStore.updateTask(taskB.id, {
        fixedStartTime: wasLocked ? targetStartTime : null,
        startTime: targetStartTime,
        endTime: targetEndTime,
        isLocked: wasLocked
      });

      runtime.initialTasks = taskStore.getTasks();
      runtime.recalculate();
      syncDynamicScheduleTimesToCalendar();
      updateScheduleUI(runtime.currentSchedule);
      renderTaskList(((runtime.currentSchedule && runtime.currentSchedule.tasks) || []) || []);
      renderCalendarModal();

      closeScheduleConflictModal();
      mobileServices.hapticTap();
      showToastNotification(`✓ Pushed "${taskB.title}" to start at ${targetStartTime}`);

      setTimeout(() => {
        const nextTasks = (runtime && runtime.currentSchedule && runtime.currentSchedule.tasks) || taskStore.getTasks();
        checkAndPromptScheduleConflict(nextTasks);
      }, 300);
    });
  }

  // Choice B: Ignore Other Task & Record Selected Only
  if (btnKeep) {
    btnKeep.addEventListener('click', () => {
      if (!currentConflictData) {
        closeScheduleConflictModal();
        return;
      }
      const taskA = currentConflictData.taskA;
      const taskB = currentConflictData.taskB;
      const idxA = currentConflictData.idxA;
      const idxB = currentConflictData.idxB;

      const isAChecked = Boolean(radioA && radioA.checked);
      const selectedTask = isAChecked ? taskA : taskB;
      const targetIndex = isAChecked ? idxA : idxB;

      if (runtime) {
        runtime.activeTaskIndex = targetIndex;
        updateActiveTaskDisplay();
        const durSec = runtime.status === TimerStatus.IDLE
          ? ((selectedTask.allocatedDuration || selectedTask.plannedDuration || 25) * 60)
          : runtime.getRemainingSeconds();
        renderClockTime(durSec);
        updateWheelProgress(0);
        updateFinishEarlyButtonText(durSec);
        renderTaskList(((runtime.currentSchedule && runtime.currentSchedule.tasks) || []) || []);
      }

      closeScheduleConflictModal();
      mobileServices.hapticTap();
      showToastNotification(`✓ Ignored overlap; running "${selectedTask.title}" on timer`);

      setTimeout(() => {
        const nextTasks = (runtime && runtime.currentSchedule && runtime.currentSchedule.tasks) || taskStore.getTasks();
        checkAndPromptScheduleConflict(nextTasks);
      }, 300);
    });
  }

  if (modalBackdrop) {
    modalBackdrop.addEventListener('click', (e) => {
      if (e.target === modalBackdrop) {
        if (btnKeep) {
          btnKeep.click();
        } else {
          closeScheduleConflictModal();
        }
      }
    });
  }

  window.checkAndPromptScheduleConflict = checkAndPromptScheduleConflict;
  window.clearDismissedOverlapPairs = function() { dismissedOverlapPairs.clear(); };
  window.dismissOverlapForTask = function(taskId) {
    if (!taskId) return;
    const allTasks = taskStore.getTasks();
    for (let i = 0; i < allTasks.length; i++) {
      const otherId = allTasks[i].id;
      if (otherId === taskId) continue;
      dismissedOverlapPairs.add(taskId + '_' + otherId);
      dismissedOverlapPairs.add(otherId + '_' + taskId);
    }
  };
}

function hexToRgba(hex, alpha) {
  const a = typeof alpha === 'number' ? alpha : 0.12;
  if (!hex || typeof hex !== 'string' || hex.charAt(0) !== '#') {
    return 'rgba(37, 99, 235, ' + a + ')';
  }
  let h = hex.slice(1);
  if (h.length === 3) {
    h = h.charAt(0) + h.charAt(0) + h.charAt(1) + h.charAt(1) + h.charAt(2) + h.charAt(2);
  }
  const num = parseInt(h, 16);
  const r = (num >> 16) & 255;
  const g = (num >> 8) & 255;
  const b = num & 255;
  return 'rgba(' + r + ', ' + g + ', ' + b + ', ' + a + ')';
}

function getCategoryHexColor(category) {
  if (typeof classifierGetCategoryColor === 'function') {
    return classifierGetCategoryColor(category);
  }
  if (typeof calendarView !== 'undefined' && calendarView && typeof calendarView._getCategoryColor === 'function') {
    return calendarView._getCategoryColor(category);
  }
  const cat = (category || 'general').trim().toLowerCase();
  switch (cat) {
    case 'work': return '#00b4ff';
    case 'study': return '#bf00ff';
    case 'break':
    case 'rest': return '#ff9500';
    case 'personal': return '#ff5e00';
    case 'meeting': return '#ff00cc';
    case 'health': return '#ff1744';
    case 'fitness': return '#ff2d87';
    case 'reading': return '#00b4ff';
    case 'coding':
    case 'dev': return '#4d4dff';
    case 'social': return '#ff2d87';
    case 'travel': return '#7928ca';
    case 'food':
    case 'dining': return '#ff5e00';
    case 'finance': return '#00f5d4';
    default: return '#4d4dff';
  }
}

// ==========================================
// Task Pipeline List
// ==========================================
function setupTaskPipeline() {
  // Bind interactive live drag reordering to pipeline task list
  setupInteractiveTaskDrag(taskListContainer);
}

function renderTaskList(rawTasks) {
  syncPastTasksCompletion();
  const tasks = (rawTasks || []).filter(t => t && t.title !== '[Calentimer Cloud Sync]');
  taskCountBadge.textContent = `${tasks.length} task${tasks.length === 1 ? '' : 's'}`;
  taskListContainer.innerHTML = '';

  const activeIdx = runtime && runtime.activeTaskIndex >= 0 ? runtime.activeTaskIndex : 0;
  const isRunning = runtime && runtime.status === TimerStatus.RUNNING;
  const isPaused = runtime && runtime.status === TimerStatus.PAUSED;
  const isAllCompleted = runtime.status === TimerStatus.COMPLETED;

  // Detect schedule overlaps in linear pipeline (chronological mode with timespans only; sequential/simple cannot overlap)
  const isTimespans = (typeof taskStore !== 'undefined' && typeof taskStore.getTimespansEnabled === 'function')
    ? taskStore.getTimespansEnabled()
    : true;
  const isSimpleSchedule = Boolean(typeof taskStore !== 'undefined' && typeof taskStore.getAppMode === 'function' && taskStore.getAppMode() === 'simple');

  const conflictingTaskIds = new Set();
  const overlapIndices = new Set();
  if (isTimespans && !isSimpleSchedule) {
    for (let i = 0; i < tasks.length; i++) {
      const tA = tasks[i];
      if (!tA.startTime || !tA.endTime) continue;
      const aStart = parseTimeToMinutes(tA.startTime);
      let aEnd = parseTimeToMinutes(tA.endTime);
      if (aEnd <= aStart) aEnd += 1440;

      for (let j = i + 1; j < tasks.length; j++) {
        const tB = tasks[j];
        if (!tB.startTime || !tB.endTime) continue;
        const bStart = parseTimeToMinutes(tB.startTime);
        let bEnd = parseTimeToMinutes(tB.endTime);
        if (bEnd <= bStart) bEnd += 1440;

        if (aStart < bEnd && bStart < aEnd) {
          conflictingTaskIds.add(tA.id);
          conflictingTaskIds.add(tB.id);
          const laterIdx = j;
          if (!overlapIndices.has(laterIdx - 1) && !overlapIndices.has(i)) {
            overlapIndices.add(laterIdx);
          }
        }
      }
    }
  }

  // For Sequential mode: calculate dynamic timespans starting from current time
  const seqTimeSpans = [];
  if (!isTimespans) {
    const now = new Date();
    let rollingMin = (now.getHours() * 60) + now.getMinutes();

    for (let i = 0; i < tasks.length; i++) {
      const t = tasks[i];
      const dur = Math.max(1, Math.round(t.allocatedDuration || t.plannedDuration || 1));
      let tStart = rollingMin;
      let tEnd = rollingMin + dur;

      if (t.isLocked && (t.fixedStartTime || t.startTime)) {
        tStart = parseTimeToMinutes(t.fixedStartTime || t.startTime);
        let lockedEndMin = (t.fixedEndTime || t.endTime) ? parseTimeToMinutes(t.fixedEndTime || t.endTime) : (tStart + dur);
        if (lockedEndMin <= tStart) lockedEndMin += 1440;
        tEnd = lockedEndMin;
        rollingMin = tEnd;
      } else if (isRunning || isPaused) {
        if (i < activeIdx) {
          tStart = rollingMin - dur;
          tEnd = rollingMin;
        } else if (i === activeIdx) {
          const remMin = Math.max(1, Math.ceil((runtime.getRemainingSeconds ? runtime.getRemainingSeconds() : dur * 60) / 60));
          tStart = rollingMin;
          tEnd = rollingMin + remMin;
          rollingMin = tEnd;
        } else {
          tStart = rollingMin;
          tEnd = rollingMin + dur;
          rollingMin = tEnd;
        }
      } else {
        tStart = rollingMin;
        tEnd = rollingMin + dur;
        rollingMin = tEnd;
      }
      seqTimeSpans.push({
        start: formatMinutesToTime(tStart % 1440),
        end: formatMinutesToTime(tEnd % 1440)
      });
    }
  }

  tasks.forEach((task, idx) => {
    const card = document.createElement('div');
    const isImmovable = Boolean(task.isLocked);
    const isCurrentActive = (isRunning || isPaused) && (idx === activeIdx);
    // Task padlock stays strictly in the user-selected state (never forced locked just because timer is running)
    const isLocked = Boolean(task.isLocked);
    const isBreak = Boolean(
      (task.category && (task.category.toLowerCase() === 'break' || task.category.toLowerCase() === 'rest')) ||
      (task.title && (task.title.toLowerCase().indexOf('break') !== -1 || task.title.toLowerCase().indexOf('rest') !== -1))
    );
    const isOverlap = overlapIndices.has(idx);

    const isTimespans = (typeof taskStore !== 'undefined' && typeof taskStore.getTimespansEnabled === 'function')
      ? taskStore.getTimespansEnabled()
      : true;
    let isPastTask = false;
    let isCurrentTask = false;

    if (isTimespans && task.endTime) {
      const now = new Date();
      const currentMinutes = (now.getHours() * 60) + now.getMinutes();
      const sMin = parseTimeToMinutes(task.startTime);
      let eMin = parseTimeToMinutes(task.endTime);
      if (eMin <= sMin) eMin += 1440;

      if (currentMinutes >= eMin) {
        isPastTask = true;
      } else if (currentMinutes >= sMin && currentMinutes < eMin) {
        isCurrentTask = true;
      }
    }

    let statusClass = 'task-pending';
    let statusBadge = '';

    if (isCurrentActive) {
      statusClass = 'task-current';
      statusBadge = `<span class="task-status-pill current" data-action="tap-status-pill" data-id="${task.id}" title="Active on timer (tap to mark done)">▶ Active</span>`;
    } else if (Boolean(task.isCompleted)) {
      statusClass = 'task-completed';
      statusBadge = `<span class="task-status-pill completed" data-action="tap-status-pill" data-id="${task.id}" title="Completed (tap to unmark as to-do)">✓ Done</span>`;
    } else {
      statusClass = 'task-pending';
      const catHex = task.color || getCategoryHexColor(task.category);
      statusBadge = isBreak
        ? `<span class="task-status-pill break-pill" data-action="tap-status-pill" data-id="${task.id}" title="${escapeHtml(task.category || 'Break')} (tap to activate on timer)">☕ ${escapeHtml(task.category || 'Break')}</span>`
        : `<span class="task-status-pill pending" data-action="tap-status-pill" data-id="${task.id}" title="To-do (tap to activate on timer)" style="background:${hexToRgba(catHex, 0.18)};color:${catHex};border:1px solid ${hexToRgba(catHex, 0.45)};">⏳ Todo</span>`;
    }

    card.className = `task-card ${statusClass} ${isBreak ? 'is-break-task' : ''} ${isLocked ? 'is-locked-task' : ''} ${isOverlap ? 'is-schedule-overlap' : ''}`;
    card.setAttribute('data-id', task.id);
    card.setAttribute('data-index', idx);

    const subtasks = (typeof taskStore !== 'undefined' && typeof taskStore.getSubtasks === 'function')
      ? taskStore.getSubtasks(task.id)
      : [];
    const hasSubtasks = subtasks.length > 0;
    const isMulti = Boolean(task.isMultiSession || (task.sessionIndex && task.totalSessions) || (task.sessionCount && task.sessionCount > 1));
    const progress = (typeof taskStore !== 'undefined' && typeof taskStore.getTaskProgress === 'function')
      ? taskStore.getTaskProgress(task)
      : { completed: 0, total: 0, percent: 0 };
    const isTaskExpanded = expandedTaskDrawerIds.has(task.id);

    let sessionBadgeHtml = '';
    if (task.isMultiSession || (task.sessionIndex && task.totalSessions)) {
      const sIdx = task.sessionIndex || 1;
      const sTot = task.totalSessions || task.sessionCount || 1;
      sessionBadgeHtml = `<span class="session-badge">Session ${sIdx} of ${sTot} 🔗</span>`;
    }

    let subtaskTogglePillHtml = '';
    if (hasSubtasks || isMulti) {
      const badgeDoneClass = (progress.completed === progress.total && progress.total > 0) ? 'all-done' : '';
      const arrowOpenClass = isTaskExpanded ? 'open' : '';
      subtaskTogglePillHtml = `
        <button type="button" class="todo-subtask-toggle-btn task-subtask-toggle" data-action="toggle-task-subtask-drawer" data-id="${task.id}" title="Toggle steps">
          <span class="todo-subtask-badge ${badgeDoneClass}">✓ ${progress.completed}/${progress.total} <span class="todo-subtask-arrow ${arrowOpenClass}">▾</span></span>
        </button>
      `;
    }

    let checkOrEarnedHtml = '';
    if (hasSubtasks || isMulti) {
      if (progress.completed === progress.total && progress.total > 0) {
        checkOrEarnedHtml = '<span class="todo-earned-check" title="All steps completed!">✓</span>';
      } else {
        checkOrEarnedHtml = '';
      }
    } else {
      checkOrEarnedHtml = `
        <button type="button" class="task-check-btn ${task.isCompleted ? 'checked' : ''}" data-action="toggle-task-done" data-id="${task.id}" title="${task.isCompleted ? 'Mark as to-do' : 'Mark as done'}" aria-label="${task.isCompleted ? 'Mark as to-do' : 'Mark as done'}">
          <svg class="check-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="20 6 9 17 4 12"></polyline>
          </svg>
        </button>
      `;
    }

    const catHex = task.color || getCategoryHexColor(task.category);
    if (statusClass === 'task-pending') {
      card.style.background = hexToRgba(catHex, 0.12);
      card.style.borderColor = hexToRgba(catHex, 0.35);
      card.style.borderLeft = `5px solid ${catHex}`;
    } else if (statusClass === 'task-current') {
      card.style.background = '#142329';
      card.style.borderColor = '#00f0ff';
      card.style.borderLeft = '5px solid #00f0ff';
      card.style.boxShadow = '0 0 16px rgba(0, 240, 255, 0.25)';
    }

    // Emerald fractional wash
    if (progress.total > 0 && progress.percent > 0) {
      const isLight = (document.documentElement && document.documentElement.getAttribute('data-theme') === 'light') || (document.body && document.body.getAttribute('data-theme') === 'light');
      const baseBg = isCurrentActive ? '#142329' : (isLight ? '#ffffff' : '#1e222d');
      const pct = progress.percent;
      card.style.background = 'linear-gradient(to right, rgba(16, 185, 129, 0.22) ' + pct + '%, ' + baseBg + ' ' + pct + '%)';
      card.style.borderColor = 'rgba(16, 185, 129, 0.4)';
    }

    const isCompressed = task.allocatedDuration < task.plannedDuration;
    const durationText = isCompressed
      ? `${task.allocatedDuration}m (was ${task.plannedDuration}m)`
      : `${task.allocatedDuration}m`;

    const lockTitle = isLocked
      ? `🔒 Locked (${task.startTime || task.fixedStartTime || 'Fixed timing'})`
      : '🔓 Unlocked (Flexible)';

    const isOverrunningTask = Boolean((runtime && runtime.isOverrunning) && (runtime && runtime.getActiveTask() && runtime.getActiveTask().id) === task.id);

    const overlapBadgeHtml = isOverlap ? `
      <div class="task-overlap-tag-group" data-action="swap-overlap-priority" data-id="${task.id}" data-dir="${isOverlap ? 'up' : 'down'}" style="cursor: pointer;" title="Tap to switch overlap priority">
        <span class="task-overlap-badge" data-action="swap-overlap-priority" data-id="${task.id}" data-dir="${isOverlap ? 'up' : 'down'}">⚠️ Overlap</span>
        <div class="overlap-priority-arrows">
          <button type="button" class="btn-overlap-arrow" data-action="swap-overlap-priority" data-id="${task.id}" data-dir="up" title="Promote task (give timer priority)">▲</button>
          <button type="button" class="btn-overlap-arrow" data-action="swap-overlap-priority" data-id="${task.id}" data-dir="down" title="Demote task (indent)">▼</button>
        </div>
      </div>
    ` : '';

    let drawerHtml = '';
    if (isTaskExpanded) {
      let subtasksListHtml = '';
      subtasks.forEach((sub, sIdx) => {
        const isDone = Boolean(sub.completed);
        subtasksListHtml += `
          <div class="subtask-row" data-subtask-id="${sub.id}" data-index="${sIdx}">
            <div class="subtask-drag-handle" data-subtask-id="${sub.id}" title="Hold & drag to reorder">
              <svg width="8" height="12" viewBox="0 0 10 15" fill="currentColor">
                <circle cx="2.5" cy="2.5" r="1.3"/>
                <circle cx="7.5" cy="2.5" r="1.3"/>
                <circle cx="2.5" cy="7.5" r="1.3"/>
                <circle cx="7.5" cy="7.5" r="1.3"/>
                <circle cx="2.5" cy="12.5" r="1.3"/>
                <circle cx="7.5" cy="12.5" r="1.3"/>
              </svg>
            </div>
            <button type="button" class="subtask-check-btn ${isDone ? 'checked' : ''}" data-action="toggle-task-subtask" data-task-id="${task.id}" data-subtask-id="${sub.id}" title="${isDone ? 'Mark step uncompleted' : 'Mark step done'}">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="20 6 9 17 4 12"></polyline>
              </svg>
            </button>
            <span class="subtask-title ${isDone ? 'completed' : ''}">${escapeHtml(sub.title || '')}</span>
            <button type="button" class="subtask-delete-btn" data-action="delete-task-subtask" data-task-id="${task.id}" data-subtask-id="${sub.id}" title="Delete step">✕</button>
          </div>
        `;
      });

      drawerHtml = `
        <div class="todo-subtask-drawer" data-task-id="${task.id}">
          <div class="subtask-list">
            ${subtasksListHtml}
          </div>
          <div class="subtask-add-row">
            <input type="text" class="subtask-add-input" data-task-id="${task.id}" placeholder="+ Add a step (press Enter)" autocomplete="off">
            <button type="button" class="btn-subtask-add-confirm" data-action="confirm-add-task-subtask" data-task-id="${task.id}">Add</button>
          </div>
        </div>
      `;
    }

    card.innerHTML = `
      <!-- Top Row: Status badge on top left, actions on top right -->
      <div class="task-card-top-row">
        <div class="task-card-status-wrap">
          ${statusBadge}
          ${sessionBadgeHtml}
          ${subtaskTogglePillHtml}
          ${overlapBadgeHtml}
        </div>
        <div class="task-card-actions">
          <button class="btn-icon-action time-bank-btn ${task.useTimeBank !== false ? 'active' : ''} ${isOverrunningTask ? 'cracked' : ''}" data-action="toggle-time-bank" data-id="${task.id}" title="${task.useTimeBank !== false ? 'Time Bank enabled: taps into saved surplus time if overdue' : 'Time Bank disabled'}">
            ${getPiggyBankSvg(isOverrunningTask)}
          </button>
          <button class="btn-icon-action ${isLocked ? 'locked' : ''}" data-action="toggle-lock" data-id="${task.id}" title="${lockTitle}">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
              ${isLocked
                ? '<path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z"/>'
                : '<path d="M12 17c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm6-9h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6h1.9c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm0 12H6V10h12v10z"/>'
              }
            </svg>
          </button>
          <button class="btn-icon-action" data-action="delete" data-id="${task.id}" title="Delete task">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>
      </div>

      <!-- Middle Row: 3x2 dots drag handle on far left (if unlocked), Emoji underneath status, full Task Name next to emoji -->
      <div class="task-card-middle-row" data-action="edit-task" data-id="${task.id}" title="Tap to edit task options">
        ${!isLocked ? `
          <div class="drag-handle" data-action="drag-handle" title="Hold & drag to reorder">
            <svg width="12" height="18" viewBox="0 0 12 18" fill="currentColor">
              <circle cx="3" cy="3" r="1.5"/>
              <circle cx="9" cy="3" r="1.5"/>
              <circle cx="3" cy="9" r="1.5"/>
              <circle cx="9" cy="9" r="1.5"/>
              <circle cx="3" cy="15" r="1.5"/>
              <circle cx="9" cy="15" r="1.5"/>
            </svg>
          </div>
        ` : `
          <div class="drag-handle-locked" data-action="locked-drag-attempt" title="Task locked">
            <span style="font-size: 0.85rem; opacity: 0.7;">🔒</span>
          </div>
        `}
        <button class="task-emoji-btn" data-action="pick-emoji" data-id="${task.id}" title="Tap to change emoji">
          ${task.emoji || '📌'}
        </button>
        <div class="task-card-title-wrap">
          <span class="task-card-title">${escapeHtml(task.title)}</span>
        </div>
        ${checkOrEarnedHtml}
      </div>

      <!-- Bottom Row: Timing duration in blue text on a single line -->
      <div class="task-card-bottom-row">
        <span class="task-timing-blue">${isTimespans
          ? `${(isLocked ? (task.fixedStartTime || task.startTime) : task.startTime) || '--:--'} → ${(isLocked ? (task.fixedEndTime || task.endTime) : task.endTime) || '--:--'} • ${durationText}`
          : `⏱️ ${durationText} <span class="task-timing-indicator" style="opacity: 0.65; font-size: 0.72rem; margin-left: 6px; font-weight: 500;">(${seqTimeSpans[idx] ? `${seqTimeSpans[idx].start} → ${seqTimeSpans[idx].end}` : ''})</span>`
        }</span>
        <span class="task-category-chip" style="${catHex ? 'background:' + hexToRgba(catHex, 0.18) + ';color:' + catHex + ';border:1px solid ' + hexToRgba(catHex, 0.45) + ';' : ''}">${escapeHtml(task.category || 'General')}</span>
      </div>
      ${drawerHtml}
    `;

    // Custom Themed Hold-to-delete gesture (450ms) on task card
    let holdTimer = null;
    let holdMoved = false;
    let startX = 0;
    let startY = 0;

    const clearHold = () => {
      if (holdTimer) {
        clearTimeout(holdTimer);
        holdTimer = null;
      }
    };

    const triggerHoldDelete = () => {
      openConfirmDeleteTaskModal(task.id, task.title);
    };

    card.addEventListener('touchstart', (e) => {
      if (e.target.closest('[data-action="drag-handle"], [data-action="locked-drag-attempt"], [data-action="pick-emoji"], [data-action="toggle-task-done"], [data-action="tap-status-pill"], .task-check-btn, .task-emoji-btn, .btn-icon-action, .task-card-status-wrap, .task-status-pill, .todo-subtask-drawer, .todo-subtask-toggle-btn, .subtask-row, .subtask-add-row, .subtask-add-input, .btn-subtask-add-confirm')) return;
      holdMoved = false;
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      clearHold();
      holdTimer = setTimeout(() => {
        if (!holdMoved) {
          triggerHoldDelete();
        }
      }, 500);
    }, { passive: true });

    card.addEventListener('touchmove', (e) => {
      if (!holdTimer) return;
      const diffX = e.touches[0].clientX - startX;
      const diffY = e.touches[0].clientY - startY;
      if (Math.hypot(diffX, diffY) > 10) {
        holdMoved = true;
        clearHold();
      }
    }, { passive: true });

    card.addEventListener('touchend', clearHold);
    card.addEventListener('touchcancel', clearHold);

    card.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      if (e.target.closest('[data-action="drag-handle"], [data-action="locked-drag-attempt"], [data-action="pick-emoji"], [data-action="toggle-task-done"], [data-action="tap-status-pill"], .task-check-btn, .task-emoji-btn, .btn-icon-action, .task-card-status-wrap, .task-status-pill, .todo-subtask-drawer, .todo-subtask-toggle-btn, .subtask-row, .subtask-add-row, .subtask-add-input, .btn-subtask-add-confirm')) return;
      holdMoved = false;
      startX = e.clientX;
      startY = e.clientY;
      clearHold();
      holdTimer = setTimeout(() => {
        if (!holdMoved) {
          triggerHoldDelete();
        }
      }, 500);

      const onMouseMove = (me) => {
        if (Math.hypot(me.clientX - startX, me.clientY - startY) > 10) {
          holdMoved = true;
          clearHold();
        }
      };
      const onMouseUp = () => {
        clearHold();
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onMouseUp);
      };
      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', onMouseUp);
    });

    // Subtask toggle pill click in task drawer
    const toggleTaskPillBtn = card.querySelector('[data-action="toggle-task-subtask-drawer"]');
    if (toggleTaskPillBtn) {
      toggleTaskPillBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (expandedTaskDrawerIds.has(task.id)) {
          expandedTaskDrawerIds.delete(task.id);
        } else {
          expandedTaskDrawerIds.add(task.id);
        }
        mobileServices.hapticTap();
        renderTaskList(((runtime && runtime.currentSchedule && runtime.currentSchedule.tasks) || []) || taskStore.getTasks());
        if (expandedTaskDrawerIds.has(task.id)) {
          setTimeout(() => {
            const inp = card.querySelector(`.subtask-add-input[data-task-id="${task.id}"]`);
            if (inp) inp.focus();
          }, 60);
        }
      });
    }

    // Subtask check click
    card.querySelectorAll('[data-action="toggle-task-subtask"]').forEach(subCheckBtn => {
      subCheckBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const subId = subCheckBtn.getAttribute('data-subtask-id');
        const targetSub = subtasks.find(s => s.id === subId);
        if (targetSub) {
          taskStore.updateSubtask(task.id, subId, { completed: !targetSub.completed });
          mobileServices.hapticTap();
          renderTaskList(((runtime && runtime.currentSchedule && runtime.currentSchedule.tasks) || []) || taskStore.getTasks());
        }
      });
    });

    // Subtask delete click
    card.querySelectorAll('[data-action="delete-task-subtask"]').forEach(subDelBtn => {
      subDelBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const subId = subDelBtn.getAttribute('data-subtask-id');
        taskStore.deleteSubtask(task.id, subId);
        mobileServices.hapticTap();
        renderTaskList(((runtime && runtime.currentSchedule && runtime.currentSchedule.tasks) || []) || taskStore.getTasks());
      });
    });

    // Subtask add handling
    const addTaskSubInput = card.querySelector('.subtask-add-input');
    const addTaskSubBtn = card.querySelector('[data-action="confirm-add-task-subtask"]');
    const doAddTaskSubtask = () => {
      if (!addTaskSubInput) return;
      const text = (addTaskSubInput.value || '').trim();
      if (!text) return;
      taskStore.addSubtask(task.id, { title: text, completed: false });
      mobileServices.hapticTap();
      renderTaskList(((runtime && runtime.currentSchedule && runtime.currentSchedule.tasks) || []) || taskStore.getTasks());
      setTimeout(() => {
        const nextInp = taskListContainer.querySelector(`.subtask-add-input[data-task-id="${task.id}"]`);
        if (nextInp) nextInp.focus();
      }, 60);
    };

    if (addTaskSubInput) {
      addTaskSubInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          e.stopPropagation();
          doAddTaskSubtask();
        }
      });
      addTaskSubInput.addEventListener('click', (e) => e.stopPropagation());
    }

    if (addTaskSubBtn) {
      addTaskSubBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        doAddTaskSubtask();
      });
    }

    const taskDrawerEl = card.querySelector('.todo-subtask-drawer');
    if (taskDrawerEl) {
      setupInteractiveSubtaskDrag(taskDrawerEl, task.id, () => {
        renderTaskList(((runtime && runtime.currentSchedule && runtime.currentSchedule.tasks) || []) || taskStore.getTasks());
      });
    }

    // Toggle task done tick box
    const checkBtn = card.querySelector('[data-action="toggle-task-done"]');
    if (checkBtn) {
      checkBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        toggleTaskDoneStatus(task.id);
      });
    }

    // Emoji click
    const _emojiBtn = card.querySelector('[data-action="pick-emoji"]');
    if (_emojiBtn) {
      _emojiBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        openEmojiPicker(task.id);
      });
    }

    // Tap status pill to toggle done or set as active timer task
    const statusWrap = card.querySelector('.task-card-status-wrap');
    if (statusWrap) {
      statusWrap.style.cursor = 'pointer';
      const onStatusPillTap = (e) => {
        if (e.target.closest('[data-action="swap-overlap-priority"]')) return;
        e.stopPropagation();
        e.preventDefault();
        if (task.isCompleted) {
          // Untick completed task back to to-do and activate on timer!
          toggleTaskDoneStatus(task.id);
        } else if (isCurrentActive) {
          // Already active task -> tap pill marks it as done!
          toggleTaskDoneStatus(task.id);
        } else if (runtime) {
          // Todo / Break task -> tap pill activates it on timer!
          runtime.setActiveTaskById(task.id);
          updateActiveTaskDisplay();
          const actTask = runtime.getActiveTask();
          const durSec = ((actTask && (actTask.allocatedDuration || actTask.plannedDuration)) || 25) * 60;
          renderClockTime(durSec);
          updateWheelProgress(0);
          updateFinishEarlyButtonText(durSec);
          renderTaskList(((runtime.currentSchedule && runtime.currentSchedule.tasks) || []) || taskStore.getTasks());
          renderCalendarModal();
          showToastNotification('✓ "' + task.title + '" is now active on the timer');
          mobileServices.hapticTap();
        }
      };
      statusWrap.addEventListener('click', onStatusPillTap);
    }

    // Edit task click
    const _editBtn = card.querySelector('[data-action="edit-task"]');
    if (_editBtn) {
      _editBtn.addEventListener('click', (e) => {
        if (e.target.closest('[data-action="pick-emoji"]') || e.target.closest('[data-action="drag-handle"]') || e.target.closest('[data-action="locked-drag-attempt"]') || e.target.closest('[data-action="swap-overlap-priority"]') || e.target.closest('[data-action="toggle-task-done"]')) return;
        openTaskEditModal(task.id);
      });
    }

    const _bottomRow = card.querySelector('.task-card-bottom-row');
    if (_bottomRow) {
      _bottomRow.addEventListener('click', (e) => {
        if (e.target.closest('[data-action="swap-overlap-priority"]')) return;
        openTaskEditModal(task.id);
      });
    }

    // Overlap priority swap buttons (▲ and ▼)
    const _swapPriorityBtns = card.querySelectorAll('[data-action="swap-overlap-priority"]');
    _swapPriorityBtns.forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        const dir = btn.getAttribute('data-dir');
        handleSwapOverlapPriority(task.id, dir);
      });
    });

    // Locked drag handle tap notification
    const lockedDrag = card.querySelector('[data-action="locked-drag-attempt"]');
    if (lockedDrag) {
      attachLockedDragHoldWarning(lockedDrag);
    }

    // Time bank toggle event
    const timeBankBtn = card.querySelector('[data-action="toggle-time-bank"]');
    if (timeBankBtn) {
      timeBankBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        taskStore.toggleTaskTimeBank(task.id);
        runtime.initialTasks = taskStore.getTasks();
        runtime.recalculate();
        syncDynamicScheduleTimesToCalendar();
        updateActiveTaskDisplay();
        renderTaskList(((runtime.currentSchedule && runtime.currentSchedule.tasks) || []) || []);
        renderCalendarModal();
        mobileServices.hapticTap();
      });
    }

    // Lock toggle event (can be toggled on/off freely whether timer is running, paused, or idle)
    const _lockToggle = card.querySelector('[data-action="toggle-lock"]');
    if (_lockToggle) {
      _lockToggle.addEventListener('click', (e) => {
        e.stopPropagation();
        const currentLocked = Boolean(task.isLocked);
        const nextLocked = !currentLocked;
        const fixedStartTime = nextLocked ? (task.fixedStartTime || task.startTime || null) : null;
        const fixedEndTime = nextLocked ? (task.fixedEndTime || task.endTime || null) : null;

        taskStore.updateTask(task.id, {
          isLocked: nextLocked,
          fixedStartTime: fixedStartTime,
          fixedEndTime: fixedEndTime
        });
        const initTask = (runtime && runtime.initialTasks) ? runtime.initialTasks.find(t => t.id === task.id) : null;
        if (initTask) {
          initTask.isLocked = nextLocked;
          initTask.fixedStartTime = fixedStartTime;
          initTask.fixedEndTime = fixedEndTime;
        }

        const activeTask = runtime ? runtime.getActiveTask() : null;
        if (activeTask && activeTask.id === task.id) {
          activeTask.isLocked = nextLocked;
          activeTask.fixedStartTime = fixedStartTime;
          activeTask.fixedEndTime = fixedEndTime;
        }

        if (runtime && runtime.currentSchedule && runtime.currentSchedule.tasks) {
          const schedTask = runtime.currentSchedule.tasks.find(t => t.id === task.id);
          if (schedTask) {
            schedTask.isLocked = nextLocked;
            schedTask.fixedStartTime = fixedStartTime;
            schedTask.fixedEndTime = fixedEndTime;
          }
        }

        runtime.recalculate();
        syncDynamicScheduleTimesToCalendar();
        updateTimerQuickToggles();
        updateActiveTaskDisplay();
        renderTaskList(((runtime.currentSchedule && runtime.currentSchedule.tasks) || []) || []);
        renderCalendarModal();
        mobileServices.hapticTap();
        showToastNotification(nextLocked ? '🔒 Task locked to current timespan' : '🔓 Task unlocked (flexible)');
      });
    }

    // Delete event
    const _delBtn = card.querySelector('[data-action="delete"]');
    if (_delBtn) {
      _delBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        executeDeleteTask(task.id, task.title);
      });
    }

    taskListContainer.appendChild(card);
  });
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Toggles a task's done status between complete and todo,
 * recording user manual overrides so automatic time checks won't revert manual changes.
 * @param {string} taskId
 */
function toggleTaskDoneStatus(taskId) {
  if (!taskId) return;
  const tasks = taskStore.getTasks();
  const task = tasks.find(t => t.id === taskId);
  if (!task) return;

  const isNowDone = !Boolean(task.isCompleted);
  const todayStr = (typeof taskStore !== 'undefined' && typeof taskStore.getTodayDateString === 'function')
    ? taskStore.getTodayDateString()
    : new Date().toISOString().split('T')[0];

  task.isCompleted = isNowDone;
  task.completedDate = isNowDone ? todayStr : null;
  task.manualCompleted = isNowDone;

  taskStore.updateTask(task.id, {
    isCompleted: isNowDone,
    completedDate: isNowDone ? todayStr : null,
    manualCompleted: isNowDone
  });

  if (runtime && runtime.initialTasks) {
    const initT = runtime.initialTasks.find(t => t.id === task.id);
    if (initT) {
      initT.isCompleted = isNowDone;
      initT.completedDate = isNowDone ? todayStr : null;
      initT.manualCompleted = isNowDone;
    }
  }
  if (runtime && runtime.currentSchedule && runtime.currentSchedule.tasks) {
    const schedT = runtime.currentSchedule.tasks.find(t => t.id === task.id);
    if (schedT) {
      schedT.isCompleted = isNowDone;
      schedT.completedDate = isNowDone ? todayStr : null;
      schedT.manualCompleted = isNowDone;
    }
  }

  // If the user unchecks the task (turns it back into to-do), immediately activate it on the timer!
  if (!isNowDone && runtime) {
    runtime.setActiveTaskById(task.id);
    updateActiveTaskDisplay();
    const actTask = runtime.getActiveTask();
    const durSec = ((actTask && (actTask.allocatedDuration || actTask.plannedDuration)) || 25) * 60;
    renderClockTime(durSec);
    updateWheelProgress(0);
    updateFinishEarlyButtonText(durSec);
    showToastNotification(`✓ "${task.title}" is now active on the timer`);
  }

  mobileServices.hapticTap();
  renderTaskList(((runtime && runtime.currentSchedule && runtime.currentSchedule.tasks) || []) || taskStore.getTasks());
  renderCalendarModal();
  updateTotalMinutesDisplay();
  if (calendarView && typeof calendarView.render === 'function' && calendarView.isOpen && calendarView.isOpen()) {
    calendarView.render();
  }
}
window.toggleTaskDoneStatus = toggleTaskDoneStatus;

/**
 * Evaluates tasks against current time:
 * - Once current time is past a task's end time, marks it as completed (unless manually unmarked by user: manualCompleted === false).
 * - If moved/rescheduled into future (current time < endTime), automatically unmarks it (isCompleted: false, manualCompleted: null).
 * - Simple Mode is strictly sequential and excluded from auto past-time completion.
 */
function syncPastTasksCompletion() {
  const isSimple = Boolean(typeof taskStore !== 'undefined' && typeof taskStore.getAppMode === 'function' && taskStore.getAppMode() === 'simple');
  if (isSimple) return;

  const tasks = taskStore.getTasks();
  if (!Array.isArray(tasks) || tasks.length === 0) return;

  const now = new Date();
  const currentMinutes = (now.getHours() * 60) + now.getMinutes();
  const todayStr = (typeof taskStore !== 'undefined' && typeof taskStore.getTodayDateString === 'function')
    ? taskStore.getTodayDateString()
    : now.toISOString().split('T')[0];

  let hasUpdates = false;

  for (let i = 0; i < tasks.length; i++) {
    const t = tasks[i];
    if (!t || !t.startTime) continue;
    const sMin = parseTimeToMinutes(t.startTime);
    let eMin = t.endTime ? parseTimeToMinutes(t.endTime) : (sMin + (t.allocatedDuration || t.plannedDuration || 30));
    if (eMin <= sMin) eMin += 1440;

    const isPast = currentMinutes >= eMin;

    const activeTask = runtime ? runtime.getActiveTask() : null;
    const isActiveBeingTimed = Boolean(activeTask && activeTask.id === t.id && (runtime.status === TimerStatus.RUNNING || runtime.status === TimerStatus.PAUSED));

    if (isPast && !isActiveBeingTimed) {
      // Past task: mark done by default unless user explicitly unmarked it (manualCompleted === false)
      if (!t.isCompleted && t.manualCompleted !== false) {
        t.isCompleted = true;
        t.completedDate = todayStr;
        hasUpdates = true;
      }
    } else if (!isPast) {
      // Future task: if it was automatically marked done in the past and then rescheduled/moved to future without manual completion, reset to todo
      if (t.isCompleted && t.manualCompleted !== true && (typeof t.manualCompleted === 'undefined' || t.manualCompleted === null)) {
        t.isCompleted = false;
        t.completedDate = null;
        hasUpdates = true;
      }
    }
  }

  if (hasUpdates) {
    taskStore.saveTasks(tasks, true);
    if (runtime && runtime.initialTasks) {
      runtime.initialTasks = tasks;
    }
    updateTotalMinutesDisplay();
  }
}
window.syncPastTasksCompletion = syncPastTasksCompletion;

// ==========================================
// Theme Management (Default/System, Light, Dark)
// ==========================================
function initTheme() {
  const currentTheme = taskStore.getTheme();
  applyTheme(currentTheme);

  if (window.matchMedia) {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      if (taskStore.getTheme() === 'system') {
        applyTheme('system');
      }
    });
  }
}

function applyTheme(theme) {
  let activeTheme = theme || 'dark';
  let resolvedTheme = activeTheme;
  if (activeTheme === 'system') {
    resolvedTheme = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches
      ? 'light'
      : 'dark';
  }
  document.documentElement.setAttribute('data-theme', resolvedTheme);
  document.documentElement.style.colorScheme = resolvedTheme;
  document.body.setAttribute('data-theme', resolvedTheme);

  const metaThemeColor = document.querySelector('meta[name="theme-color"]');
  if (metaThemeColor) {
    metaThemeColor.setAttribute('content', resolvedTheme === 'light' ? '#f4f5f8' : '#0a0a0f');
  }

  const segmentBtns = document.querySelectorAll('.theme-segment-btn');
  segmentBtns.forEach(btn => {
    if (btn.getAttribute('data-theme-val') === activeTheme) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });
}

// ==========================================
// Emoji Picker Modal Logic
// ==========================================
const CURATED_EMOJIS = [
  '📚', '📖', '📝', '💻', '🔬', '🧪', '📐', '🧠', '🎯', '⚡', '☕', '🏃',
  '🏋️', '🎨', '💼', '📊', '🎧', '⏰', '✨', '🔥', '📌', '🧹', '🥗', '🛌',
  '👥', '🎓', '🩺', '🌿', '🎉', '✈️', '🍱', '💰', '🥞', '🥪', '😴', '🐛',
  '🚀', '🗄️', '🔀', '🏊', '🚴', '🧘', '🥾', '🎾', '⚽', '🏀', '🥊', '🧗',
  '🏛️', '📄', '🤝', '📞', '🍻', '🎬', '🎮', '🎵', '🎂', '❤️', '🚆', '🚌',
  '🚗', '🏨', '🧳', '🍽️', '🍕', '🍔', '🍣', '🍜', '🌮', '🍲', '🥩', '🍳',
  '🍰', '🍦', '🍪', '🍎', '🧋', '💧', '🍷', '🍸', '🧃', '🛒', '🛍️', '🧺',
  '🧼', '🗑️', '🛏️', '🚿', '✂️', '💅', '🔧', '📦', '🐾', '🌱', '✍️', '✉️',
  '💊', '🎁', '🚶', '⭐', '🗓️', '💡', '🕒'
];
let currentEmojiTaskId = null;
let currentAddTaskEmoji = '📚';
let currentTodoEmoji = '📌';
let isTodoManualEmoji = false;
let currentEditEmoji = null;
let selectedEmojiInPicker = null;

function applyEmojiSelection(emoji) {
  if (!emoji) return;
  if (currentEmojiTaskId === 'NEW_TASK') {
    currentAddTaskEmoji = emoji;
    const addModalEmoji = document.getElementById('addTaskHeaderEmoji');
    if (addModalEmoji) addModalEmoji.textContent = emoji;
    closeEmojiPicker(false);
    mobileServices.hapticTap();
  } else if (currentEmojiTaskId === 'NEW_TODO') {
    currentTodoEmoji = emoji;
    isTodoManualEmoji = true;
    const addTodoEmoji = document.getElementById('addTodoHeaderEmoji');
    if (addTodoEmoji) addTodoEmoji.textContent = emoji;
    closeEmojiPicker(false);
    mobileServices.hapticTap();
  } else if (currentEmojiTaskId === 'CAL_EVENT') {
    if (calendarView) calendarView.setEventEmoji(emoji);
    closeEmojiPicker(false);
    mobileServices.hapticTap();
  } else if (typeof currentEmojiTaskId === 'string' && currentEmojiTaskId.indexOf('todo-') === 0) {
    taskStore.updateTodoTask(currentEmojiTaskId, { emoji: emoji });
    if (typeof renderTodoList === 'function') renderTodoList();
    closeEmojiPicker(false);
    mobileServices.hapticTap();
    showToastNotification(`Emoji updated to ${emoji}`);
  } else if (currentEmojiTaskId) {
    currentEditEmoji = emoji;
    taskStore.updateTask(currentEmojiTaskId, { emoji });
    runtime.initialTasks = taskStore.getTasks();
    runtime.recalculate();
    updateActiveTaskDisplay();
    renderTaskList(((runtime.currentSchedule && runtime.currentSchedule.tasks) || []) || []);
    const editHeaderEmoji = document.getElementById('editTaskHeaderEmoji');
    if (editHeaderEmoji) editHeaderEmoji.textContent = emoji;
    renderCalendarModal();
    closeEmojiPicker(false);
    mobileServices.hapticTap();
    showToastNotification(`Emoji updated to ${emoji}`);
  }
}

function openEmojiPicker(taskId) {
  currentEmojiTaskId = taskId;
  let currentTaskEmoji = '📚';
  if (taskId === 'NEW_TASK') {
    currentTaskEmoji = currentAddTaskEmoji || '📚';
  } else if (taskId === 'NEW_TODO') {
    currentTaskEmoji = currentTodoEmoji || '📌';
  } else if (taskId === 'CAL_EVENT') {
    currentTaskEmoji = (calendarView && calendarView.currentEmoji) ? calendarView.currentEmoji : '💼';
  } else if (typeof taskId === 'string' && taskId.indexOf('todo-') === 0) {
    const todos = taskStore.getTodoTasks();
    const t = todos.find(item => item.id === taskId);
    currentTaskEmoji = (t && t.emoji) ? t.emoji : '📌';
  } else if (taskId) {
    const t = taskStore.getTasks().find(item => item.id === taskId);
    currentTaskEmoji = (t ? t.emoji : "") || currentEditEmoji || '📌';
  }
  selectedEmojiInPicker = currentTaskEmoji;

  const grid = document.getElementById('emojiPickerGrid');
  if (grid) {
    grid.innerHTML = '';
    const allClassEmojis = (typeof getAllClassificationEmojis === 'function') ? getAllClassificationEmojis() : [];
    const existingEmojis = [];
    if (typeof taskStore !== 'undefined') {
      if (typeof taskStore.getTasks === 'function') {
        taskStore.getTasks().forEach(t => { if (t && t.emoji) existingEmojis.push(t.emoji); });
      }
      if (typeof taskStore.getTodoTasks === 'function') {
        taskStore.getTodoTasks().forEach(t => { if (t && t.emoji) existingEmojis.push(t.emoji); });
      }
      if (typeof taskStore.getCalendarEvents === 'function') {
        taskStore.getCalendarEvents().forEach(e => { if (e && e.emoji) existingEmojis.push(e.emoji); });
      }
    }
    const dynamicEmojiSet = new Set(CURATED_EMOJIS);
    allClassEmojis.forEach(e => { if (e) dynamicEmojiSet.add(e); });
    existingEmojis.forEach(e => { if (e) dynamicEmojiSet.add(e); });
    if (selectedEmojiInPicker) dynamicEmojiSet.add(selectedEmojiInPicker);
    const displayedEmojis = Array.from(dynamicEmojiSet);

    displayedEmojis.forEach(emoji => {
      const btn = document.createElement('button');
      btn.className = `emoji-pick-btn ${emoji === selectedEmojiInPicker ? 'active' : ''}`;
      btn.type = 'button';
      btn.textContent = emoji;
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (selectedEmojiInPicker === emoji) {
          // Second click on the same emoji confirms immediately
          applyEmojiSelection(emoji);
        } else {
          // First click selects and visually highlights
          selectedEmojiInPicker = emoji;
          grid.querySelectorAll('.emoji-pick-btn').forEach(b => {
            b.classList.toggle('active', b.textContent === emoji);
          });
          mobileServices.hapticTap();
        }
      });
      grid.appendChild(btn);
    });
  }
  (() => { const _el = document.getElementById("emojiPickerModalBackdrop"); if (_el) _el.classList.remove("hidden"); })();
  mobileServices.hapticTap();
}
window.openEmojiPicker = openEmojiPicker;

function closeEmojiPicker(confirmSelected = true) {
  if (confirmSelected && selectedEmojiInPicker && currentEmojiTaskId) {
    applyEmojiSelection(selectedEmojiInPicker);
  } else {
    (() => { const _el = document.getElementById("emojiPickerModalBackdrop"); if (_el) _el.classList.add("hidden"); })();
    currentEmojiTaskId = null;
    selectedEmojiInPicker = null;
  }
}

// ==========================================
// Category Color Palette Popover & Remembered Custom Colors
// ==========================================
let currentPaletteCategory = null;

function openCategoryColorPalette(category) {
  if (!category) return;
  currentPaletteCategory = category;

  const modal = document.getElementById('categoryColorPaletteModalBackdrop');
  const title = document.getElementById('categoryColorModalTitle');
  const dot = document.getElementById('categoryColorModalDot');
  const grid = document.getElementById('categoryColorSwatchesGrid');
  if (!modal || !grid) return;

  const currentColor = classifierGetCategoryColor(category);

  if (title) title.textContent = `"${category}" Color`;
  if (dot) {
    dot.style.background = currentColor;
    dot.style.boxShadow = `0 0 8px ${currentColor}`;
    dot.style.color = currentColor;
  }

  grid.innerHTML = '';

  PRESET_CATEGORY_COLORS.forEach(hex => {
    const btn = document.createElement('button');
    btn.type = 'button';
    const isCurrent = hex.toLowerCase() === currentColor.toLowerCase();
    btn.className = `color-swatch-btn ${isCurrent ? 'is-active-color' : ''}`;
    btn.style.backgroundColor = hex;
    btn.style.color = hex;
    btn.title = hex;

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      selectCategoryColor(currentPaletteCategory, hex);
    });

    grid.appendChild(btn);
  });

  ensureHistoryBuffer();
  modal.classList.remove('hidden');
  mobileServices.hapticTap();
}
window.openCategoryColorPalette = openCategoryColorPalette;

function closeCategoryColorPalette() {
  const modal = document.getElementById('categoryColorPaletteModalBackdrop');
  if (modal) modal.classList.add('hidden');
  currentPaletteCategory = null;
}
window.closeCategoryColorPalette = closeCategoryColorPalette;

function selectCategoryColor(category, chosenHex) {
  if (!category || !chosenHex) return;

  // 1. Permanently remember custom color for this category
  taskStore.setCategoryColor(category, chosenHex);

  // 2. If in calendarView with an open event inspector:
  if (typeof calendarView !== 'undefined' && calendarView) {
    calendarView.currentEventCustomColor = chosenHex;
    if (calendarView.selectedEvent) {
      let newColorId = null;
      if (typeof googleCalendarAdapter !== 'undefined' && typeof googleCalendarAdapter.getGoogleColorId === 'function') {
        newColorId = googleCalendarAdapter.getGoogleColorId(category, chosenHex, null);
      }
      calendarView.selectedEvent.color = chosenHex;
      calendarView.selectedEvent.colorId = newColorId;
      taskStore.updateCalendarEvent(calendarView.selectedEvent.id, {
        color: chosenHex,
        colorId: newColorId,
        isDirty: true
      });

      // Outbound sync to Google / Microsoft if linked
      const isPaired = Boolean(
        calendarView.selectedEvent.googleEventId ||
        calendarView.selectedEvent.microsoftEventId ||
        calendarView.selectedEvent.source === 'google' ||
        calendarView.selectedEvent.source === 'microsoft' ||
        (calendarView.selectedEvent.externalId && (calendarView.selectedEvent.provider === 'google' || calendarView.selectedEvent.provider === 'microsoft'))
      );
      if (isPaired && typeof calendarSyncService !== 'undefined' && typeof calendarSyncService.pushEventUpdate === 'function') {
        calendarSyncService.pushEventUpdate(calendarView.selectedEvent).catch(() => {});
      }
    }
    if (typeof calendarView.render === 'function') {
      calendarView.render();
    }
  }

  // 3. If in Task Edit Modal:
  if (currentEditTaskId) {
    const task = taskStore.getTasks().find(t => t.id === currentEditTaskId);
    if (task) {
      let newColorId = null;
      if (typeof googleCalendarAdapter !== 'undefined' && typeof googleCalendarAdapter.getGoogleColorId === 'function') {
        newColorId = googleCalendarAdapter.getGoogleColorId(category, chosenHex, null);
      }
      taskStore.updateTask(currentEditTaskId, {
        color: chosenHex,
        colorId: newColorId
      });
      const updatedTask = taskStore.getTasks().find(t => t.id === currentEditTaskId);
      const isPaired = Boolean(
        updatedTask && (
          updatedTask.googleEventId ||
          updatedTask.microsoftEventId ||
          updatedTask.source === 'google' ||
          updatedTask.source === 'microsoft' ||
          (updatedTask.externalId && (updatedTask.provider === 'google' || updatedTask.provider === 'microsoft'))
        )
      );
      if (isPaired && typeof calendarSyncService !== 'undefined' && typeof calendarSyncService.pushEventUpdate === 'function') {
        calendarSyncService.pushEventUpdate(updatedTask).catch(() => {});
      }
    }
  }

  // 4. Re-render chips across all three modals
  if (typeof refreshAddCategoryChips === 'function') refreshAddCategoryChips();
  if (typeof refreshEditCategoryChips === 'function') refreshEditCategoryChips();
  if (typeof calendarView !== 'undefined' && calendarView && typeof calendarView.refreshCategoryChips === 'function') {
    calendarView.refreshCategoryChips();
  }

  closeCategoryColorPalette();
  mobileServices.hapticCelebration();
  showToastNotification(`✓ "${category}" color updated`);
}
window.selectCategoryColor = selectCategoryColor;

// ==========================================
// Category Chips & Remembered Categories Management
// ==========================================
function setupCategorySelector(containerId, inputId, addBtnId, onSelectCategory) {
  const container = document.getElementById(containerId);
  const input = document.getElementById(inputId);
  const addBtn = document.getElementById(addBtnId);
  if (!container || !input) return () => {};

  function renderChips() {
    const cats = taskStore.getCategories();
    container.innerHTML = '';
    const currentVal = input.value.trim().toLowerCase();

    cats.forEach(cat => {
      const chip = document.createElement('span');
      const isSelected = cat.toLowerCase() === currentVal;
      const catColor = classifierGetCategoryColor(cat);
      const rgbaBg = hexToRgba(catColor, 0.18);
      const rgbaGlow = hexToRgba(catColor, 0.55);

      chip.className = `category-chip ${isSelected ? 'active' : ''}`;
      chip.style.setProperty('--chip-glow-color', catColor);
      chip.style.setProperty('--chip-glow-bg', rgbaBg);
      chip.style.setProperty('--chip-glow-shadow', rgbaGlow);

      if (isSelected) {
        chip.style.borderColor = catColor;
        chip.style.color = catColor;
        chip.style.background = rgbaBg;
        chip.style.boxShadow = `0 0 12px ${rgbaGlow}, inset 0 0 3px ${rgbaBg}`;
      } else {
        chip.style.removeProperty('border-color');
        chip.style.removeProperty('color');
        chip.style.removeProperty('background');
        chip.style.removeProperty('box-shadow');
      }

      chip.innerHTML = `
        <span class="chip-color-dot" style="background: ${catColor}; box-shadow: 0 0 5px ${rgbaGlow};" title="Click to choose color for ${escapeHtml(cat)}"></span>
        <span class="chip-text">${escapeHtml(cat)}</span>
        <button type="button" class="chip-delete" title="Delete category">✕</button>
      `;

      // Tap on color dot opens category color palette immediately
      const colorDot = chip.querySelector('.chip-color-dot');
      if (colorDot) {
        colorDot.addEventListener('click', (e) => {
          e.stopPropagation();
          input.value = cat;
          if (addBtn) addBtn.classList.add('hidden');
          renderChips();
          if (onSelectCategory) onSelectCategory(cat);
          openCategoryColorPalette(cat);
        });
      }

      // Tap chip to select, or if already active tap again to open color palette
      chip.addEventListener('click', (e) => {
        if (e.target.closest('.chip-delete')) return;
        if (e.target.closest('.chip-color-dot')) return;

        if (isSelected) {
          openCategoryColorPalette(cat);
        } else {
          input.value = cat;
          if (addBtn) addBtn.classList.add('hidden');
          renderChips();
          if (onSelectCategory) onSelectCategory(cat);
          mobileServices.hapticTap();
        }
      });

      // Tap × to delete category
      const delBtn = chip.querySelector('.chip-delete');
      if (delBtn) {
        delBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          taskStore.deleteCategory(cat);
          if (input.value.trim().toLowerCase() === cat.toLowerCase()) {
            input.value = '';
          }
          renderChips();
          mobileServices.hapticTap();
          showToastNotification(`Category "${cat}" removed`);
        });
      }

      container.appendChild(chip);
    });
  }

  input.addEventListener('input', () => {
    const val = input.value.trim();
    const cats = taskStore.getCategories();
    const exists = cats.some(c => c.toLowerCase() === val.toLowerCase());
    if (addBtn) {
      if (val.length > 0 && !exists) {
        addBtn.classList.remove('hidden');
      } else {
        addBtn.classList.add('hidden');
      }
    }
    renderChips();
  });

  if (addBtn) {
    addBtn.addEventListener('click', (e) => {
      e.preventDefault();
      const val = input.value.trim();
      if (val) {
        taskStore.addCategory(val);
        addBtn.classList.add('hidden');
        renderChips();
        if (onSelectCategory) onSelectCategory(val);
        mobileServices.hapticTap();
        showToastNotification(`Category "${val}" saved`);
      }
    });
  }

  renderChips();
  return renderChips;
}

let refreshAddCategoryChips = null;
let refreshEditCategoryChips = null;

function syncModalToggleIcons() {
  const addBank = document.getElementById('addModalTimeBank');
  const addPiggy = document.getElementById('addModalPiggyIcon');
  if (addPiggy && addBank) {
    addPiggy.classList.toggle('active', Boolean(addBank.checked));
  }

  const addLock = document.getElementById('addModalIsLocked');
  const addLockIcon = document.getElementById('addModalLockIcon');
  if (addLockIcon && addLock) {
    addLockIcon.classList.toggle('active', Boolean(addLock.checked));
  }

  const editBank = document.getElementById('editTaskTimeBank');
  const editPiggy = document.getElementById('editModalPiggyIcon');
  if (editPiggy && editBank) {
    editPiggy.classList.toggle('active', Boolean(editBank.checked));
  }

  const editLock = document.getElementById('editTaskIsLocked');
  const editLockIcon = document.getElementById('editModalLockIcon');
  if (editLockIcon && editLock) {
    editLockIcon.classList.toggle('active', Boolean(editLock.checked));
  }

  const calBank = document.getElementById('calEventTimeBank');
  const calPiggy = document.getElementById('calEventPiggyIcon');
  if (calPiggy && calBank) {
    calPiggy.classList.toggle('active', Boolean(calBank.checked));
  }

  const calLock = document.getElementById('calEventToggleLock');
  const calLockIcon = document.getElementById('calEventLockIcon');
  if (calLockIcon && calLock) {
    calLockIcon.classList.toggle('active', Boolean(calLock.checked));
  }
}

// ==========================================
// Work / Break Segmented Control for Add Task
// ==========================================
let currentAddTaskType = 'work'; // 'work' or 'break'

function setAddTaskType(type) {
  currentAddTaskType = type;
  const workBtn = document.getElementById('typeSegmentWork');
  const breakBtn = document.getElementById('typeSegmentBreak');
  const submitBtn = document.getElementById('btnAddModalSubmit');
  const titleInput = document.getElementById('addModalTitle');
  const durationInput = document.getElementById('addModalDuration');
  const categoryInput = document.getElementById('addModalCategory');
  const emojiBadge = document.getElementById('addTaskHeaderEmoji');
  const heading = document.getElementById('addTaskModalHeading');

  if (type === 'break') {
    if (workBtn) workBtn.classList.remove('active');
    if (breakBtn) breakBtn.classList.add('active');
    if (submitBtn) {
      submitBtn.classList.add('is-break-btn');
      submitBtn.textContent = '+ Add Break';
      submitBtn.style.setProperty('background', '#f59e0b', 'important');
      submitBtn.style.setProperty('color', '#0c0e14', 'important');
    }
    if (heading) heading.textContent = 'Add Break';
    currentAddTaskEmoji = '☕';
    if (emojiBadge) emojiBadge.textContent = '☕';
    if (titleInput && (titleInput.value === 'Break' || titleInput.value === 'Untitled Task')) {
      titleInput.value = '';
    }
    if (titleInput) titleInput.placeholder = 'e.g. Coffee break, walk, stretch';
    if (durationInput) {
      durationInput.value = '';
      durationInput.placeholder = 'e.g. 30';
    }
    if (typeof addModalFieldState !== 'undefined') {
      addModalFieldState.durationUserDefined = false;
    }
    if (categoryInput) categoryInput.value = 'Break';
    const bankInput = document.getElementById('addModalTimeBank');
    if (bankInput) bankInput.checked = false; // Breaks default to no piggy bank

    document.querySelectorAll('#addModalDurationChips .duration-chip').forEach(c => {
      c.classList.remove('active');
    });
  } else {
    if (workBtn) workBtn.classList.add('active');
    if (breakBtn) breakBtn.classList.remove('active');
    if (submitBtn) {
      submitBtn.classList.remove('is-break-btn');
      submitBtn.textContent = '+ Add Task';
      submitBtn.style.removeProperty('background');
      submitBtn.style.removeProperty('color');
    }
    if (heading) heading.textContent = 'Add Task';
    currentAddTaskEmoji = '📚';
    if (emojiBadge) emojiBadge.textContent = '📚';
    if (titleInput && titleInput.value === 'Break') {
      titleInput.value = '';
    }
    if (titleInput) titleInput.placeholder = 'e.g. Core Reading & Practice';
    if (durationInput) {
      durationInput.value = '';
      durationInput.placeholder = 'e.g. 30';
    }
    if (typeof addModalFieldState !== 'undefined') {
      addModalFieldState.durationUserDefined = false;
    }
    if (categoryInput && categoryInput.value === 'Break') categoryInput.value = 'Study';
    const bankInput = document.getElementById('addModalTimeBank');
    if (bankInput) bankInput.checked = false;

    document.querySelectorAll('#addModalDurationChips .duration-chip').forEach(c => {
      c.classList.remove('active');
    });
  }

  syncModalToggleIcons();
  if (refreshAddCategoryChips) refreshAddCategoryChips();
}

// ==========================================
// Add Task Modal Logic (Unified Planning UI)
// ==========================================
let isAddModalManualEmoji = false;
let isAddModalManualCategory = false;
let isEditModalManualEmoji = false;
let isEditModalManualCategory = false;

let addModalSubtasks = [];
let editModalSubtasks = [];
let addModalSessionCount = 2;
let editModalSessionCount = 2;

function renderAddModalSubtaskList() {
  const container = document.getElementById('addModalSubtaskList');
  if (!container) return;
  container.innerHTML = '';
  addModalSubtasks.forEach((st, idx) => {
    const row = document.createElement('div');
    row.className = 'subtask-editor-row';
    row.setAttribute('data-index', idx);
    row.innerHTML = `
      <span class="subtask-editor-handle" title="Drag to reorder">::</span>
      <span class="subtask-editor-title">${escapeHtml(st.title || '')}</span>
      <button type="button" class="btn-subtask-editor-del" data-index="${idx}" title="Remove step">✕</button>
    `;
    const delBtn = row.querySelector('.btn-subtask-editor-del');
    if (delBtn) {
      delBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        addModalSubtasks.splice(idx, 1);
        renderAddModalSubtaskList();
      });
    }
    container.appendChild(row);
  });
}

function renderEditModalSubtaskList() {
  const container = document.getElementById('editTaskSubtaskList');
  if (!container) return;
  container.innerHTML = '';
  editModalSubtasks.forEach((st, idx) => {
    const row = document.createElement('div');
    row.className = 'subtask-editor-row';
    row.setAttribute('data-index', idx);
    row.innerHTML = `
      <span class="subtask-editor-handle" title="Drag to reorder">::</span>
      <span class="subtask-editor-title">${escapeHtml(st.title || '')}</span>
      <button type="button" class="btn-subtask-editor-del" data-index="${idx}" title="Remove step">✕</button>
    `;
    const delBtn = row.querySelector('.btn-subtask-editor-del');
    if (delBtn) {
      delBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        editModalSubtasks.splice(idx, 1);
        renderEditModalSubtaskList();
      });
    }
    container.appendChild(row);
  });
}

function openAddTaskModal(defaultType = 'work', prefillData = null) {
  ensureHistoryBuffer();
  isAddModalManualEmoji = false;
  isAddModalManualCategory = false;
  addModalSubtasks = [];
  addModalSessionCount = 2;
  const toggleMulti = document.getElementById('addModalIsMultiSession');
  const detailsMulti = document.getElementById('addModalMultiSessionDetails');
  const valMulti = document.getElementById('addModalSessionCountVal');
  const hintMulti = document.getElementById('addModalMultiSessionHint');
  const addModalAddToTodo = document.getElementById('addModalAddToTodo');
  if (toggleMulti) toggleMulti.checked = false;
  if (detailsMulti) detailsMulti.classList.add('hidden');
  if (valMulti) valMulti.textContent = '2';
  if (hintMulti) hintMulti.textContent = 'Total duration split into 2 sessions';
  if (addModalAddToTodo) addModalAddToTodo.checked = false;
  const addModalNewSubtaskInput = document.getElementById('addModalNewSubtaskInput');
  if (addModalNewSubtaskInput) addModalNewSubtaskInput.value = '';
  renderAddModalSubtaskList();
  if (typeof addModalFieldState !== 'undefined') {
    addModalFieldState.durationUserDefined = false;
    addModalFieldState.startUserDefined = false;
    addModalFieldState.endUserDefined = false;
    addModalFieldState.endTimeLocked = false;
    addModalFieldState.lastEdited = null;
  }
  const modal = document.getElementById('addTaskModalBackdrop');
  if (!modal) return;
  const inputTitle = document.getElementById('addModalTitle');
  const inputDur = document.getElementById('addModalDuration');
  const inputCat = document.getElementById('addModalCategory');
  const inputFixed = document.getElementById('addModalFixedTime');
  const inputStart = document.getElementById('addModalStartTime');
  const inputEnd = document.getElementById('addModalEndTime');
  const toggleBank = document.getElementById('addModalTimeBank');
  const toggleLock = document.getElementById('addModalIsLocked');
  const emojiBadge = document.getElementById('addTaskHeaderEmoji');

  const addSyncGoogle = document.getElementById('addTaskSyncGoogle');
  const addSyncMS = document.getElementById('addTaskSyncMS');
  if (addSyncGoogle) {
    addSyncGoogle.checked = (typeof taskStore.getOutboundSyncPreference === 'function')
      ? taskStore.getOutboundSyncPreference('google')
      : false;
  }
  if (addSyncMS) {
    addSyncMS.checked = (typeof taskStore.getOutboundSyncPreference === 'function')
      ? taskStore.getOutboundSyncPreference('microsoft')
      : false;
  }

  if (inputDur) {
    inputDur.value = '';
    inputDur.placeholder = 'e.g. 30';
  }
  if (inputCat) inputCat.value = defaultType === 'break' ? 'Break' : 'Study';
  if (inputFixed) inputFixed.value = '';
  if (inputStart) inputStart.value = '';
  const inputStartNative = document.getElementById('addModalStartTimeNative');
  if (inputStartNative) inputStartNative.value = '';
  if (inputEnd) inputEnd.value = '';
  const inputEndNative = document.getElementById('addModalEndTimeNative');
  if (inputEndNative) inputEndNative.value = '';
  if (toggleBank) toggleBank.checked = false;
  if (toggleLock) toggleLock.checked = false;

  setAddTaskType(defaultType);

  if (prefillData && prefillData.title) {
    if (inputTitle) inputTitle.value = prefillData.title;
  } else {
    if (inputTitle) inputTitle.value = '';
  }

  if (prefillData && prefillData.category) {
    if (inputCat) inputCat.value = prefillData.category;
  }

  if (prefillData && prefillData.emoji) {
    currentAddTaskEmoji = prefillData.emoji;
  } else {
    currentAddTaskEmoji = defaultType === 'break' ? '☕' : '📚';
  }
  if (emojiBadge) emojiBadge.textContent = currentAddTaskEmoji;

  syncModalToggleIcons();
  if (typeof renderAllDurationPresetChips === 'function') renderAllDurationPresetChips();
  if (refreshAddCategoryChips) refreshAddCategoryChips();

  modal.classList.remove('hidden');
  mobileServices.hapticTap();
}

function closeAddTaskModal() {
  (() => { const _el = document.getElementById("addTaskModalBackdrop"); if (_el) _el.classList.add("hidden"); })();
}

// ==========================================
// Task Edit Modal Logic (With Auto-Save on Click-Off)
// ==========================================
let currentEditTaskId = null;

function openTaskEditModal(taskId) {
  const tasks = taskStore.getTasks();
  const task = tasks.find(t => t.id === taskId);
  if (!task) return;
  currentEditTaskId = taskId;
  currentEditEmoji = task.emoji || '📝';

  const editTaskId = document.getElementById('editTaskId');
  const editTaskTitle = document.getElementById('editTaskTitle');
  const editTaskDuration = document.getElementById('editTaskDuration');
  const editTaskCategory = document.getElementById('editTaskCategory');
  const editTaskFixedTime = document.getElementById('editTaskFixedTime');
  const editTaskStartTime = document.getElementById('editTaskStartTime');
  const editTaskEndTime = document.getElementById('editTaskEndTime');
  const editTaskIsLocked = document.getElementById('editTaskIsLocked');
  const editTaskHeaderEmoji = document.getElementById('editTaskHeaderEmoji');
  const editTaskTimeBank = document.getElementById('editTaskTimeBank');

  if (editTaskId) editTaskId.value = task.id;
  if (editTaskTitle) editTaskTitle.value = task.title || '';
  const durVal = task.plannedDuration || 30;
  if (editTaskDuration) editTaskDuration.value = durVal;
  document.querySelectorAll('#editModalDurationChips .duration-chip').forEach(c => {
    c.classList.toggle('active', c.getAttribute('data-min') === String(durVal));
  });
  if (editTaskCategory) editTaskCategory.value = task.category || 'General';
  if (editTaskFixedTime) editTaskFixedTime.value = task.fixedStartTime || '';
  if (editTaskStartTime) editTaskStartTime.value = task.fixedStartTime || (task.isLocked ? task.startTime : '') || '';
  if (editTaskEndTime) editTaskEndTime.value = task.fixedEndTime || (task.isLocked ? task.endTime : '') || '';
  if (editTaskIsLocked) editTaskIsLocked.checked = Boolean(task.isLocked);
  if (editTaskHeaderEmoji) editTaskHeaderEmoji.textContent = currentEditEmoji;
  if (editTaskTimeBank) editTaskTimeBank.checked = task.useTimeBank !== false;

  const editSyncGoogle = document.getElementById('editTaskSyncGoogle');
  const editSyncMS = document.getElementById('editTaskSyncMS');
  const isPairedGoogle = Boolean(task.googleEventId || task.source === 'google' || (task.externalId && task.provider === 'google'));
  const isPairedMS = Boolean(task.microsoftEventId || task.source === 'microsoft' || (task.externalId && task.provider === 'microsoft'));
  if (editSyncGoogle) {
    editSyncGoogle.checked = isPairedGoogle;
  }
  if (editSyncMS) {
    editSyncMS.checked = isPairedMS;
  }
  isEditModalManualEmoji = false;
  isEditModalManualCategory = false;

  const subtasks = (typeof taskStore !== 'undefined' && typeof taskStore.getSubtasks === 'function')
    ? taskStore.getSubtasks(taskId)
    : (Array.isArray(task.subtasks) ? task.subtasks : []);
  editModalSubtasks = subtasks.map(s => ({ id: s.id, title: s.title, completed: Boolean(s.completed) }));
  editModalSessionCount = task.sessionCount || 2;
  const isMulti = Boolean(task.isMultiSession);
  const toggleMulti = document.getElementById('editTaskIsMultiSession');
  const detailsMulti = document.getElementById('editTaskMultiSessionDetails');
  const valMulti = document.getElementById('editTaskSessionCountVal');
  const hintMulti = document.getElementById('editTaskMultiSessionHint');
  const editTaskAddToTodo = document.getElementById('editTaskAddToTodo');
  if (toggleMulti) toggleMulti.checked = isMulti;
  if (detailsMulti) detailsMulti.classList.toggle('hidden', !isMulti);
  if (valMulti) valMulti.textContent = String(editModalSessionCount);
  if (hintMulti) hintMulti.textContent = `Total duration split into ${editModalSessionCount} sessions`;
  if (editTaskAddToTodo) {
    const isAlsoInTodo = taskStore.getTodoTasks().some(t => t.id === taskId || t.masterTaskId === taskId);
    editTaskAddToTodo.checked = isAlsoInTodo;
  }
  const editTaskNewSubtaskInput = document.getElementById('editTaskNewSubtaskInput');
  if (editTaskNewSubtaskInput) editTaskNewSubtaskInput.value = '';
  renderEditModalSubtaskList();

  syncModalToggleIcons();
  if (typeof renderAllDurationPresetChips === 'function') renderAllDurationPresetChips();
  if (refreshEditCategoryChips) refreshEditCategoryChips();

  ensureHistoryBuffer();
  (() => { const _el = document.getElementById("taskEditModalBackdrop"); if (_el) _el.classList.remove("hidden"); })();
  mobileServices.hapticTap();
}

function saveCurrentTaskEdit() {
  if (!currentEditTaskId) return;
  const title = (() => { const _el = document.getElementById("editTaskTitle"); return _el ? _el.value : ""; })().trim();
  if (!title) return;
  const plannedDuration = parseInt((() => { const _el = document.getElementById("editTaskDuration"); return _el ? _el.value : ""; })(), 10) || 30;
  const category = (() => { const _el = document.getElementById("editTaskCategory"); return _el ? _el.value : ""; })().trim() || 'General';
  const fixedStartTime = (() => { const _el = document.getElementById("editTaskStartTime"); return _el ? _el.value : ""; })() || (() => { const _el = document.getElementById("editTaskFixedTime"); return _el ? _el.value : ""; })() || null;
  const endInput = document.getElementById('editTaskEndTime');
  const fixedEndTime = (endInput && endInput.value && endInput.value.trim().length === 5) ? endInput.value.trim() : null;
  const isLocked = (() => { const _el = document.getElementById("editTaskIsLocked"); return _el ? _el.checked : false; })();
  const useTimeBank = document.getElementById('editTaskTimeBank') ? document.getElementById('editTaskTimeBank').checked : true;
  const emoji = currentEditEmoji || (() => { const _el = document.getElementById("editTaskHeaderEmoji"); return _el ? _el.textContent : ""; })().trim() || '📝';

  if (category) taskStore.addCategory(category);

  const editSyncGoogle = document.getElementById('editTaskSyncGoogle');
  const editSyncMS = document.getElementById('editTaskSyncMS');
  const prevTask = taskStore.getTasks().find(t => t.id === currentEditTaskId);
  const prevGoogle = Boolean(prevTask && (prevTask.googleEventId || prevTask.source === 'google' || (prevTask.externalId && prevTask.provider === 'google')));
  const prevMS = Boolean(prevTask && (prevTask.microsoftEventId || prevTask.source === 'microsoft' || (prevTask.externalId && prevTask.provider === 'microsoft')));
  const nextGoogle = Boolean(editSyncGoogle && editSyncGoogle.checked);
  const nextMS = Boolean(editSyncMS && editSyncMS.checked);

  const isCreatedInApp = Boolean(
    prevTask && (
      (prevTask.origin === 'local' || prevTask.createdInApp === true) ||
      (prevTask.id && (prevTask.id.indexOf('task-') === 0 || prevTask.id.indexOf('cal-event-') === 0))
    )
  );
  const isExplicitlyExternal = Boolean(
    prevTask && (
      prevTask.origin === 'external' ||
      prevTask.createdInApp === false ||
      (prevTask.id && (prevTask.id.indexOf('cal-gcal-') === 0 || prevTask.id.indexOf('cal-ms-') === 0 || prevTask.id.indexOf('cal-sync-') === 0))
    )
  );

  // Unpair Google:
  if (prevGoogle && !nextGoogle) {
    if (isCreatedInApp && !isExplicitlyExternal) {
      if (typeof calendarSyncService !== 'undefined' && typeof calendarSyncService.pushEventDelete === 'function') {
        calendarSyncService.pushEventDelete(prevTask, 'google').catch(() => {});
      }
    } else {
      if (prevTask && prevTask.externalId && typeof taskStore.addDeletedId === 'function') {
        taskStore.addDeletedId(prevTask.externalId);
      }
    }
    taskStore.updateTask(currentEditTaskId, { googleEventId: null, externalId: null, provider: 'local', origin: 'local', createdInApp: true });
  } else if (!prevGoogle && nextGoogle) {
    if (typeof calendarSyncService !== 'undefined' && typeof calendarSyncService.createRemoteEvent === 'function') {
      const taskPayload = Object.assign({}, prevTask, {
        title,
        plannedDuration,
        category,
        fixedStartTime,
        emoji,
        color: (prevTask && prevTask.color) ? prevTask.color : classifierGetCategoryColor(category)
      });
      calendarSyncService.createRemoteEvent('google', taskPayload).then(res => {
        if (res && res.externalId) {
          taskStore.updateTask(currentEditTaskId, {
            googleEventId: res.externalId,
            externalId: res.externalId,
            provider: 'google'
          });
        }
      }).catch(() => {});
    }
  }

  // Unpair Microsoft:
  if (prevMS && !nextMS) {
    if (isCreatedInApp && !isExplicitlyExternal) {
      if (typeof calendarSyncService !== 'undefined' && typeof calendarSyncService.pushEventDelete === 'function') {
        calendarSyncService.pushEventDelete(prevTask, 'microsoft').catch(() => {});
      }
    } else {
      if (prevTask && prevTask.externalId && typeof taskStore.addDeletedId === 'function') {
        taskStore.addDeletedId(prevTask.externalId);
      }
    }
    taskStore.updateTask(currentEditTaskId, { microsoftEventId: null, externalId: null, provider: 'local', origin: 'local', createdInApp: true });
  } else if (!prevMS && nextMS) {
    if (typeof calendarSyncService !== 'undefined' && typeof calendarSyncService.createRemoteEvent === 'function') {
      const taskPayload = Object.assign({}, prevTask, {
        title,
        plannedDuration,
        category,
        fixedStartTime,
        emoji,
        color: (prevTask && prevTask.color) ? prevTask.color : classifierGetCategoryColor(category)
      });
      calendarSyncService.createRemoteEvent('microsoft', taskPayload).then(res => {
        if (res && res.externalId) {
          taskStore.updateTask(currentEditTaskId, {
            microsoftEventId: res.externalId,
            externalId: res.externalId,
            provider: 'microsoft'
          });
        }
      }).catch(() => {});
    }
  }

  const categoryChanged = Boolean(prevTask && prevTask.category !== category);
  const taskColor = (prevTask && prevTask.color && !categoryChanged) ? prevTask.color : classifierGetCategoryColor(category);
  let taskColorId = (prevTask && prevTask.colorId && !categoryChanged) ? prevTask.colorId : null;
  if (!taskColorId && taskColor && typeof googleCalendarAdapter !== 'undefined' && typeof googleCalendarAdapter.getGoogleColorId === 'function') {
    taskColorId = googleCalendarAdapter.getGoogleColorId(category, taskColor, null);
  }

  const editMultiInput = document.getElementById('editTaskIsMultiSession');
  const isMultiSession = Boolean(editMultiInput && editMultiInput.checked);
  const sessionCount = isMultiSession ? editModalSessionCount : 1;
  const sessionDuration = isMultiSession ? Math.max(1, Math.round(plannedDuration / sessionCount)) : plannedDuration;
  const editAddToTodoInput = document.getElementById('editTaskAddToTodo');
  const addToTodo = Boolean(editAddToTodoInput && editAddToTodoInput.checked);

  taskStore.updateTask(currentEditTaskId, {
    title,
    plannedDuration: isMultiSession ? sessionDuration : plannedDuration,
    category,
    fixedStartTime,
    fixedEndTime,
    isLocked,
    useTimeBank,
    emoji,
    color: taskColor,
    colorId: taskColorId,
    isMultiSession: isMultiSession,
    sessionCount: sessionCount,
    sessionDuration: sessionDuration,
    subtasks: editModalSubtasks.slice()
  });

  const existingTodo = taskStore.getTodoTasks().find(t => t.id === currentEditTaskId || t.masterTaskId === currentEditTaskId);
  if (addToTodo) {
    if (existingTodo) {
      taskStore.updateTodoTask(existingTodo.id, {
        title,
        category,
        emoji,
        isMultiSession,
        sessionCount,
        sessionDuration,
        plannedDuration,
        subtasks: editModalSubtasks.slice()
      });
    } else {
      taskStore.addTodoTask({
        id: 'todo-' + currentEditTaskId,
        masterTaskId: currentEditTaskId,
        title,
        category,
        emoji,
        completed: false,
        isMultiSession,
        sessionCount,
        sessionDuration,
        plannedDuration,
        subtasks: editModalSubtasks.slice()
      });
    }
    renderTodoList();
  } else if (existingTodo) {
    taskStore.deleteTodoTask(existingTodo.id);
    renderTodoList();
  }

  const updatedTask = taskStore.getTasks().find(t => t.id === currentEditTaskId);
  if ((prevGoogle && nextGoogle) || (prevMS && nextMS)) {
    if (typeof calendarSyncService !== 'undefined' && typeof calendarSyncService.pushEventUpdate === 'function') {
      calendarSyncService.pushEventUpdate(updatedTask).catch(() => {});
    }
  }

  runtime.initialTasks = taskStore.getTasks();
  const activeTask = runtime ? runtime.getActiveTask() : null;
  if (activeTask && activeTask.id === currentEditTaskId) {
    activeTask.isLocked = isLocked;
    activeTask.fixedStartTime = fixedStartTime;
    activeTask.fixedEndTime = fixedEndTime;
  }
  if (runtime && runtime.currentSchedule && runtime.currentSchedule.tasks) {
    const schedTask = runtime.currentSchedule.tasks.find(t => t.id === currentEditTaskId);
    if (schedTask) {
      schedTask.isLocked = isLocked;
      schedTask.fixedStartTime = fixedStartTime;
      schedTask.fixedEndTime = fixedEndTime;
    }
  }
  runtime.recalculate();
  syncDynamicScheduleTimesToCalendar();
  updateTimerQuickToggles();
  updateActiveTaskDisplay();
  renderTaskList(((runtime.currentSchedule && runtime.currentSchedule.tasks) || []) || []);
  renderCalendarModal();
}

function closeTaskEditModal() {
  (() => { const _el = document.getElementById("taskEditModalBackdrop"); if (_el) _el.classList.add("hidden"); })();
  currentEditTaskId = null;
  currentEditEmoji = null;
}

// ==========================================
// Navigation Drawer, Settings & Calendar Modals (Module Scope)
// ==========================================
function ensureHistoryBuffer() {
  try {
    if (typeof window !== 'undefined' && window.history && typeof window.history.pushState === 'function') {
      window.history.pushState({ appState: 'app' }, '');
    }
  } catch (_) {}
}
window.ensureHistoryBuffer = ensureHistoryBuffer;

function syncNavActiveState() {
  const isFullCalOpen = typeof calendarView !== 'undefined' && calendarView && typeof calendarView.isOpen === 'function' && calendarView.isOpen();
  const calendarModalBackdrop = document.getElementById('calendarModalBackdrop');
  const todoModalBackdrop = document.getElementById('todoModalBackdrop');
  const insightsModalBackdrop = document.getElementById('insightsModalBackdrop');
  const settingsModalBackdrop = document.getElementById('settingsModalBackdrop');

  const isTodayCalOpen = Boolean(calendarModalBackdrop && !calendarModalBackdrop.classList.contains('hidden'));
  const isTodoOpen = Boolean(todoModalBackdrop && !todoModalBackdrop.classList.contains('hidden'));
  const isInsightsOpen = Boolean(insightsModalBackdrop && !insightsModalBackdrop.classList.contains('hidden'));
  const isSettingsOpen = Boolean(settingsModalBackdrop && !settingsModalBackdrop.classList.contains('hidden'));

  const navItemTimer = document.getElementById('navItemTimer');
  const navItemFullCalendar = document.getElementById('navItemFullCalendar');
  const navItemCalendar = document.getElementById('navItemCalendar');
  const navItemTodo = document.getElementById('navItemTodo');
  const navItemInsights = document.getElementById('navItemInsights');
  const navItemSettings = document.getElementById('navItemSettings');

  const allItems = [navItemTimer, navItemFullCalendar, navItemCalendar, navItemTodo, navItemInsights, navItemSettings];
  for (let i = 0; i < allItems.length; i++) {
    const item = allItems[i];
    if (item) {
      item.classList.remove('active');
      if (typeof item.blur === 'function') item.blur();
    }
  }

  if (isFullCalOpen) {
    if (navItemFullCalendar) navItemFullCalendar.classList.add('active');
  } else if (isTodayCalOpen) {
    if (navItemCalendar) navItemCalendar.classList.add('active');
  } else if (isTodoOpen) {
    if (navItemTodo) navItemTodo.classList.add('active');
  } else if (isInsightsOpen) {
    if (navItemInsights) navItemInsights.classList.add('active');
  } else if (isSettingsOpen) {
    if (navItemSettings) navItemSettings.classList.add('active');
  } else {
    if (navItemTimer) navItemTimer.classList.add('active');
  }
}
window.syncNavActiveState = syncNavActiveState;

function openDrawer() {
  if (navDrawer && navDrawerBackdrop) {
    ensureHistoryBuffer();
    syncNavActiveState();
    navDrawer.style.removeProperty('transform');
    navDrawer.style.removeProperty('transition');
    navDrawer.style.removeProperty('visibility');
    navDrawerBackdrop.style.removeProperty('opacity');
    navDrawerBackdrop.style.removeProperty('transition');
    navDrawer.classList.add('open');
    navDrawerBackdrop.classList.remove('hidden');
    navDrawer.setAttribute('aria-hidden', 'false');
    mobileServices.hapticTap();
  }
}

function closeDrawer() {
  if (navDrawer && navDrawerBackdrop) {
    navDrawer.style.removeProperty('transform');
    navDrawer.style.removeProperty('transition');
    navDrawer.style.removeProperty('visibility');
    navDrawerBackdrop.style.removeProperty('opacity');
    navDrawerBackdrop.style.removeProperty('transition');
    navDrawer.classList.remove('open');
    navDrawerBackdrop.classList.add('hidden');
    navDrawer.setAttribute('aria-hidden', 'true');
  }
}

function openSettings() {
  ensureHistoryBuffer();
  closeDrawer();
  closeCalendar();
  closeTodo();
  closeInsights();
  if (typeof calendarView !== 'undefined' && calendarView && typeof calendarView.close === 'function') {
    calendarView.close();
  }
  const navItemFullCalendar = document.getElementById('navItemFullCalendar');
  if (navItemFullCalendar) navItemFullCalendar.classList.remove('active');
  const navItemInsights = document.getElementById('navItemInsights');
  if (navItemInsights) navItemInsights.classList.remove('active');
  if (toggleConfirmAdjust) {
    toggleConfirmAdjust.checked = taskStore.getConfirmAdjustments();
  }
  const toggleHaptics = document.getElementById('toggleHapticsEnabled');
  if (toggleHaptics && typeof taskStore.getHapticsEnabled === 'function') {
    toggleHaptics.checked = taskStore.getHapticsEnabled();
  }
  const toggleKeepAwake = document.getElementById('toggleKeepScreenAwake');
  if (toggleKeepAwake && typeof taskStore.getKeepScreenAwake === 'function') {
    toggleKeepAwake.checked = taskStore.getKeepScreenAwake();
  }
  const toggleCompletion = document.getElementById('toggleCompletionHaptics');
  if (toggleCompletion && typeof taskStore.getCompletionHapticsEnabled === 'function') {
    toggleCompletion.checked = taskStore.getCompletionHapticsEnabled();
  }
  const timerSettingsSubPanel = document.getElementById('timerSettingsSubPanel');
  const calendarSettingsSubPanel = document.getElementById('calendarSettingsSubPanel');
  const settingsMainPanel = document.getElementById('settingsMainPanel');
  const settingsModalCard = document.getElementById('settingsModal');
  const settingsMainGroup = settingsModalCard ? settingsModalCard.querySelector('.modal-body > .settings-group') : null;
  const settingsMainHeader = settingsModalCard ? settingsModalCard.querySelector('.modal-header') : null;
  if (timerSettingsSubPanel) timerSettingsSubPanel.classList.add('hidden');
  if (calendarSettingsSubPanel) calendarSettingsSubPanel.classList.add('hidden');
  if (settingsMainPanel) settingsMainPanel.classList.remove('hidden');
  if (settingsMainGroup) settingsMainGroup.classList.remove('hidden');
  if (settingsMainHeader) settingsMainHeader.classList.remove('hidden');
  applyTheme(taskStore.getTheme());
  if (settingsModalBackdrop) {
    settingsModalBackdrop.classList.remove('hidden');
  }
  mobileServices.hapticTap();
}

function closeSettings() {
  if (settingsModalBackdrop) {
    settingsModalBackdrop.classList.add('hidden');
  }
  const timerSettingsSubPanel = document.getElementById('timerSettingsSubPanel');
  const calendarSettingsSubPanel = document.getElementById('calendarSettingsSubPanel');
  const settingsMainPanel = document.getElementById('settingsMainPanel');
  const settingsModalCard = document.getElementById('settingsModal');
  const settingsMainGroup = settingsModalCard ? settingsModalCard.querySelector('.modal-body > .settings-group') : null;
  const settingsMainHeader = settingsModalCard ? settingsModalCard.querySelector('.modal-header') : null;
  if (timerSettingsSubPanel) timerSettingsSubPanel.classList.add('hidden');
  if (calendarSettingsSubPanel) calendarSettingsSubPanel.classList.add('hidden');
  if (settingsMainPanel) settingsMainPanel.classList.remove('hidden');
  if (settingsMainGroup) settingsMainGroup.classList.remove('hidden');
  if (settingsMainHeader) settingsMainHeader.classList.remove('hidden');
}

function openCalendar() {
  ensureHistoryBuffer();
  closeDrawer();
  closeSettings();
  closeTodo();
  closeInsights();
  if (typeof calendarView !== 'undefined' && calendarView && typeof calendarView.close === 'function') {
    calendarView.close();
  }
  const navItemFullCalendar = document.getElementById('navItemFullCalendar');
  if (navItemFullCalendar) navItemFullCalendar.classList.remove('active');
  const navItemInsights = document.getElementById('navItemInsights');
  if (navItemInsights) navItemInsights.classList.remove('active');
  if (!runtime || runtime.status === TimerStatus.IDLE) {
    taskStore.syncScheduleAndCalendar();
    runtime.initialTasks = taskStore.getTasks();
    runtime.recalculate();
  }
  renderTaskList(((runtime.currentSchedule && runtime.currentSchedule.tasks) || []) || taskStore.getTasks());
  renderCalendarModal();
  updateScheduleUI(runtime.currentSchedule);
  updateActiveTaskDisplay();
  updateTimespansButtonUI();
  if (typeof updateSimpleLoopUI === 'function') updateSimpleLoopUI();
  if (calendarModalBackdrop) {
    calendarModalBackdrop.classList.remove('hidden');
  }
  if (navItemCalendar) navItemCalendar.classList.add('active');
  if (navItemTimer) navItemTimer.classList.remove('active');
  if (navItemTodo) navItemTodo.classList.remove('active');
  mobileServices.hapticTap();
}

function closeCalendar() {
  if (calendarModalBackdrop) {
    calendarModalBackdrop.classList.add('hidden');
  }
  if (navItemTimer) navItemTimer.classList.add('active');
  if (navItemCalendar) {
    navItemCalendar.classList.remove('active');
    if (typeof navItemCalendar.blur === 'function') navItemCalendar.blur();
  }
  const navItemFullCalendar = document.getElementById('navItemFullCalendar');
  if (navItemFullCalendar) {
    navItemFullCalendar.classList.remove('active');
    if (typeof navItemFullCalendar.blur === 'function') navItemFullCalendar.blur();
  }
  if (runtime && runtime.status === TimerStatus.IDLE) {
    runtime.initialTasks = taskStore.getTasks();
    runtime.recalculate();
    updateActiveTaskDisplay();
  }
}

function openTodo() {
  ensureHistoryBuffer();
  closeDrawer();
  closeSettings();
  closeCalendar();
  closeInsights();
  if (typeof calendarView !== 'undefined' && calendarView && typeof calendarView.close === 'function') {
    calendarView.close();
  }
  const navItemFullCalendar = document.getElementById('navItemFullCalendar');
  if (navItemFullCalendar) navItemFullCalendar.classList.remove('active');
  const navItemInsights = document.getElementById('navItemInsights');
  if (navItemInsights) navItemInsights.classList.remove('active');
  renderTodoList();
  const todoModal = document.getElementById('todoModalBackdrop');
  if (todoModal) {
    todoModal.classList.remove('hidden');
  }
  if (navItemTodo) navItemTodo.classList.add('active');
  if (navItemTimer) navItemTimer.classList.remove('active');
  if (navItemCalendar) navItemCalendar.classList.remove('active');
  mobileServices.hapticTap();
}

function closeTodo() {
  const todoModal = document.getElementById('todoModalBackdrop');
  if (todoModal) {
    todoModal.classList.add('hidden');
  }
  if (navItemTimer) navItemTimer.classList.add('active');
  if (navItemTodo) navItemTodo.classList.remove('active');
}

// ==========================================
// Insights & Analytics Modal (Phase 4)
// ==========================================
let currentInsightsRangeDays = 7;

function openInsights() {
  ensureHistoryBuffer();
  closeDrawer();
  closeSettings();
  closeCalendar();
  closeTodo();
  if (typeof calendarView !== 'undefined' && calendarView && typeof calendarView.close === 'function') {
    calendarView.close();
  }
  const navItemFullCalendar = document.getElementById('navItemFullCalendar');
  if (navItemFullCalendar) navItemFullCalendar.classList.remove('active');

  const insightsModal = document.getElementById('insightsModalBackdrop');
  if (insightsModal) {
    insightsModal.classList.remove('hidden');
  }
  const navItemInsights = document.getElementById('navItemInsights');
  if (navItemInsights) navItemInsights.classList.add('active');
  if (navItemTimer) navItemTimer.classList.remove('active');
  if (navItemCalendar) navItemCalendar.classList.remove('active');
  if (navItemTodo) navItemTodo.classList.remove('active');

  renderInsightsModal(currentInsightsRangeDays);
  mobileServices.hapticTap();
}

function closeInsights() {
  const insightsModal = document.getElementById('insightsModalBackdrop');
  if (insightsModal) {
    insightsModal.classList.add('hidden');
  }
  if (navItemTimer) navItemTimer.classList.add('active');
  const navItemInsights = document.getElementById('navItemInsights');
  if (navItemInsights) navItemInsights.classList.remove('active');
}

async function renderInsightsModal(days) {
  const range = typeof days === 'number' ? days : (currentInsightsRangeDays || 7);
  currentInsightsRangeDays = range;

  const insightsMeta = document.getElementById('insightsChartMeta');
  if (insightsMeta) {
    insightsMeta.textContent = range === 7 ? 'Past 7 days' : (range === 30 ? 'Past 30 days' : 'All recorded time');
  }

  let insights = null;
  try {
    if (typeof analytics !== 'undefined' && analytics && typeof analytics.getProductivityInsights === 'function') {
      insights = await analytics.getProductivityInsights(range);
    }
  } catch (err) {
    console.warn('Failed to load productivity insights:', err);
  }

  if (!insights) {
    insights = {
      totalFocusHours: 0,
      completedCount: 0,
      earlyCount: 0,
      overrunCount: 0,
      netBankMin: 0,
      totalBankDepositedMin: 0,
      totalBankConsumedMin: 0,
      categoryInsights: []
    };
  }

  // 1. KPI Cards
  const kpiFocusHours = document.getElementById('kpiFocusHours');
  const kpiFocusAvg = document.getElementById('kpiFocusAvg');
  if (kpiFocusHours) kpiFocusHours.textContent = (insights.totalFocusHours || 0) + 'h';
  if (kpiFocusAvg) {
    const avgPerDay = ((insights.totalFocusHours || 0) / Math.max(1, range)).toFixed(1);
    kpiFocusAvg.textContent = avgPerDay + 'h / day avg';
  }

  const kpiTasksCompleted = document.getElementById('kpiTasksCompleted');
  const kpiTasksSub = document.getElementById('kpiTasksSub');
  if (kpiTasksCompleted) kpiTasksCompleted.textContent = String(insights.completedCount || 0);
  if (kpiTasksSub) {
    kpiTasksSub.textContent = (insights.earlyCount > 0) ? (insights.earlyCount + ' finished early') : 'Tasks completed';
  }

  // Conditional Hard Stop Card (if feature disabled or removed, hide gracefully)
  const isHardStopActive = (typeof taskStore !== 'undefined' && typeof taskStore.getHardStopEnabled === 'function')
    ? taskStore.getHardStopEnabled()
    : true;
  const kpiHardStopCard = document.getElementById('kpiHardStopCard');
  if (kpiHardStopCard) {
    if (isHardStopActive) {
      kpiHardStopCard.style.display = 'flex';
      const kpiHardStopRate = document.getElementById('kpiHardStopRate');
      const totalAttempted = (insights.completedCount || 0) + (insights.overrunCount || 0);
      const ratePct = totalAttempted > 0 ? Math.round(((insights.completedCount || 0) / totalAttempted) * 100) : 100;
      if (kpiHardStopRate) kpiHardStopRate.textContent = ratePct + '%';
    } else {
      kpiHardStopCard.style.display = 'none';
    }
  }

  // Conditional Time Bank Card
  const kpiTimeBankCard = document.getElementById('kpiTimeBankCard');
  if (kpiTimeBankCard) {
    const net = insights.netBankMin || 0;
    const kpiTimeBankNet = document.getElementById('kpiTimeBankNet');
    const kpiTimeBankSub = document.getElementById('kpiTimeBankSub');
    if (kpiTimeBankNet) kpiTimeBankNet.textContent = (net >= 0 ? '+' : '') + net + 'm';
    if (kpiTimeBankSub) {
      kpiTimeBankSub.textContent = (insights.totalBankDepositedMin || 0) + 'm saved • ' + (insights.totalBankConsumedMin || 0) + 'm used';
    }
  }

  // 2. Daily Focus Activity Bar Chart
  await renderInsightsFocusChart(range);

  // 3. Category Distribution Donut Ring
  renderInsightsCategoryDonut(insights.categoryInsights);

  // 4. Estimation Bias Coach
  renderInsightsEstimationCoach(insights.categoryInsights);
}

async function renderInsightsFocusChart(rangeDays) {
  const container = document.getElementById('insightsChartContainer');
  if (!container) return;

  const numDays = Math.min(14, rangeDays);
  const now = new Date();
  const dayBuckets = [];

  for (let i = numDays - 1; i >= 0; i--) {
    const d = new Date(now.getTime() - (i * 24 * 60 * 60 * 1000));
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const key = y + '-' + m + '-' + day;
    const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()];
    dayBuckets.push({ dateKey: key, label: weekday, minutes: 0 });
  }

  const startKey = dayBuckets[0].dateKey;
  const endKey = dayBuckets[dayBuckets.length - 1].dateKey;

  try {
    if (typeof analytics !== 'undefined' && analytics && typeof analytics.getTaskMetrics === 'function') {
      const tasks = await analytics.getTaskMetrics(startKey, endKey);
      if (tasks && tasks.length) {
        for (let j = 0; j < tasks.length; j++) {
          const t = tasks[j];
          const match = dayBuckets.find(b => b.dateKey === t.date);
          if (match) {
            match.minutes += Math.round((t.actualDurationSec || 0) / 60);
          }
        }
      }
    }
  } catch (_) {}

  let maxMin = 60;
  for (let k = 0; k < dayBuckets.length; k++) {
    if (dayBuckets[k].minutes > maxMin) maxMin = dayBuckets[k].minutes;
  }
  maxMin = Math.ceil(maxMin / 30) * 30;

  const svgW = 480;
  const svgH = 140;
  const barW = Math.max(12, Math.floor(svgW / (numDays * 2.2)));
  const spacing = svgW / numDays;

  let svgContent = '<svg class="insights-chart-svg" viewBox="0 0 ' + svgW + ' ' + svgH + '">';
  svgContent += '<line x1="0" y1="20" x2="' + svgW + '" y2="20" stroke="rgba(255,255,255,0.06)" stroke-dasharray="4"/>';
  svgContent += '<line x1="0" y1="65" x2="' + svgW + '" y2="65" stroke="rgba(255,255,255,0.06)" stroke-dasharray="4"/>';
  svgContent += '<line x1="0" y1="110" x2="' + svgW + '" y2="110" stroke="rgba(255,255,255,0.12)"/>';

  for (let i = 0; i < dayBuckets.length; i++) {
    const b = dayBuckets[i];
    const x = i * spacing + (spacing - barW) / 2;
    const barHeight = Math.max(4, Math.round((b.minutes / maxMin) * 90));
    const y = 110 - barHeight;
    const isToday = (i === dayBuckets.length - 1);
    const barColor = isToday ? 'var(--accent-cyan, #00d2ff)' : 'rgba(0, 210, 255, 0.45)';

    svgContent += '<rect x="' + x + '" y="' + y + '" width="' + barW + '" height="' + barHeight + '" rx="3" fill="' + barColor + '"/>';
    svgContent += '<text x="' + (x + barW / 2) + '" y="128" fill="rgba(255,255,255,0.4)" font-size="10" font-family="monospace" text-anchor="middle">' + b.label + '</text>';
    if (b.minutes > 0) {
      svgContent += '<text x="' + (x + barW / 2) + '" y="' + (y - 5) + '" fill="rgba(255,255,255,0.8)" font-size="9" font-family="monospace" text-anchor="middle">' + b.minutes + 'm</text>';
    }
  }

  svgContent += '</svg>';
  container.innerHTML = svgContent;
}

function renderInsightsCategoryDonut(catInsights) {
  const donutContainer = document.getElementById('insightsDonutContainer');
  const legendContainer = document.getElementById('insightsCategoryLegend');
  if (!donutContainer || !legendContainer) return;

  donutContainer.innerHTML = '';
  legendContainer.innerHTML = '';

  const cats = (catInsights && catInsights.length) ? catInsights : [];
  let totalMin = 0;
  for (let i = 0; i < cats.length; i++) {
    totalMin += (cats[i].totalFocusMinutes || 0);
  }

  if (totalMin === 0 || cats.length === 0) {
    donutContainer.innerHTML = '<svg width="100" height="100" viewBox="0 0 100 100">' +
      '<circle cx="50" cy="50" r="38" fill="none" stroke="rgba(255,255,255,0.08)" stroke-width="12"/>' +
    '</svg>';
    legendContainer.innerHTML = '<span style="color:var(--text-muted);font-size:0.75rem;">No category data yet.</span>';
    return;
  }

  const radius = 38;
  const circumference = 2 * Math.PI * radius;
  let accumulatedOffset = 0;
  let svgPaths = '<svg width="100" height="100" viewBox="0 0 100 100" style="transform:rotate(-90deg);">';

  cats.forEach(function(cat) {
    const min = cat.totalFocusMinutes || 0;
    const fraction = min / totalMin;
    const strokeDash = fraction * circumference;
    const strokeOffset = circumference - accumulatedOffset;
    accumulatedOffset += strokeDash;

    const hex = getCategoryHexColor(cat.category);
    svgPaths += '<circle cx="50" cy="50" r="' + radius + '" fill="none" stroke="' + hex + '" stroke-width="12" ' +
      'stroke-dasharray="' + strokeDash + ' ' + (circumference - strokeDash) + '" ' +
      'stroke-dashoffset="' + strokeOffset + '"/>';

    const pct = Math.round(fraction * 100);
    const legendRow = document.createElement('div');
    legendRow.className = 'legend-row';
    legendRow.innerHTML = '<div class="legend-left">' +
      '<span class="legend-dot" style="background:' + hex + ';"></span>' +
      '<span class="legend-label">' + escapeHtml(cat.category) + '</span>' +
    '</div>' +
    '<span class="legend-pct">' + pct + '%</span>';
    legendContainer.appendChild(legendRow);
  });

  svgPaths += '</svg>';
  donutContainer.innerHTML = svgPaths;
}

function renderInsightsEstimationCoach(catInsights) {
  const container = document.getElementById('insightsCoachList');
  if (!container) return;
  container.innerHTML = '';

  const cats = (catInsights && catInsights.length) ? catInsights : [];
  if (cats.length === 0) {
    container.innerHTML = '<div class="coach-empty-state">Complete your first focus sessions to reveal your estimation coach.</div>';
    return;
  }

  cats.forEach(function(c) {
    const biasMin = c.avgEstimationBiasMin || 0;
    const catName = escapeHtml(c.category || 'General');

    let badgeClass = 'coach-badge-accurate';
    let badgeText = 'Accurate';
    if (biasMin > 0) {
      badgeClass = 'coach-badge-slower';
      badgeText = '+' + biasMin + 'm slower';
    } else if (biasMin < 0) {
      badgeClass = 'coach-badge-faster';
      badgeText = Math.abs(biasMin) + 'm faster';
    }

    const item = document.createElement('div');
    item.className = 'coach-item';
    item.innerHTML = '<span class="coach-cat-name">' + catName + '</span>' +
      '<span class="coach-badge ' + badgeClass + '">' + badgeText + '</span>';
    container.appendChild(item);
  });
}

window.openInsights = openInsights;
window.closeInsights = closeInsights;
window.renderInsightsModal = renderInsightsModal;

function getCategoryColor(category) {
  const hex = getCategoryHexColor(category);
  return {
    bg: hexToRgba(hex, 0.22),
    border: hex,
    text: hex
  };
}

// Condensed Calendar Timeline Renderer
function renderCalendarModal() {
  if (!calendarTimelineList) return;
  syncPastTasksCompletion();
  calendarTimelineList.innerHTML = '';

  const finishLine = document.getElementById('calendarFinishLine');
  const rawTasks = ((runtime && runtime.currentSchedule && runtime.currentSchedule.tasks) || []) || [];
  const tasks = rawTasks.filter(t => t && t.title !== '[Calentimer Cloud Sync]');
  if (tasks.length === 0) {
    calendarTimelineList.innerHTML = '<div style="color:var(--text-dim);text-align:center;padding:24px 0;">No scheduled events for today.</div>';
    if (finishLine) finishLine.style.display = 'none';
    return;
  }

  const activeIdx = runtime && runtime.activeTaskIndex >= 0 ? runtime.activeTaskIndex : 0;
  const isRunning = runtime && runtime.status === TimerStatus.RUNNING;
  const isPaused = runtime && runtime.status === TimerStatus.PAUSED;

  const isTimespans = (typeof taskStore !== 'undefined' && typeof taskStore.getTimespansEnabled === 'function')
    ? taskStore.getTimespansEnabled()
    : true;

  // In sequential mode: compute dynamic sequence times
  const seqTimeSpans = [];
  if (!isTimespans) {
    const now = new Date();
    let rollingMin = (now.getHours() * 60) + now.getMinutes();

    for (let i = 0; i < tasks.length; i++) {
      const t = tasks[i];
      const dur = Math.max(1, Math.round(t.allocatedDuration || t.plannedDuration || 1));
      let tStart = rollingMin;
      let tEnd = rollingMin + dur;

      if (t.isLocked && (t.fixedStartTime || t.startTime)) {
        tStart = parseTimeToMinutes(t.fixedStartTime || t.startTime);
        let lockedEndMin = (t.fixedEndTime || t.endTime) ? parseTimeToMinutes(t.fixedEndTime || t.endTime) : (tStart + dur);
        if (lockedEndMin <= tStart) lockedEndMin += 1440;
        tEnd = lockedEndMin;
        rollingMin = tEnd;
      } else if (isRunning || isPaused) {
        if (i < activeIdx) {
          tStart = rollingMin - dur;
          tEnd = rollingMin;
        } else if (i === activeIdx) {
          const remMin = Math.max(1, Math.ceil((runtime.getRemainingSeconds ? runtime.getRemainingSeconds() : dur * 60) / 60));
          tStart = rollingMin;
          tEnd = rollingMin + remMin;
          rollingMin = tEnd;
        } else {
          tStart = rollingMin;
          tEnd = rollingMin + dur;
          rollingMin = tEnd;
        }
      } else {
        tStart = rollingMin;
        tEnd = rollingMin + dur;
        rollingMin = tEnd;
      }
      seqTimeSpans.push({
        start: formatMinutesToTime(tStart % 1440),
        end: formatMinutesToTime(tEnd % 1440)
      });
    }
  }

  // Detect schedule overlaps for calendar modal (chronological mode with timespans only; sequential/simple cannot overlap)
  const isSimpleCal = Boolean(typeof taskStore !== 'undefined' && typeof taskStore.getAppMode === 'function' && taskStore.getAppMode() === 'simple');
  const calConflictingIds = new Set();
  const calIndentedIndices = new Set();

  if (isTimespans && !isSimpleCal) {
    for (let i = 0; i < tasks.length; i++) {
      const tA = tasks[i];
      if (!tA.startTime || !tA.endTime) continue;
      const aStart = parseTimeToMinutes(tA.startTime);
      let aEnd = parseTimeToMinutes(tA.endTime);
      if (aEnd <= aStart) aEnd += 1440;

      for (let j = i + 1; j < tasks.length; j++) {
        const tB = tasks[j];
        if (!tB.startTime || !tB.endTime) continue;
        const bStart = parseTimeToMinutes(tB.startTime);
        let bEnd = parseTimeToMinutes(tB.endTime);
        if (bEnd <= bStart) bEnd += 1440;

        if (aStart < bEnd && bStart < aEnd) {
          calConflictingIds.add(tA.id);
          calConflictingIds.add(tB.id);

          const laterIdx = j;
          if (!calIndentedIndices.has(laterIdx - 1) && !calIndentedIndices.has(i)) {
            calIndentedIndices.add(laterIdx);
          }
        }
      }
    }
  }

  tasks.forEach((task, idx) => {
    const isImmovable = Boolean(task.isLocked);
    const isCurrentActive = (isRunning || isPaused) && (idx === activeIdx);
    // Task padlock stays strictly in user-selected state (never forced active merely because timer is running)
    const isLocked = Boolean(task.isLocked);
    const isOverrunningTask = Boolean((runtime && runtime.isOverrunning) && (runtime && runtime.getActiveTask() && runtime.getActiveTask().id) === task.id);
    const isBreak = Boolean(
      (task.category && (task.category.toLowerCase() === 'break' || task.category.toLowerCase() === 'rest')) ||
      (task.title && (task.title.toLowerCase().indexOf('break') !== -1 || task.title.toLowerCase().indexOf('rest') !== -1))
    );
    const catColor = getCategoryColor(task.category);

    let statusClass = 'pending';
    if (isCurrentActive) {
      statusClass = 'current';
    } else if (Boolean(task.isCompleted)) {
      statusClass = 'completed';
    }

    const lockTitle = isLocked
      ? `🔒 Locked (${task.startTime || task.fixedStartTime || 'Fixed timing'})`
      : '🔓 Unlocked (Flexible)';

    const isCalOverlap = calIndentedIndices.has(idx);
    const wrapper = document.createElement('div');
    wrapper.className = `calendar-item-wrapper ${isCalOverlap ? 'is-schedule-overlap' : ''}`;
    wrapper.setAttribute('data-id', task.id);
    wrapper.setAttribute('data-index', idx);

    const deleteAction = document.createElement('div');
    deleteAction.className = 'calendar-swipe-delete-action';
    deleteAction.innerHTML = `<button type="button" class="btn-swipe-delete" data-action="swipe-delete-task" data-id="${task.id}" title="Delete task">✕</button>`;

    const doneAction = document.createElement('div');
    doneAction.className = 'calendar-swipe-done-action';
    doneAction.innerHTML = `<span>✓</span>`;

    const item = document.createElement('div');
    item.className = `calendar-block ${statusClass} ${isBreak ? 'is-break-task' : ''} ${isLocked ? 'is-locked-task' : ''}`;
    item.setAttribute('data-id', task.id);
    item.setAttribute('data-index', idx);

    const subtasks = (typeof taskStore !== 'undefined' && typeof taskStore.getSubtasks === 'function')
      ? taskStore.getSubtasks(task.id)
      : (Array.isArray(task.subtasks) ? task.subtasks : []);
    const progress = (typeof taskStore !== 'undefined' && typeof taskStore.getTaskProgress === 'function')
      ? taskStore.getTaskProgress(task)
      : { completed: 0, total: 0, percent: 0 };
    const hasSubtasks = subtasks.length > 0;
    const isMulti = Boolean(task.isMultiSession);
    const isCalExpanded = expandedCalendarDrawerIds.has(task.id);

    const catHex = task.color || getCategoryHexColor(task.category);
    if (statusClass === 'pending') {
      const tint = hexToRgba(catHex, 0.12);
      const isLight = (document.documentElement && document.documentElement.getAttribute('data-theme') === 'light') || (document.body && document.body.getAttribute('data-theme') === 'light');
      const baseBg = isLight ? '#ffffff' : '#141822';
      if (progress.percent > 0) {
        item.style.background = `linear-gradient(to right, rgba(16, 185, 129, 0.22) ${progress.percent}%, ${baseBg} ${progress.percent}%)`;
      } else {
        item.style.background = `linear-gradient(${tint}, ${tint}), ${baseBg}`;
      }
      item.style.borderColor = hexToRgba(catHex, 0.35);
      item.style.borderLeft = `4px solid ${catHex}`;
    } else if (statusClass === 'current') {
      if (progress.percent > 0) {
        item.style.background = `linear-gradient(to right, rgba(16, 185, 129, 0.28) ${progress.percent}%, #142329 ${progress.percent}%)`;
      } else {
        item.style.background = '#142329';
      }
      item.style.borderColor = '#00f0ff';
      item.style.borderLeft = '4px solid #00f0ff';
      item.style.boxShadow = '0 0 14px rgba(0, 240, 255, 0.25)';
    }

    const pillStyle = `background:${hexToRgba(catHex, 0.2)};border:1px solid ${hexToRgba(catHex, 0.45)};color:${catHex};`;

    let sessionBadgeHtml = '';
    if (isMulti) {
      const sIdx = typeof task.sessionIndex === 'number' ? task.sessionIndex : 1;
      const sTot = task.sessionCount || 1;
      sessionBadgeHtml = `<span class="session-badge cal-session-badge" style="margin-left: 6px;">Session ${sIdx} of ${sTot} 🔗</span>`;
    }

    let subtaskTogglePillHtml = '';
    if (hasSubtasks) {
      subtaskTogglePillHtml = `
        <button type="button" class="btn-subtask-toggle cal-subtask-toggle ${isCalExpanded ? 'expanded' : ''}" data-action="toggle-cal-subtask-drawer" data-id="${task.id}" title="Toggle steps">
          <span>✓ ${progress.completed}/${progress.total}</span>
          <span class="arrow">${isCalExpanded ? '▴' : '▾'}</span>
        </button>
      `;
    }

    let drawerHtml = '';
    if (hasSubtasks || isCalExpanded) {
      const rowsHtml = subtasks.map(st => {
        const isDone = Boolean(st.completed);
        return `
          <div class="subtask-row ${isDone ? 'is-completed' : ''}" data-subtask-id="${st.id}">
            <div class="subtask-drag-handle" title="Drag to reorder">
              <svg width="8" height="12" viewBox="0 0 8 12" fill="currentColor">
                <circle cx="2" cy="2" r="1.1"/>
                <circle cx="6" cy="2" r="1.1"/>
                <circle cx="2" cy="6" r="1.1"/>
                <circle cx="6" cy="6" r="1.1"/>
                <circle cx="2" cy="10" r="1.1"/>
                <circle cx="6" cy="10" r="1.1"/>
              </svg>
            </div>
            <label class="subtask-checkbox-label">
              <input type="checkbox" class="subtask-checkbox" data-action="toggle-cal-subtask" data-task-id="${task.id}" data-subtask-id="${st.id}" ${isDone ? 'checked' : ''}>
              <span class="subtask-custom-checkbox"></span>
            </label>
            <span class="subtask-title">${escapeHtml(st.title || '')}</span>
            <button type="button" class="btn-subtask-delete" data-action="delete-cal-subtask" data-task-id="${task.id}" data-subtask-id="${st.id}" title="Remove step">✕</button>
          </div>
        `;
      }).join('');

      drawerHtml = `
        <div class="calendar-subtask-drawer ${isCalExpanded ? 'open' : ''}" data-task-id="${task.id}">
          <div class="subtask-items-container">
            ${rowsHtml}
          </div>
          <div class="subtask-add-row">
            <input type="text" class="subtask-add-input" placeholder="+ Add a step..." data-task-id="${task.id}" autocomplete="off">
            <button type="button" class="btn-subtask-add-confirm" data-action="confirm-add-cal-subtask" data-task-id="${task.id}">Add</button>
          </div>
        </div>
      `;
    }

    const calOverlapHtml = isCalOverlap ? `
      <div class="task-overlap-tag-group" data-action="swap-overlap-priority" data-id="${task.id}" data-dir="${isCalOverlap ? 'up' : 'down'}" style="margin-left: 6px; cursor: pointer;" title="Tap to switch overlap priority">
        <span class="task-overlap-badge" data-action="swap-overlap-priority" data-id="${task.id}" data-dir="${isCalOverlap ? 'up' : 'down'}">⚠️ Overlap</span>
        <div class="overlap-priority-arrows">
          <button type="button" class="btn-overlap-arrow" data-action="swap-overlap-priority" data-id="${task.id}" data-dir="up" title="Promote task (give timer priority)">▲</button>
          <button type="button" class="btn-overlap-arrow" data-action="swap-overlap-priority" data-id="${task.id}" data-dir="down" title="Demote task (indent)">▼</button>
        </div>
      </div>
    ` : '';

    item.innerHTML = `
      <div class="calendar-block-left">
        ${!isLocked ? `
          <div class="drag-handle-compact" data-action="drag-handle" title="Hold & drag to reorder">
            <svg width="10" height="15" viewBox="0 0 10 15" fill="currentColor">
              <circle cx="2.5" cy="2.5" r="1.3"/>
              <circle cx="7.5" cy="2.5" r="1.3"/>
              <circle cx="2.5" cy="7.5" r="1.3"/>
              <circle cx="7.5" cy="7.5" r="1.3"/>
              <circle cx="2.5" cy="12.5" r="1.3"/>
              <circle cx="7.5" cy="12.5" r="1.3"/>
            </svg>
          </div>
        ` : `
          <div class="drag-handle-locked-compact" data-action="locked-drag-attempt" title="Task locked">
            <span>🔒</span>
          </div>
        `}
        <button class="calendar-emoji-btn" data-action="pick-calendar-emoji" data-id="${task.id}" title="Tap to change emoji">
          ${task.emoji || '📌'}
        </button>
      </div>

      <div class="calendar-block-main" data-action="edit-calendar-task" data-id="${task.id}" title="Tap to edit task options">
        <div class="calendar-main-line1">
          <span class="calendar-block-title">${escapeHtml(task.title)}</span>
          ${sessionBadgeHtml}
          <span class="calendar-duration-badge">${task.allocatedDuration || task.plannedDuration}m</span>
          ${subtaskTogglePillHtml}
          ${calOverlapHtml}
        </div>
        <div class="calendar-main-line2">
          <span class="calendar-time-range">${isTimespans ? `${(isLocked ? (task.fixedStartTime || task.startTime) : task.startTime) || '--:--'} → ${(isLocked ? (task.fixedEndTime || task.endTime) : task.endTime) || '--:--'}` : `${seqTimeSpans[idx] ? `${seqTimeSpans[idx].start} → ${seqTimeSpans[idx].end}` : ''}`}</span>
          <span class="calendar-category-pill" style="${pillStyle}">${escapeHtml(task.category || 'General')}</span>
        </div>
      </div>

      <div class="calendar-block-actions">
        <button class="btn-icon-action time-bank-btn ${task.useTimeBank !== false ? 'active' : ''} ${isOverrunningTask ? 'cracked' : ''}" data-action="toggle-calendar-time-bank" data-id="${task.id}" title="${task.useTimeBank !== false ? 'Time Bank enabled: taps into saved surplus time if overdue' : 'Time Bank disabled'}">
          ${getPiggyBankSvg(isOverrunningTask)}
        </button>
        <button class="btn-icon-action ${isLocked ? 'locked' : ''}" data-action="toggle-calendar-lock" data-id="${task.id}" title="${lockTitle}">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
            ${isLocked
              ? '<path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z"/>'
              : '<path d="M12 17c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm6-9h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6h1.9c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2H6c-1.1 0-2 .9-2 2v10c0 1.1 2 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm0 12H6V10h12v10z"/>'
            }
          </svg>
        </button>
      </div>
      ${drawerHtml}
    `;

    // Partitioned Gestures:
    const leftZone = item.querySelector('.calendar-block-left');
    if (leftZone) {
      leftZone.addEventListener('pointerdown', () => {
        calendarTimelineList.querySelectorAll('.has-swiped-open, .swiped-open').forEach(el => {
          el.classList.remove('has-swiped-open', 'swiped-open');
          if (el.style.transform) el.style.removeProperty('transform');
        });
      });
    }

    // Time bank toggle inside calendar
    const calTimeBankBtn = item.querySelector('[data-action="toggle-calendar-time-bank"]');
    if (calTimeBankBtn) {
      calTimeBankBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        taskStore.toggleTaskTimeBank(task.id);
        runtime.initialTasks = taskStore.getTasks();
        runtime.recalculate();
        syncDynamicScheduleTimesToCalendar();
        updateActiveTaskDisplay();
        renderTaskList(((runtime.currentSchedule && runtime.currentSchedule.tasks) || []) || []);
        renderCalendarModal();
        mobileServices.hapticTap();
      });
    }

    // Lock toggle inside calendar
    const calLockBtn = item.querySelector('[data-action="toggle-calendar-lock"]');
    if (calLockBtn) {
      calLockBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const currentLocked = Boolean(task.isLocked);
        const nextLocked = !currentLocked;
        const fixedStartTime = nextLocked ? (task.fixedStartTime || task.startTime || null) : null;
        const fixedEndTime = nextLocked ? (task.fixedEndTime || task.endTime || null) : null;

        taskStore.updateTask(task.id, {
          isLocked: nextLocked,
          fixedStartTime: fixedStartTime,
          fixedEndTime: fixedEndTime
        });
        const initTask = (runtime && runtime.initialTasks) ? runtime.initialTasks.find(t => t.id === task.id) : null;
        if (initTask) {
          initTask.isLocked = nextLocked;
          initTask.fixedStartTime = fixedStartTime;
          initTask.fixedEndTime = fixedEndTime;
        }

        const activeTask = runtime ? runtime.getActiveTask() : null;
        if (activeTask && activeTask.id === task.id) {
          activeTask.isLocked = nextLocked;
          activeTask.fixedStartTime = fixedStartTime;
          activeTask.fixedEndTime = fixedEndTime;
        }

        if (runtime && runtime.currentSchedule && runtime.currentSchedule.tasks) {
          const schedTask = runtime.currentSchedule.tasks.find(t => t.id === task.id);
          if (schedTask) {
            schedTask.isLocked = nextLocked;
            schedTask.fixedStartTime = fixedStartTime;
            schedTask.fixedEndTime = fixedEndTime;
          }
        }

        runtime.recalculate();
        syncDynamicScheduleTimesToCalendar();
        updateTimerQuickToggles();
        updateActiveTaskDisplay();
        renderTaskList(((runtime.currentSchedule && runtime.currentSchedule.tasks) || []) || []);
        renderCalendarModal();
        mobileServices.hapticTap();
        showToastNotification(nextLocked ? 'Task duration locked' : 'Task duration unlocked');
      });
    }

    // Emoji click inside calendar
    const calEmojiBtn = item.querySelector('[data-action="pick-calendar-emoji"]');
    if (calEmojiBtn) {
      calEmojiBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        openEmojiPicker(task.id);
      });
    }

    // Click on locked drag handle (press-hold only)
    const lockedDrag = item.querySelector('[data-action="locked-drag-attempt"]');
    if (lockedDrag) {
      attachLockedDragHoldWarning(lockedDrag);
    }

    // Swipe & Gesture Zone: The full task block (except drag handle, left gutter, and emoji button)
    let touchStartX = 0;
    let touchStartY = 0;
    let hasMoved = false;
    let isSwiping = false;
    let swipeDirection = null; // 'left' (delete) or 'right' (toggle done)
    let holdTimer = null;
    let startIsOpen = false;
    let currentShiftPct = 0;

    const clearHold = () => {
      if (holdTimer) {
        clearTimeout(holdTimer);
        holdTimer = null;
      }
    };

    const handleTaskTouchStart = (e) => {
      if (isCalendarModalPullingDown) {
        return;
      }
      // Ignore interactions originating directly from the drag handle, left gutter area, emoji button, or subtasks drawer
      if (e.target.closest('[data-action="drag-handle"], [data-action="locked-drag-attempt"], .calendar-block-left, [data-action="pick-calendar-emoji"], .calendar-subtask-drawer, .cal-subtask-toggle, .btn-subtask-toggle, .subtask-row, .subtask-add-row, .subtask-add-input, .btn-subtask-add-confirm')) {
        return;
      }
      const rect = item.getBoundingClientRect();
      const clientX = (e.touches && e.touches[0]) ? e.touches[0].clientX : e.clientX;
      if (clientX - rect.left <= 44) {
        return; // Left zone before/at 3x2 dots: reserved for press-hold reordering, NOT delete!
      }

      hasMoved = false;
      isSwiping = false;
      swipeDirection = null;
      startIsOpen = item.classList.contains('swiped-open') || wrapper.classList.contains('has-swiped-open');
      currentShiftPct = startIsOpen ? -25 : 0;
      touchStartX = (e.touches && e.touches[0]) ? e.touches[0].clientX : e.clientX;
      touchStartY = (e.touches && e.touches[0]) ? e.touches[0].clientY : e.clientY;
      clearHold();

      // Holding task (including in piggy bank or padlock area) reveals the red X!
      holdTimer = setTimeout(() => {
        if (!hasMoved && !isSwiping && !isCalendarModalPullingDown) {
          wrapper.classList.add('has-swiped-open');
          item.classList.add('swiped-open');
          item.style.removeProperty('transform');
          mobileServices.hapticTap();
        }
      }, 350);
    };

    const handleTaskTouchMove = (e) => {
      if (isCalendarModalPullingDown) {
        clearHold();
        return;
      }
      if (e.target.closest('[data-action="drag-handle"], [data-action="locked-drag-attempt"], .calendar-block-left, [data-action="pick-calendar-emoji"], .calendar-subtask-drawer, .cal-subtask-toggle, .btn-subtask-toggle, .subtask-row, .subtask-add-row, .subtask-add-input, .btn-subtask-add-confirm')) {
        return;
      }
      const rect = item.getBoundingClientRect();
      const clientX = (e.touches && e.touches[0]) ? e.touches[0].clientX : e.clientX;
      if (clientX - rect.left <= 44) {
        return;
      }

      const clientY = (e.touches && e.touches[0]) ? e.touches[0].clientY : e.clientY;
      const diffX = clientX - touchStartX;
      const diffY = clientY - touchStartY;

      if (Math.hypot(diffX, diffY) > 8) {
        hasMoved = true;
        clearHold();
      }

      // Check if predominantly horizontal swipe
      if (Math.abs(diffX) > 8 && Math.abs(diffX) * 1.3 >= Math.abs(diffY)) {
        isSwiping = true;
        const itemW = item.offsetWidth || 300;
        const deltaPct = (diffX / itemW) * 100;

        if (diffX > 0 && !startIsOpen) {
          // Swipe Right: toggle done status (green tick mark)
          swipeDirection = 'right';
          isSwipingCardToDelete = false;
          wrapper.classList.remove('is-swiping');
          wrapper.classList.add('is-swiping-done');
          currentShiftPct = Math.max(0, Math.min(30, deltaPct));
          item.style.transition = 'none';
          item.style.transform = `translateX(${currentShiftPct}%)`;
        } else {
          // Swipe Left: delete action (red X)
          swipeDirection = 'left';
          isSwipingCardToDelete = true;
          wrapper.classList.remove('is-swiping-done');
          wrapper.classList.add('is-swiping');
          const basePct = startIsOpen ? -25 : 0;
          currentShiftPct = Math.min(0, Math.max(-25, basePct + deltaPct));

          item.style.transition = 'none';
          item.style.transform = `translateX(${currentShiftPct}%)`;

          if (currentShiftPct < -5) {
            wrapper.classList.add('has-swiped-open');
          } else {
            wrapper.classList.remove('has-swiped-open');
          }
        }
      }
    };

    const handleTaskTouchEnd = (e) => {
      clearHold();
      isSwipingCardToDelete = false;
      if (isSwiping) {
        wrapper.classList.remove('is-swiping');
        wrapper.classList.remove('is-swiping-done');
        item.style.transition = 'transform 0.2s ease';
        item.style.removeProperty('transform');

        if (swipeDirection === 'right') {
          // One-handed swipe right threshold reached: instantly toggle task done status!
          if (currentShiftPct >= 12 || Math.abs(currentShiftPct) >= 12) {
            if ((hasSubtasks || isMulti) && progress.completed < progress.total) {
              mobileServices.hapticWarning();
              showToastNotification('Complete all steps/sessions first to mark this task done');
            } else {
              mobileServices.hapticTap();
              toggleTaskDoneStatus(task.id);
            }
          }
        } else {
          // If shifted at least halfway to -25% (<= -12%), snap open; otherwise snap closed
          if (currentShiftPct <= -12) {
            wrapper.classList.add('has-swiped-open');
            item.classList.add('swiped-open');
            mobileServices.hapticTap();
          } else {
            wrapper.classList.remove('has-swiped-open');
            item.classList.remove('swiped-open');
          }
        }
        isSwiping = false;
        swipeDirection = null;
      }
    };

    item.addEventListener('touchstart', handleTaskTouchStart, { passive: true });
    item.addEventListener('touchmove', handleTaskTouchMove, { passive: true });
    item.addEventListener('touchend', handleTaskTouchEnd, { passive: true });
    item.addEventListener('touchcancel', () => {
      clearHold();
      isSwipingCardToDelete = false;
      item.style.transition = '';
      item.style.transform = '';
    });

    item.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      if (isCalendarModalPullingDown) return;
      handleTaskTouchStart(e);

      const onMouseMove = (moveEv) => handleTaskTouchMove(moveEv);
      const onMouseUp = (upEv) => {
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onMouseUp);
        handleTaskTouchEnd(upEv);
      };

      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', onMouseUp);
    });

    // Tap on card: if swiped open, close it; else if tapped main zone, open edit modal
    item.addEventListener('click', (e) => {
      if (wrapper.classList.contains('has-swiped-open') || item.classList.contains('swiped-open')) {
        wrapper.classList.remove('has-swiped-open');
        item.classList.remove('swiped-open');
        item.style.transform = '';
        e.stopPropagation();
        return;
      }
      if (hasMoved || isSwiping) return;
      if (e.target.closest('[data-action="toggle-calendar-time-bank"]') ||
          e.target.closest('[data-action="toggle-calendar-lock"]') ||
          e.target.closest('[data-action="pick-calendar-emoji"]') ||
          e.target.closest('[data-action="drag-handle"]') ||
          e.target.closest('[data-action="locked-drag-attempt"]') ||
          e.target.closest('[data-action="swap-overlap-priority"]') ||
          e.target.closest('[data-action="toggle-cal-subtask-drawer"]') ||
          e.target.closest('.calendar-subtask-drawer')) {
        return;
      }
      openTaskEditModal(task.id);
    });

    // Subtask toggle button
    const calSubToggleBtn = item.querySelector('[data-action="toggle-cal-subtask-drawer"]');
    if (calSubToggleBtn) {
      calSubToggleBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        if (expandedCalendarDrawerIds.has(task.id)) {
          expandedCalendarDrawerIds.delete(task.id);
        } else {
          expandedCalendarDrawerIds.add(task.id);
        }
        mobileServices.hapticTap();
        renderCalendarModal();
      });
    }

    // Subtask Drawer actions
    const calDrawerEl = item.querySelector('.calendar-subtask-drawer');
    if (calDrawerEl) {
      calDrawerEl.addEventListener('click', (e) => e.stopPropagation());
      calDrawerEl.addEventListener('touchstart', (e) => e.stopPropagation(), { passive: true });
      calDrawerEl.addEventListener('mousedown', (e) => e.stopPropagation());

      calDrawerEl.querySelectorAll('[data-action="toggle-cal-subtask"]').forEach(chk => {
        chk.addEventListener('change', (e) => {
          e.stopPropagation();
          const subId = chk.getAttribute('data-subtask-id');
          taskStore.updateSubtask(task.id, subId, { completed: chk.checked });
          mobileServices.hapticTap();
          renderCalendarModal();
          renderTaskList(((runtime.currentSchedule && runtime.currentSchedule.tasks) || []) || []);
        });
      });

      calDrawerEl.querySelectorAll('[data-action="delete-cal-subtask"]').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const subId = btn.getAttribute('data-subtask-id');
          taskStore.deleteSubtask(task.id, subId);
          mobileServices.hapticTap();
          renderCalendarModal();
          renderTaskList(((runtime.currentSchedule && runtime.currentSchedule.tasks) || []) || []);
        });
      });

      const calAddInput = calDrawerEl.querySelector('.subtask-add-input');
      const calAddBtn = calDrawerEl.querySelector('[data-action="confirm-add-cal-subtask"]');
      const handleCalSubtaskAdd = () => {
        if (!calAddInput) return;
        const text = calAddInput.value.trim();
        if (!text) return;
        taskStore.addSubtask(task.id, { title: text, completed: false });
        calAddInput.value = '';
        mobileServices.hapticTap();
        renderCalendarModal();
        renderTaskList(((runtime.currentSchedule && runtime.currentSchedule.tasks) || []) || []);
      };

      if (calAddBtn) {
        calAddBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          handleCalSubtaskAdd();
        });
      }
      if (calAddInput) {
        calAddInput.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            e.stopPropagation();
            e.preventDefault();
            handleCalSubtaskAdd();
          }
        });
      }

      setupInteractiveSubtaskDrag(calDrawerEl, task.id, () => {
        renderCalendarModal();
        renderTaskList(((runtime.currentSchedule && runtime.currentSchedule.tasks) || []) || []);
      });
    }

    // Overlap priority swap buttons (▲ and ▼) inside calendar item
    const _calSwapPriorityBtns = item.querySelectorAll('[data-action="swap-overlap-priority"]');
    _calSwapPriorityBtns.forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        const dir = btn.getAttribute('data-dir');
        handleSwapOverlapPriority(task.id, dir);
      });
    });

    // Also allow swiping right on deleteAction to slide X closed
    deleteAction.addEventListener('touchstart', (e) => {
      touchStartX = e.touches[0].clientX;
    }, { passive: true });
    deleteAction.addEventListener('touchmove', (e) => {
      const diffX = e.touches[0].clientX - touchStartX;
      if (diffX > 15) {
        wrapper.classList.remove('has-swiped-open');
        item.classList.remove('swiped-open');
        item.style.transform = '';
      }
    }, { passive: true });

    // Swipe delete button click
    const _swpBtn = deleteAction.querySelector(".btn-swipe-delete"); if (_swpBtn) _swpBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      executeDeleteTask(task.id, task.title);
    });

    wrapper.appendChild(deleteAction);
    wrapper.appendChild(doneAction);
    wrapper.appendChild(item);
    calendarTimelineList.appendChild(wrapper);
  });

  if (finishLine) {
    finishLine.style.display = 'flex';
    const calInput = document.getElementById('calendarHardStopInput');
    if (calInput) {
      calInput.value = (typeof taskStore !== 'undefined' && typeof taskStore.getHardStop === 'function')
        ? (taskStore.getHardStop() || '18:00')
        : '18:00';
    }
  }
}

// Global window aliases
window.renderCalendarModal = renderCalendarModal;
window.renderCalendarModel = renderCalendarModal;
window.openCalendar = openCalendar;
window.closeCalendar = closeCalendar;
window.openTodo = openTodo;
window.closeTodo = closeTodo;

// ==========================================
// To-Do List View & Task Management
// ==========================================
let pendingDeleteTodoId = null;
let pendingDeleteTodoTitle = '';
const expandedTodoDrawerIds = new Set();
const expandedTaskDrawerIds = new Set();
const expandedCalendarDrawerIds = new Set();

function setupInteractiveSubtaskDrag(drawerEl, taskId, onReorderCallback) {
  if (!drawerEl || drawerEl._hasSubtaskDrag) return;
  drawerEl._hasSubtaskDrag = true;

  drawerEl.addEventListener('pointerdown', (e) => {
    const handle = e.target.closest('.subtask-drag-handle');
    if (!handle) return;
    const row = handle.closest('.subtask-row');
    if (!row) return;

    const list = drawerEl.querySelector('.subtask-list');
    if (!list) return;

    const allRows = Array.from(list.children).filter(r => r.matches('.subtask-row'));
    const fromIndex = allRows.indexOf(row);
    if (fromIndex === -1) return;

    const pointerId = e.pointerId;
    let isDragging = false;
    let currentSlot = fromIndex;
    const startY = e.clientY;

    try {
      handle.setPointerCapture(pointerId);
    } catch (_) {}

    const onPointerMove = (moveEv) => {
      if (moveEv.pointerId !== pointerId) return;
      if (!isDragging) {
        if (Math.abs(moveEv.clientY - startY) > 5) {
          isDragging = true;
          row.classList.add('is-subtask-dragging');
          handle.classList.add('is-holding');
          if (typeof mobileServices !== 'undefined' && mobileServices.hapticBuzz) {
            mobileServices.hapticBuzz();
          }
        } else {
          return;
        }
      }
      if (moveEv.cancelable) moveEv.preventDefault();

      const midPositions = allRows.map((r, idx) => {
        const rect = r.getBoundingClientRect();
        return { index: idx, midY: rect.top + rect.height / 2 };
      });

      let targetSlot = fromIndex;
      for (let i = 0; i < midPositions.length; i++) {
        if (moveEv.clientY > midPositions[i].midY) {
          targetSlot = i;
        }
      }
      targetSlot = Math.max(0, Math.min(allRows.length - 1, targetSlot));
      if (targetSlot !== currentSlot) {
        currentSlot = targetSlot;
        if (typeof mobileServices !== 'undefined' && mobileServices.hapticTick) {
          mobileServices.hapticTick();
        }
      }
    };

    const onPointerUp = (upEv) => {
      if (upEv.pointerId !== pointerId) return;
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);

      try {
        handle.releasePointerCapture(pointerId);
      } catch (_) {}

      row.classList.remove('is-subtask-dragging');
      handle.classList.remove('is-holding');

      if (isDragging && fromIndex !== currentSlot) {
        taskStore.reorderSubtasks(taskId, fromIndex, currentSlot);
        if (typeof mobileServices !== 'undefined' && mobileServices.hapticBuzz) {
          mobileServices.hapticBuzz();
        }
        if (typeof onReorderCallback === 'function') {
          onReorderCallback();
        } else {
          renderTodoList();
        }
      }
    };

    window.addEventListener('pointermove', onPointerMove, { passive: false });
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
  });
}

function openConfirmDeleteTodo(id, title) {
  pendingDeleteTodoId = id;
  pendingDeleteTodoTitle = title || 'Task';
  const desc = document.getElementById('confirmDeleteTodoDesc');
  if (desc) desc.textContent = `Are you sure you want to delete "${pendingDeleteTodoTitle}"?`;
  const modal = document.getElementById('confirmDeleteTodoModalBackdrop');
  if (modal) modal.classList.remove('hidden');
  mobileServices.hapticTap();
}

function closeConfirmDeleteTodo() {
  const modal = document.getElementById('confirmDeleteTodoModalBackdrop');
  if (modal) modal.classList.add('hidden');
  pendingDeleteTodoId = null;
  pendingDeleteTodoTitle = '';
}

function renderTodoList() {
  const container = document.getElementById('todoListContainer');
  const emptyState = document.getElementById('todoEmptyState');
  const countBadge = document.getElementById('todoCountBadge');
  if (!container) return;

  const todos = taskStore.getTodoTasks();
  container.innerHTML = '';

  if (countBadge) {
    countBadge.textContent = todos.length === 1 ? '1 task' : `${todos.length} tasks`;
  }

  if (todos.length === 0) {
    if (emptyState) emptyState.classList.remove('hidden');
    return;
  } else {
    if (emptyState) emptyState.classList.add('hidden');
  }

  todos.forEach((todo, idx) => {
    const wrapper = document.createElement('div');
    wrapper.className = 'todo-item-wrapper';
    wrapper.setAttribute('data-id', todo.id);
    wrapper.setAttribute('data-index', idx);

    const deleteAction = document.createElement('div');
    deleteAction.className = 'calendar-swipe-delete-action';
    deleteAction.innerHTML = `<button type="button" class="btn-swipe-delete" data-action="swipe-delete-todo" data-id="${todo.id}" title="Delete task">✕</button>`;

    const progress = (typeof taskStore !== 'undefined' && typeof taskStore.getTaskProgress === 'function')
      ? taskStore.getTaskProgress(todo)
      : { completed: 0, total: 0, percent: 0 };
    const subtasks = Array.isArray(todo.subtasks) ? todo.subtasks.slice().sort((a, b) => (a.order || 0) - (b.order || 0)) : [];
    const hasSubtasks = subtasks.length > 0;
    const isMulti = Boolean(todo.isMultiSession && todo.sessionCount && todo.sessionCount > 1);
    const hasProgress = progress.total > 0;
    const isExpanded = expandedTodoDrawerIds.has(todo.id);
    const isAllDone = (hasProgress && progress.completed === progress.total) || Boolean(todo.completed);

    const item = document.createElement('div');
    item.className = `todo-block ${isAllDone ? 'completed' : ''}`;
    item.setAttribute('data-id', todo.id);
    item.setAttribute('data-index', idx);

    // Apply proportional emerald background wash
    if (hasProgress && progress.percent > 0) {
      const isLight = (document.documentElement && document.documentElement.getAttribute('data-theme') === 'light') || (document.body && document.body.getAttribute('data-theme') === 'light');
      const baseBg = isLight ? '#ffffff' : '#1e222d';
      const pct = progress.percent;
      item.style.background = 'linear-gradient(to right, rgba(16, 185, 129, 0.22) ' + pct + '%, ' + baseBg + ' ' + pct + '%)';
      item.style.borderColor = 'rgba(16, 185, 129, 0.4)';
    }

    // Right-hand completion action
    let checkOrEarnedHtml = '';
    if (hasSubtasks || isMulti) {
      if (progress.completed === progress.total && progress.total > 0) {
        checkOrEarnedHtml = '<span class="todo-earned-check" title="All steps completed!">✓</span>';
      } else {
        checkOrEarnedHtml = '';
      }
    } else {
      checkOrEarnedHtml = `
        <button type="button" class="todo-checkbox-btn ${todo.completed ? 'checked' : ''}" data-action="toggle-todo" data-id="${todo.id}" title="${todo.completed ? 'Mark uncompleted' : 'Mark done'}">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="20 6 9 17 4 12"></polyline>
          </svg>
        </button>
      `;
    }

    // Pill badge for subtasks
    let pillBadgeHtml = '';
    if (hasSubtasks || isMulti) {
      const badgeDoneClass = (progress.completed === progress.total && progress.total > 0) ? 'all-done' : '';
      const arrowOpenClass = isExpanded ? 'open' : '';
      pillBadgeHtml = `
        <button type="button" class="todo-subtask-toggle-btn" data-action="toggle-subtask-drawer" data-id="${todo.id}" title="Toggle subtasks">
          <span class="todo-subtask-badge ${badgeDoneClass}">✓ ${progress.completed}/${progress.total} <span class="todo-subtask-arrow ${arrowOpenClass}">▾</span></span>
        </button>
      `;
    } else {
      pillBadgeHtml = `
        <button type="button" class="todo-subtask-add-pill-btn" data-action="toggle-subtask-drawer" data-id="${todo.id}" title="Add steps / subtasks">+ Steps</button>
      `;
    }

    // Subtask drawer content
    let drawerHtml = '';
    if (isExpanded) {
      let subtasksListHtml = '';
      subtasks.forEach((sub, sIdx) => {
        const isDone = Boolean(sub.completed);
        subtasksListHtml += `
          <div class="subtask-row" data-subtask-id="${sub.id}" data-index="${sIdx}">
            <div class="subtask-drag-handle" data-subtask-id="${sub.id}" title="Hold & drag to reorder">
              <svg width="8" height="12" viewBox="0 0 10 15" fill="currentColor">
                <circle cx="2.5" cy="2.5" r="1.3"/>
                <circle cx="7.5" cy="2.5" r="1.3"/>
                <circle cx="2.5" cy="7.5" r="1.3"/>
                <circle cx="7.5" cy="7.5" r="1.3"/>
                <circle cx="2.5" cy="12.5" r="1.3"/>
                <circle cx="7.5" cy="12.5" r="1.3"/>
              </svg>
            </div>
            <button type="button" class="subtask-check-btn ${isDone ? 'checked' : ''}" data-action="toggle-subtask" data-todo-id="${todo.id}" data-subtask-id="${sub.id}" title="${isDone ? 'Mark step uncompleted' : 'Mark step done'}">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="20 6 9 17 4 12"></polyline>
              </svg>
            </button>
            <span class="subtask-title ${isDone ? 'completed' : ''}">${escapeHtml(sub.title || '')}</span>
            <button type="button" class="subtask-delete-btn" data-action="delete-subtask" data-todo-id="${todo.id}" data-subtask-id="${sub.id}" title="Delete step">✕</button>
          </div>
        `;
      });

      drawerHtml = `
        <div class="todo-subtask-drawer" data-todo-id="${todo.id}">
          <div class="subtask-list">
            ${subtasksListHtml}
          </div>
          <div class="subtask-add-row">
            <input type="text" class="subtask-add-input" data-todo-id="${todo.id}" placeholder="+ Add a step (press Enter)" autocomplete="off">
            <button type="button" class="btn-subtask-add-confirm" data-action="confirm-add-subtask" data-todo-id="${todo.id}">Add</button>
          </div>
        </div>
      `;
    }

    item.innerHTML = `
      <div class="todo-block-header">
        <div class="todo-block-left">
          <div class="drag-handle-compact" data-action="drag-handle" title="Hold & drag to reorder">
            <svg width="10" height="15" viewBox="0 0 10 15" fill="currentColor">
              <circle cx="2.5" cy="2.5" r="1.3"/>
              <circle cx="7.5" cy="2.5" r="1.3"/>
              <circle cx="2.5" cy="7.5" r="1.3"/>
              <circle cx="7.5" cy="7.5" r="1.3"/>
              <circle cx="2.5" cy="12.5" r="1.3"/>
              <circle cx="7.5" cy="12.5" r="1.3"/>
            </svg>
          </div>
          <button type="button" class="calendar-emoji-btn todo-emoji-btn" data-action="pick-todo-emoji" data-id="${todo.id}" title="Tap to change emoji">
            ${todo.emoji || '📌'}
          </button>
          <span class="todo-title">${escapeHtml(todo.title)}</span>
          ${pillBadgeHtml}
        </div>
        <div class="todo-block-right" style="display: flex; align-items: center; gap: 4px;">
          <button type="button" class="btn-todo-advanced" data-action="edit-todo-advanced" data-id="${todo.id}" title="Advanced task options">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <line x1="4" y1="8" x2="20" y2="8"></line>
              <line x1="4" y1="16" x2="20" y2="16"></line>
              <circle cx="9" cy="8" r="3" fill="currentColor"></circle>
              <circle cx="15" cy="16" r="3" fill="currentColor"></circle>
            </svg>
          </button>
          ${checkOrEarnedHtml}
        </div>
      </div>
      ${drawerHtml}
    `;

    // Advanced options 2-sliders button click
    const advBtn = item.querySelector('[data-action="edit-todo-advanced"]');
    if (advBtn) {
      advBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        mobileServices.hapticTap();
        if (typeof calendarView !== 'undefined' && calendarView && typeof calendarView.openEventInspector === 'function') {
          calendarView.openEventInspector(todo, null, null, null, { isTodo: true });
        }
      });
    }

    // Checkbox toggle on whole task
    const checkBtn = item.querySelector('[data-action="toggle-todo"]');
    if (checkBtn) {
      checkBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        taskStore.updateTodoTask(todo.id, { completed: !todo.completed });
        mobileServices.hapticTap();
        renderTodoList();
      });
    }

    // Emoji change
    const emojiBtn = item.querySelector('[data-action="pick-todo-emoji"]');
    if (emojiBtn) {
      emojiBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        openEmojiPicker(todo.id);
      });
    }

    // Subtask toggle pill click
    const togglePillBtn = item.querySelector('[data-action="toggle-subtask-drawer"]');
    if (togglePillBtn) {
      togglePillBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (expandedTodoDrawerIds.has(todo.id)) {
          expandedTodoDrawerIds.delete(todo.id);
        } else {
          expandedTodoDrawerIds.add(todo.id);
        }
        mobileServices.hapticTap();
        renderTodoList();
        if (expandedTodoDrawerIds.has(todo.id)) {
          setTimeout(() => {
            const inp = container.querySelector(`.subtask-add-input[data-todo-id="${todo.id}"]`);
            if (inp) inp.focus();
          }, 60);
        }
      });
    }

    // Subtask check click
    item.querySelectorAll('[data-action="toggle-subtask"]').forEach(subCheckBtn => {
      subCheckBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const subId = subCheckBtn.getAttribute('data-subtask-id');
        const targetSub = subtasks.find(s => s.id === subId);
        if (targetSub) {
          taskStore.updateSubtask(todo.id, subId, { completed: !targetSub.completed });
          mobileServices.hapticTap();
          renderTodoList();
        }
      });
    });

    // Subtask delete click
    item.querySelectorAll('[data-action="delete-subtask"]').forEach(subDelBtn => {
      subDelBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const subId = subDelBtn.getAttribute('data-subtask-id');
        taskStore.deleteSubtask(todo.id, subId);
        mobileServices.hapticTap();
        renderTodoList();
      });
    });

    // Subtask add handling
    const addInput = item.querySelector('.subtask-add-input');
    const addBtn = item.querySelector('[data-action="confirm-add-subtask"]');
    const doAddSubtask = () => {
      if (!addInput) return;
      const text = (addInput.value || '').trim();
      if (!text) return;
      taskStore.addSubtask(todo.id, { title: text, completed: false });
      mobileServices.hapticTap();
      renderTodoList();
      setTimeout(() => {
        const nextInp = container.querySelector(`.subtask-add-input[data-todo-id="${todo.id}"]`);
        if (nextInp) nextInp.focus();
      }, 60);
    };

    if (addInput) {
      addInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          e.stopPropagation();
          doAddSubtask();
        }
      });
      addInput.addEventListener('click', (e) => e.stopPropagation());
    }

    if (addBtn) {
      addBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        doAddSubtask();
      });
    }

    // Setup interactive subtask drag reorder
    const drawerEl = item.querySelector('.todo-subtask-drawer');
    if (drawerEl) {
      setupInteractiveSubtaskDrag(drawerEl, todo.id);
    }

    // Partitioned gestures: Touching left zone closes any open swipe delete buttons
    const leftZone = item.querySelector('.todo-block-left');
    if (leftZone) {
      const resetSwiped = () => {
        container.querySelectorAll('.has-swiped-open, .swiped-open').forEach(el => {
          el.classList.remove('has-swiped-open', 'swiped-open');
          if (el.style.transform) el.style.removeProperty('transform');
        });
      };
      leftZone.addEventListener('pointerdown', resetSwiped);
      leftZone.addEventListener('touchstart', resetSwiped, { passive: true });
    }

    // Swipe & Hold gestures (identical to calendar delete mechanic)
    let touchStartX = 0;
    let touchStartY = 0;
    let isSwiping = false;
    let holdTimer = null;
    let startIsOpen = false;
    let currentShiftPct = 0;

    item.addEventListener('touchstart', (e) => {
      // Ignore interactions originating directly from the drag handle, left zone, emoji/checkbox buttons, advanced options, or subtask drawer
      if (e.target.closest('[data-action="drag-handle"], .drag-handle-compact, .todo-block-left, [data-action="pick-todo-emoji"], [data-action="toggle-todo"], .btn-todo-advanced, [data-action="edit-todo-advanced"], .todo-subtask-drawer, .todo-subtask-toggle-btn, .todo-subtask-add-pill-btn, .subtask-row, .subtask-add-row, .subtask-add-input')) {
        return;
      }
      const rect = item.getBoundingClientRect();
      const clientX = (e.touches && e.touches[0]) ? e.touches[0].clientX : e.clientX;
      if (clientX - rect.left <= 48) {
        return; // Left zone before/at 3x2 dots: reserved for press-hold reordering, NOT delete!
      }

      touchStartX = (e.touches && e.touches[0]) ? e.touches[0].clientX : e.clientX;
      touchStartY = (e.touches && e.touches[0]) ? e.touches[0].clientY : e.clientY;
      isSwiping = false;
      currentShiftPct = 0;
      startIsOpen = item.classList.contains('swiped-open') || wrapper.classList.contains('has-swiped-open');

      holdTimer = setTimeout(() => {
        if (!isSwiping) {
          wrapper.classList.add('has-swiped-open');
          item.classList.add('swiped-open');
          item.style.removeProperty('transform');
          mobileServices.hapticWarning();
        }
      }, 500);
    }, { passive: true });

    item.addEventListener('touchmove', (e) => {
      if (e.target.closest('[data-action="drag-handle"], .drag-handle-compact, .todo-block-left, [data-action="pick-todo-emoji"], [data-action="toggle-todo"], .btn-todo-advanced, [data-action="edit-todo-advanced"], .todo-subtask-drawer, .todo-subtask-toggle-btn, .todo-subtask-add-pill-btn, .subtask-row, .subtask-add-row, .subtask-add-input')) {
        if (holdTimer) {
          clearTimeout(holdTimer);
          holdTimer = null;
        }
        return;
      }
      const rect = item.getBoundingClientRect();
      const clientX = (e.touches && e.touches[0]) ? e.touches[0].clientX : e.clientX;
      if (clientX - rect.left <= 48) {
        if (holdTimer) {
          clearTimeout(holdTimer);
          holdTimer = null;
        }
        return;
      }
      const clientY = (e.touches && e.touches[0]) ? e.touches[0].clientY : e.clientY;
      const diffX = clientX - touchStartX;
      const diffY = clientY - touchStartY;

      if (Math.hypot(diffX, diffY) > 8) {
        if (holdTimer) {
          clearTimeout(holdTimer);
          holdTimer = null;
        }
      }

      if (Math.abs(diffX) > 8 && Math.abs(diffX) * 1.3 >= Math.abs(diffY)) {
        isSwiping = true;
        wrapper.classList.add('is-swiping');
        const itemW = item.offsetWidth || 300;
        const deltaPct = (diffX / itemW) * 100;
        const basePct = startIsOpen ? -25 : 0;
        currentShiftPct = Math.min(0, Math.max(-25, basePct + deltaPct));

        item.style.transition = 'none';
        item.style.transform = `translateX(${currentShiftPct}%)`;

        if (currentShiftPct < -5) {
          wrapper.classList.add('has-swiped-open');
        } else {
          wrapper.classList.remove('has-swiped-open');
        }
      }
    }, { passive: true });

    item.addEventListener('touchend', (e) => {
      if (holdTimer) {
        clearTimeout(holdTimer);
        holdTimer = null;
      }
      if (isSwiping) {
        wrapper.classList.remove('is-swiping');
        item.style.transition = '';
        item.style.removeProperty('transform');

        if (currentShiftPct <= -12) {
          wrapper.classList.add('has-swiped-open');
          item.classList.add('swiped-open');
          mobileServices.hapticTap();
        } else {
          wrapper.classList.remove('has-swiped-open');
          item.classList.remove('swiped-open');
        }
        isSwiping = false;
      }
    });

    item.addEventListener('touchcancel', () => {
      if (holdTimer) {
        clearTimeout(holdTimer);
        holdTimer = null;
      }
    });

    // Tap outside to close swipe
    item.addEventListener('click', (e) => {
      if (wrapper.classList.contains('has-swiped-open') || item.classList.contains('swiped-open')) {
        wrapper.classList.remove('has-swiped-open');
        item.classList.remove('swiped-open');
        item.style.removeProperty('transform');
        e.stopPropagation();
      }
    });

    // Swiping right on deleteAction to slide X closed
    deleteAction.addEventListener('touchstart', (e) => {
      touchStartX = (e.touches && e.touches[0]) ? e.touches[0].clientX : e.clientX;
    }, { passive: true });
    deleteAction.addEventListener('touchmove', (e) => {
      const clientX = (e.touches && e.touches[0]) ? e.touches[0].clientX : e.clientX;
      const diffX = clientX - touchStartX;
      if (diffX > 15) {
        wrapper.classList.remove('has-swiped-open');
        item.classList.remove('swiped-open');
        item.style.removeProperty('transform');
      }
    }, { passive: true });

    // Swipe delete button click
    const swpBtn = deleteAction.querySelector('.btn-swipe-delete');
    if (swpBtn) {
      swpBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        openConfirmDeleteTodo(todo.id, todo.title);
      });
    }

    wrapper.appendChild(deleteAction);
    wrapper.appendChild(item);
    container.appendChild(wrapper);
  });
  setupInteractiveTodoDrag(container);
}
window.renderTodoList = renderTodoList;

function setupInteractiveTodoDrag(container) {
  if (!container || container._hasInteractiveDrag) return;
  container._hasInteractiveDrag = true;

  container.addEventListener('pointerdown', (e) => {
    if (e.button !== undefined && e.button !== 0) return;
    // Do not initiate drag if tapping emoji picker, toggle checkbox, subtask drawer, or subtask controls
    if (e.target.closest('.todo-emoji-btn, [data-action="pick-todo-emoji"], [data-action="toggle-todo"], .todo-checkbox-btn, .todo-subtask-drawer, .todo-subtask-toggle-btn, .todo-subtask-add-pill-btn, .subtask-row, .subtask-add-row, .subtask-add-input, .btn-subtask-add-confirm')) {
      return;
    }

    let handle = e.target.closest('[data-action="drag-handle"], .drag-handle-compact, .todo-block-left');
    const card = e.target.closest('.todo-item-wrapper');
    if (!card) return;

    if (!handle) {
      const cardEl = card.querySelector('.todo-block') || card;
      const rect = cardEl.getBoundingClientRect();
      if (e.clientX - rect.left <= 48) {
        handle = card.querySelector('[data-action="drag-handle"], .drag-handle-compact, .todo-block-left');
      }
    }
    if (!handle) return;

    const allCards = Array.from(container.children).filter(c => c.matches('.todo-item-wrapper'));
    const fromIndex = allCards.indexOf(card);
    if (fromIndex === -1) return;

    const activePointerId = e.pointerId;
    const startX = e.clientX;
    const startY = e.clientY;
    let holdTimer = null;
    let isDragActive = false;
    let currentSlotIndex = fromIndex;
    let cardSlotPositions = [];
    let initialCardTop = 0;
    let slotSpacing = 54;

    const draggedCard = card;

    holdTimer = setTimeout(() => {
      holdTimer = null;
      isDragActive = true;
      if (handle) handle.classList.add('is-holding');
      const dotsEl = draggedCard.querySelector('[data-action="drag-handle"], .drag-handle-compact');
      if (dotsEl) dotsEl.classList.add('is-holding');

      try {
        (handle || draggedCard).setPointerCapture(activePointerId);
      } catch (_) {}

      const draggedRect = draggedCard.getBoundingClientRect();
      initialCardTop = draggedRect.top;
      slotSpacing = draggedRect.height + 8;

      cardSlotPositions = allCards.map((c, idx) => {
        const r = c.getBoundingClientRect();
        return { index: idx, midY: r.top + r.height / 2, el: c };
      });

      allCards.forEach(c => {
        if (c !== draggedCard) {
          c.classList.add('is-drag-sibling');
          c.style.transition = 'transform 0.22s cubic-bezier(0.2, 0, 0, 1)';
        }
      });

      draggedCard.classList.add('is-live-dragging');
      const innerBlock = draggedCard.querySelector('.todo-block');
      if (innerBlock) innerBlock.classList.add('is-live-dragging');
      draggedCard.style.zIndex = '999';
      mobileServices.hapticBuzz();
    }, 180);

    const onPointerMove = (moveEv) => {
      if (moveEv.pointerId !== activePointerId) return;
      if (!isDragActive) {
        if (Math.hypot(moveEv.clientX - startX, moveEv.clientY - startY) > 8) {
          if (holdTimer) {
            clearTimeout(holdTimer);
            holdTimer = null;
          }
        }
        return;
      }
      if (moveEv.cancelable) moveEv.preventDefault();

      const currentPointerY = moveEv.clientY;
      const offsetY = currentPointerY - (initialCardTop + 24);
      draggedCard.style.transform = `translate3d(0, ${offsetY}px, 0) scale(1.02)`;

      let newSlot = fromIndex;
      for (let i = 0; i < cardSlotPositions.length; i++) {
        if (currentPointerY > cardSlotPositions[i].midY) {
          newSlot = i;
        }
      }
      newSlot = Math.max(0, Math.min(cardSlotPositions.length - 1, newSlot));

      if (newSlot !== currentSlotIndex) {
        currentSlotIndex = newSlot;
        mobileServices.hapticTick();

        allCards.forEach((siblingCard, sibIdx) => {
          if (siblingCard === draggedCard) return;
          if (fromIndex < currentSlotIndex) {
            if (sibIdx > fromIndex && sibIdx <= currentSlotIndex) {
              siblingCard.style.transform = `translate3d(0, ${-slotSpacing}px, 0)`;
            } else {
              siblingCard.style.transform = 'translate3d(0, 0, 0)';
            }
          } else if (fromIndex > currentSlotIndex) {
            if (sibIdx >= currentSlotIndex && sibIdx < fromIndex) {
              siblingCard.style.transform = `translate3d(0, ${slotSpacing}px, 0)`;
            } else {
              siblingCard.style.transform = 'translate3d(0, 0, 0)';
            }
          } else {
            siblingCard.style.transform = 'translate3d(0, 0, 0)';
          }
        });
      }
    };

    const onPointerUp = (upEv) => {
      if (upEv.pointerId !== activePointerId) return;
      if (holdTimer) {
        clearTimeout(holdTimer);
        holdTimer = null;
      }
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);

      if (!isDragActive) return;
      isDragActive = false;

      if (handle) handle.classList.remove('is-holding');
      draggedCard.querySelectorAll('.is-holding').forEach(el => el.classList.remove('is-holding'));

      try {
        (handle || draggedCard).releasePointerCapture(activePointerId);
      } catch (_) {}

      allCards.forEach(c => {
        c.classList.remove('is-live-dragging');
        c.classList.remove('is-drag-sibling');
        const innerBlock = c.querySelector('.todo-block');
        if (innerBlock) innerBlock.classList.remove('is-live-dragging');
        c.style.transform = '';
        c.style.zIndex = '';
        c.style.transition = '';
      });

      if (fromIndex !== currentSlotIndex) {
        taskStore.reorderTodoTasks(fromIndex, currentSlotIndex);
        renderTodoList();
        mobileServices.hapticBuzz();
        showToastNotification('✓ To-Do reordered');
      }
    };

    window.addEventListener('pointermove', onPointerMove, { passive: false });
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
  });
}

// ==========================================
// Navigation Drawer, Settings, Calendar & Modals Setup
// ==========================================
function setupNavigationAndModals() {

  // Work / Break Segmented Control
  const typeSegmentWork = document.getElementById('typeSegmentWork');
  const typeSegmentBreak = document.getElementById('typeSegmentBreak');

  if (typeSegmentWork) {
    typeSegmentWork.addEventListener('click', () => {
      setAddTaskType('work');
      mobileServices.hapticTap();
    });
  }
  if (typeSegmentBreak) {
    typeSegmentBreak.addEventListener('click', () => {
      setAddTaskType('break');
      mobileServices.hapticTap();
    });
  }

  // Setup category chip selectors for Add Task, Edit Task, and Calendar Event
  refreshAddCategoryChips = setupCategorySelector('addModalCategoryChips', 'addModalCategory', 'btnAddCategory', () => {
    isAddModalManualCategory = true;
  });
  refreshEditCategoryChips = setupCategorySelector('editModalCategoryChips', 'editTaskCategory', 'btnEditAddCategory', () => {
    isEditModalManualCategory = true;
  });
  const refreshCalCategoryChips = setupCategorySelector('calEventCategoryChips', 'calEventCategory', 'btnAddCalCategory', (cat) => {
    if (calendarView) calendarView.currentCategory = cat;
  });
  if (calendarView) calendarView.refreshCategoryChips = refreshCalCategoryChips;

  // Live Title Auto-Classification for Add Task Modal
  let addTitleDebounceTimer = null;
  const addModalTitle = document.getElementById('addModalTitle');
  const addModalCategory = document.getElementById('addModalCategory');
  const addTaskHeaderEmoji = document.getElementById('addTaskHeaderEmoji');

  if (addModalTitle) {
    addModalTitle.addEventListener('input', () => {
      if (addTitleDebounceTimer) {
        clearTimeout(addTitleDebounceTimer);
      }
      addTitleDebounceTimer = setTimeout(() => {
        const text = (addModalTitle ? addModalTitle.value : '').trim();
        if (!text || text.length < 2) return;
        const cl = classifyEvent(text);
        if (cl) {
          if (!isAddModalManualCategory && cl.category) {
            if (addModalCategory) addModalCategory.value = cl.category;
            if (refreshAddCategoryChips) refreshAddCategoryChips();
          }
          if (!isAddModalManualEmoji && cl.emoji) {
            currentAddTaskEmoji = cl.emoji;
            if (addTaskHeaderEmoji) addTaskHeaderEmoji.textContent = cl.emoji;
          }
        }
      }, 150);
    });
  }

  // Live Title Auto-Classification for Edit Task Modal
  let editTitleDebounceTimer = null;
  const editTaskTitle = document.getElementById('editTaskTitle');
  const editTaskCategory = document.getElementById('editTaskCategory');
  const editTaskHeaderEmoji = document.getElementById('editTaskHeaderEmoji');

  if (editTaskTitle) {
    editTaskTitle.addEventListener('input', () => {
      if (editTitleDebounceTimer) {
        clearTimeout(editTitleDebounceTimer);
      }
      editTitleDebounceTimer = setTimeout(() => {
        const text = (editTaskTitle ? editTaskTitle.value : '').trim();
        if (!text || text.length < 2) return;
        const cl = classifyEvent(text);
        if (cl) {
          if (!isEditModalManualCategory && cl.category) {
            if (editTaskCategory) editTaskCategory.value = cl.category;
            if (refreshEditCategoryChips) refreshEditCategoryChips();
          }
          if (!isEditModalManualEmoji && cl.emoji) {
            currentEditEmoji = cl.emoji;
            if (editTaskHeaderEmoji) editTaskHeaderEmoji.textContent = cl.emoji;
          }
        }
      }, 150);
    });
  }

  // Add Task Modal Elements
  const btnCloseAddTaskModal = document.getElementById('btnCloseAddTaskModal');
  const addTaskModalBackdrop = document.getElementById('addTaskModalBackdrop');
  const formAddModalTask = document.getElementById('formAddModalTask');
  const btnAddModalEmoji = document.getElementById('btnAddModalEmoji');

  if (btnCloseAddTaskModal) btnCloseAddTaskModal.addEventListener('click', closeAddTaskModal);
  if (addTaskModalBackdrop) {
    addTaskModalBackdrop.addEventListener('click', (e) => {
      if (e.target === addTaskModalBackdrop) closeAddTaskModal();
    });
  }

  if (btnAddModalEmoji) {
    btnAddModalEmoji.addEventListener('click', (e) => {
      e.preventDefault();
      openEmojiPicker('NEW_TASK');
    });
  }

  // Dynamic duration presets rendering with "+" button & long-press deletion
  function renderAllDurationPresetChips() {
    const presets = taskStore.getDurationPresets();

    function populateContainer(containerId, inputElement, onChangeCallback) {
      const container = document.getElementById(containerId);
      if (!container) return;
      container.innerHTML = '';
      const currentVal = inputElement ? parseInt(inputElement.value, 10) : 0;

      presets.forEach(min => {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'duration-chip' + (min === currentVal ? ' active' : '');
        chip.setAttribute('data-min', String(min));
        chip.textContent = min + 'm';

        let holdTimer = null;
        let hasLongPressed = false;

        function startHold() {
          hasLongPressed = false;
          holdTimer = setTimeout(() => {
            hasLongPressed = true;
            mobileServices.hapticWarning();
            const confirmed = window.confirm('Delete the ' + min + 'm duration preset?');
            if (confirmed) {
              taskStore.deleteDurationPreset(min);
              renderAllDurationPresetChips();
              showToastNotification('Removed ' + min + 'm preset');
            }
          }, 550);
        }

        function cancelHold() {
          if (holdTimer) {
            clearTimeout(holdTimer);
            holdTimer = null;
          }
        }

        chip.addEventListener('mousedown', startHold);
        chip.addEventListener('touchstart', startHold, { passive: true });
        chip.addEventListener('mouseup', cancelHold);
        chip.addEventListener('mouseleave', cancelHold);
        chip.addEventListener('touchend', cancelHold);
        chip.addEventListener('touchcancel', cancelHold);

        chip.addEventListener('click', (e) => {
          if (hasLongPressed) {
            e.preventDefault();
            e.stopPropagation();
            return;
          }
          if (inputElement) {
            inputElement.value = min;
            inputElement.dispatchEvent(new Event('input', { bubbles: true }));
            inputElement.dispatchEvent(new Event('change', { bubbles: true }));
          }
          container.querySelectorAll('.duration-chip').forEach(c => c.classList.remove('active'));
          chip.classList.add('active');
          if (onChangeCallback) onChangeCallback(min);
          mobileServices.hapticTap();
        });

        container.appendChild(chip);
      });

      // "+" button to add custom duration preset
      const addBtn = document.createElement('button');
      addBtn.type = 'button';
      addBtn.className = 'duration-chip duration-chip-add-btn';
      addBtn.title = 'Add custom duration preset';
      addBtn.textContent = '+';
      addBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        mobileServices.hapticTap();
        const entered = window.prompt('Enter new duration preset in minutes (e.g. 20, 75):');
        if (entered) {
          const parsed = parseInt(entered.trim(), 10);
          if (!isNaN(parsed) && parsed > 0 && parsed <= 720) {
            taskStore.addDurationPreset(parsed);
            renderAllDurationPresetChips();
            showToastNotification('✓ Added ' + parsed + 'm preset');
          } else {
            showToastNotification('Please enter a valid number of minutes (1 to 720).');
          }
        }
      });
      container.appendChild(addBtn);
    }

    const addInput = document.getElementById('addModalDuration');
    populateContainer('addModalDurationChips', addInput, () => {
      updateAddModalEndTimeFromDuration();
    });

    const editInput = document.getElementById('editTaskDuration');
    populateContainer('editModalDurationChips', editInput, () => {
      updateEditModalEndTimeFromDuration();
    });

    const calInput = document.getElementById('calEventDuration');
    populateContainer('calEventDurationChips', calInput, () => {
      if (calendarView && typeof calendarView.updateEndTimeFromDuration === 'function') {
        calendarView.updateEndTimeFromDuration();
      }
    });

    populateContainer('pickerQuickChips', null, (min) => {
      pickerMinutes = min;
      updatePickerVisuals();
    });
  }
  window.renderAllDurationPresetChips = renderAllDurationPresetChips;
  renderAllDurationPresetChips();

  // ==========================================
  // Interactive Rotary Duration Dial Picker Modal
  // ==========================================
  let currentPickerTarget = null;
  let currentPickerCallingModal = null;
  let pickerMinutes = 30;
  let isDraggingPickerDial = false;
  let pickerDialRotationDeg = 0;
  let pickerDialStartAngleRad = 0;
  let pickerAccumulatedDeltaDeg = 0;

  const durationDialModalBackdrop = document.getElementById('durationDialModalBackdrop');
  const btnCloseDurationDial = document.getElementById('btnCloseDurationDial');
  const btnCancelDurationDial = document.getElementById('btnCancelDurationDial');
  const btnConfirmDurationDial = document.getElementById('btnConfirmDurationDial');
  const pickerRotarySvg = document.getElementById('pickerRotarySvg');
  const pickerRotaryDialGroup = document.getElementById('pickerRotaryDialGroup');
  const pickerDialHitRing = document.getElementById('pickerDialHitRing');
  const pickerTicksGroup = document.getElementById('pickerTicksGroup');
  const pickerDigitalInput = document.getElementById('pickerDigitalInput');
  const durationDialTaskTitle = document.getElementById('durationDialTaskTitle');
  const durationDialTimeSpan = document.getElementById('durationDialTimeSpan');

  function renderPickerTicks(isBreak) {
    if (!pickerTicksGroup) return;
    pickerTicksGroup.innerHTML = '';
    const majorColor = isBreak ? '#f59e0b' : 'var(--accent-cyan)';
    for (let i = 0; i < 60; i++) {
      const isMajor = i % 5 === 0;
      const angleRad = (i * 6 - 90) * (Math.PI / 180);
      const r1 = isMajor ? 133 : 139;
      const r2 = 151;
      const x1 = 160 + r1 * Math.cos(angleRad);
      const y1 = 160 + r1 * Math.sin(angleRad);
      const x2 = 160 + r2 * Math.cos(angleRad);
      const y2 = 160 + r2 * Math.sin(angleRad);

      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', x1);
      line.setAttribute('y1', y1);
      line.setAttribute('x2', x2);
      line.setAttribute('y2', y2);
      line.setAttribute('class', 'dial-tick' + (isMajor ? ' major' : ''));
      line.style.stroke = isMajor ? majorColor : 'rgba(255, 255, 255, 0.28)';
      line.style.strokeWidth = isMajor ? '3.5' : '2';
      line.style.strokeLinecap = 'round';
      pickerTicksGroup.appendChild(line);
    }
  }

  function updatePickerSubtitle() {
    if (!durationDialTimeSpan) return;
    let startInput = null;
    if (currentPickerCallingModal === 'add') {
      startInput = document.getElementById('addModalStartTime');
    } else if (currentPickerCallingModal === 'cal_event') {
      startInput = document.getElementById('calEventStartTime');
    } else {
      startInput = document.getElementById('editTaskStartTime');
    }
    const startVal = (startInput ? startInput.value : "").trim();

    if (startVal && startVal.length === 5) {
      const startMin = parseTimeToMinutes(startVal);
      const endMin = (startMin + pickerMinutes) % 1440;
      durationDialTimeSpan.textContent = startVal + ' → ' + formatMinutesToTime(endMin) + ' (' + pickerMinutes + 'm)';
    } else {
      durationDialTimeSpan.textContent = pickerMinutes + ' minutes';
    }
  }

  function updatePickerVisuals() {
    if (pickerDigitalInput && document.activeElement !== pickerDigitalInput) {
      pickerDigitalInput.value = pickerMinutes + 'm';
    }
    updatePickerSubtitle();
    document.querySelectorAll('#pickerQuickChips .duration-chip').forEach(c => {
      c.classList.toggle('active', c.getAttribute('data-min') === String(pickerMinutes));
    });
  }

  function openDurationDialPicker(targetInput, callingModal) {
    currentPickerTarget = targetInput;
    currentPickerCallingModal = callingModal || 'add';

    let titleInput = null;
    if (currentPickerCallingModal === 'add') {
      titleInput = document.getElementById('addModalTitle');
    } else if (currentPickerCallingModal === 'cal_event') {
      titleInput = document.getElementById('calEventTitle');
    } else {
      titleInput = document.getElementById('editTaskTitle');
    }
    const defaultTitle = currentPickerCallingModal === 'cal_event' ? 'Calendar Event' : (currentPickerCallingModal === 'add' ? 'New Task' : 'Edit Task');
    const taskTitle = (titleInput ? titleInput.value : "").trim() || defaultTitle;

    if (durationDialTaskTitle) durationDialTaskTitle.textContent = taskTitle;

    pickerMinutes = Math.max(1, parseInt((targetInput ? targetInput.value : ""), 10) || 30);
    pickerDialRotationDeg = 0;
    pickerAccumulatedDeltaDeg = 0;
    if (pickerRotaryDialGroup) {
      pickerRotaryDialGroup.setAttribute('transform', 'rotate(0 160 160)');
    }

    let isBreak = false;
    if (currentPickerCallingModal === 'add') {
      const catInput = document.getElementById('addModalCategory');
      const titleInput = document.getElementById('addModalTitle');
      isBreak = (currentAddTaskType === 'break') || ((catInput ? catInput.value : "").toLowerCase() === 'break') || ((titleInput ? titleInput.value : "").toLowerCase() === 'break');
    } else if (currentPickerCallingModal === 'cal_event') {
      const catInput = document.getElementById('calEventCategory');
      const titleInput = document.getElementById('calEventTitle');
      isBreak = ((catInput ? catInput.value : "").toLowerCase() === 'break') || ((titleInput ? titleInput.value : "").toLowerCase() === 'break');
    } else {
      const task = taskStore.getTasks().find(t => t.id === currentEditTaskId);
      const catInput = document.getElementById('editTaskCategory');
      isBreak = (((task && task.category) ? task.category.toLowerCase() : "") === 'break') || ((catInput ? catInput.value : "").toLowerCase() === 'break');
    }

    renderPickerTicks(isBreak);
    renderAllDurationPresetChips();
    updatePickerVisuals();

    if (durationDialModalBackdrop) durationDialModalBackdrop.classList.remove('hidden');
    mobileServices.hapticTap();
  }
  window.openDurationDialPicker = openDurationDialPicker;

  function closeDurationDialPicker() {
    if (durationDialModalBackdrop) durationDialModalBackdrop.classList.add('hidden');
    pickerDialRotationDeg = 0;
    if (pickerRotaryDialGroup) {
      pickerRotaryDialGroup.setAttribute('transform', 'rotate(0 160 160)');
    }
  }

  if (btnCloseDurationDial) btnCloseDurationDial.addEventListener('click', closeDurationDialPicker);
  if (btnCancelDurationDial) btnCancelDurationDial.addEventListener('click', closeDurationDialPicker);
  if (durationDialModalBackdrop) {
    durationDialModalBackdrop.addEventListener('click', (e) => {
      if (e.target === durationDialModalBackdrop) closeDurationDialPicker();
    });
  }

  if (btnConfirmDurationDial) {
    btnConfirmDurationDial.addEventListener('click', () => {
      mobileServices.hapticTap();
      if (currentPickerTarget) {
        currentPickerTarget.value = pickerMinutes;
        currentPickerTarget.dispatchEvent(new Event('input', { bubbles: true }));
        currentPickerTarget.dispatchEvent(new Event('change', { bubbles: true }));
      }
      closeDurationDialPicker();
    });
  }

  if (pickerDigitalInput) {
    pickerDigitalInput.addEventListener('input', () => {
      const raw = pickerDigitalInput.value.replace(/[^0-9]/g, '');
      const parsed = parseInt(raw, 10);
      if (!isNaN(parsed) && parsed > 0) {
        pickerMinutes = Math.min(720, parsed);
        updatePickerSubtitle();
        document.querySelectorAll('#pickerQuickChips .duration-chip').forEach(c => {
          c.classList.toggle('active', c.getAttribute('data-min') === String(pickerMinutes));
        });
      }
    });
    pickerDigitalInput.addEventListener('blur', () => {
      pickerDigitalInput.value = pickerMinutes + 'm';
    });
  }

  function getPickerAngle(clientX, clientY) {
    if (!pickerRotarySvg) return 0;
    const rect = pickerRotarySvg.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    return Math.atan2(clientY - cy, clientX - cx);
  }

  function getPickerRadius(clientX, clientY) {
    if (!pickerRotarySvg) return 0;
    const rect = pickerRotarySvg.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    return Math.hypot(clientX - cx, clientY - cy);
  }

  function onPickerPointerStart(e) {
    if (e.target && e.target.id === 'pickerDigitalInput') return;
    const clientX = (e.touches && e.touches[0]) ? e.touches[0].clientX : e.clientX;
    const clientY = (e.touches && e.touches[0]) ? e.touches[0].clientY : e.clientY;
    const radius = getPickerRadius(clientX, clientY);

    // Grab on outer bezel ticks area (radius >= 55)
    if (radius < 55) return;
    if (e.cancelable) e.preventDefault();

    isDraggingPickerDial = true;
    pickerDialStartAngleRad = getPickerAngle(clientX, clientY);
    pickerAccumulatedDeltaDeg = 0;
  }

  function onPickerPointerMove(e) {
    if (!isDraggingPickerDial) return;
    if (e.cancelable) e.preventDefault();
    const clientX = (e.touches && e.touches[0]) ? e.touches[0].clientX : e.clientX;
    const clientY = (e.touches && e.touches[0]) ? e.touches[0].clientY : e.clientY;
    const currentAngleRad = getPickerAngle(clientX, clientY);

    let diff = (currentAngleRad - pickerDialStartAngleRad) * (180 / Math.PI);
    if (diff > 180) diff -= 360;
    if (diff < -180) diff += 360;

    pickerDialStartAngleRad = currentAngleRad;
    pickerDialRotationDeg += diff;
    pickerAccumulatedDeltaDeg += diff;

    // Physically rotate outer bezel ticks
    if (pickerRotaryDialGroup) {
      pickerRotaryDialGroup.setAttribute('transform', 'rotate(' + pickerDialRotationDeg + ' 160 160)');
    }

    // 6 degrees of rotation = 1 minute
    const minutesDelta = Math.round(pickerAccumulatedDeltaDeg / 6);
    if (minutesDelta !== 0) {
      pickerMinutes = Math.max(1, Math.min(720, pickerMinutes + minutesDelta));
      pickerAccumulatedDeltaDeg -= minutesDelta * 6;
      audioManager.playRotaryTick();
      mobileServices.hapticTick();
      updatePickerVisuals();
    }
  }

  function onPickerPointerEnd() {
    isDraggingPickerDial = false;
  }

  const dialPickerContainer = document.getElementById('dialPickerContainer');
  if (dialPickerContainer) {
    dialPickerContainer.addEventListener('mousedown', onPickerPointerStart);
    dialPickerContainer.addEventListener('touchstart', onPickerPointerStart, { passive: false });
  }

  window.addEventListener('mousemove', (e) => {
    if (isDraggingPickerDial) onPickerPointerMove(e);
  });
  window.addEventListener('touchmove', (e) => {
    if (isDraggingPickerDial) onPickerPointerMove(e);
  }, { passive: false });
  window.addEventListener('mouseup', onPickerPointerEnd);
  window.addEventListener('touchend', onPickerPointerEnd);

  // Trigger bindings for duration dial picker
  const addModalDurationInput = document.getElementById('addModalDuration');
  const btnAddModalOpenDial = document.getElementById('btnAddModalOpenDial');
  const editTaskDurationInput = document.getElementById('editTaskDuration');
  const btnEditModalOpenDial = document.getElementById('btnEditModalOpenDial');

  if (btnAddModalOpenDial) {
    btnAddModalOpenDial.addEventListener('click', () => openDurationDialPicker(addModalDurationInput, 'add'));
  }
  if (btnEditModalOpenDial) {
    btnEditModalOpenDial.addEventListener('click', () => openDurationDialPicker(editTaskDurationInput, 'edit'));
  }
  const btnCalEventOpenDial = document.getElementById('btnCalEventOpenDial');
  const calEventDurationInput = document.getElementById('calEventDuration');
  if (btnCalEventOpenDial) {
    btnCalEventOpenDial.addEventListener('click', () => openDurationDialPicker(calEventDurationInput, 'cal_event'));
  }

  // Auto-colon formatter for time-num-input fields (fills HH:MM from left to right)
  document.querySelectorAll('.time-num-input').forEach(input => {
    input.addEventListener('input', (e) => {
      let raw = input.value.replace(/[^0-9]/g, '');
      if (raw.length > 4) raw = raw.slice(0, 4);

      if (raw.length >= 3) {
        input.value = raw.slice(0, 2) + ':' + raw.slice(2);
      } else if (raw.length === 2 && e.inputType !== 'deleteContentBackward') {
        input.value = raw + ':';
      } else {
        input.value = raw;
      }
    });
  });

  // Setup clock picker buttons inside time input boxes
  function bindClockPicker(btnId, nativeInputId, textInputId, onTimeSelected) {
    const btn = document.getElementById(btnId);
    const nativeInput = document.getElementById(nativeInputId);
    const textInput = document.getElementById(textInputId);

    if (btn && nativeInput) {
      const syncNativeFromText = () => {
        if (textInput && textInput.value && textInput.value.length === 5) {
          nativeInput.value = textInput.value;
        }
      };

      nativeInput.addEventListener('pointerdown', syncNativeFromText, { passive: true });
      nativeInput.addEventListener('touchstart', syncNativeFromText, { passive: true });
      nativeInput.addEventListener('focus', syncNativeFromText, { passive: true });

      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        mobileServices.hapticTap();
        syncNativeFromText();
        nativeInput.focus();
        if (typeof nativeInput.showPicker === 'function') {
          try {
            nativeInput.showPicker();
          } catch (err) {
            nativeInput.click();
          }
        } else {
          nativeInput.click();
        }
      });

      const handleNativeTimeChange = () => {
        if (nativeInput.value && textInput) {
          const cleanVal = String(nativeInput.value).slice(0, 5);
          if (cleanVal.length === 5) {
            textInput.value = cleanVal;
            textInput.dispatchEvent(new Event('input', { bubbles: true }));
            textInput.dispatchEvent(new Event('change', { bubbles: true }));
            if (onTimeSelected) onTimeSelected();
          }
        }
      };

      nativeInput.addEventListener('change', handleNativeTimeChange);
      nativeInput.addEventListener('input', handleNativeTimeChange);
      nativeInput.addEventListener('blur', handleNativeTimeChange);
    }
  }

  // Start & End Time calculation listeners for Add Task Modal
  let addModalFieldState = {
    durationUserDefined: false,
    startUserDefined: false,
    endUserDefined: false,
    endTimeLocked: false,
    lastEdited: null
  };

  const addModalStartTime = document.getElementById('addModalStartTime');
  const addModalEndTime = document.getElementById('addModalEndTime');

  function updateAddModalDurationFromTimeSpan() {
    if (!(addModalStartTime && addModalStartTime.value) || !(addModalEndTime && addModalEndTime.value)) return;
    const startMin = parseTimeToMinutes(addModalStartTime.value);
    const endMin = parseTimeToMinutes(addModalEndTime.value);
    let diff = endMin - startMin;
    if (diff < 0) diff += 1440;
    if (diff > 0) {
      if (addModalDurationInput) addModalDurationInput.value = diff;
      document.querySelectorAll('#addModalDurationChips .duration-chip').forEach(c => {
        c.classList.toggle('active', c.getAttribute('data-min') === String(diff));
      });
    }
  }

  function updateAddModalEndTimeFromDuration() {
    if (!(addModalDurationInput && addModalDurationInput.value)) return;
    const dur = parseInt(addModalDurationInput.value, 10) || 0;
    if (dur <= 0) return;

    // If user entered End Time before Start Time (either End Time first, or Duration then End Time),
    // keep End Time locked in place and set Start Time = End Time - Duration
    if (addModalFieldState.endTimeLocked && addModalEndTime && addModalEndTime.value && addModalEndTime.value.length === 5) {
      const endMin = parseTimeToMinutes(addModalEndTime.value);
      let sMin = endMin - dur;
      if (sMin < 0) sMin += 1440;
      if (addModalStartTime) addModalStartTime.value = formatMinutesToTime(sMin);
      return;
    }

    if (!(addModalStartTime && addModalStartTime.value && addModalStartTime.value.length === 5)) return;
    const startMin = parseTimeToMinutes(addModalStartTime.value);
    const endMin = (startMin + dur) % 1440;
    if (addModalEndTime) addModalEndTime.value = formatMinutesToTime(endMin);
  }

  function handleAddModalStartTimeChange() {
    addModalFieldState.startUserDefined = Boolean(addModalStartTime && addModalStartTime.value && addModalStartTime.value.length === 5);
    if (addModalFieldState.startUserDefined) {
      addModalFieldState.endTimeLocked = false;
    }
    addModalFieldState.lastEdited = 'start';
    if (addModalStartTime && addModalStartTime.value.length === 5) {
      if (addModalFieldState.durationUserDefined && !addModalFieldState.endUserDefined && addModalDurationInput && addModalDurationInput.value) {
        updateAddModalEndTimeFromDuration();
      } else if (addModalEndTime && addModalEndTime.value && addModalEndTime.value.length === 5) {
        updateAddModalDurationFromTimeSpan();
      }
    }
  }

  function handleAddModalEndTimeChange() {
    addModalFieldState.endUserDefined = Boolean(addModalEndTime && addModalEndTime.value && addModalEndTime.value.length === 5);
    addModalFieldState.lastEdited = 'end';
    if (addModalEndTime && addModalEndTime.value.length === 5) {
      if (!addModalFieldState.startUserDefined) {
        // User entered End Time before Start Time (either before Duration, or after Duration):
        // Lock End Time in place and set Start Time = End Time - Duration once Duration is defined
        addModalFieldState.endTimeLocked = true;
        if (addModalDurationInput && addModalDurationInput.value) {
          const endMin = parseTimeToMinutes(addModalEndTime.value);
          const dur = parseInt(addModalDurationInput.value, 10) || 0;
          if (dur > 0) {
            let sMin = endMin - dur;
            if (sMin < 0) sMin += 1440;
            if (addModalStartTime) addModalStartTime.value = formatMinutesToTime(sMin);
          }
        }
      } else if (addModalStartTime && addModalStartTime.value && addModalStartTime.value.length === 5) {
        updateAddModalDurationFromTimeSpan();
      }
    }
  }

  bindClockPicker('btnAddModalStartTimeClock', 'addModalStartTimeNative', 'addModalStartTime', handleAddModalStartTimeChange);

  bindClockPicker('btnAddModalEndTimeClock', 'addModalEndTimeNative', 'addModalEndTime', handleAddModalEndTimeChange);

  if (addModalStartTime) {
    addModalStartTime.addEventListener('input', handleAddModalStartTimeChange);
    addModalStartTime.addEventListener('change', handleAddModalStartTimeChange);
  }
  if (addModalEndTime) {
    addModalEndTime.addEventListener('input', handleAddModalEndTimeChange);
    addModalEndTime.addEventListener('change', handleAddModalEndTimeChange);
  }
  if (addModalDurationInput) {
    addModalDurationInput.addEventListener('input', () => {
      addModalFieldState.durationUserDefined = Boolean(addModalDurationInput.value);
      addModalFieldState.lastEdited = 'duration';
      updateAddModalEndTimeFromDuration();
      const val = addModalDurationInput.value;
      document.querySelectorAll('#addModalDurationChips .duration-chip').forEach(c => {
        c.classList.toggle('active', c.getAttribute('data-min') === val);
      });
    });
    addModalDurationInput.addEventListener('change', () => {
      addModalFieldState.durationUserDefined = Boolean(addModalDurationInput.value);
      addModalFieldState.lastEdited = 'duration';
      updateAddModalEndTimeFromDuration();
    });
  }

  // Start & End Time calculation listeners for Edit Task Modal
  const editTaskStartTime = document.getElementById('editTaskStartTime');
  const editTaskEndTime = document.getElementById('editTaskEndTime');

  function updateEditModalDurationFromTimeSpan() {
    if (!(editTaskStartTime && editTaskStartTime.value) || !(editTaskEndTime && editTaskEndTime.value)) return;
    const startMin = parseTimeToMinutes(editTaskStartTime.value);
    const endMin = parseTimeToMinutes(editTaskEndTime.value);
    let diff = endMin - startMin;
    if (diff < 0) diff += 1440;
    if (diff > 0) {
      if (editTaskDurationInput) editTaskDurationInput.value = diff;
      document.querySelectorAll('#editModalDurationChips .duration-chip').forEach(c => {
        c.classList.toggle('active', c.getAttribute('data-min') === String(diff));
      });
    }
  }

  function updateEditModalEndTimeFromDuration() {
    if (!(editTaskStartTime && editTaskStartTime.value) || !(editTaskDurationInput && editTaskDurationInput.value)) return;
    const startMin = parseTimeToMinutes(editTaskStartTime.value);
    const dur = parseInt(editTaskDurationInput.value, 10) || 0;
    const endMin = (startMin + dur) % 1440;
    if (editTaskEndTime) editTaskEndTime.value = formatMinutesToTime(endMin);
  }

  bindClockPicker('btnEditTaskStartTimeClock', 'editTaskStartTimeNative', 'editTaskStartTime', () => {
    if (editTaskDurationInput && editTaskDurationInput.value) {
      updateEditModalEndTimeFromDuration();
    } else if (editTaskEndTime && editTaskEndTime.value) {
      updateEditModalDurationFromTimeSpan();
    }
  });

  bindClockPicker('btnEditTaskEndTimeClock', 'editTaskEndTimeNative', 'editTaskEndTime', () => {
    updateEditModalDurationFromTimeSpan();
  });

  if (editTaskStartTime) {
    editTaskStartTime.addEventListener('input', () => {
      if (editTaskStartTime.value.length === 5) {
        if (editTaskDurationInput && editTaskDurationInput.value) {
          updateEditModalEndTimeFromDuration();
        } else if (editTaskEndTime && editTaskEndTime.value) {
          updateEditModalDurationFromTimeSpan();
        }
      }
    });
    editTaskStartTime.addEventListener('change', () => {
      if (editTaskDurationInput && editTaskDurationInput.value) {
        updateEditModalEndTimeFromDuration();
      } else if (editTaskEndTime && editTaskEndTime.value) {
        updateEditModalDurationFromTimeSpan();
      }
    });
  }
  if (editTaskEndTime) {
    editTaskEndTime.addEventListener('input', () => {
      if (editTaskEndTime.value.length === 5) updateEditModalDurationFromTimeSpan();
    });
    editTaskEndTime.addEventListener('change', updateEditModalDurationFromTimeSpan);
  }
  if (editTaskDurationInput) {
    editTaskDurationInput.addEventListener('input', () => {
      updateEditModalEndTimeFromDuration();
      const val = editTaskDurationInput.value;
      document.querySelectorAll('#editModalDurationChips .duration-chip').forEach(c => {
        c.classList.toggle('active', c.getAttribute('data-min') === val);
      });
    });
    editTaskDurationInput.addEventListener('change', updateEditModalEndTimeFromDuration);
  }

  setupTimeBankInfoModal();

  function handleAddTaskSubmit(e) {
    if (e) e.preventDefault();
    const titleInput = document.getElementById('addModalTitle');
    let title = titleInput ? titleInput.value.trim() : '';
    if (!title) {
      title = currentAddTaskType === 'break' ? 'Break' : `Task ${taskStore.getTasks().length + 1}`;
    }

    const durInput = document.getElementById('addModalDuration');
    const fixedInput = document.getElementById('addModalFixedTime');
    const startInput = document.getElementById('addModalStartTime');
    let fixedStartTime = (startInput ? startInput.value : "") || (fixedInput ? fixedInput.value : "") || null;
    const endInput = document.getElementById('addModalEndTime');
    const rawEndTime = (endInput && endInput.value && endInput.value.trim().length === 5) ? endInput.value.trim() : null;

    let duration = parseInt((durInput ? durInput.value : ""), 10);
    if (!fixedStartTime && rawEndTime && !isNaN(duration) && duration > 0) {
      const eMin = parseTimeToMinutes(rawEndTime);
      let sMin = eMin - duration;
      if (sMin < 0) sMin += 1440;
      fixedStartTime = formatMinutesToTime(sMin);
    } else if (!fixedStartTime && rawEndTime && (isNaN(duration) || duration <= 0)) {
      const existingTasks = taskStore.getTasks();
      if (existingTasks.length === 0) {
        const now = new Date();
        const nowMin = (now.getHours() * 60) + now.getMinutes();
        fixedStartTime = formatMinutesToTime(nowMin);
      }
    }

    if (isNaN(duration) || duration <= 0) {
      if (fixedStartTime && rawEndTime) {
        const sMin = parseTimeToMinutes(fixedStartTime);
        let eMin = parseTimeToMinutes(rawEndTime);
        if (eMin <= sMin) eMin += 1440;
        duration = Math.max(1, eMin - sMin);
      } else {
        duration = 30;
      }
    }

    const catInput = document.getElementById('addModalCategory');
    const category = (catInput ? catInput.value : "").trim() || (currentAddTaskType === 'break' ? 'Break' : 'General');

    const bankInput = document.getElementById('addModalTimeBank');
    const useTimeBank = bankInput ? bankInput.checked : false;

    const lockInput = document.getElementById('addModalIsLocked');
    const isLocked = Boolean(lockInput && lockInput.checked);
    const shouldLockToFixedEndTime = Boolean(
      rawEndTime && (
        isLocked ||
        addModalFieldState.endTimeLocked ||
        !addModalFieldState.durationUserDefined ||
        addModalFieldState.lastEdited === 'end'
      )
    );
    const fixedEndTime = shouldLockToFixedEndTime ? rawEndTime : null;

    if (category) taskStore.addCategory(category);

    const addSyncGoogle = document.getElementById('addTaskSyncGoogle');
    const addSyncMS = document.getElementById('addTaskSyncMS');
    const syncGoogle = Boolean(addSyncGoogle && addSyncGoogle.checked);
    const syncMS = Boolean(addSyncMS && addSyncMS.checked);
    if (typeof taskStore.setOutboundSyncPreference === 'function') {
      taskStore.setOutboundSyncPreference('google', syncGoogle);
      taskStore.setOutboundSyncPreference('microsoft', syncMS);
    }

    const resolvedColor = classifierGetCategoryColor(category);
    let resolvedColorId = null;
    if (typeof googleCalendarAdapter !== 'undefined' && typeof googleCalendarAdapter.getGoogleColorId === 'function') {
      resolvedColorId = googleCalendarAdapter.getGoogleColorId(category, resolvedColor, null);
    }

    const addMultiInput = document.getElementById('addModalIsMultiSession');
    const isMultiSession = Boolean(addMultiInput && addMultiInput.checked);
    const sessionCount = isMultiSession ? addModalSessionCount : 1;
    const sessionDuration = isMultiSession ? Math.max(1, Math.round(duration / sessionCount)) : duration;
    const addToTodoInput = document.getElementById('addModalAddToTodo');
    const addToTodo = Boolean(addToTodoInput && addToTodoInput.checked);

    const newTask = taskStore.addTask({
      title,
      plannedDuration: isMultiSession ? sessionDuration : duration,
      category,
      fixedStartTime,
      fixedEndTime,
      isLocked: Boolean(isLocked),
      useTimeBank,
      emoji: currentAddTaskEmoji || (currentAddTaskType === 'break' ? '☕' : '📝'),
      color: resolvedColor,
      colorId: resolvedColorId,
      source: 'local',
      origin: 'local',
      createdInApp: true,
      isDirty: false,
      provider: syncGoogle ? 'google' : (syncMS ? 'microsoft' : 'local'),
      isMultiSession: isMultiSession,
      sessionCount: sessionCount,
      sessionDuration: sessionDuration,
      sessionIndex: isMultiSession ? 1 : null,
      subtasks: addModalSubtasks.slice()
    });

    if (isMultiSession) {
      taskStore.updateTask(newTask.id, { masterTaskId: newTask.id });
    }

    if (addToTodo) {
      taskStore.addTodoTask({
        id: 'todo-' + newTask.id,
        masterTaskId: newTask.id,
        title: title,
        emoji: currentAddTaskEmoji || '📝',
        category: category,
        completed: false,
        isMultiSession: isMultiSession,
        sessionCount: sessionCount,
        sessionDuration: sessionDuration,
        plannedDuration: duration,
        subtasks: addModalSubtasks.slice()
      });
      renderTodoList();
    }

    if (syncGoogle) {
      if (typeof calendarSyncService !== 'undefined' && typeof calendarSyncService.createRemoteEvent === 'function') {
        calendarSyncService.createRemoteEvent('google', newTask).then(res => {
          if (res && res.externalId) {
            taskStore.updateTask(newTask.id, {
              googleEventId: res.externalId,
              externalId: res.externalId,
              provider: 'google',
              isDirty: false
            });
            taskStore.updateCalendarEvent(newTask.id, {
              googleEventId: res.externalId,
              externalId: res.externalId,
              provider: 'google',
              isDirty: false
            });
          }
        }).catch(() => {
          taskStore.updateTask(newTask.id, { isDirty: true });
        });
      }
    }
    if (syncMS) {
      if (typeof calendarSyncService !== 'undefined' && typeof calendarSyncService.createRemoteEvent === 'function') {
        calendarSyncService.createRemoteEvent('microsoft', newTask).then(res => {
          if (res && res.externalId) {
            taskStore.updateTask(newTask.id, {
              microsoftEventId: res.externalId,
              externalId: res.externalId,
              provider: 'microsoft',
              isDirty: false
            });
            taskStore.updateCalendarEvent(newTask.id, {
              microsoftEventId: res.externalId,
              externalId: res.externalId,
              provider: 'microsoft',
              isDirty: false
            });
          }
        }).catch(() => {
          taskStore.updateTask(newTask.id, { isDirty: true });
        });
      }
    }

    if (runtime && runtime.status === TimerStatus.COMPLETED) {
      runtime.status = TimerStatus.IDLE;
      runtime.activeTaskIndex = 0;
    }
    runtime.initialTasks = taskStore.getTasks();
    runtime.recalculate();
    syncDynamicScheduleTimesToCalendar();
    updateScheduleUI(runtime.currentSchedule);
    updateActiveTaskDisplay();
    renderTaskList(((runtime.currentSchedule && runtime.currentSchedule.tasks) || []) || taskStore.getTasks());
    renderCalendarModal();
    closeAddTaskModal();
    mobileServices.hapticTap();
    showToastNotification(currentAddTaskType === 'break' ? '☕ Break added to schedule' : '✓ Task added to schedule');
  }

  if (formAddModalTask) {
    formAddModalTask.addEventListener('submit', handleAddTaskSubmit);
  }
  const btnAddModalSubmit = document.getElementById('btnAddModalSubmit');
  if (btnAddModalSubmit) {
    btnAddModalSubmit.addEventListener('click', (e) => {
      // If within a form, submit event will also trigger; calling handleAddTaskSubmit prevents double submissions
      handleAddTaskSubmit(e);
    });
  }

  // Theme segmented buttons in Settings
  const themeSegmentBtns = document.querySelectorAll('.theme-segment-btn');
  themeSegmentBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const selectedTheme = btn.getAttribute('data-theme-val');
      taskStore.setTheme(selectedTheme);
      applyTheme(selectedTheme);
      mobileServices.hapticTap();
    });
  });

  // Task Edit Modal events
  const btnCloseTaskEdit = document.getElementById('btnCloseTaskEdit');
  const btnSaveTaskEdit = document.getElementById('btnSaveTaskEdit');
  const taskEditModalBackdrop = document.getElementById('taskEditModalBackdrop');
  const formEditTask = document.getElementById('formEditTask');
  const btnDeleteTaskFromModal = document.getElementById('btnDeleteTaskFromModal');
  const btnEditTaskHeaderEmoji = document.getElementById('btnEditTaskHeaderEmoji');

  if (btnEditTaskHeaderEmoji) {
    btnEditTaskHeaderEmoji.addEventListener('click', (e) => {
      e.preventDefault();
      if (currentEditTaskId) {
        openEmojiPicker(currentEditTaskId);
      }
    });
  }

  function handleSaveTaskEdit(e) {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    saveCurrentTaskEdit();
    (() => { const _el = document.getElementById("taskEditModalBackdrop"); if (_el) _el.classList.add("hidden"); })();
    currentEditTaskId = null;
    currentEditEmoji = null;
    mobileServices.hapticTap();
    showToastNotification('✓ Task updated');
  }

  function handleCloseTaskEdit(e) {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    (() => { const _el = document.getElementById("taskEditModalBackdrop"); if (_el) _el.classList.add("hidden"); })();
    currentEditTaskId = null;
    currentEditEmoji = null;
  }

  if (btnCloseTaskEdit) btnCloseTaskEdit.addEventListener('click', handleCloseTaskEdit);
  if (btnSaveTaskEdit) btnSaveTaskEdit.addEventListener('click', handleSaveTaskEdit);
  if (formEditTask) formEditTask.addEventListener('submit', handleSaveTaskEdit);
  if (taskEditModalBackdrop) {
    taskEditModalBackdrop.addEventListener('click', (e) => {
      if (e.target === taskEditModalBackdrop) handleCloseTaskEdit(e);
    });
  }

  // Multi-Session Steppers & Subtask Editors for Add & Edit Modals
  const addModalIsMultiSession = document.getElementById('addModalIsMultiSession');
  const addModalMultiSessionDetails = document.getElementById('addModalMultiSessionDetails');
  const addModalMultiSessionHint = document.getElementById('addModalMultiSessionHint');
  const updateAddModalHint = () => {
    if (addModalMultiSessionHint) {
      addModalMultiSessionHint.textContent = `Total duration split into ${addModalSessionCount} sessions`;
    }
  };
  if (addModalIsMultiSession) {
    addModalIsMultiSession.addEventListener('change', () => {
      if (addModalMultiSessionDetails) {
        addModalMultiSessionDetails.classList.toggle('hidden', !addModalIsMultiSession.checked);
      }
      updateAddModalHint();
    });
  }
  const btnDecAddSessions = document.getElementById('btnDecAddSessions');
  const btnIncAddSessions = document.getElementById('btnIncAddSessions');
  const addModalSessionCountVal = document.getElementById('addModalSessionCountVal');
  if (btnDecAddSessions) {
    btnDecAddSessions.addEventListener('click', (e) => {
      e.preventDefault();
      addModalSessionCount = Math.max(2, addModalSessionCount - 1);
      if (addModalSessionCountVal) addModalSessionCountVal.textContent = String(addModalSessionCount);
      updateAddModalHint();
      mobileServices.hapticTick();
    });
  }
  if (btnIncAddSessions) {
    btnIncAddSessions.addEventListener('click', (e) => {
      e.preventDefault();
      addModalSessionCount = Math.min(10, addModalSessionCount + 1);
      if (addModalSessionCountVal) addModalSessionCountVal.textContent = String(addModalSessionCount);
      updateAddModalHint();
      mobileServices.hapticTick();
    });
  }

  const btnAddModalAddSubtask = document.getElementById('btnAddModalAddSubtask');
  const addModalNewSubtaskInput = document.getElementById('addModalNewSubtaskInput');
  const handleAddModalSubtaskAdd = () => {
    if (!addModalNewSubtaskInput) return;
    const title = addModalNewSubtaskInput.value.trim();
    if (!title) return;
    addModalSubtasks.push({
      id: 'sub-' + Date.now() + '-' + Math.random().toString(36).substr(2, 4),
      title: title,
      completed: false
    });
    addModalNewSubtaskInput.value = '';
    renderAddModalSubtaskList();
    mobileServices.hapticTap();
  };
  if (btnAddModalAddSubtask) {
    btnAddModalAddSubtask.addEventListener('click', (e) => {
      e.preventDefault();
      handleAddModalSubtaskAdd();
    });
  }
  if (addModalNewSubtaskInput) {
    addModalNewSubtaskInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        handleAddModalSubtaskAdd();
      }
    });
  }

  const editTaskIsMultiSession = document.getElementById('editTaskIsMultiSession');
  const editTaskMultiSessionDetails = document.getElementById('editTaskMultiSessionDetails');
  const editTaskMultiSessionHint = document.getElementById('editTaskMultiSessionHint');
  const updateEditModalHint = () => {
    if (editTaskMultiSessionHint) {
      editTaskMultiSessionHint.textContent = `Total duration split into ${editModalSessionCount} sessions`;
    }
  };
  if (editTaskIsMultiSession) {
    editTaskIsMultiSession.addEventListener('change', () => {
      if (editTaskMultiSessionDetails) {
        editTaskMultiSessionDetails.classList.toggle('hidden', !editTaskIsMultiSession.checked);
      }
      updateEditModalHint();
    });
  }
  const btnDecEditSessions = document.getElementById('btnDecEditSessions');
  const btnIncEditSessions = document.getElementById('btnIncEditSessions');
  const editTaskSessionCountVal = document.getElementById('editTaskSessionCountVal');
  if (btnDecEditSessions) {
    btnDecEditSessions.addEventListener('click', (e) => {
      e.preventDefault();
      editModalSessionCount = Math.max(2, editModalSessionCount - 1);
      if (editTaskSessionCountVal) editTaskSessionCountVal.textContent = String(editModalSessionCount);
      updateEditModalHint();
      mobileServices.hapticTick();
    });
  }
  if (btnIncEditSessions) {
    btnIncEditSessions.addEventListener('click', (e) => {
      e.preventDefault();
      editModalSessionCount = Math.min(10, editModalSessionCount + 1);
      if (editTaskSessionCountVal) editTaskSessionCountVal.textContent = String(editModalSessionCount);
      updateEditModalHint();
      mobileServices.hapticTick();
    });
  }

  const btnEditTaskAddSubtask = document.getElementById('btnEditTaskAddSubtask');
  const editTaskNewSubtaskInput = document.getElementById('editTaskNewSubtaskInput');
  const handleEditTaskSubtaskAdd = () => {
    if (!editTaskNewSubtaskInput) return;
    const title = editTaskNewSubtaskInput.value.trim();
    if (!title) return;
    editModalSubtasks.push({
      id: 'sub-' + Date.now() + '-' + Math.random().toString(36).substr(2, 4),
      title: title,
      completed: false
    });
    editTaskNewSubtaskInput.value = '';
    renderEditModalSubtaskList();
    mobileServices.hapticTap();
  };
  if (btnEditTaskAddSubtask) {
    btnEditTaskAddSubtask.addEventListener('click', (e) => {
      e.preventDefault();
      handleEditTaskSubtaskAdd();
    });
  }
  if (editTaskNewSubtaskInput) {
    editTaskNewSubtaskInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        handleEditTaskSubtaskAdd();
      }
    });
  }

  if (btnDeleteTaskFromModal) {
    btnDeleteTaskFromModal.addEventListener('click', () => {
      if (currentEditTaskId) {
        const id = currentEditTaskId;
        const task = taskStore.getTasks().find(t => t.id === id);
        const title = task ? task.title : 'Task';
        (() => { const _el = document.getElementById("taskEditModalBackdrop"); if (_el) _el.classList.add("hidden"); })();
        currentEditTaskId = null;
        currentEditEmoji = null;
        executeDeleteTask(id, title);
      }
    });
  }

  // Emoji Picker Modal events
  const btnCloseEmojiPicker = document.getElementById('btnCloseEmojiPicker');
  const emojiPickerModalBackdrop = document.getElementById('emojiPickerModalBackdrop');
  if (btnCloseEmojiPicker) btnCloseEmojiPicker.addEventListener('click', closeEmojiPicker);
  if (emojiPickerModalBackdrop) {
    emojiPickerModalBackdrop.addEventListener('click', (e) => {
      if (e.target === emojiPickerModalBackdrop) closeEmojiPicker();
    });
  }

  // Category Color Palette Modal events
  const btnCloseCategoryColorModal = document.getElementById('btnCloseCategoryColorModal');
  const categoryColorPaletteModalBackdrop = document.getElementById('categoryColorPaletteModalBackdrop');
  if (btnCloseCategoryColorModal) btnCloseCategoryColorModal.addEventListener('click', closeCategoryColorPalette);
  if (categoryColorPaletteModalBackdrop) {
    categoryColorPaletteModalBackdrop.addEventListener('click', (e) => {
      if (e.target === categoryColorPaletteModalBackdrop) closeCategoryColorPalette();
    });
  }

  // Swipe right on screen to smoothly open nav menu; swipe left to smoothly close
  navTouchStartX = null;
  navTouchStartY = null;
  isNavSwiping = false;
  let isDrawerOpenAtTouchStart = false;

  window.addEventListener('touchstart', (e) => {
    if (!navDrawer || !navDrawerBackdrop) return;
    const target = e.target;

    // Reset stale drawer pull state if no finger is currently touching the bottom drawer
    if (!isDrawerTouching) {
      isDrawerPullingUp = false;
      isDrawerPullingDown = false;
    }

    // Ensure stale nav swiping flag is cleared when a new single-finger gesture starts
    if (e.touches && e.touches.length === 1 && (!navDrawer || !navDrawer.classList.contains('open'))) {
      isNavSwiping = false;
    }

    // Guard: Never open side menu if ANY modal is currently open
    const openModal = document.querySelector('.modal-backdrop:not(.hidden)');
    if (openModal) {
      navTouchStartX = null;
      navTouchStartY = null;
      return;
    }

    // Guard: If Today's Tasks drawer is open (expanded), ignore touches inside it for nav menu
    if (taskDrawer && !taskDrawer.classList.contains('collapsed')) {
      if (target.closest('.task-drawer, #taskDrawer, .task-drawer-backdrop, #taskDrawerBackdrop')) {
        navTouchStartX = null;
        navTouchStartY = null;
        return;
      }
    }

    const touch = e.touches && e.touches[0];
    if (!touch) return;

    // Guard: If touch starts inside or on the timer wheel/dial elements, check if inside dial circle.
    // Swipes starting near the left edge of the screen (touch.clientX <= 90) or at the outer corner spandrels
    // are allowed to open the nav menu drawer immediately even if touching over the wheel container!
    const wheelEl = document.getElementById('wheelContainer');
    if (touch.clientX > 90 && wheelEl && target.closest('.wheel-container, #wheelContainer, .rotary-dial-group, #rotaryDialGroup, .revolving-circle-group, #revolvingCircleGroup, .dial-hit-ring, .timer-center-display')) {
      const rect = wheelEl.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const dist = Math.hypot(touch.clientX - cx, touch.clientY - cy);
      const wheelRadius = rect.width / 2;
      // Outer dial tick radius is ~1.02 * wheelRadius (bezel).
      // The green track is at ~0.81 * wheelRadius.
      // We define the protected dial rotation zone between innerGreenBorderRadius (~0.68 * wheelRadius) and dialSafeRadius (1.02 * wheelRadius).
      const dialSafeRadius = wheelRadius * 1.02;
      const innerGreenBorderRadius = wheelRadius * 0.68;
      if (dist >= innerGreenBorderRadius && dist <= dialSafeRadius && isDraggingOuterDial && Math.abs(accumulatedDialAngleDeltaDeg) > 5) {
        navTouchStartX = null;
        navTouchStartY = null;
        return;
      }
    }

    // Clear stale dial states if body does not have active dragging classes
    if (document.body && !document.body.classList.contains('is-dragging-dial') && !document.body.classList.contains('is-scrubbing')) {
      isDraggingOuterDial = false;
      isScrubbingGreenLine = false;
    }

    // Never start nav menu swipe if Today's Tasks drawer is open or actively pulling up/down
    if (isDrawerPullingUp || isDrawerPullingDown || (taskDrawer && !taskDrawer.classList.contains('collapsed'))) {
      navTouchStartX = null;
      navTouchStartY = null;
      return;
    }

    isDrawerOpenAtTouchStart = navDrawer.classList.contains('open');
    navTouchStartX = touch.clientX;
    navTouchStartY = touch.clientY;
    isNavSwiping = false;
  }, { capture: true, passive: true });

  window.addEventListener('touchmove', (e) => {
    if (!navDrawer || !navDrawerBackdrop) return;
    if (navTouchStartX === null || navTouchStartY === null) return;
    if (isDrawerPullingUp || isDrawerPullingDown) {
      if (isNavSwiping) {
        isNavSwiping = false;
        closeDrawer();
      }
      return;
    }

    // If Today's Tasks drawer is open, never swipe menu
    if (taskDrawer && !taskDrawer.classList.contains('collapsed')) {
      if (isNavSwiping) {
        isNavSwiping = false;
        closeDrawer();
      }
      return;
    }

    const touch = e.touches && e.touches[0];
    if (!touch) return;
    const diffX = touch.clientX - navTouchStartX;
    const diffY = touch.clientY - navTouchStartY;
    const drawerW = navDrawer.offsetWidth || 280;

    if (!isDrawerOpenAtTouchStart) {
      // Swiping right from closed state:
      // Only open the menu for milder/flatter angles of swiping left to right:
      // - Horizontal movement must be at least 22px
      // - If swiping upwards (diffY < 0), require diffX >= Math.abs(diffY) * 1.85 (angle <= 28 deg from horizontal)
      // - If swiping downwards (diffY >= 0), require diffX >= diffY * 1.5 (angle <= 33 deg from horizontal)
      // This strictly prevents steep upward swipes or dial thumb gestures from opening the menu
      const maxAllowedVertical = diffY < 0 ? (diffX / 1.85) : (diffX / 1.5);
      if (diffX > 22 && Math.abs(diffY) <= maxAllowedVertical) {
        // Deliberate horizontal swipe right: cancel any dial dragging/scrubbing
        if (isDraggingOuterDial || isScrubbingGreenLine) {
          isDraggingOuterDial = false;
          isScrubbingGreenLine = false;
          document.body.classList.remove('is-dragging-dial', 'is-scrubbing');
          if (rotaryDialGroup) {
            rotaryDialGroup.setAttribute('transform', 'rotate(0 160 160)');
          }
          if (rotaryPreviewBadge) {
            rotaryPreviewBadge.classList.add('hidden');
          }
          currentDialRotationDeg = 0;
          accumulatedDialAngleDeltaDeg = 0;
        }

        if (!isNavSwiping) {
          syncNavActiveState();
        }
        isNavSwiping = true;
        navDrawer.style.transition = 'none';
        navDrawer.style.visibility = 'visible';
        navDrawerBackdrop.classList.remove('hidden');
        navDrawerBackdrop.style.transition = 'none';

        const progress = Math.max(0, Math.min(1, diffX / 160));
        const currentX = -drawerW * (1 - progress);
        navDrawer.style.transform = `translateX(${currentX}px)`;
        navDrawerBackdrop.style.opacity = progress.toString();
      } else if (isDraggingOuterDial || isScrubbingGreenLine) {
        // User is actually turning dial or scrubbing, do not trigger nav swipe
        return;
      }
    } else if (isDrawerOpenAtTouchStart && diffX < -15) {
      // Swiping left from open state: smoothly slide menu back left
      isNavSwiping = true;
      navDrawer.style.transition = 'none';
      navDrawerBackdrop.style.transition = 'none';

      const progress = Math.max(0, Math.min(1, 1 + diffX / 160));
      const currentX = -drawerW * (1 - progress);
      navDrawer.style.transform = `translateX(${currentX}px)`;
      navDrawerBackdrop.style.opacity = progress.toString();
    }
  }, { capture: true, passive: true });

  window.addEventListener('touchend', (e) => {
    if (!isNavSwiping || !navDrawer || !navDrawerBackdrop) {
      navTouchStartX = null;
      navTouchStartY = null;
      return;
    }
    isNavSwiping = false;
    const touch = (e.changedTouches && e.changedTouches[0]) ? e.changedTouches[0] : null;
    const diffX = (touch && navTouchStartX !== null) ? (touch.clientX - navTouchStartX) : 0;
    navTouchStartX = null;
    navTouchStartY = null;

    navDrawer.style.transition = 'transform 0.28s cubic-bezier(0.32, 0.72, 0, 1)';
    navDrawerBackdrop.style.transition = 'opacity 0.25s ease';

    if (!isDrawerOpenAtTouchStart) {
      if (diffX > 40) {
        openDrawer();
      } else {
        closeDrawer();
      }
    } else {
      if (diffX < -30) {
        closeDrawer();
      } else {
        openDrawer();
      }
    }
  }, { capture: true, passive: true });

  window.addEventListener('touchcancel', () => {
    if (isNavSwiping && navDrawer && navDrawerBackdrop) {
      isNavSwiping = false;
      closeDrawer();
    }
    navTouchStartX = null;
    navTouchStartY = null;
    isNavSwiping = false;
    if (typeof onDrawerTouchCancel === 'function') {
      onDrawerTouchCancel();
    } else {
      isDrawerTouching = false;
      isDrawerPullingDown = false;
      isDrawerPullingUp = false;
    }
  }, { capture: true, passive: true });

  // Bind interactive live drag reordering to calendar timeline
  setupInteractiveTaskDrag(calendarTimelineList);

  // Drawer events
  if (btnOpenNav) btnOpenNav.addEventListener('click', openDrawer);
  if (btnCloseNav) btnCloseNav.addEventListener('click', closeDrawer);
  if (navDrawerBackdrop) navDrawerBackdrop.addEventListener('click', closeDrawer);

  // Drawer items
  if (navItemTimer) {
    navItemTimer.addEventListener('click', () => {
      analytics.trackInteraction('tab_switch', 'timer');
      closeDrawer();
      closeSettings();
      closeCalendar();
      closeTodo();
      closeInsights();
      calendarView.close();
      const navItemFullCalendar = document.getElementById('navItemFullCalendar');
      if (navItemFullCalendar) navItemFullCalendar.classList.remove('active');
      navItemTimer.classList.add('active');
      if (navItemCalendar) navItemCalendar.classList.remove('active');
      if (navItemTodo) navItemTodo.classList.remove('active');
      const navItemInsights = document.getElementById('navItemInsights');
      if (navItemInsights) navItemInsights.classList.remove('active');
      if (runtime && runtime.status === TimerStatus.IDLE) {
        runtime.initialTasks = taskStore.getTasks();
        runtime.recalculate();
        updateActiveTaskDisplay();
        renderTaskList(((runtime.currentSchedule && runtime.currentSchedule.tasks) || []) || taskStore.getTasks());
      }
      mobileServices.hapticTap();
    });
  }

  if (navItemCalendar) {
    navItemCalendar.addEventListener('click', () => {
      analytics.trackInteraction('tab_switch', 'today_schedule');
      openCalendar();
    });
  }

  const navItemFullCalendar = document.getElementById('navItemFullCalendar');
  if (navItemFullCalendar) {
    navItemFullCalendar.addEventListener('click', () => {
      analytics.trackInteraction('tab_switch', 'full_calendar');
      closeDrawer();
      closeSettings();
      closeCalendar();
      closeTodo();
      calendarView.open();
      navItemFullCalendar.classList.add('active');
      if (navItemTimer) navItemTimer.classList.remove('active');
      if (navItemCalendar) navItemCalendar.classList.remove('active');
      if (navItemTodo) navItemTodo.classList.remove('active');
      mobileServices.hapticTap();
    });
  }

  const navItemTodo = document.getElementById('navItemTodo');
  if (navItemTodo) {
    navItemTodo.addEventListener('click', () => {
      analytics.trackInteraction('tab_switch', 'todo');
      openTodo();
    });
  }

  const navItemInsights = document.getElementById('navItemInsights');
  if (navItemInsights) {
    navItemInsights.addEventListener('click', () => {
      analytics.trackInteraction('tab_switch', 'insights');
      openInsights();
    });
  }

  if (navItemSettings) {
    navItemSettings.addEventListener('click', () => {
      analytics.trackInteraction('tab_switch', 'settings');
      openSettings();
    });
  }

  // Insights modal
  const btnCloseInsights = document.getElementById('btnCloseInsights');
  if (btnCloseInsights) btnCloseInsights.addEventListener('click', closeInsights);
  const insightsModalBackdrop = document.getElementById('insightsModalBackdrop');
  if (insightsModalBackdrop) {
    insightsModalBackdrop.addEventListener('click', (e) => {
      if (e.target === insightsModalBackdrop) closeInsights();
    });
  }

  // Insights range segment buttons
  const insightsSegmentBtns = document.querySelectorAll('.insights-segment-btn');
  insightsSegmentBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      insightsSegmentBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const r = parseInt(btn.getAttribute('data-range'), 10) || 7;
      renderInsightsModal(r);
      mobileServices.hapticTap();
    });
  });

  // Settings modal
  if (btnCloseSettings) btnCloseSettings.addEventListener('click', closeSettings);
  if (settingsModalBackdrop) {
    settingsModalBackdrop.addEventListener('click', (e) => {
      if (e.target === settingsModalBackdrop) closeSettings();
    });
  }
  const toggleTelemetryEnabled = document.getElementById('toggleTelemetryEnabled');
  if (toggleTelemetryEnabled) {
    toggleTelemetryEnabled.checked = taskStore.getTelemetryEnabled();
    toggleTelemetryEnabled.addEventListener('change', () => {
      const enabled = toggleTelemetryEnabled.checked;
      taskStore.setTelemetryEnabled(enabled);
      mobileServices.hapticTap();
      showToastNotification(enabled ? 'App analytics & diagnostics enabled' : 'App analytics & diagnostics disabled');
    });
  }
  if (toggleConfirmAdjust) {
    toggleConfirmAdjust.addEventListener('change', () => {
      taskStore.setConfirmAdjustments(toggleConfirmAdjust.checked);
      mobileServices.hapticTap();
    });
  }
  if (toggleHardStopEnabled) {
    toggleHardStopEnabled.checked = taskStore.getHardStopEnabled();
    toggleHardStopEnabled.addEventListener('change', () => {
      const enabled = toggleHardStopEnabled.checked;
      taskStore.setHardStopEnabled(enabled);
      runtime.setHardStopEnabled(enabled);
      updateHardStopPillsUI(enabled);
      mobileServices.hapticTap();
      showToastNotification(enabled ? 'Hard Stop enabled' : 'Hard Stop disabled');
    });
  }

  const toggleShowTimeSpansSequential = document.getElementById('toggleShowTimeSpansSequential');
  if (toggleShowTimeSpansSequential) {
    toggleShowTimeSpansSequential.checked = (typeof taskStore.getShowTimeSpansInSequential === 'function')
      ? taskStore.getShowTimeSpansInSequential()
      : false;
    toggleShowTimeSpansSequential.addEventListener('change', () => {
      const enabled = toggleShowTimeSpansSequential.checked;
      if (typeof taskStore.setShowTimeSpansInSequential === 'function') {
        taskStore.setShowTimeSpansInSequential(enabled);
      }
      updateActiveTaskDisplay();
      mobileServices.hapticTap();
      showToastNotification(enabled ? 'Time spans enabled on timer' : 'Time spans hidden on timer (duration only)');
    });
  }

  const toggleAlertsEnabled = document.getElementById('toggleAlertsEnabled');
  if (toggleAlertsEnabled) {
    toggleAlertsEnabled.checked = taskStore.getAlertsEnabled();
    toggleAlertsEnabled.addEventListener('change', async () => {
      if (toggleAlertsEnabled.checked) {
        taskStore.setAlertsEnabled(true);
        if ('Notification' in window && Notification.permission === 'default') {
          await mobileServices.requestNotificationPermission();
        }
      } else {
        taskStore.setAlertsEnabled(false);
        mobileServices.cancelLiveNotification();
      }
      updateNotifToggleUI();
      mobileServices.hapticTap();
      showToastNotification(toggleAlertsEnabled.checked ? 'Alerts enabled' : 'Alerts disabled');
    });
  }

  const toggleHapticsEnabled = document.getElementById('toggleHapticsEnabled');
  if (toggleHapticsEnabled) {
    toggleHapticsEnabled.checked = taskStore.getHapticsEnabled();
    toggleHapticsEnabled.addEventListener('change', () => {
      const enabled = toggleHapticsEnabled.checked;
      taskStore.setHapticsEnabled(enabled);
      if (enabled) mobileServices.hapticTap();
      showToastNotification(enabled ? 'Haptic feedback enabled' : 'Haptic feedback disabled');
    });
  }

  const toggleKeepScreenAwake = document.getElementById('toggleKeepScreenAwake');
  if (toggleKeepScreenAwake) {
    toggleKeepScreenAwake.checked = (typeof taskStore.getKeepScreenAwake === 'function') ? taskStore.getKeepScreenAwake() : true;
    toggleKeepScreenAwake.addEventListener('change', () => {
      const enabled = toggleKeepScreenAwake.checked;
      taskStore.setKeepScreenAwake(enabled);
      if (enabled) {
        mobileServices.enableWakeLock();
      } else {
        const isRunning = runtime && runtime.status === TimerStatus.RUNNING;
        if (!isRunning) {
          mobileServices.forceReleaseWakeLock();
        }
      }
      mobileServices.hapticTap();
      showToastNotification(enabled ? 'Keep screen on enabled' : 'Keep screen on disabled');
    });
  }

  const toggleCompletionHaptics = document.getElementById('toggleCompletionHaptics');
  if (toggleCompletionHaptics) {
    toggleCompletionHaptics.checked = (typeof taskStore.getCompletionHapticsEnabled === 'function') ? taskStore.getCompletionHapticsEnabled() : true;
    toggleCompletionHaptics.addEventListener('change', () => {
      const enabled = toggleCompletionHaptics.checked;
      taskStore.setCompletionHapticsEnabled(enabled);
      if (enabled) {
        mobileServices.hapticTaskComplete();
      }
      showToastNotification(enabled ? 'Task completion vibration enabled' : 'Task completion vibration disabled');
    });
  }

  // Allow horizontal toggle switches (.toggle-switch) across Settings and Modals to be swiped
  // right when off to turn on, and swiped left when on to turn off, without interfering with vertical swipe-down
  (function setupSwipeableToggleSwitches() {
    let activeToggleLabel = null;
    let activeCheckbox = null;
    let startX = 0;
    let startY = 0;
    let didSwipeToggle = false;
    let verticalAborted = false;

    document.addEventListener('touchstart', (e) => {
      if (!e.touches || e.touches.length !== 1) return;
      const label = e.target && e.target.closest ? e.target.closest('.toggle-switch') : null;
      if (!label) {
        activeToggleLabel = null;
        activeCheckbox = null;
        return;
      }
      const cb = label.querySelector('input[type="checkbox"]');
      if (!cb || cb.disabled) {
        activeToggleLabel = null;
        activeCheckbox = null;
        return;
      }
      activeToggleLabel = label;
      activeCheckbox = cb;
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      didSwipeToggle = false;
      verticalAborted = false;
    }, { passive: true });

    document.addEventListener('touchmove', (e) => {
      if (!activeToggleLabel || !activeCheckbox || verticalAborted) return;
      if (!e.touches || e.touches.length !== 1) return;
      const dx = e.touches[0].clientX - startX;
      const dy = e.touches[0].clientY - startY;

      // If vertical movement dominates, let vertical swipe-down / scroll handle it
      if (Math.abs(dy) > 10 && Math.abs(dy) >= Math.abs(dx)) {
        verticalAborted = true;
        return;
      }

      if (Math.abs(dx) >= 12 && Math.abs(dx) > Math.abs(dy) * 1.25) {
        if (e.cancelable) e.preventDefault();
        didSwipeToggle = true;
        if (dx >= 12 && !activeCheckbox.checked) {
          activeCheckbox.checked = true;
          activeCheckbox.dispatchEvent(new Event('change', { bubbles: true }));
        } else if (dx <= -12 && activeCheckbox.checked) {
          activeCheckbox.checked = false;
          activeCheckbox.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }
    }, { passive: false });

    const onEnd = () => {
      if (didSwipeToggle && activeToggleLabel) {
        const targetLabel = activeToggleLabel;
        const suppressSyntheticClick = (clickEv) => {
          if (targetLabel.contains(clickEv.target)) {
            clickEv.preventDefault();
            clickEv.stopPropagation();
          }
          window.removeEventListener('click', suppressSyntheticClick, true);
        };
        window.addEventListener('click', suppressSyntheticClick, true);
        setTimeout(() => {
          window.removeEventListener('click', suppressSyntheticClick, true);
        }, 350);
      }
      activeToggleLabel = null;
      activeCheckbox = null;
      didSwipeToggle = false;
      verticalAborted = false;
    };

    document.addEventListener('touchend', onEnd, { passive: true });
    document.addEventListener('touchcancel', onEnd, { passive: true });
  })();

  const alertVolumeSlider = document.getElementById('alertVolumeSlider');
  const alertVolumeLabel = document.getElementById('alertVolumeLabel');
  if (alertVolumeSlider) {
    const currentVol = taskStore.getAlertVolume();
    const pct = Math.round(currentVol * 100);
    alertVolumeSlider.value = pct;
    if (alertVolumeLabel) alertVolumeLabel.textContent = `${pct}%`;
    audioManager.setVolume(currentVol);

    alertVolumeSlider.addEventListener('input', () => {
      const val = parseInt(alertVolumeSlider.value, 10) || 0;
      if (alertVolumeLabel) alertVolumeLabel.textContent = `${val}%`;
      const normalized = val / 100;
      taskStore.setAlertVolume(normalized);
      audioManager.setVolume(normalized);
    });
    alertVolumeSlider.addEventListener('change', () => {
      audioManager.playRotaryTick();
    });
  }

  // Timer Settings Sub-Panel setup
  const settingRowTimer = document.getElementById('settingRowTimer');
  const timerSettingsSubPanel = document.getElementById('timerSettingsSubPanel');
  const btnBackTimerSettings = document.getElementById('btnBackTimerSettings');

  if (settingRowTimer && timerSettingsSubPanel) {
    settingRowTimer.addEventListener('click', () => {
      ensureHistoryBuffer();
      const p = document.getElementById('settingsMainPanel');
      if (p) p.classList.add('hidden');
      if (settingsMainGroup) settingsMainGroup.classList.add('hidden');
      if (settingsMainHeader) settingsMainHeader.classList.add('hidden');
      timerSettingsSubPanel.classList.remove('hidden');
      mobileServices.hapticTap();
    });
  }

  if (btnBackTimerSettings && timerSettingsSubPanel) {
    btnBackTimerSettings.addEventListener('click', () => {
      timerSettingsSubPanel.classList.add('hidden');
      const p = document.getElementById('settingsMainPanel');
      if (p) p.classList.remove('hidden');
      if (settingsMainGroup) settingsMainGroup.classList.remove('hidden');
      if (settingsMainHeader) settingsMainHeader.classList.remove('hidden');
      mobileServices.hapticTap();
    });
  }

  // Calendar Settings Sub-Panel setup
  const settingRowCalendar = document.getElementById('settingRowCalendar');
  const calendarSettingsSubPanel = document.getElementById('calendarSettingsSubPanel');
  const btnBackCalendarSettings = document.getElementById('btnBackCalendarSettings');
  const settingsModalCard = document.getElementById('settingsModal');
  const settingsMainGroup = settingsModalCard ? settingsModalCard.querySelector('.modal-body > .settings-group') : null;
  const settingsMainHeader = settingsModalCard ? settingsModalCard.querySelector('.modal-header') : null;

  const toggleCalRangeEnabled = document.getElementById('toggleCalRangeEnabled');
  const calStartTimeInput = document.getElementById('calStartTimeInput');
  const calEndTimeInput = document.getElementById('calEndTimeInput');

  const settingsGoogleStatus = document.getElementById('settingsGoogleStatus');
  const btnSettingsGoogleConnect = document.getElementById('btnSettingsGoogleConnect');
  const settingsMSStatus = document.getElementById('settingsMSStatus');
  const btnSettingsMSConnect = document.getElementById('btnSettingsMSConnect');
  const toggleAutoSyncEnabled = document.getElementById('toggleAutoSyncEnabled');
  const settingsLastSyncDesc = document.getElementById('settingsLastSyncDesc');
  const btnSettingsSyncAll = document.getElementById('btnSettingsSyncAll');

  function openCalendarSettingsSubPanel() {
    ensureHistoryBuffer();
    closeDrawer();
    closeCalendar();
    closeTodo();
    if (calendarView && typeof calendarView.close === 'function') calendarView.close();
    const navItemFullCal = document.getElementById('navItemFullCalendar');
    if (navItemFullCal) navItemFullCal.classList.remove('active');

    const settingsBackdrop = document.getElementById('settingsModalBackdrop');
    const settingsCard = document.getElementById('settingsModal');
    const settingsMain = document.getElementById('settingsMainPanel');
    const settingsGroup = settingsCard ? settingsCard.querySelector('.modal-body > .settings-group') : null;
    const settingsHeader = settingsCard ? settingsCard.querySelector('.modal-header') : null;
    const timerSub = document.getElementById('timerSettingsSubPanel');
    const calSub = document.getElementById('calendarSettingsSubPanel');

    if (settingsMain) settingsMain.classList.add('hidden');
    if (timerSub) timerSub.classList.add('hidden');
    if (settingsGroup) settingsGroup.classList.add('hidden');
    if (settingsHeader) settingsHeader.classList.add('hidden');
    if (calSub) calSub.classList.remove('hidden');
    if (settingsBackdrop) settingsBackdrop.classList.remove('hidden');

    syncCalendarSettingsUI();
    mobileServices.hapticTap();
  }
  window.openCalendarSettingsSubPanel = openCalendarSettingsSubPanel;

  async function renderMultiCalendarChecklist(provider) {
    const isGoogle = provider === 'google';
    const container = document.getElementById(isGoogle ? 'settingsGoogleCalendarsContainer' : 'settingsMSCalendarsContainer');
    const checklist = document.getElementById(isGoogle ? 'settingsGoogleCalChecklist' : 'settingsMSCalChecklist');
    const countBadge = document.getElementById(isGoogle ? 'settingsGoogleCalCount' : 'settingsMSCalCount');
    if (!container || !checklist) return;

    const isConnected = isGoogle
      ? ((typeof taskStore.getGoogleCalendarConnected === 'function') ? taskStore.getGoogleCalendarConnected() : false)
      : ((typeof taskStore.getMicrosoftCalendarConnected === 'function') ? taskStore.getMicrosoftCalendarConnected() : false);

    if (!isConnected) {
      container.classList.add('hidden');
      checklist.innerHTML = '';
      return;
    }

    container.classList.remove('hidden');

    try {
      const adapter = isGoogle ? googleCalendarAdapter : microsoftCalendarAdapter;
      const calendars = await adapter.fetchCalendarList();
      const storedSelected = isGoogle
        ? taskStore.getGoogleSelectedCalendarIds()
        : taskStore.getMicrosoftSelectedCalendarIds();

      const selectedSet = new Set((storedSelected && Array.isArray(storedSelected)) ? storedSelected : calendars.map(c => c.id));

      checklist.innerHTML = '';
      calendars.forEach(cal => {
        const item = document.createElement('label');
        item.className = 'cal-list-check-item';
        const isChecked = selectedSet.has(cal.id);
        const dotColor = cal.backgroundColor || cal.hexColor || (isGoogle ? '#4285F4' : '#0078d4');

        item.innerHTML = `
          <input type="checkbox" data-cal-id="${escapeHtml(cal.id)}" ${isChecked ? 'checked' : ''}>
          <span class="cal-list-color-dot" style="background:${dotColor}"></span>
          <span class="cal-list-item-name">${escapeHtml(cal.summary || cal.name || 'Calendar')}</span>
        `;

        const chk = item.querySelector('input');
        if (chk) {
          chk.addEventListener('change', () => {
            mobileServices.hapticTick();
            const checkedBoxes = Array.from(checklist.querySelectorAll('input:checked'));
            const newSelectedIds = checkedBoxes.map(b => b.getAttribute('data-cal-id'));
            if (isGoogle) {
              taskStore.setGoogleSelectedCalendarIds(newSelectedIds);
            } else {
              taskStore.setMicrosoftSelectedCalendarIds(newSelectedIds);
            }
            if (countBadge) {
              countBadge.textContent = newSelectedIds.length === calendars.length ? 'All' : `${newSelectedIds.length}/${calendars.length}`;
            }
            if (calendarView && typeof calendarView.render === 'function') calendarView.render();
            refreshAppScheduleFromStore();
            if (typeof calendarSyncService !== 'undefined' && typeof calendarSyncService.syncAll === 'function') {
              calendarSyncService.syncAll().then(() => {
                refreshAppScheduleFromStore();
                if (calendarView && typeof calendarView.render === 'function') calendarView.render();
              }).catch(() => {});
            }
          });
        }

        checklist.appendChild(item);
      });

      if (countBadge) {
        countBadge.textContent = selectedSet.size === calendars.length ? 'All' : `${selectedSet.size}/${calendars.length}`;
      }
    } catch (err) {
      console.warn('Could not load calendar list:', err);
    }
  }

  function syncCalendarSettingsUI() {
    if (toggleCalRangeEnabled) {
      toggleCalRangeEnabled.checked = taskStore.getCalendarCustomRangeEnabled();
    }
    if (calStartTimeInput) {
      calStartTimeInput.value = taskStore.getCalendarStartTime();
    }
    if (calEndTimeInput) {
      calEndTimeInput.value = taskStore.getCalendarEndTime();
    }

    // Google Calendar Settings State
    const isGoogleConnected = (typeof taskStore.getGoogleCalendarConnected === 'function')
      ? taskStore.getGoogleCalendarConnected()
      : false;
    if (settingsGoogleStatus) {
      if (isGoogleConnected) {
        const email = (typeof taskStore.getGoogleUserEmail === 'function') ? taskStore.getGoogleUserEmail() : null;
        settingsGoogleStatus.textContent = email ? ('Connected (' + email + ')') : 'Connected';
      } else {
        settingsGoogleStatus.textContent = 'Not connected';
      }
    }
    if (btnSettingsGoogleConnect) {
      if (isGoogleConnected) {
        btnSettingsGoogleConnect.textContent = 'Disconnect';
        btnSettingsGoogleConnect.classList.add('is-connected');
      } else {
        btnSettingsGoogleConnect.textContent = 'Connect';
        btnSettingsGoogleConnect.classList.remove('is-connected');
      }
    }

    // Microsoft Calendar Settings State
    const isMSConnected = (typeof taskStore.getMicrosoftCalendarConnected === 'function')
      ? taskStore.getMicrosoftCalendarConnected()
      : false;
    if (settingsMSStatus) {
      if (isMSConnected) {
        const email = (typeof taskStore.getMicrosoftUserEmail === 'function') ? taskStore.getMicrosoftUserEmail() : null;
        settingsMSStatus.textContent = email ? ('Connected (' + email + ')') : 'Connected';
      } else {
        settingsMSStatus.textContent = 'Not connected';
      }
    }
    if (btnSettingsMSConnect) {
      if (isMSConnected) {
        btnSettingsMSConnect.textContent = 'Disconnect';
        btnSettingsMSConnect.classList.add('is-connected');
      } else {
        btnSettingsMSConnect.textContent = 'Connect';
        btnSettingsMSConnect.classList.remove('is-connected');
      }
    }

    // Multi-calendar checklists
    renderMultiCalendarChecklist('google');
    renderMultiCalendarChecklist('microsoft');

    // Auto-Sync Toggle
    if (toggleAutoSyncEnabled && typeof taskStore.getAutoSyncEnabled === 'function') {
      toggleAutoSyncEnabled.checked = taskStore.getAutoSyncEnabled();
    }

    // Last Synced Timestamp
    if (settingsLastSyncDesc && typeof taskStore.getLastSyncTimestamp === 'function') {
      const lastSync = taskStore.getLastSyncTimestamp('all');
      if (lastSync && typeof lastSync === 'number' && lastSync > 0) {
        const d = new Date(lastSync);
        const timeStr = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        settingsLastSyncDesc.textContent = 'Last synced: ' + timeStr;
      } else {
        settingsLastSyncDesc.textContent = 'Last synced: Never';
      }
    }
  }
  window.syncCalendarSettingsUI = syncCalendarSettingsUI;

  if (settingRowCalendar && calendarSettingsSubPanel) {
    settingRowCalendar.addEventListener('click', () => {
      ensureHistoryBuffer();
      syncCalendarSettingsUI();
      const p = document.getElementById('settingsMainPanel');
      if (p) p.classList.add('hidden');
      if (settingsMainGroup) settingsMainGroup.classList.add('hidden');
      if (settingsMainHeader) settingsMainHeader.classList.add('hidden');
      calendarSettingsSubPanel.classList.remove('hidden');
      mobileServices.hapticTap();
    });
  }

  if (btnBackCalendarSettings && calendarSettingsSubPanel) {
    btnBackCalendarSettings.addEventListener('click', () => {
      calendarSettingsSubPanel.classList.add('hidden');
      const p = document.getElementById('settingsMainPanel');
      if (p) p.classList.remove('hidden');
      if (settingsMainGroup) settingsMainGroup.classList.remove('hidden');
      if (settingsMainHeader) settingsMainHeader.classList.remove('hidden');
      mobileServices.hapticTap();
    });
  }

  if (toggleCalRangeEnabled) {
    toggleCalRangeEnabled.addEventListener('change', () => {
      taskStore.setCalendarCustomRangeEnabled(toggleCalRangeEnabled.checked);
      mobileServices.hapticTap();
      showToastNotification(toggleCalRangeEnabled.checked ? 'Custom visible hours enabled' : 'Full 24-hour calendar view restored');
      if (calendarView) calendarView.render();
    });
  }

  if (calStartTimeInput) {
    calStartTimeInput.addEventListener('change', () => {
      if (calStartTimeInput.value && calStartTimeInput.value.length === 5) {
        taskStore.setCalendarStartTime(calStartTimeInput.value);
        if (calendarView) calendarView.render();
      }
    });
  }

  if (calEndTimeInput) {
    calEndTimeInput.addEventListener('change', () => {
      if (calEndTimeInput.value && calEndTimeInput.value.length === 5) {
        taskStore.setCalendarEndTime(calEndTimeInput.value);
        if (calendarView) calendarView.render();
      }
    });
  }

  bindClockPicker('btnCalStartTimeClock', 'calStartTimeNative', 'calStartTimeInput', () => {
    if (calStartTimeInput.value) {
      taskStore.setCalendarStartTime(calStartTimeInput.value);
      if (calendarView) calendarView.render();
    }
  });

  bindClockPicker('btnCalEndTimeClock', 'calEndTimeNative', 'calEndTimeInput', () => {
    if (calEndTimeInput.value) {
      taskStore.setCalendarEndTime(calEndTimeInput.value);
      if (calendarView) calendarView.render();
    }
  });

  // Google Settings Connect / Disconnect Action
  if (btnSettingsGoogleConnect) {
    btnSettingsGoogleConnect.addEventListener('click', async () => {
      mobileServices.hapticTap();
      const isConnected = taskStore.getGoogleCalendarConnected();
      if (isConnected) {
        await calendarSyncService.disconnectProvider('google');
        showToastNotification('Google Calendar disconnected');
        syncCalendarSettingsUI();
        refreshAppScheduleFromStore();
        if (calendarView) {
          calendarView.updateProviderToggleUI();
          calendarView.render();
        }
      } else {
        try {
          btnSettingsGoogleConnect.textContent = 'Connecting...';
          btnSettingsGoogleConnect.disabled = true;
          await calendarSyncService.connectProvider('google');
          btnSettingsGoogleConnect.disabled = false;
          syncCalendarSettingsUI();
          refreshAppScheduleFromStore();
          if (calendarView) {
            calendarView.updateProviderToggleUI();
            calendarView.openSyncConfirmModal('Google');
          }
          showToastNotification('Google Calendar connected!');
          openCalendarSettingsSubPanel();
        } catch (err) {
          btnSettingsGoogleConnect.disabled = false;
          syncCalendarSettingsUI();
          showToastNotification('Failed to connect Google: ' + (err && err.message ? err.message : 'Error'));
        }
      }
    });
  }

  // Microsoft Settings Connect / Disconnect Action
  if (btnSettingsMSConnect) {
    btnSettingsMSConnect.addEventListener('click', async () => {
      mobileServices.hapticTap();
      const isConnected = taskStore.getMicrosoftCalendarConnected();
      if (isConnected) {
        await calendarSyncService.disconnectProvider('microsoft');
        showToastNotification('Microsoft Calendar disconnected');
        syncCalendarSettingsUI();
        refreshAppScheduleFromStore();
        if (calendarView) {
          calendarView.updateProviderToggleUI();
          calendarView.render();
        }
      } else {
        try {
          btnSettingsMSConnect.textContent = 'Connecting...';
          btnSettingsMSConnect.disabled = true;
          await calendarSyncService.connectProvider('microsoft');
          btnSettingsMSConnect.disabled = false;
          syncCalendarSettingsUI();
          refreshAppScheduleFromStore();
          if (calendarView) {
            calendarView.updateProviderToggleUI();
            calendarView.openSyncConfirmModal('Microsoft');
          }
          showToastNotification('Microsoft Calendar connected!');
          openCalendarSettingsSubPanel();
        } catch (err) {
          btnSettingsMSConnect.disabled = false;
          syncCalendarSettingsUI();
          showToastNotification('Failed to connect Microsoft: ' + (err && err.message ? err.message : 'Error'));
        }
      }
    });
  }

  // Auto-Sync Toggle Switch
  if (toggleAutoSyncEnabled) {
    toggleAutoSyncEnabled.addEventListener('change', () => {
      taskStore.setAutoSyncEnabled(toggleAutoSyncEnabled.checked);
      mobileServices.hapticTap();
      if (toggleAutoSyncEnabled.checked) {
        calendarSyncService.startAutoSync();
        showToastNotification('Background Auto-Sync enabled');
      } else {
        calendarSyncService.stopAutoSync();
        showToastNotification('Background Auto-Sync disabled');
      }
    });
  }

  // Settings Manual Sync Button
  if (btnSettingsSyncAll) {
    btnSettingsSyncAll.addEventListener('click', async () => {
      mobileServices.hapticTap();
      btnSettingsSyncAll.textContent = 'Syncing...';
      btnSettingsSyncAll.disabled = true;
      try {
        await calendarSyncService.syncAll(true);
        btnSettingsSyncAll.textContent = 'Sync Now';
        btnSettingsSyncAll.disabled = false;
        syncCalendarSettingsUI();
        refreshAppScheduleFromStore();
        showToastNotification('✓ Calendar sync complete');
      } catch (err) {
        btnSettingsSyncAll.textContent = 'Sync Now';
        btnSettingsSyncAll.disabled = false;
        showToastNotification('Sync error: ' + (err && err.message ? err.message : 'Failed'));
      }
    });
  }

  // Connect Modal Buttons (Google & Microsoft)
  const btnConnectGoogle = document.getElementById('btnConnectGoogle');
  if (btnConnectGoogle) {
    btnConnectGoogle.addEventListener('click', async () => {
      mobileServices.hapticTap();
      if (calendarView && typeof calendarView.closeConnectModal === 'function') {
        calendarView.closeConnectModal();
      }
      try {
        await calendarSyncService.connectProvider('google');
        syncCalendarSettingsUI();
        refreshAppScheduleFromStore();
        if (calendarView) {
          calendarView.updateProviderToggleUI();
          calendarView.openSyncConfirmModal('Google');
        }
        showToastNotification('Google Calendar connected!');
        openCalendarSettingsSubPanel();
      } catch (err) {
        showToastNotification('Failed to connect Google: ' + (err && err.message ? err.message : 'Error'));
      }
    });
  }

  const btnConnectMicrosoft = document.getElementById('btnConnectMicrosoft');
  if (btnConnectMicrosoft) {
    btnConnectMicrosoft.addEventListener('click', async () => {
      mobileServices.hapticTap();
      if (calendarView && typeof calendarView.closeConnectModal === 'function') {
        calendarView.closeConnectModal();
      }
      try {
        await calendarSyncService.connectProvider('microsoft');
        syncCalendarSettingsUI();
        refreshAppScheduleFromStore();
        if (calendarView) {
          calendarView.updateProviderToggleUI();
          calendarView.openSyncConfirmModal('Microsoft');
        }
        showToastNotification('Microsoft Calendar connected!');
        openCalendarSettingsSubPanel();
      } catch (err) {
        showToastNotification('Failed to connect Microsoft: ' + (err && err.message ? err.message : 'Error'));
      }
    });
  }

  // Sync Confirmation Modal Button
  const btnConfirmSyncNow = document.getElementById('btnConfirmSyncNow');
  if (btnConfirmSyncNow) {
    btnConfirmSyncNow.addEventListener('click', async () => {
      mobileServices.hapticCelebration();
      if (calendarView && typeof calendarView.closeSyncConfirmModal === 'function') {
        calendarView.closeSyncConfirmModal();
      }
      try {
        await calendarSyncService.syncAll(true);
        syncCalendarSettingsUI();
        refreshAppScheduleFromStore();
        showToastNotification('✓ Events synced successfully!');
      } catch (err) {
        showToastNotification('Sync error: ' + (err && err.message ? err.message : 'Failed'));
      }
    });
  }

  // Active Task Card tap to Add Task when idle
  if (activeTaskTitle) {
    activeTaskTitle.addEventListener('click', () => {
      if (!runtime.getActiveTask() || activeTaskTitle.textContent.trim() === 'Add Task') {
        openAddTaskModal('work');
      }
    });
  }

  // Toggle icon listeners for Piggy Bank and Padlock SVG indicators
  const addModalTimeBank = document.getElementById('addModalTimeBank');
  if (addModalTimeBank) addModalTimeBank.addEventListener('change', syncModalToggleIcons);
  const addModalIsLocked = document.getElementById('addModalIsLocked');
  if (addModalIsLocked) addModalIsLocked.addEventListener('change', syncModalToggleIcons);
  const editTaskTimeBank = document.getElementById('editTaskTimeBank');
  if (editTaskTimeBank) editTaskTimeBank.addEventListener('change', syncModalToggleIcons);
  const editTaskIsLocked = document.getElementById('editTaskIsLocked');
  if (editTaskIsLocked) editTaskIsLocked.addEventListener('change', syncModalToggleIcons);

  // Live Digital Clock ticker: dynamic time span before timer starts or when paused
  setInterval(() => {
    if (isDraggingOuterDial || isScrubbingGreenLine || pendingMinuteAdjustment !== 0) return;
    if (!runtime || !runtime.getActiveTask() || runtime.status === TimerStatus.IDLE || runtime.status === TimerStatus.PAUSED) {
      updateActiveTaskTimeSpanDynamic();
    }
  }, 1000);

  // Calendar modal buttons & swipe-down to minimise
  if (btnCloseCalendar) btnCloseCalendar.addEventListener('click', closeCalendar);
  if (calendarModalBackdrop) {
    calendarModalBackdrop.addEventListener('click', (e) => {
      if (e.target === calendarModalBackdrop) closeCalendar();
    });
  }
  setupCalendarModalPullToDismiss();
  setupScheduleHorizontalSwipeToggle(document.getElementById('taskDrawer'));
  setupScheduleHorizontalSwipeToggle(document.getElementById('calendarModal'));

  // Universal Pull-to-Dismiss on Add Task, Edit Task, To-Do, Settings, and Calendar Event Modals
  const elSettingsModal = document.getElementById('settingsModal');
  if (elSettingsModal) {
    setupModalPullToDismiss(elSettingsModal, closeSettings);
  }
  const elAddTaskModal = document.getElementById('addTaskModal');
  if (elAddTaskModal) {
    setupModalPullToDismiss(elAddTaskModal, closeAddTaskModal);
  }
  const elTaskEditModal = document.getElementById('taskEditModal');
  if (elTaskEditModal) {
    setupModalPullToDismiss(elTaskEditModal, closeTaskEditModal);
  }
  const elTodoModal = document.getElementById('todoModal');
  if (elTodoModal) {
    setupModalPullToDismiss(elTodoModal, closeTodo);
  }
  const elAddTodoModal = document.getElementById('addTodoModal');
  if (elAddTodoModal) {
    setupModalPullToDismiss(elAddTodoModal, () => {
      const addTodoModalBackdrop = document.getElementById('addTodoModalBackdrop');
      if (addTodoModalBackdrop) addTodoModalBackdrop.classList.add('hidden');
    });
  }
  const elInsightsModal = document.getElementById('insightsModal');
  if (elInsightsModal) {
    setupModalPullToDismiss(elInsightsModal, closeInsights);
  }
  const elCalEventModal = document.getElementById('calendarEventModal');
  if (elCalEventModal) {
    setupModalPullToDismiss(elCalEventModal, () => {
      if (typeof calendarView !== 'undefined' && calendarView && typeof calendarView.closeEventInspector === 'function') {
        calendarView.closeEventInspector();
      }
    });
  }

  const btnCalendarAddTask = document.getElementById('btnCalendarAddTask');
  const btnCalendarAddBreak = document.getElementById('btnCalendarAddBreak');
  const btnCalendarAddTodo = document.getElementById('btnCalendarAddTodo');
  const btnDrawerAddTask = document.getElementById('btnDrawerAddTask');
  const btnDrawerAddBreak = document.getElementById('btnDrawerAddBreak');
  const btnDrawerAddTodo = document.getElementById('btnDrawerAddTodo');

  // Select To-Do to Schedule Modal
  const selectTodoModalBackdrop = document.getElementById('selectTodoModalBackdrop');
  const btnCloseSelectTodoModal = document.getElementById('btnCloseSelectTodoModal');
  const btnSelectTodoOpenNew = document.getElementById('btnSelectTodoOpenNew');

  function openSelectTodoModal() {
    if (!selectTodoModalBackdrop) return;
    renderSelectTodoList();
    selectTodoModalBackdrop.classList.remove('hidden');
    mobileServices.hapticTap();
  }

  function closeSelectTodoModal() {
    if (selectTodoModalBackdrop) selectTodoModalBackdrop.classList.add('hidden');
  }

  function renderSelectTodoList() {
    const container = document.getElementById('selectTodoListContainer');
    const emptyState = document.getElementById('selectTodoEmptyState');
    if (!container) return;

    const todos = taskStore.getTodoTasks();
    if (!todos || todos.length === 0) {
      container.innerHTML = '';
      if (emptyState) emptyState.classList.remove('hidden');
      return;
    }

    if (emptyState) emptyState.classList.add('hidden');
    container.innerHTML = todos.map(todo => `
      <div class="select-todo-item ${todo.completed ? 'completed' : ''}" data-id="${todo.id}">
        <span class="select-todo-emoji">${todo.emoji || '📌'}</span>
        <span class="select-todo-title">${escapeHtml(todo.title)}</span>
        <svg class="select-todo-arrow" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="9 18 15 12 9 6"></polyline>
        </svg>
      </div>
    `).join('');

    container.querySelectorAll('.select-todo-item').forEach(el => {
      el.addEventListener('click', () => {
        const id = el.getAttribute('data-id');
        const todo = todos.find(t => t.id === id);
        if (!todo) return;
        closeSelectTodoModal();
        mobileServices.hapticTap();
        openAddTaskModal('work', {
          title: todo.title,
          emoji: todo.emoji || '📌'
        });
      });
    });
  }

  if (btnCalendarAddTodo) {
    btnCalendarAddTodo.addEventListener('click', () => {
      openSelectTodoModal();
    });
  }

  if (btnDrawerAddTodo) {
    btnDrawerAddTodo.addEventListener('click', () => {
      openSelectTodoModal();
    });
  }

  if (btnCloseSelectTodoModal) {
    btnCloseSelectTodoModal.addEventListener('click', closeSelectTodoModal);
  }

  if (selectTodoModalBackdrop) {
    selectTodoModalBackdrop.addEventListener('click', (e) => {
      if (e.target === selectTodoModalBackdrop) closeSelectTodoModal();
    });
  }

  if (btnSelectTodoOpenNew) {
    btnSelectTodoOpenNew.addEventListener('click', () => {
      closeSelectTodoModal();
      openTodo();
    });
  }

  if (btnCalendarAddTask) {
    btnCalendarAddTask.addEventListener('click', () => {
      openAddTaskModal('work');
    });
  }

  if (btnCalendarAddBreak) {
    btnCalendarAddBreak.addEventListener('click', () => {
      openAddTaskModal('break');
    });
  }

  if (btnDrawerAddTask) {
    btnDrawerAddTask.addEventListener('click', () => {
      openAddTaskModal('work');
    });
  }

  if (btnDrawerAddBreak) {
    btnDrawerAddBreak.addEventListener('click', () => {
      openAddTaskModal('break');
    });
  }

  // To-Do Modal Events
  const btnCloseTodo = document.getElementById('btnCloseTodo');
  const btnClearTodoTasks = document.getElementById('btnClearTodoTasks') || document.getElementById('btnClearCompletedTodo');
  const btnOpenAddTodoModal = document.getElementById('btnOpenAddTodoModal');
  const todoModalBackdrop = document.getElementById('todoModalBackdrop');

  const addTodoModalBackdrop = document.getElementById('addTodoModalBackdrop');
  const btnCloseAddTodoModal = document.getElementById('btnCloseAddTodoModal');
  const formAddTodoTask = document.getElementById('formAddTodoTask');
  const btnAddTodoEmoji = document.getElementById('btnAddTodoEmoji');
  const addTodoTitle = document.getElementById('addTodoTitle');

  const confirmDeleteTodoModalBackdrop = document.getElementById('confirmDeleteTodoModalBackdrop');
  const btnCancelDeleteTodo = document.getElementById('btnCancelDeleteTodo');
  const btnConfirmDeleteTodo = document.getElementById('btnConfirmDeleteTodo');

  const confirmClearTodoModalBackdrop = document.getElementById('confirmClearTodoModalBackdrop');
  const btnCancelClearTodo = document.getElementById('btnCancelClearTodo');
  const btnConfirmClearTodo = document.getElementById('btnConfirmClearTodo');

  function openConfirmClearTodoModal() {
    if (confirmClearTodoModalBackdrop) confirmClearTodoModalBackdrop.classList.remove('hidden');
    mobileServices.hapticWarning();
  }

  function closeConfirmClearTodoModal() {
    if (confirmClearTodoModalBackdrop) confirmClearTodoModalBackdrop.classList.add('hidden');
  }

  if (btnCloseTodo) btnCloseTodo.addEventListener('click', closeTodo);
  if (todoModalBackdrop) {
    todoModalBackdrop.addEventListener('click', (e) => {
      if (e.target === todoModalBackdrop) closeTodo();
    });
    todoModalBackdrop.addEventListener('touchstart', (e) => {
      if (e.target === todoModalBackdrop) closeTodo();
    }, { passive: true });
  }

  if (btnClearTodoTasks) {
    btnClearTodoTasks.addEventListener('click', (e) => {
      e.stopPropagation();
      openConfirmClearTodoModal();
    });
  }

  if (btnCancelClearTodo) {
    btnCancelClearTodo.addEventListener('click', closeConfirmClearTodoModal);
  }

  if (confirmClearTodoModalBackdrop) {
    confirmClearTodoModalBackdrop.addEventListener('click', (e) => {
      if (e.target === confirmClearTodoModalBackdrop) closeConfirmClearTodoModal();
    });
  }

  if (btnConfirmClearTodo) {
    btnConfirmClearTodo.addEventListener('click', () => {
      closeConfirmClearTodoModal();
      taskStore.saveTodoTasks([]);
      renderTodoList();
      mobileServices.hapticBuzz();
      showToastNotification("✓ Cleared all To-Do tasks");
    });
  }

  let addTodoTitleDebounceTimer = null;
  if (addTodoTitle) {
    addTodoTitle.addEventListener('input', () => {
      if (addTodoTitleDebounceTimer) {
        clearTimeout(addTodoTitleDebounceTimer);
      }
      addTodoTitleDebounceTimer = setTimeout(() => {
        const text = (addTodoTitle ? addTodoTitle.value : '').trim();
        const emojiSpan = document.getElementById('addTodoHeaderEmoji');
        if (!text || text.length < 2) {
          if (!isTodoManualEmoji && text.length === 0) {
            currentTodoEmoji = '📌';
            if (emojiSpan) emojiSpan.textContent = '📌';
          }
          return;
        }
        if (!isTodoManualEmoji) {
          const cl = classifyEvent(text);
          if (cl && cl.emoji) {
            currentTodoEmoji = cl.emoji;
            if (emojiSpan) emojiSpan.textContent = cl.emoji;
          }
        }
      }, 150);
    });
  }

  if (btnOpenAddTodoModal) {
    btnOpenAddTodoModal.addEventListener('click', () => {
      isTodoManualEmoji = false;
      currentTodoEmoji = '📌';
      const emojiSpan = document.getElementById('addTodoHeaderEmoji');
      if (emojiSpan) emojiSpan.textContent = '📌';
      if (addTodoTitle) addTodoTitle.value = '';
      if (addTodoModalBackdrop) addTodoModalBackdrop.classList.remove('hidden');
      if (addTodoTitle) setTimeout(() => addTodoTitle.focus(), 80);
      mobileServices.hapticTap();
    });
  }

  if (btnCloseAddTodoModal) {
    btnCloseAddTodoModal.addEventListener('click', () => {
      if (addTodoModalBackdrop) addTodoModalBackdrop.classList.add('hidden');
    });
  }
  if (addTodoModalBackdrop) {
    addTodoModalBackdrop.addEventListener('click', (e) => {
      if (e.target === addTodoModalBackdrop) addTodoModalBackdrop.classList.add('hidden');
    });
  }

  if (btnAddTodoEmoji) {
    btnAddTodoEmoji.addEventListener('click', (e) => {
      e.preventDefault();
      openEmojiPicker('NEW_TODO');
    });
  }

  const btnAddTodoAdvanced = document.getElementById('btnAddTodoAdvanced');
  if (btnAddTodoAdvanced) {
    btnAddTodoAdvanced.addEventListener('click', (e) => {
      e.preventDefault();
      const title = addTodoTitle ? addTodoTitle.value.trim() : '';
      if (addTodoModalBackdrop) addTodoModalBackdrop.classList.add('hidden');
      if (typeof calendarView !== 'undefined' && calendarView && typeof calendarView.openEventInspector === 'function') {
        const fullCalBackdrop = document.getElementById('fullCalendarModalBackdrop');
        if (fullCalBackdrop && fullCalBackdrop.classList.contains('hidden')) {
          fullCalBackdrop.classList.remove('hidden');
        }
        calendarView.openEventInspector({
          title: title,
          emoji: currentTodoEmoji || '📌',
          plannedDuration: 30,
          addToTodo: true
        }, { isTodo: true });
      }
      mobileServices.hapticTap();
    });
  }

  if (formAddTodoTask) {
    formAddTodoTask.addEventListener('submit', (e) => {
      e.preventDefault();
      const title = addTodoTitle ? addTodoTitle.value.trim() : '';
      if (!title) return;
      taskStore.addTodoTask({
        title: title,
        emoji: currentTodoEmoji || '📌',
        completed: false
      });
      if (addTodoModalBackdrop) addTodoModalBackdrop.classList.add('hidden');
      if (addTodoTitle) addTodoTitle.value = '';
      renderTodoList();
      mobileServices.hapticTap();
      showToastNotification('✓ To-Do added');
    });
  }

  if (btnCancelDeleteTodo) btnCancelDeleteTodo.addEventListener('click', closeConfirmDeleteTodo);
  if (confirmDeleteTodoModalBackdrop) {
    confirmDeleteTodoModalBackdrop.addEventListener('click', (e) => {
      if (e.target === confirmDeleteTodoModalBackdrop) closeConfirmDeleteTodo();
    });
  }
  if (btnConfirmDeleteTodo) {
    btnConfirmDeleteTodo.addEventListener('click', () => {
      if (pendingDeleteTodoId) {
        taskStore.deleteTodoTask(pendingDeleteTodoId);
        renderTodoList();
        closeConfirmDeleteTodo();
        mobileServices.hapticTap();
        showToastNotification('🗑️ Task deleted');
      }
    });
  }

  const todoListContainer = document.getElementById('todoListContainer');
  if (todoListContainer) {
    setupInteractiveTodoDrag(todoListContainer);
  }

  // ==========================================
  // Browser PWA Installation & Guidance
  // ==========================================
  let deferredInstallPrompt = null;

  function isStandaloneApp() {
    return Boolean(
      (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ||
      (window.navigator && window.navigator.standalone === true) ||
      (document.referrer && document.referrer.indexOf('android-app://') !== -1)
    );
  }

  function updateInstallUI() {
    const isInstalled = isStandaloneApp();
    const navLabel = document.getElementById('navInstallLabel');
    const navItem = document.getElementById('navItemInstall');
    const btnSettingInstall = document.getElementById('btnSettingInstall');
    const settingInstallDesc = document.getElementById('settingInstallDesc');

    if (isInstalled) {
      if (navLabel) navLabel.textContent = '✓ Installed';
      if (navItem) navItem.title = 'Calentimer is running as an installed app';
      if (btnSettingInstall) {
        btnSettingInstall.textContent = 'Installed';
        btnSettingInstall.classList.add('is-installed');
      }
      if (settingInstallDesc) {
        settingInstallDesc.textContent = 'Calentimer is running in standalone app mode.';
      }
    } else {
      if (navLabel) navLabel.textContent = 'Install App';
      if (navItem) navItem.title = 'Install Calentimer as App';
      if (btnSettingInstall) {
        btnSettingInstall.textContent = 'Install';
        btnSettingInstall.classList.remove('is-installed');
      }
      if (settingInstallDesc) {
        settingInstallDesc.textContent = 'Install on your phone or desktop for full-screen focus and offline use.';
      }
    }
  }

  function openInstallModal() {
    const modal = document.getElementById('installAppModalBackdrop');
    const container = document.getElementById('installInstructionsContainer');
    const btnTrigger = document.getElementById('btnTriggerBrowserInstall');
    if (!modal || !container || !btnTrigger) return;

    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;

    if (isIOS) {
      container.innerHTML = `
        <div class="install-step">
          <span class="install-step-badge">1</span>
          <span class="install-step-text">Tap the <strong>Share</strong> button <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" style="vertical-align:-2px"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg> in Safari's bottom toolbar.</span>
        </div>
        <div class="install-step">
          <span class="install-step-badge">2</span>
          <span class="install-step-text">Scroll down the menu and tap <strong>Add to Home Screen</strong> ➕.</span>
        </div>
        <div class="install-step">
          <span class="install-step-badge">3</span>
          <span class="install-step-text">Tap <strong>Add</strong> in the top-right corner to install.</span>
        </div>
      `;
      btnTrigger.textContent = 'Got It';
      btnTrigger.onclick = closeInstallModal;
    } else if (deferredInstallPrompt) {
      container.innerHTML = `
        <div class="install-step">
          <span class="install-step-badge">1</span>
          <span class="install-step-text">Tap <strong>Install App</strong> below to launch the browser installer.</span>
        </div>
        <div class="install-step">
          <span class="install-step-badge">2</span>
          <span class="install-step-text">Confirm when prompted to install <strong>Calentimer</strong> on your home screen or desktop.</span>
        </div>
      `;
      btnTrigger.textContent = 'Install App';
      btnTrigger.onclick = () => {
        closeInstallModal();
        if (deferredInstallPrompt) {
          deferredInstallPrompt.prompt();
          deferredInstallPrompt.userChoice.then((choiceResult) => {
            if (choiceResult && choiceResult.outcome === 'accepted') {
              showToastNotification('✓ Installing Calentimer...');
            }
            deferredInstallPrompt = null;
          }).catch(() => {});
        }
      };
    } else {
      container.innerHTML = `
        <div class="install-step">
          <span class="install-step-badge">1</span>
          <span class="install-step-text">Click the <strong>Install</strong> icon ⊕ in the browser address bar (right side of calentimer.com).</span>
        </div>
        <div class="install-step">
          <span class="install-step-badge">2</span>
          <span class="install-step-text">Or open browser menu (<strong>⋮</strong>) and click <strong>Install Calentimer...</strong></span>
        </div>
      `;
      btnTrigger.textContent = 'Got It';
      btnTrigger.onclick = closeInstallModal;
    }

    ensureHistoryBuffer();
    modal.classList.remove('hidden');
    mobileServices.hapticTap();
  }

  function closeInstallModal() {
    const modal = document.getElementById('installAppModalBackdrop');
    if (modal) modal.classList.add('hidden');
  }

  function triggerAppInstall() {
    if (isStandaloneApp()) {
      showToastNotification('✓ Calentimer is already running as an installed app');
      return;
    }
    if (deferredInstallPrompt) {
      deferredInstallPrompt.prompt();
      deferredInstallPrompt.userChoice.then((choiceResult) => {
        if (choiceResult && choiceResult.outcome === 'accepted') {
          showToastNotification('✓ Installing Calentimer...');
        }
        deferredInstallPrompt = null;
      }).catch(() => {});
    } else {
      openInstallModal();
    }
  }

  function setupPWAInstallHandlers() {
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      deferredInstallPrompt = e;
      updateInstallUI();
    });

    window.addEventListener('appinstalled', () => {
      deferredInstallPrompt = null;
      updateInstallUI();
      showToastNotification('✓ Calentimer successfully installed!');
    });

    const navItemInstall = document.getElementById('navItemInstall');
    if (navItemInstall) {
      navItemInstall.addEventListener('click', () => {
        closeDrawer();
        triggerAppInstall();
      });
    }

    const settingRowInstall = document.getElementById('settingRowInstall');
    const btnSettingInstall = document.getElementById('btnSettingInstall');
    if (settingRowInstall) {
      settingRowInstall.addEventListener('click', (e) => {
        if (e.target === btnSettingInstall) return;
        triggerAppInstall();
      });
    }
    if (btnSettingInstall) {
      btnSettingInstall.addEventListener('click', (e) => {
        e.stopPropagation();
        triggerAppInstall();
      });
    }

    const btnCloseInstallModal = document.getElementById('btnCloseInstallModal');
    const installModalBackdrop = document.getElementById('installAppModalBackdrop');
    if (btnCloseInstallModal) {
      btnCloseInstallModal.addEventListener('click', closeInstallModal);
    }
    if (installModalBackdrop) {
      installModalBackdrop.addEventListener('click', (e) => {
        if (e.target === installModalBackdrop) closeInstallModal();
      });
    }

    updateInstallUI();
  }

  setupPWAInstallHandlers();

  // ==========================================
  // Simple Mode & Header Slider Controller
  // ==========================================
  function updateSliderDisplay(mode) {
    const isSimple = mode === 'simple';
    const modeSliderWrap = document.getElementById('modeSliderWrap');
    const modeSliderTrack = document.getElementById('modeSliderTrack');
    const modeSliderLabel = document.getElementById('modeSliderLabel');
    if (modeSliderWrap) modeSliderWrap.classList.toggle('is-simple', isSimple);
    if (modeSliderTrack) modeSliderTrack.classList.toggle('is-simple', isSimple);
    if (modeSliderLabel) {
      modeSliderLabel.textContent = 'Simple';
      modeSliderLabel.classList.toggle('is-simple', isSimple);
    }
  }
  window.updateSliderDisplay = updateSliderDisplay;

  let isModeSwitching = false;

  function switchAppMode(targetMode) {
    if (!runtime || isModeSwitching) return;
    isModeSwitching = true;

    const isSimple = targetMode === 'simple';

    // 1. Immediately animate toggle slider & trigger haptic tap with 0ms latency
    updateSliderDisplay(targetMode);
    mobileServices.hapticTap();
    if (document.body) {
      document.body.classList.toggle('simple-mode-active', isSimple);
    }

    // 2. Snapshot current mode's active timer session
    const currentMode = (typeof taskStore !== 'undefined' && typeof taskStore.getAppMode === 'function')
      ? taskStore.getAppMode()
      : 'advanced';
    const currentSession = (runtime && typeof runtime.exportSessionState === 'function')
      ? runtime.exportSessionState()
      : null;
    if (currentMode === 'simple') {
      if (typeof taskStore.saveSimpleTimerSession === 'function') {
        taskStore.saveSimpleTimerSession(currentSession);
      }
    } else {
      if (typeof taskStore.saveAdvancedTimerSession === 'function') {
        taskStore.saveAdvancedTimerSession(currentSession);
      }
    }

    // 3. Stop running wheel animation and alarms for outgoing mode
    stopContinuousWheelAnimation();

    // 4. Update store mode silently so taskStore.onChange doesn't trigger redundant duplicate re-renders
    if (typeof taskStore.setAppMode === 'function') {
      taskStore.setAppMode(targetMode, true);
    }

    // 5. Update runtime mode-specific configurations
    if (isSimple) {
      const loopEnabled = (typeof taskStore.getSimpleLoopEnabled === 'function')
        ? taskStore.getSimpleLoopEnabled()
        : true;
      runtime.setLoopEnabled(loopEnabled);
      runtime.setHardStopEnabled(false);
      updateHardStopPillsUI(false);
    } else {
      runtime.setLoopEnabled(false);
      const advHardStop = (typeof taskStore.getHardStopEnabled === 'function')
        ? taskStore.getHardStopEnabled()
        : true;
      runtime.setHardStopEnabled(advHardStop);
      updateHardStopPillsUI(advHardStop);
    }

    // 6. Reset runtime and load new mode's tasks
    const newTasks = taskStore.getTasks();
    runtime.initialTasks = newTasks;
    runtime.reset();

    // 7. Check if target mode has a saved active session to restore
    const savedTargetSession = (typeof taskStore.getTimerSession === 'function')
      ? taskStore.getTimerSession()
      : null;
    let restored = false;
    if (savedTargetSession) {
      restored = runtime.restoreSessionState(savedTargetSession);
    }

    // 8. Recalculate schedule & refresh active timer screen UI elements immediately
    runtime.recalculate();
    syncDynamicScheduleTimesToCalendar();
    updateScheduleUI(runtime.currentSchedule);
    updateActiveTaskDisplay();
    updateTotalMinutesDisplay();
    updateResetButtonUI();
    if (typeof updateTimespansButtonUI === 'function') updateTimespansButtonUI();

    const activeTask = runtime.getActiveTask();
    const durSec = (restored && (runtime.status === TimerStatus.RUNNING || runtime.status === TimerStatus.PAUSED))
      ? runtime.getRemainingSeconds()
      : (((activeTask ? (activeTask.allocatedDuration || activeTask.plannedDuration) : 0) || 25) * 60);

    renderClockTime(durSec);
    const progress = (restored && (runtime.status === TimerStatus.RUNNING || runtime.status === TimerStatus.PAUSED))
      ? runtime.getProgress()
      : 0;
    updateWheelProgress(progress);
    updateFinishEarlyButtonText(durSec);

    if (restored && runtime.status === TimerStatus.RUNNING) {
      iconPlay.classList.add('hidden');
      iconPause.classList.remove('hidden');
      startContinuousWheelAnimation();
    } else {
      iconPlay.classList.remove('hidden');
      iconPause.classList.add('hidden');
      stopContinuousWheelAnimation();
    }

    if (typeof updateSimpleLoopUI === 'function') updateSimpleLoopUI();

    // 9. Optimize secondary modal & drawer DOM rendering:
    // Only rebuild DOM synchronously if the view is currently visible on screen.
    // When hidden, defer via requestAnimationFrame so the main thread never hitches.
    const isDrawerOpen = Boolean(taskDrawer && !taskDrawer.classList.contains('collapsed'));
    const isCalModalOpen = Boolean(calendarModalBackdrop && !calendarModalBackdrop.classList.contains('hidden'));

    if (isDrawerOpen) {
      renderTaskList(((runtime.currentSchedule && runtime.currentSchedule.tasks) || []) || newTasks);
    }
    if (isCalModalOpen) {
      renderCalendarModal();
    }

    if (!isDrawerOpen || !isCalModalOpen) {
      const scheduleTasks = ((runtime.currentSchedule && runtime.currentSchedule.tasks) || []) || newTasks;
      if (typeof window.requestAnimationFrame === 'function') {
        window.requestAnimationFrame(() => {
          if (!runtime) return;
          if (!isDrawerOpen) renderTaskList(scheduleTasks);
          if (!isCalModalOpen) renderCalendarModal();
        });
      } else {
        setTimeout(() => {
          if (!runtime) return;
          if (!isDrawerOpen) renderTaskList(scheduleTasks);
          if (!isCalModalOpen) renderCalendarModal();
        }, 0);
      }
    }

    if (calendarView && typeof calendarView.render === 'function' && calendarView.isOpen && calendarView.isOpen()) {
      calendarView.render();
    }

    // 10. Defer background cloud profile sync and display toast
    showToastNotification(isSimple ? '⚡ Switched to Simple Mode' : '⏱️ Switched to Standard Mode');

    if (typeof calendarSyncService !== 'undefined' && calendarSyncService && typeof calendarSyncService.saveCloudProfile === 'function') {
      setTimeout(() => {
        try {
          calendarSyncService.saveCloudProfile().catch(() => {});
        } catch (_) {}
      }, 500);
    }

    setTimeout(() => {
      isModeSwitching = false;
    }, 250);
  }
  window.switchAppMode = switchAppMode;

  function setupSimpleModeAndSlider() {
    const modeSliderWrap = document.getElementById('modeSliderWrap');

    const confirmModeSwitchModalBackdrop = document.getElementById('confirmModeSwitchModalBackdrop');
    const confirmModeSwitchIcon = document.getElementById('confirmModeSwitchIcon');
    const confirmModeSwitchTitle = document.getElementById('confirmModeSwitchTitle');
    const confirmModeSwitchDesc = document.getElementById('confirmModeSwitchDesc');
    const btnCancelModeSwitch = document.getElementById('btnCancelModeSwitch');
    const btnConfirmModeSwitch = document.getElementById('btnConfirmModeSwitch');

    const simpleModeModalBackdrop = document.getElementById('simpleModeModalBackdrop');
    const btnCloseSimpleModeModal = document.getElementById('btnCloseSimpleModeModal');
    const btnStartSimpleMode = document.getElementById('btnStartSimpleMode');
    const simplePresetsGrid = document.getElementById('simplePresetsGrid');
    const simpleCustomParams = document.getElementById('simpleCustomParams');
    const toggleSimpleLoop = document.getElementById('toggleSimpleLoop');

    let pendingTargetMode = null;
    let selectedPresetKey = (typeof taskStore.getSimplePreset === 'function')
      ? taskStore.getSimplePreset()
      : 'pomodoro';

    function promptModeSwitch(targetMode) {
      pendingTargetMode = targetMode;
      const isTargetSimple = targetMode === 'simple';
      const isRunning = runtime && runtime.status === TimerStatus.RUNNING;

      if (confirmModeSwitchIcon) {
        confirmModeSwitchIcon.textContent = isTargetSimple ? '⚡' : '🚀';
      }
      if (confirmModeSwitchTitle) {
        confirmModeSwitchTitle.textContent = isTargetSimple ? 'Switch to Simple Mode?' : 'Switch to Standard Mode?';
      }
      if (confirmModeSwitchDesc) {
        if (isRunning) {
          confirmModeSwitchDesc.textContent = isTargetSimple
            ? 'Your active timer will pause and be preserved for Standard Mode. Switch to Simple focus mode?'
            : 'Your active timer will pause and be preserved for Simple Mode. Switch to Standard Mode?';
        } else {
          confirmModeSwitchDesc.textContent = isTargetSimple
            ? 'Switch to Simple Mode? Your schedule, calendar events, and settings will remain safely saved in Standard Mode.'
            : 'Switch back to Standard Mode? Your full daily schedule and calendar settings will be restored.';
        }
      }

      ensureHistoryBuffer();
      if (confirmModeSwitchModalBackdrop) {
        confirmModeSwitchModalBackdrop.classList.remove('hidden');
      }
      mobileServices.hapticTap();
    }

    function openSimplePresetsModal() {
      ensureHistoryBuffer();
      selectedPresetKey = (typeof taskStore.getSimplePreset === 'function')
        ? taskStore.getSimplePreset()
        : 'pomodoro';

      if (simplePresetsGrid) {
        const cards = simplePresetsGrid.querySelectorAll('.simple-preset-card');
        cards.forEach(c => {
          const key = c.getAttribute('data-preset');
          c.classList.toggle('active', key === selectedPresetKey);
        });
      }
      if (simpleCustomParams) {
        simpleCustomParams.classList.toggle('hidden', selectedPresetKey !== 'custom');
        const customCfg = (typeof taskStore.getSimpleCustomConfig === 'function')
          ? taskStore.getSimpleCustomConfig()
          : { focusMinutes: 30, restMinutes: 5, cycles: 3 };
        const inFocus = document.getElementById('simpleCustomFocusMin');
        const inRest = document.getElementById('simpleCustomRestMin');
        const inCycles = document.getElementById('simpleCustomCycles');
        if (inFocus) inFocus.value = customCfg.focusMinutes;
        if (inRest) inRest.value = customCfg.restMinutes;
        if (inCycles) inCycles.value = customCfg.cycles;
      }
      if (toggleSimpleLoop && typeof taskStore.getSimpleLoopEnabled === 'function') {
        toggleSimpleLoop.checked = taskStore.getSimpleLoopEnabled();
      }
      if (simpleModeModalBackdrop) {
        simpleModeModalBackdrop.classList.remove('hidden');
      }
      mobileServices.hapticTap();
    }

    function closeSimplePresetsModal() {
      if (simpleModeModalBackdrop) {
        simpleModeModalBackdrop.classList.add('hidden');
      }
    }

    function closeConfirmModeSwitchModal() {
      if (confirmModeSwitchModalBackdrop) {
        confirmModeSwitchModalBackdrop.classList.add('hidden');
      }
      pendingTargetMode = null;
    }

    // Preset Card Clicks
    if (simplePresetsGrid) {
      const cards = simplePresetsGrid.querySelectorAll('.simple-preset-card');
      cards.forEach(card => {
        card.addEventListener('click', () => {
          cards.forEach(c => c.classList.remove('active'));
          card.classList.add('active');
          selectedPresetKey = card.getAttribute('data-preset');
          if (simpleCustomParams) {
            simpleCustomParams.classList.toggle('hidden', selectedPresetKey !== 'custom');
          }
          mobileServices.hapticTap();
        });
      });
    }

    // Start Simple Mode / Apply Preset Button
    if (btnStartSimpleMode) {
      btnStartSimpleMode.addEventListener('click', () => {
        const loopVal = toggleSimpleLoop ? Boolean(toggleSimpleLoop.checked) : true;
        if (typeof taskStore.setSimpleLoopEnabled === 'function') {
          taskStore.setSimpleLoopEnabled(loopVal);
        }
        if (typeof taskStore.setSimplePreset === 'function') {
          taskStore.setSimplePreset(selectedPresetKey);
        }

        let customCfg = null;
        if (selectedPresetKey === 'custom') {
          const inFocus = document.getElementById('simpleCustomFocusMin');
          const inRest = document.getElementById('simpleCustomRestMin');
          const inCycles = document.getElementById('simpleCustomCycles');
          customCfg = {
            focusMinutes: inFocus ? Math.max(1, parseInt(inFocus.value, 10) || 30) : 30,
            restMinutes: inRest ? Math.max(0, parseInt(inRest.value, 10) || 5) : 5,
            cycles: inCycles ? Math.max(1, Math.min(24, parseInt(inCycles.value, 10) || 3)) : 3
          };
          if (typeof taskStore.setSimpleCustomConfig === 'function') {
            taskStore.setSimpleCustomConfig(customCfg);
          }
        }

        const todayStr = (typeof taskStore.getTodayDateString === 'function')
          ? taskStore.getTodayDateString()
          : new Date().toISOString().split('T')[0];

        // 1. Check existing Simple Mode tasks and calendar events for completed items
        const existingSimpleTasks = (typeof taskStore.getSimpleTasks === 'function')
          ? taskStore.getSimpleTasks()
          : [];
        const completedTasks = existingSimpleTasks.filter(t => Boolean(t.isCompleted));

        const allCalEvents = (typeof taskStore.getCalendarEvents === 'function')
          ? taskStore.getCalendarEvents()
          : [];
        const todayCalEvents = allCalEvents.filter(e => e.date === todayStr);
        const otherCalEvents = allCalEvents.filter(e => e.date !== todayStr);

        // Find base start time for new tasks:
        // After the last completed task's end time, or current time (whichever is later)
        const now = new Date();
        const nowMin = (now.getHours() * 60) + now.getMinutes();
        let baseStartMin = nowMin;

        if (completedTasks.length > 0) {
          let latestEndMin = 0;
          completedTasks.forEach(ct => {
            const endStr = ct.endTime;
            if (endStr) {
              const parts = endStr.split(':');
              const em = (parseInt(parts[0], 10) || 0) * 60 + (parseInt(parts[1], 10) || 0);
              if (em > latestEndMin) latestEndMin = em;
            }
          });
          if (latestEndMin > 0) {
            baseStartMin = Math.max(latestEndMin, nowMin);
          }
        }

        // 2. Generate new preset tasks starting from baseStartMin
        const generated = (typeof taskStore.generatePresetTasks === 'function')
          ? taskStore.generatePresetTasks(selectedPresetKey, customCfg, baseStartMin)
          : [];

        // 3. Final task list for Simple Mode: completed tasks remain, followed by new preset tasks
        const finalTasks = completedTasks.concat(generated);
        if (typeof taskStore.saveSimpleTasks === 'function') {
          taskStore.saveSimpleTasks(finalTasks);
        }
        if (typeof taskStore.setSimpleConfigured === 'function') {
          taskStore.setSimpleConfigured(true);
        }

        // 4. Update Calendar Events for Today:
        // - Retain all completed events for today (user requirement: completed tasks stay on calendar)
        // - Retain external or non-simple events
        // - Remove uncompleted simple events
        // - Add new generated simple preset tasks to calendar
        const unfinishedSimpleIds = new Set(existingSimpleTasks.filter(t => !t.isCompleted).map(t => t.id));
        const retainedTodayEvents = todayCalEvents.filter(e => {
          if (e.isCompleted) return true;
          if (unfinishedSimpleIds.has(e.id)) return false;
          if (e.id && String(e.id).indexOf('simple-') === 0) return false;
          return true;
        });

        const newEventsForCalendar = generated.map(t => ({
          id: t.id,
          title: t.title || 'Focus',
          date: todayStr,
          startTime: t.startTime || '09:00',
          endTime: t.endTime || '09:25',
          plannedDuration: t.plannedDuration || 25,
          isLocked: false,
          isCompleted: false,
          completedDate: null,
          manualCompleted: null,
          useTimeBank: false,
          emoji: t.emoji || (t.category === 'Rest' ? '☕' : '🎯'),
          category: t.category || 'Focus',
          color: t.color || (typeof classifierGetCategoryColor === 'function' ? classifierGetCategoryColor(t.category) : (t.category === 'Rest' ? '#f59e0b' : '#3b82f6')),
          colorId: t.colorId || null,
          source: 'local',
          origin: 'local',
          createdInApp: true,
          provider: 'local',
          lastModified: Date.now()
        }));

        const finalCalEvents = otherCalEvents.concat(retainedTodayEvents).concat(newEventsForCalendar);
        if (typeof taskStore.saveCalendarEvents === 'function') {
          taskStore.saveCalendarEvents(finalCalEvents);
        }

        closeSimplePresetsModal();

        const curMode = (typeof taskStore.getAppMode === 'function') ? taskStore.getAppMode() : 'advanced';
        if (curMode === 'simple') {
          if (runtime) {
            runtime.initialTasks = finalTasks;
            runtime.reset();
            runtime.activeTaskIndex = completedTasks.length;
            runtime.setLoopEnabled(loopVal);
            runtime.recalculate();
            syncDynamicScheduleTimesToCalendar();
            updateActiveTaskDisplay();
            renderTaskList(((runtime.currentSchedule && runtime.currentSchedule.tasks) || []) || finalTasks);
            renderCalendarModal();
            updateScheduleUI(runtime.currentSchedule);
            renderClockTime(runtime.getRemainingSeconds());
            updateWheelProgress(0);
            updateFinishEarlyButtonText(runtime.getRemainingSeconds());
            if (calendarView && typeof calendarView.render === 'function') {
              calendarView.render();
            }
          }
          mobileServices.hapticTap();
          showToastNotification('✓ Applied Simple Focus Preset');
        } else {
          switchAppMode('simple');
        }

        if (typeof calendarSyncService !== 'undefined' && calendarSyncService && typeof calendarSyncService.saveCloudProfile === 'function') {
          calendarSyncService.saveCloudProfile().catch(() => {});
        }
      });
    }

    if (btnCloseSimpleModeModal) {
      btnCloseSimpleModeModal.addEventListener('click', closeSimplePresetsModal);
    }
    if (simpleModeModalBackdrop) {
      simpleModeModalBackdrop.addEventListener('click', (e) => {
        if (e.target === simpleModeModalBackdrop) closeSimplePresetsModal();
      });
    }

    const simpleModalCard = document.getElementById('simpleModeModal');
    if (simpleModalCard && typeof setupModalPullToDismiss === 'function') {
      setupModalPullToDismiss(simpleModalCard, closeSimplePresetsModal);
    }

    // Confirm Modal Actions
    if (btnCancelModeSwitch) {
      btnCancelModeSwitch.addEventListener('click', closeConfirmModeSwitchModal);
    }
    if (confirmModeSwitchModalBackdrop) {
      confirmModeSwitchModalBackdrop.addEventListener('click', (e) => {
        if (e.target === confirmModeSwitchModalBackdrop) closeConfirmModeSwitchModal();
      });
    }
    if (btnConfirmModeSwitch) {
      btnConfirmModeSwitch.addEventListener('click', () => {
        const target = pendingTargetMode;
        closeConfirmModeSwitchModal();
        if (!target) return;

        const isConfigured = (typeof taskStore.getSimpleConfigured === 'function')
          ? taskStore.getSimpleConfigured()
          : false;

        if (target === 'simple' && !isConfigured) {
          openSimplePresetsModal();
        } else {
          switchAppMode(target);
        }
      });
    }

    function requestModeSwitch(targetMode) {
      const isRunning = runtime && runtime.status === TimerStatus.RUNNING;
      if (isRunning) {
        promptModeSwitch(targetMode);
      } else {
        const isConfigured = (typeof taskStore.getSimpleConfigured === 'function')
          ? taskStore.getSimpleConfigured()
          : false;
        if (targetMode === 'simple' && !isConfigured) {
          openSimplePresetsModal();
        } else {
          switchAppMode(targetMode);
        }
      }
    }

    // Slider Toggle Interactions (Tap or Swipe)
    if (modeSliderWrap) {
      let touchStartX = 0;
      let touchStartY = 0;
      let isSliderSwiping = false;
      let lastToggleTimestamp = 0;

      function triggerModeSliderSwitch() {
        const now = Date.now();
        if (now - lastToggleTimestamp < 350) return;
        lastToggleTimestamp = now;
        const currentMode = (typeof taskStore.getAppMode === 'function') ? taskStore.getAppMode() : 'advanced';
        const targetMode = currentMode === 'simple' ? 'advanced' : 'simple';
        requestModeSwitch(targetMode);
      }

      modeSliderWrap.addEventListener('touchstart', (e) => {
        if (!e.touches || e.touches.length !== 1) return;
        touchStartX = e.touches[0].clientX;
        touchStartY = e.touches[0].clientY;
        isSliderSwiping = false;
      }, { passive: true });

      modeSliderWrap.addEventListener('touchmove', (e) => {
        if (!e.touches || e.touches.length !== 1) return;
        const diffX = e.touches[0].clientX - touchStartX;
        const diffY = e.touches[0].clientY - touchStartY;
        if (Math.abs(diffX) > 12 && Math.abs(diffX) > Math.abs(diffY)) {
          isSliderSwiping = true;
        }
      }, { passive: true });

      modeSliderWrap.addEventListener('touchend', (e) => {
        if (isSliderSwiping) {
          triggerModeSliderSwitch();
          isSliderSwiping = false;
          if (e.cancelable) e.preventDefault();
        }
      });

      modeSliderWrap.addEventListener('click', (e) => {
        e.stopPropagation();
        triggerModeSliderSwitch();
      });

      modeSliderWrap.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          triggerModeSliderSwitch();
        }
      });
    }

    // Simple Mode Loop vs End segmented toggle in Today's Schedule & Calendar modal
    function updateSimpleLoopUI() {
      const isLoop = (typeof taskStore.getSimpleLoopEnabled === 'function')
        ? taskStore.getSimpleLoopEnabled()
        : true;
      const btnDrawerLoop = document.getElementById('btnDrawerLoopOption');
      const btnDrawerEnd = document.getElementById('btnDrawerEndOption');
      const btnCalLoop = document.getElementById('btnCalLoopOption');
      const btnCalEnd = document.getElementById('btnCalEndOption');

      if (btnDrawerLoop) btnDrawerLoop.classList.toggle('active', isLoop);
      if (btnDrawerEnd) btnDrawerEnd.classList.toggle('active', !isLoop);
      if (btnCalLoop) btnCalLoop.classList.toggle('active', isLoop);
      if (btnCalEnd) btnCalEnd.classList.toggle('active', !isLoop);
    }
    window.updateSimpleLoopUI = updateSimpleLoopUI;

    function setSimpleLoopOption(isLoop) {
      if (typeof taskStore.setSimpleLoopEnabled === 'function') {
        taskStore.setSimpleLoopEnabled(isLoop);
      }
      if (runtime && typeof runtime.setLoopEnabled === 'function') {
        runtime.setLoopEnabled(isLoop);
      }
      if (toggleSimpleLoop) {
        toggleSimpleLoop.checked = isLoop;
      }
      updateSimpleLoopUI();
      mobileServices.hapticTap();
      showToastNotification(isLoop ? '🔁 Schedule set to Loop' : '🏁 Schedule set to End at completion');
    }
    window.setSimpleLoopOption = setSimpleLoopOption;

    const btnDrawerLoop = document.getElementById('btnDrawerLoopOption');
    const btnDrawerEnd = document.getElementById('btnDrawerEndOption');
    const btnCalLoop = document.getElementById('btnCalLoopOption');
    const btnCalEnd = document.getElementById('btnCalEndOption');

    if (btnDrawerLoop) btnDrawerLoop.addEventListener('click', (e) => { e.stopPropagation(); setSimpleLoopOption(true); });
    if (btnDrawerEnd) btnDrawerEnd.addEventListener('click', (e) => { e.stopPropagation(); setSimpleLoopOption(false); });
    if (btnCalLoop) btnCalLoop.addEventListener('click', (e) => { e.stopPropagation(); setSimpleLoopOption(true); });
    if (btnCalEnd) btnCalEnd.addEventListener('click', (e) => { e.stopPropagation(); setSimpleLoopOption(false); });

    const attachLoopSegmentSwipe = (segmentEl) => {
      if (!segmentEl) return;
      let startX = 0;
      let startY = 0;
      let isSwiping = false;

      segmentEl.addEventListener('touchstart', (e) => {
        if (!e.touches || e.touches.length !== 1) return;
        startX = e.touches[0].clientX;
        startY = e.touches[0].clientY;
        isSwiping = false;
      }, { passive: true });

      segmentEl.addEventListener('touchmove', (e) => {
        if (!e.touches || e.touches.length !== 1) return;
        const dx = e.touches[0].clientX - startX;
        const dy = e.touches[0].clientY - startY;
        if (Math.abs(dx) > 15 && Math.abs(dx) > Math.abs(dy)) {
          isSwiping = true;
        }
      }, { passive: true });

      segmentEl.addEventListener('touchend', (e) => {
        if (!isSwiping) return;
        const touch = (e.changedTouches && e.changedTouches[0]) ? e.changedTouches[0] : null;
        if (!touch) return;
        const dx = touch.clientX - startX;
        if (dx > 20) {
          // Swipe right -> End
          setSimpleLoopOption(false);
          if (e.cancelable) e.preventDefault();
        } else if (dx < -20) {
          // Swipe left -> Loop
          setSimpleLoopOption(true);
          if (e.cancelable) e.preventDefault();
        }
        isSwiping = false;
      });
    };

    attachLoopSegmentSwipe(document.getElementById('drawerSimpleLoopSegment'));
    attachLoopSegmentSwipe(document.getElementById('calendarSimpleLoopSegment'));

    updateSimpleLoopUI();

    // Simple Mode Quick Action Footer Buttons in Task Drawer & Today's Schedule Modal
    const wireSimpleAction = (id, fn) => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('click', (e) => {
        e.stopPropagation();
        fn();
      });
    };

    wireSimpleAction('btnDrawerSimpleAddFocus', () => {
      openAddTaskModal('work', { title: 'Focus', category: 'Focus', emoji: '🎯' });
    });
    wireSimpleAction('btnCalendarSimpleAddFocus', () => {
      openAddTaskModal('work', { title: 'Focus', category: 'Focus', emoji: '🎯' });
    });
    wireSimpleAction('btnDrawerSimpleAddRest', () => {
      openAddTaskModal('break', { title: 'Rest', category: 'Rest', emoji: '☕' });
    });
    wireSimpleAction('btnCalendarSimpleAddRest', () => {
      openAddTaskModal('break', { title: 'Rest', category: 'Rest', emoji: '☕' });
    });
    wireSimpleAction('btnDrawerSimplePresets', openSimplePresetsModal);
    wireSimpleAction('btnCalendarSimplePresets', openSimplePresetsModal);

    window.openSimplePresetsModal = openSimplePresetsModal;
    window.setupSimpleModeAndSlider = setupSimpleModeAndSlider;
  }
  window.setupSimpleModeAndSlider = setupSimpleModeAndSlider;
  setupSimpleModeAndSlider();

  // ==========================================
  // Confirm Exit App Modal & Mobile Back Button
  // ==========================================
  const confirmExitAppModalBackdrop = document.getElementById('confirmExitAppModalBackdrop');
  const btnCancelExitApp = document.getElementById('btnCancelExitApp');
  const btnConfirmExitApp = document.getElementById('btnConfirmExitApp');

  function openConfirmExitAppModal() {
    if (confirmExitAppModalBackdrop) {
      confirmExitAppModalBackdrop.classList.remove('hidden');
      mobileServices.hapticWarning();
    }
  }

  function closeConfirmExitAppModal() {
    if (confirmExitAppModalBackdrop) {
      confirmExitAppModalBackdrop.classList.add('hidden');
    }
  }

  if (btnCancelExitApp) {
    btnCancelExitApp.addEventListener('click', () => {
      closeConfirmExitAppModal();
      mobileServices.hapticTap();
      ensureHistoryBuffer();
    });
  }

  if (confirmExitAppModalBackdrop) {
    confirmExitAppModalBackdrop.addEventListener('click', (e) => {
      if (e.target === confirmExitAppModalBackdrop) {
        closeConfirmExitAppModal();
        ensureHistoryBuffer();
      }
    });
  }

  if (btnConfirmExitApp) {
    btnConfirmExitApp.addEventListener('click', () => {
      closeConfirmExitAppModal();
      if (window.navigator && window.navigator.app && typeof window.navigator.app.exitApp === 'function') {
        window.navigator.app.exitApp();
      } else {
        try {
          window.close();
        } catch (_) {}
        try {
          window.history.back();
        } catch (_) {}
      }
    });
  }

  // Prime browser history entry on the first user interaction so Chrome recognizes user activation
  // (Prevents Chrome's History Manipulation Intervention from skipping history entries on back button)
  let isHistoryPrimed = false;
  function primeHistoryStack() {
    if (isHistoryPrimed) return;
    isHistoryPrimed = true;
    setTimeout(() => {
      try {
        if (window.history && typeof window.history.pushState === 'function') {
          window.history.replaceState({ appState: 'root' }, '');
          window.history.pushState({ appState: 'app' }, '');
        }
      } catch (_) {}
    }, 250);
  }

  window.addEventListener('pointerdown', primeHistoryStack, { capture: true, once: true });
  window.addEventListener('touchstart', primeHistoryStack, { capture: true, once: true });
  window.addEventListener('click', primeHistoryStack, { capture: true, once: true });

  try {
    if (window.history && typeof window.history.replaceState === 'function') {
      window.history.replaceState({ appState: 'root' }, '');
    }
  } catch (_) {}

  function handleMobileBackButton() {
    // 1. If Exit modal is open, dismiss it
    if (confirmExitAppModalBackdrop && !confirmExitAppModalBackdrop.classList.contains('hidden')) {
      closeConfirmExitAppModal();
      return;
    }

    // 2. Innermost Dialogs & Pickers (close the child modal first before closing any parent tab)
    const subModals = [
      'confirmModeSwitchModalBackdrop',
      'simpleModeModalBackdrop',
      'calendarConnectModalBackdrop',
      'confirmSyncNowModalBackdrop',
      'categoryColorPaletteModalBackdrop',
      'installAppModalBackdrop',
      'confirmDeleteTodoModalBackdrop',
      'confirmFishUnscheduleModalBackdrop',
      'confirmReelAllTasksModalBackdrop',
      'durationDialModalBackdrop',
      'emojiPickerModalBackdrop',
      'timeBankInfoModalBackdrop',
      'alertsModalBackdrop',
      'hardStopModalBackdrop',
      'selectTodoModalBackdrop',
      'calendarEventModalBackdrop',
      'addTodoModalBackdrop',
      'addTaskModalBackdrop',
      'taskEditModalBackdrop'
    ];

    for (let s = 0; s < subModals.length; s++) {
      const el = document.getElementById(subModals[s]);
      if (el && !el.classList.contains('hidden')) {
        const closeBtn = el.querySelector('.btn-close-modal, .btn-confirm-cancel, .btn-modal-cancel-danger, #btnCloseSimpleModeModal, #btnCancelModeSwitch, #btnCloseCalendarConnectModal, #btnSkipConnect, #btnDismissSyncNow, #btnCloseCalEventModal, #btnCloseTaskEdit, #btnCloseAddTaskModal, #btnCloseAddTodoModal');
        if (closeBtn) {
          closeBtn.click();
        } else {
          el.classList.add('hidden');
        }
        mobileServices.hapticTap();
        return;
      }
    }

    // 3. Settings Sub-Panels (Timer Settings & Calendar Settings -> go back to main Settings)
    const settingsModalBackdrop = document.getElementById('settingsModalBackdrop');
    if (settingsModalBackdrop && !settingsModalBackdrop.classList.contains('hidden')) {
      const timerSub = document.getElementById('timerSettingsSubPanel');
      const calSub = document.getElementById('calendarSettingsSubPanel');
      if (timerSub && !timerSub.classList.contains('hidden')) {
        const btnBackTimer = document.getElementById('btnBackTimerSettings');
        if (btnBackTimer) {
          btnBackTimer.click();
          return;
        }
      }
      if (calSub && !calSub.classList.contains('hidden')) {
        const btnBackCal = document.getElementById('btnBackCalendarSettings');
        if (btnBackCal) {
          btnBackCal.click();
          return;
        }
      }

      // If at main Settings level -> close Settings and go back to Timer screen
      closeSettings();
      mobileServices.hapticTap();
      return;
    }

    // 4. Calendar Tab (Full Calendar View) -> close calendar and return to Timer screen
    const fullCalendarModalBackdrop = document.getElementById('fullCalendarModalBackdrop');
    if (fullCalendarModalBackdrop && !fullCalendarModalBackdrop.classList.contains('hidden')) {
      if (calendarView && typeof calendarView.close === 'function') {
        calendarView.close();
      } else {
        fullCalendarModalBackdrop.classList.add('hidden');
      }
      mobileServices.hapticTap();
      return;
    }

    // 5. Today's Schedule Modal Tab -> close and return to Timer screen
    const calendarModalBackdrop = document.getElementById('calendarModalBackdrop');
    if (calendarModalBackdrop && !calendarModalBackdrop.classList.contains('hidden')) {
      closeCalendar();
      mobileServices.hapticTap();
      return;
    }

    // 6. To-Do Tab -> close and return to Timer screen
    const todoModalBackdrop = document.getElementById('todoModalBackdrop');
    if (todoModalBackdrop && !todoModalBackdrop.classList.contains('hidden')) {
      closeTodo();
      mobileServices.hapticTap();
      return;
    }

    // 6b. Insights Tab -> close and return to Timer screen
    const insightsModalBackdrop = document.getElementById('insightsModalBackdrop');
    if (insightsModalBackdrop && !insightsModalBackdrop.classList.contains('hidden')) {
      closeInsights();
      mobileServices.hapticTap();
      return;
    }

    // 7. Today's Tasks Bottom Drawer -> collapse and stay on Timer screen
    if (taskDrawer && !taskDrawer.classList.contains('collapsed')) {
      if (typeof closeTaskDrawer === 'function') {
        closeTaskDrawer();
      } else {
        taskDrawer.classList.add('collapsed');
        taskDrawer.classList.remove('will-minimise', 'will-open');
        taskDrawer.style.removeProperty('transform');
        if (taskDrawerBackdrop) taskDrawerBackdrop.classList.add('hidden');
      }
      mobileServices.hapticTap();
      return;
    }

    // 8. Navigation Drawer Menu -> close and stay on Timer screen
    if (navDrawer && navDrawer.classList.contains('open')) {
      closeDrawer();
      mobileServices.hapticTap();
      return;
    }

    // 9. Root Timer Screen: No active tabs or modals open.
    // Allow default browser back behavior without trapping.
  }

  window.handleMobileBackButton = handleMobileBackButton;
  window.openConfirmExitAppModal = openConfirmExitAppModal;
  window.closeConfirmExitAppModal = closeConfirmExitAppModal;

  window.addEventListener('popstate', handleMobileBackButton);
  document.addEventListener('backbutton', (e) => {
    if (e && typeof e.preventDefault === 'function') e.preventDefault();
    handleMobileBackButton();
  }, false);
}

// Track visibility changes and page lifecycle (app backgrounding, BFCache restore, blur)
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    resetTransientGestureState();
    if (document.visibilityState === 'hidden') {
      if (runtime && (runtime.status === TimerStatus.RUNNING || runtime.status === TimerStatus.PAUSED)) {
        analytics.recordSessionEvent('visibility_loss');
        analytics.trackInteraction('app_lifecycle', 'visibility_hidden_while_running');
        const activeTask = runtime.getActiveTask();
        if (activeTask) {
          const nextTask = ((runtime.currentSchedule && runtime.currentSchedule.tasks) || [])[runtime.activeTaskIndex + 1] || null;
          mobileServices.updateLiveNotification({
            activeTask: activeTask,
            remainingSeconds: runtime.getRemainingSeconds(),
            nextTask: nextTask,
            isPaused: runtime.status === TimerStatus.PAUSED
          });
        }
      }
    }
  });
}

if (typeof window !== 'undefined') {
  window.addEventListener('pageshow', () => {
    resetTransientGestureState();
  });
  window.addEventListener('pagehide', () => {
    resetTransientGestureState();
  });
  window.addEventListener('blur', () => {
    resetTransientGestureState();
  });
}

// Start application: immediately if DOM is already ready, or on DOMContentLoaded
if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}
