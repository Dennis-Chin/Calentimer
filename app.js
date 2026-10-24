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
let pendingMinuteAdjustment = 0;
let lastAudibleMinuteTick = 0;

// Today's Tasks Drawer Touch/Pull State (Global so nav menu gestures can inspect drawer interaction)
let isDrawerTouching = false;
let isDrawerPullingDown = false;
let isDrawerPullingUp = false;

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

function initApp() {
  try {
    const savedHardStop = taskStore.getHardStop();
    if (hardStopInput) hardStopInput.value = savedHardStop;
    if (calendarHardStopInput) calendarHardStopInput.value = savedHardStop;
    const todayFinishLineTime = document.getElementById('todayFinishLineTime');
    if (todayFinishLineTime) todayFinishLineTime.textContent = savedHardStop;

    const isHardStopEnabled = taskStore.getHardStopEnabled();

    const tasks = taskStore.getTasks();

    runtime = new TimerRuntime({
      hardStop: savedHardStop,
      tasks: tasks
    });
    runtime.setHardStopEnabled(isHardStopEnabled);
    updateHardStopPillsUI(isHardStopEnabled);

    initTheme();
    renderDialTicks();
    setupRuntimeEvents();
    setupControls();
    setupRotaryWheel();
    setupTaskPipeline();
    setupNavigationAndModals();
    calendarView.init();

    // Initial render: calculate schedule and populate all lists immediately
    runtime.recalculate();
    updateScheduleUI(runtime.currentSchedule);
    renderTaskList(((runtime.currentSchedule && runtime.currentSchedule.tasks) || []) || tasks);
    updateActiveTaskDisplay();
    updateResetButtonUI();
    updateNotifToggleUI();
    updateTimeBankDisplay();
    renderTodoList();
    const initActiveTask = runtime.getActiveTask();
    const initDurSec = ((initActiveTask ? initActiveTask.allocatedDuration : 0) || (initActiveTask ? initActiveTask.plannedDuration : 0) || 30) * 60;
    updateFinishEarlyButtonText(initDurSec);
    renderClockTime(initDurSec);
    updateWheelProgress(0);
  } catch (err) {
    console.error('Fatal initialization error in initApp:', err);
    showToastNotification('⚠️ Init Error: ' + err.message);
  }
}

function updateNotifToggleUI() {
  if (!btnNotifToggle || !notifStatusText) return;
  const isEnabled = taskStore.getAlertsEnabled();
  const hasPerm = mobileServices.hasNotificationPermission();
  const toggleAlerts = document.getElementById('toggleAlertsEnabled');
  if (toggleAlerts) toggleAlerts.checked = isEnabled;

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
  dialTicksGroup.innerHTML = '';
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
    line.setAttribute('class', `dial-tick ${isMajor ? 'major' : ''}`);
    dialTicksGroup.appendChild(line);
  }
}

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
    analytics.startTaskMetric(data && data.activeTask ? data.activeTask : runtime.getActiveTask(), { index: runtime.activeTaskIndex });
    startContinuousWheelAnimation();
    updateActiveTaskDisplay();
    updateFinishEarlyButtonText(data.totalDurationSeconds);
    renderTaskList(((runtime.currentSchedule && runtime.currentSchedule.tasks) || []) || []);
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
    updateActiveTaskDisplay();
    renderTaskList(((runtime.currentSchedule && runtime.currentSchedule.tasks) || []) || []);
  });

  runtime.on('allTasksCompleted', () => {
    stopContinuousWheelAnimation();
    mobileServices.disableWakeLock();
    mobileServices.clearLiveNotification();
    updateActiveTaskDisplay();
    updateResetButtonUI();
    renderTaskList(((runtime.currentSchedule && runtime.currentSchedule.tasks) || []) || []);
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

  if (!activeTask || (runtime && runtime.status === TimerStatus.COMPLETED)) {
    // Idle/No task state: Live digital clock start time, end time = now + 30m
    const d = new Date();
    const startMinutes = d.getHours() * 60 + d.getMinutes();
    const endMinutes = (startMinutes + 30) % 1440;
    const startStr = formatMinutesToTime(startMinutes);
    const endStr = formatMinutesToTime(endMinutes);
    activeTaskTimeSpan.textContent = `${startStr} → ${endStr}`;
    if (totalDurEl) totalDurEl.textContent = '(30m)';
    return;
  }

  const isIdle = !runtime || runtime.status === TimerStatus.IDLE || !runtime.taskStartedAt;

  let startMinutes;
  if (!isIdle && runtime.taskStartedAt) {
    const d = new Date(runtime.taskStartedAt);
    startMinutes = d.getHours() * 60 + d.getMinutes();
  } else if (activeTask.fixedStartTime && activeTask.startTime) {
    startMinutes = parseTimeToMinutes(activeTask.startTime);
  } else {
    // Before timer has started: dynamic live start time matching current clock!
    const d = new Date();
    startMinutes = d.getHours() * 60 + d.getMinutes();
  }

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

  let endMinutes;
  if (activeTask.fixedEndTime && activeTask.endTime) {
    endMinutes = parseTimeToMinutes(activeTask.endTime);
  } else {
    endMinutes = (startMinutes + totalMinutes) % 1440;
  }

  const startStr = formatMinutesToTime(startMinutes);
  const endStr = formatMinutesToTime(endMinutes);
  activeTaskTimeSpan.textContent = `${startStr} → ${endStr}`;
  if (totalDurEl) {
    totalDurEl.textContent = `(${totalMinutes}m)`;
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
  if (!activeTask || runtime.status === TimerStatus.COMPLETED) {
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
  const isBreak = (
    (activeTask.category && activeTask.category.toLowerCase() === 'break') ||
    (activeTask.title && activeTask.title.toLowerCase() === 'break')
  );

  if (wheelContainer) wheelContainer.classList.toggle('is-break-mode', Boolean(isBreak));
  document.body.classList.toggle('is-break-mode', Boolean(isBreak));

  activeCategoryChip.textContent = (activeTask.category || 'Focus').toUpperCase();
  activeTaskTitle.textContent = activeTask.title;
  updateActiveTaskTimeSpanDynamic();
  updateTimerQuickToggles();
}

function updateScheduleUI(schedule) {
  if (!schedule || !schedule.success) return;

  if (warningAlertCard) warningAlertCard.classList.add('hidden');

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
  let baseDialSeconds = 0;

  // -------------------------------------------------------------
  // Mode 1: Scrub Green Line Handle (Countdown reduction scrubber)
  // 360 degrees around center = timer counts down to 0!
  // Strictly used to reduce time. Dragging to a location leaves it in that position.
  // -------------------------------------------------------------
  function onScrubStart(e) {
    const activeTask = runtime ? runtime.getActiveTask() : null;
    if (activeTask && activeTask.isLocked) {
      if (e) {
        e.stopPropagation();
        if (e.preventDefault) e.preventDefault();
      }
      mobileServices.hapticWarning();
      showToastNotification('Task duration is locked. Tap the padlock on the timer to unlock and adjust time.');
      return;
    }

    e.stopPropagation();
    isScrubbingGreenLine = true;
    document.body.classList.add('is-scrubbing');

    scrubStartAngleRad = getAngleFromEvent(e);

    if (runtime.status === TimerStatus.RUNNING || runtime.status === TimerStatus.PAUSED) {
      activeTotalSec = runtime.taskDurationMs > 0
        ? Math.round(runtime.taskDurationMs / 1000)
        : (((activeTask ? activeTask.allocatedDuration : 0) || (activeTask ? activeTask.plannedDuration : 0) || 30) * 60);
      baseRemainingSecAtScrubStart = runtime.getRemainingSeconds();
    } else {
      activeTotalSec = ((activeTask ? activeTask.allocatedDuration : 0) || (activeTask ? activeTask.plannedDuration : 0) || 30) * 60;
      baseRemainingSecAtScrubStart = activeTotalSec;
    }

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
    if (!isScrubbingGreenLine) return;

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
    if (isScrubbingGreenLine) return;
    if (!rotaryConfirmPill.classList.contains('hidden')) return;

    const activeTask = runtime ? runtime.getActiveTask() : null;
    if (activeTask && activeTask.isLocked) {
      if (e) {
        e.stopPropagation();
        if (e.preventDefault) e.preventDefault();
      }
      mobileServices.hapticWarning();
      showToastNotification('Task duration is locked. Tap the padlock on the timer to unlock and adjust time.');
      return;
    }

    isDraggingOuterDial = true;
    document.body.classList.add('is-dragging-dial');
    dialStartAngleRad = getAngleFromEvent(e);
    accumulatedDialAngleDeltaDeg = 0;
    pendingMinuteAdjustment = 0;
    lastAudibleMinuteTick = 0;

    baseDialSeconds = runtime.status === TimerStatus.IDLE
      ? (((runtime && runtime.getActiveTask()) ? runtime.getActiveTask().allocatedDuration : 0) || 30) * 60
      : runtime.getRemainingSeconds();

    rotaryPreviewBadge.classList.remove('hidden');
    rotaryPreviewBadge.textContent = '+0m';
  }

  function handleDialMove(e) {
    if (!isDraggingOuterDial) return;

    const currentAngleRad = getAngleFromEvent(e);
    let diff = (currentAngleRad - dialStartAngleRad) * (180 / Math.PI);

    if (diff > 180) diff -= 360;
    if (diff < -180) diff += 360;

    dialStartAngleRad = currentAngleRad;
    accumulatedDialAngleDeltaDeg += diff;
    currentDialRotationDeg += diff;

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
      const previewSeconds = Math.max(1, currentRemaining + pendingMinuteAdjustment * 60);
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

      // Compute exact preview target seconds based on live remaining seconds
      const currentRemaining = runtime.status === TimerStatus.IDLE
        ? baseDialSeconds
        : runtime.getRemainingSeconds();
      const targetSeconds = Math.max(60, currentRemaining + pendingMinuteAdjustment * 60);

      // Lock task to this exact target seconds so it preserves seconds and doesn't round to a whole minute!
      runtime.setActiveTaskTargetSeconds(targetSeconds, pendingMinuteAdjustment);

      const activeTask = runtime.getActiveTask();
      if (activeTask) {
        taskStore.updateTask(activeTask.id, {
          plannedDuration: activeTask.plannedDuration,
          isLocked: Boolean(activeTask.isLocked)
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
      renderTaskList(((runtime.currentSchedule && runtime.currentSchedule.tasks) || []) || []);
      pendingMinuteAdjustment = 0;

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
  // Reset clears Time Bank back to zero (strictly on reset, not on exit)
  taskStore.setTimeBankSeconds(0);
  updateTimeBankDisplay();
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
    mobileServices.hapticTap();
    analytics.trackInteraction('btn_click', 'btnPlayPause', { action: runtime.status === TimerStatus.RUNNING ? 'pause' : 'start' });
    if (runtime.status === TimerStatus.RUNNING) {
      runtime.pause();
    } else {
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

  function handleTimerLockToggle(e) {
    if (e) {
      e.stopPropagation();
      if (e.preventDefault) e.preventDefault();
    }
    const activeTask = runtime ? runtime.getActiveTask() : null;
    if (!activeTask) {
      showToastNotification('Add a task first to toggle Lock.');
      return;
    }
    mobileServices.hapticTap();
    const nextLock = !Boolean(activeTask.isLocked);
    activeTask.isLocked = nextLock;

    taskStore.updateTask(activeTask.id, { isLocked: nextLock });
    const initTask = (runtime && runtime.initialTasks) ? runtime.initialTasks.find(t => t.id === activeTask.id) : null;
    if (initTask) initTask.isLocked = nextLock;

    showToastNotification(nextLock ? 'Task duration locked' : 'Task duration unlocked');
    updateTimerQuickToggles();
    renderTaskList(((runtime.currentSchedule && runtime.currentSchedule.tasks) || []) || []);
    const calBackdrop = document.getElementById('calendarModalBackdrop');
    if (calBackdrop && !calBackdrop.classList.contains('hidden')) {
      renderCalendarModal();
    }
  }

  const timerScreenPiggyBtn = document.getElementById('timerScreenPiggyBtn');
  if (timerScreenPiggyBtn) {
    timerScreenPiggyBtn.addEventListener('click', handleTimerPiggyToggle);
    timerScreenPiggyBtn.addEventListener('touchend', handleTimerPiggyToggle, { passive: false });
  }

  const timerScreenLockIcon = document.getElementById('timerScreenLockIcon');
  if (timerScreenLockIcon) {
    timerScreenLockIcon.addEventListener('click', handleTimerLockToggle);
    timerScreenLockIcon.addEventListener('touchend', handleTimerLockToggle, { passive: false });
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
    if (confirmDeleteTaskTitle) confirmDeleteTaskTitle.textContent = `Delete "${pendingDeleteTaskTitle}"?`;
    if (confirmDeleteTaskDesc) confirmDeleteTaskDesc.textContent = `Are you sure you want to remove "${pendingDeleteTaskTitle}" from today's schedule?`;
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
    mobileServices.hapticBuzz();
    showToastNotification(`✓ Deleted "${taskTitle}"`);
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
      mobileServices.hapticBuzz();
      showToastNotification("✓ Cleared today's schedule");
    });
  }

  const taskDrawerBackdrop = document.getElementById('taskDrawerBackdrop');
  const btnDrawerToggle = document.getElementById('btnDrawerToggle');

  function openTaskDrawer() {
    taskDrawer.style.removeProperty('transform');
    taskDrawer.classList.remove('collapsed');
    taskDrawer.classList.remove('will-minimise', 'will-open');
    if (taskDrawerBackdrop) taskDrawerBackdrop.classList.remove('hidden');
    mobileServices.hapticTap();
  }

  function closeTaskDrawer() {
    taskDrawer.style.removeProperty('transform');
    taskDrawer.classList.add('collapsed');
    taskDrawer.classList.remove('will-minimise', 'will-open');
    if (taskDrawerBackdrop) taskDrawerBackdrop.classList.add('hidden');
  }

  function toggleTaskDrawer() {
    if (taskDrawer.classList.contains('collapsed')) {
      openTaskDrawer();
    } else {
      closeTaskDrawer();
    }
  }

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
    if (isDraggingTask || e.target.closest('[data-action="drag-handle"], .drag-handle, .drag-handle-compact')) {
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
    if (isDraggingTask || e.target.closest('[data-action="drag-handle"], .drag-handle, .drag-handle-compact')) {
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
          taskDrawer.classList.remove('will-minimise');
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

    taskDrawer.classList.remove('will-minimise', 'will-open');
    isDrawerTouching = false;
    isDrawerPullingDown = false;
    isDrawerPullingUp = false;
  }

  if (drawerHeader) {
    drawerHeader.addEventListener('touchstart', onDrawerTouchStart, { passive: true });
    drawerHeader.addEventListener('touchmove', onDrawerTouchMove, { passive: true });
    drawerHeader.addEventListener('touchend', onDrawerTouchEnd, { passive: true });
  }

  if (taskDrawer) {
    taskDrawer.addEventListener('touchstart', onDrawerTouchStart, { passive: true });
    taskDrawer.addEventListener('touchmove', onDrawerTouchMove, { passive: true });
    taskDrawer.addEventListener('touchend', onDrawerTouchEnd, { passive: true });
  }
}

// ==========================================
// Toast Notification System
// ==========================================
let toastTimeout = null;
function showToastNotification(msg) {
  const toast = document.getElementById('toastNotification');
  if (!toast) return;
  toast.style.removeProperty('background');
  toast.style.removeProperty('color');
  toast.textContent = msg;
  toast.classList.remove('hidden');
  toast.style.opacity = '1';
  toast.style.transform = 'translateX(-50%) translateY(0)';
  if (toastTimeout) clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(-50%) translateY(10px)';
    setTimeout(() => {
      toast.classList.add('hidden');
      toast.style.removeProperty('background');
      toast.style.removeProperty('color');
    }, 220);
  }, 2200);
}

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
// Interactive Live Drag Reordering (Mobile Touch + Desktop Pointer)
// ==========================================
function setupInteractiveTaskDrag(container) {
  if (!container || container._hasInteractiveDrag) return;
  container._hasInteractiveDrag = true;

  container.addEventListener('pointerdown', (e) => {
    // Only accept primary pointer (left mouse click or touch)
    if (e.button !== undefined && e.button !== 0) return;

    // Reject all drag interactions if drawer is collapsed
    const drawer = container.closest('#taskDrawer');
    if (drawer && drawer.classList.contains('collapsed')) return;

    // STRICT CHECK: Drag can ONLY begin if pointer is directly on the 3x2 dots drag handle!
    const handle = e.target.closest('[data-action="drag-handle"]');
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

    // In RUNNING state: current active task cannot be moved, but FUTURE tasks can be moved!
    if (isRunning && fromIndex <= activeIdx) {
      e.preventDefault();
      e.stopPropagation();
      mobileServices.hapticWarning();
      showToastNotification('Active task is running. Pause timer to reorder.');
      return;
    }

    // In PAUSED state: if task is locked, notify user to deselect the padlock first
    if (isPaused && fromIndex === activeIdx && (dragCard.querySelector('.is-locked-task') || dragCard.classList.contains('is-locked-task'))) {
      e.preventDefault();
      e.stopPropagation();
      mobileServices.hapticWarning();
      showToastNotification('Deselect the padlock to unlock active task first.');
      return;
    }

    if (dragCard.querySelector('.is-locked-task') || dragCard.classList.contains('is-locked-task')) {
      e.preventDefault();
      e.stopPropagation();
      mobileServices.hapticWarning();
      showToastNotification('🔒 This task is locked and cannot be moved.');
      return;
    }

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

    // 200ms HOLD REQUIRED before dragging engages!
    holdTimer = setTimeout(() => {
      holdTimer = null;
      isDragActive = true;
      isDraggingTask = true;

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
        // Cancel hold if finger moves before 200ms (user is swiping/scrolling)
        if (Math.hypot(moveEv.clientX - startX, moveEv.clientY - startY) > 8) {
          if (holdTimer) {
            clearTimeout(holdTimer);
            holdTimer = null;
          }
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

      if (draggedTaskId && targetTaskId && draggedTaskId !== targetTaskId) {
        taskStore.reorderTaskById(draggedTaskId, targetTaskId);
        runtime.initialTasks = taskStore.getTasks();
        runtime.recalculate();
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
// Task Pipeline List
// ==========================================
function setupTaskPipeline() {
  // Bind interactive live drag reordering to pipeline task list
  setupInteractiveTaskDrag(taskListContainer);
}

function renderTaskList(tasks) {
  taskCountBadge.textContent = `${tasks.length} task${tasks.length === 1 ? '' : 's'}`;
  taskListContainer.innerHTML = '';

  const activeIdx = runtime && runtime.activeTaskIndex >= 0 ? runtime.activeTaskIndex : 0;
  const isRunning = runtime && runtime.status === TimerStatus.RUNNING;
  const isPaused = runtime && runtime.status === TimerStatus.PAUSED;
  const isAllCompleted = runtime.status === TimerStatus.COMPLETED;

  tasks.forEach((task, idx) => {
    const card = document.createElement('div');
    const isImmovable = Boolean(task.fixedStartTime);
    const isCurrentActive = (isRunning || isPaused) && (idx === activeIdx);
    // When timer is RUNNING, the active in-progress task is locked. When PAUSED, user can toggle lock!
    const isLocked = Boolean(task.isLocked || isImmovable || (isRunning && isCurrentActive));
    const isBreak = task.category === 'Break' || (task.title ? task.title.toLowerCase() : "") === 'break';

    let statusClass = 'task-pending';
    let statusBadge = isBreak
      ? '<span class="task-status-pill break-pill">☕ Break</span>'
      : '<span class="task-status-pill pending">⏳ Todo</span>';

    if (isAllCompleted || (runtime.activeTaskIndex > 0 && idx < runtime.activeTaskIndex)) {
      statusClass = 'task-completed';
      statusBadge = '<span class="task-status-pill completed">✓ Done</span>';
    } else if (idx === activeIdx && !isAllCompleted) {
      statusClass = 'task-current';
      statusBadge = '<span class="task-status-pill current">▶ Active</span>';
    } else {
      statusClass = 'task-pending';
      statusBadge = isBreak
        ? '<span class="task-status-pill break-pill">☕ Break</span>'
        : '<span class="task-status-pill pending">⏳ Todo</span>';
    }

    card.className = `task-card ${statusClass} ${isBreak ? 'is-break-task' : ''} ${isLocked ? 'is-locked-task' : ''}`;
    card.setAttribute('data-id', task.id);
    card.setAttribute('data-index', idx);

    const isCompressed = task.allocatedDuration < task.plannedDuration;
    const durationText = isCompressed
      ? `${task.allocatedDuration}m (was ${task.plannedDuration}m)`
      : `${task.allocatedDuration}m`;

    const lockTitle = isImmovable
      ? `🔒 Fixed in place at ${task.fixedStartTime} (Immovable)`
      : (task.isLocked ? 'Locked (Incompressible)' : 'Unlocked');

    const isOverrunningTask = Boolean((runtime && runtime.isOverrunning) && (runtime && runtime.getActiveTask() && runtime.getActiveTask().id) === task.id);

    card.innerHTML = `
      <!-- Top Row: Status badge on top left, actions on top right -->
      <div class="task-card-top-row">
        <div class="task-card-status-wrap">
          ${statusBadge}
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
      </div>

      <!-- Bottom Row: Timing duration in blue text on a single line -->
      <div class="task-card-bottom-row">
        <span class="task-timing-blue">${task.startTime || '--:--'} → ${task.endTime || '--:--'} • ${durationText}</span>
        <span class="task-category-chip">${escapeHtml(task.category || 'General')}</span>
      </div>
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
      if (e.target.closest('[data-action="drag-handle"], [data-action="locked-drag-attempt"], [data-action="pick-emoji"], .task-emoji-btn, .btn-icon-action')) return;
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
      if (e.target.closest('[data-action="drag-handle"], [data-action="locked-drag-attempt"], [data-action="pick-emoji"], .task-emoji-btn, .btn-icon-action')) return;
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

    // Emoji click
    card.querySelector('[data-action="pick-emoji"]').addEventListener('click', (e) => {
      e.stopPropagation();
      openEmojiPicker(task.id);
    });

    // Edit task click
    card.querySelector('[data-action="edit-task"]').addEventListener('click', (e) => {
      if (e.target.closest('[data-action="pick-emoji"]') || e.target.closest('[data-action="drag-handle"]') || e.target.closest('[data-action="locked-drag-attempt"]')) return;
      openTaskEditModal(task.id);
    });

    // Locked drag handle tap notification
    const lockedDrag = card.querySelector('[data-action="locked-drag-attempt"]');
    if (lockedDrag) {
      lockedDrag.addEventListener('click', (e) => {
        e.stopPropagation();
        mobileServices.hapticWarning();
        showToastNotification('🔒 This task is locked and cannot be moved.');
      });
    }

    // Time bank toggle event
    const timeBankBtn = card.querySelector('[data-action="toggle-time-bank"]');
    if (timeBankBtn) {
      timeBankBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        taskStore.toggleTaskTimeBank(task.id);
        runtime.initialTasks = taskStore.getTasks();
        runtime.recalculate();
        updateActiveTaskDisplay();
        renderTaskList(((runtime.currentSchedule && runtime.currentSchedule.tasks) || []) || []);
        renderCalendarModal();
        mobileServices.hapticTap();
      });
    }

    // Lock toggle event
    card.querySelector('[data-action="toggle-lock"]').addEventListener('click', (e) => {
      e.stopPropagation();
      if (runtime && runtime.status === TimerStatus.RUNNING && isCurrentActive) {
        mobileServices.hapticWarning();
        showToastNotification('Pause timer first to unlock the current task.');
        return;
      }
      taskStore.toggleLock(task.id);
      runtime.initialTasks = taskStore.getTasks();
      runtime.recalculate();
      updateActiveTaskDisplay();
      renderTaskList(((runtime.currentSchedule && runtime.currentSchedule.tasks) || []) || []);
      renderCalendarModal();
      mobileServices.hapticTap();
    });

    // Delete event
    card.querySelector('[data-action="delete"]').addEventListener('click', (e) => {
      e.stopPropagation();
      executeDeleteTask(task.id, task.title);
    });

    taskListContainer.appendChild(card);
  });
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

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
  let resolvedTheme = theme;
  if (theme === 'system') {
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
    if (btn.getAttribute('data-theme-val') === theme) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });
}

// ==========================================
// Emoji Picker Modal Logic
// ==========================================
const CURATED_EMOJIS = ['📚', '📖', '📝', '💻', '🔬', '🧪', '📐', '🧠', '🎯', '⚡', '☕', '🏃', '🏋️', '🎨', '💼', '📊', '🎧', '⏰', '✨', '🔥', '📌', '🧹', '🥗', '🛌'];
let currentEmojiTaskId = null;
let currentAddTaskEmoji = '📚';
let currentTodoEmoji = '📌';
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
    CURATED_EMOJIS.forEach(emoji => {
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
      chip.className = `category-chip ${isSelected ? 'active' : ''}`;
      chip.innerHTML = `
        <span class="chip-text">${escapeHtml(cat)}</span>
        <button type="button" class="chip-delete" title="Delete category">✕</button>
      `;

      // Tap chip to select
      chip.addEventListener('click', (e) => {
        if (e.target.closest('.chip-delete')) return;
        input.value = cat;
        if (addBtn) addBtn.classList.add('hidden');
        renderChips();
        if (onSelectCategory) onSelectCategory(cat);
        mobileServices.hapticTap();
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
    if (titleInput && (!titleInput.value || titleInput.value === 'Untitled Task')) {
      titleInput.value = 'Break';
    }
    if (titleInput) titleInput.placeholder = 'e.g. Coffee break, walk, stretch';
    if (durationInput) durationInput.value = '10';
    if (categoryInput) categoryInput.value = 'Break';
    const bankInput = document.getElementById('addModalTimeBank');
    if (bankInput) bankInput.checked = false; // Breaks default to no piggy bank

    document.querySelectorAll('#addModalDurationChips .duration-chip').forEach(c => {
      c.classList.toggle('active', c.getAttribute('data-min') === '10');
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
    if (durationInput) durationInput.value = '30';
    if (categoryInput && categoryInput.value === 'Break') categoryInput.value = 'Study';
    const bankInput = document.getElementById('addModalTimeBank');
    if (bankInput) bankInput.checked = true;

    document.querySelectorAll('#addModalDurationChips .duration-chip').forEach(c => {
      c.classList.toggle('active', c.getAttribute('data-min') === '30');
    });
  }

  syncModalToggleIcons();
  if (refreshAddCategoryChips) refreshAddCategoryChips();
}

// ==========================================
// Add Task Modal Logic (Unified Planning UI)
// ==========================================
function openAddTaskModal(defaultType = 'work', prefillData = null) {
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

  if (inputDur) inputDur.value = defaultType === 'break' ? '10' : '30';
  if (inputCat) inputCat.value = defaultType === 'break' ? 'Break' : 'Study';
  if (inputFixed) inputFixed.value = '';
  if (inputStart) inputStart.value = '';
  if (inputEnd) inputEnd.value = '';
  if (toggleBank) toggleBank.checked = defaultType !== 'break';
  if (toggleLock) toggleLock.checked = false;

  setAddTaskType(defaultType);

  if (prefillData && prefillData.title) {
    if (inputTitle) inputTitle.value = prefillData.title;
  } else {
    if (inputTitle) inputTitle.value = defaultType === 'break' ? 'Break' : '';
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
  if (editTaskStartTime) editTaskStartTime.value = task.fixedStartTime || task.startTime || '';
  if (editTaskEndTime) editTaskEndTime.value = task.endTime || '';
  if (editTaskIsLocked) editTaskIsLocked.checked = Boolean(task.isLocked);
  if (editTaskHeaderEmoji) editTaskHeaderEmoji.textContent = currentEditEmoji;
  if (editTaskTimeBank) editTaskTimeBank.checked = task.useTimeBank !== false;

  syncModalToggleIcons();
  if (typeof renderAllDurationPresetChips === 'function') renderAllDurationPresetChips();
  if (refreshEditCategoryChips) refreshEditCategoryChips();

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
  const isLocked = (() => { const _el = document.getElementById("editTaskIsLocked"); return _el ? _el.checked : false; })() || Boolean(fixedStartTime);
  const useTimeBank = document.getElementById('editTaskTimeBank') ? document.getElementById('editTaskTimeBank').checked : true;
  const emoji = currentEditEmoji || (() => { const _el = document.getElementById("editTaskHeaderEmoji"); return _el ? _el.textContent : ""; })().trim() || '📝';

  if (category) taskStore.addCategory(category);

  taskStore.updateTask(currentEditTaskId, {
    title,
    plannedDuration,
    category,
    fixedStartTime,
    isLocked,
    useTimeBank,
    emoji
  });

  runtime.initialTasks = taskStore.getTasks();
  runtime.recalculate();
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
function openDrawer() {
  if (navDrawer && navDrawerBackdrop) {
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
  closeDrawer();
  closeCalendar();
  closeTodo();
  calendarView.close();
  const navItemFullCalendar = document.getElementById('navItemFullCalendar');
  if (navItemFullCalendar) navItemFullCalendar.classList.remove('active');
  if (toggleConfirmAdjust) {
    toggleConfirmAdjust.checked = taskStore.getConfirmAdjustments();
  }
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
}

function openCalendar() {
  closeDrawer();
  closeSettings();
  closeTodo();
  calendarView.close();
  const navItemFullCalendar = document.getElementById('navItemFullCalendar');
  if (navItemFullCalendar) navItemFullCalendar.classList.remove('active');
  renderCalendarModal();
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
  if (navItemCalendar) navItemCalendar.classList.remove('active');
}

function openTodo() {
  closeDrawer();
  closeSettings();
  closeCalendar();
  calendarView.close();
  const navItemFullCalendar = document.getElementById('navItemFullCalendar');
  if (navItemFullCalendar) navItemFullCalendar.classList.remove('active');
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

// Category Color Palette: Vibrant, colorful tones strictly distinct from task status colors (no light-blue, red, orange/yellow, or grey)
const CATEGORY_PALETTE = [
  { bg: 'rgba(168, 85, 247, 0.22)', border: '#a855f7', text: '#e9d5ff' },  // Bright Purple (Study / Deep Work)
  { bg: 'rgba(16, 185, 129, 0.22)', border: '#10b981', text: '#6ee7b7' },  // Emerald / Mint (Personal)
  { bg: 'rgba(236, 72, 153, 0.22)', border: '#ec4899', text: '#fbcfe8' },  // Magenta / Hot Pink (Creative / Life)
  { bg: 'rgba(132, 204, 22, 0.22)', border: '#84cc16', text: '#d9f99d' },  // Bright Lime (Health / Fitness)
  { bg: 'rgba(99, 102, 241, 0.22)', border: '#6366f1', text: '#c7d2fe' },  // Royal Indigo (Coding / Dev)
  { bg: 'rgba(20, 184, 166, 0.22)', border: '#14b8a6', text: '#99f6e4' },  // Teal (Chores / Tasks)
  { bg: 'rgba(217, 70, 239, 0.22)', border: '#d946ef', text: '#f5d0fe' },  // Vivid Fuchsia (Meeting)
  { bg: 'rgba(139, 92, 246, 0.22)', border: '#8b5cf6', text: '#ddd6fe' },  // Violet (General)
  { bg: 'rgba(34, 197, 94, 0.22)', border: '#22c55e', text: '#bbf7d0' }   // Spring Green (Admin)
];

function getCategoryColor(category) {
  const cat = (category || 'General').trim();
  const lower = cat.toLowerCase();
  if (lower === 'study') return CATEGORY_PALETTE[0];
  if (lower === 'work') return CATEGORY_PALETTE[4];
  if (lower === 'personal') return CATEGORY_PALETTE[1];
  if (lower === 'health' || lower === 'fitness') return CATEGORY_PALETTE[3];
  if (lower === 'meeting') return CATEGORY_PALETTE[6];
  if (lower === 'coding' || lower === 'dev') return CATEGORY_PALETTE[4];
  if (lower === 'chores') return CATEGORY_PALETTE[5];
  if (lower === 'general') return CATEGORY_PALETTE[7];

  let hash = 0;
  for (let i = 0; i < cat.length; i++) {
    hash = ((hash << 5) - hash) + cat.charCodeAt(i);
    hash |= 0;
  }
  const idx = Math.abs(hash) % CATEGORY_PALETTE.length;
  return CATEGORY_PALETTE[idx];
}

// Condensed Calendar Timeline Renderer
function renderCalendarModal() {
  if (!calendarTimelineList) return;
  calendarTimelineList.innerHTML = '';

  const tasks = ((runtime && runtime.currentSchedule && runtime.currentSchedule.tasks) || []) || [];
  if (tasks.length === 0) {
    calendarTimelineList.innerHTML = '<div style="color:var(--text-dim);text-align:center;padding:24px 0;">No scheduled events for today.</div>';
    return;
  }

  const activeIdx = runtime && runtime.activeTaskIndex >= 0 ? runtime.activeTaskIndex : 0;
  const isRunning = runtime && runtime.status === TimerStatus.RUNNING;
  const isPaused = runtime && runtime.status === TimerStatus.PAUSED;

  tasks.forEach((task, idx) => {
    const isImmovable = Boolean(task.fixedStartTime);
    const isCurrentActive = (isRunning || isPaused) && (idx === activeIdx);
    // When timer is RUNNING, the active task is locked. When PAUSED, user can toggle lock!
    const isLocked = Boolean(task.isLocked || isImmovable || (isRunning && isCurrentActive));
    const isOverrunningTask = Boolean((runtime && runtime.isOverrunning) && (runtime && runtime.getActiveTask() && runtime.getActiveTask().id) === task.id);
    const isBreak = task.category === 'Break' || (task.title ? task.title.toLowerCase() : "") === 'break';
    const catColor = getCategoryColor(task.category);

    let statusClass = 'pending';
    if (task.isCompleted || (runtime.activeTaskIndex > 0 && idx < activeIdx)) {
      statusClass = 'completed';
    } else if (idx === activeIdx) {
      statusClass = 'current';
    }

    const lockTitle = isImmovable
      ? `🔒 Fixed in place at ${task.fixedStartTime} (Immovable)`
      : (task.isLocked ? 'Locked (Incompressible)' : 'Unlocked');

    const wrapper = document.createElement('div');
    wrapper.className = 'calendar-item-wrapper';
    wrapper.setAttribute('data-id', task.id);
    wrapper.setAttribute('data-index', idx);

    const deleteAction = document.createElement('div');
    deleteAction.className = 'calendar-swipe-delete-action';
    deleteAction.innerHTML = `<button type="button" class="btn-swipe-delete" data-action="swipe-delete-task" data-id="${task.id}" title="Delete task">✕</button>`;

    const item = document.createElement('div');
    item.className = `calendar-block ${statusClass} ${isBreak ? 'is-break-task' : ''} ${isLocked ? 'is-locked-task' : ''}`;
    item.setAttribute('data-id', task.id);
    item.setAttribute('data-index', idx);

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
          <span class="calendar-duration-badge">${task.allocatedDuration || task.plannedDuration}m</span>
        </div>
        <div class="calendar-main-line2">
          <span class="calendar-time-range">${task.startTime || '--:--'} → ${task.endTime || '--:--'}</span>
          <span class="calendar-category-pill" style="background:${catColor.bg};border:1px solid ${catColor.border};color:${catColor.text};">${escapeHtml(task.category || 'General')}</span>
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
        updateActiveTaskDisplay();
        renderTaskList(((runtime.currentSchedule && runtime.currentSchedule.tasks) || []) || []);
        renderCalendarModal();
        mobileServices.hapticTap();
      });
    }

    // Lock toggle inside calendar
    item.querySelector('[data-action="toggle-calendar-lock"]').addEventListener('click', (e) => {
      e.stopPropagation();
      if (runtime && runtime.status === TimerStatus.RUNNING && isCurrentActive) {
        mobileServices.hapticWarning();
        showToastNotification('Pause timer first to unlock the current task.');
        return;
      }
      taskStore.toggleLock(task.id);
      runtime.initialTasks = taskStore.getTasks();
      runtime.recalculate();
      updateActiveTaskDisplay();
      renderTaskList(((runtime.currentSchedule && runtime.currentSchedule.tasks) || []) || []);
      renderCalendarModal();
      mobileServices.hapticTap();
    });

    // Emoji click inside calendar
    const calEmojiBtn = item.querySelector('[data-action="pick-calendar-emoji"]');
    if (calEmojiBtn) {
      calEmojiBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        openEmojiPicker(task.id);
      });
    }

    // Click on locked drag handle
    const lockedDrag = item.querySelector('[data-action="locked-drag-attempt"]');
    if (lockedDrag) {
      lockedDrag.addEventListener('click', (e) => {
        e.stopPropagation();
        mobileServices.hapticWarning();
        showToastNotification('🔒 This task is locked and cannot be moved.');
      });
    }

    // Swipe & Gesture Zone: The full task block (except drag handle and emoji button)
    let touchStartX = 0;
    let touchStartY = 0;
    let hasMoved = false;
    let isSwiping = false;
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
      // Ignore interactions originating directly from the drag handle or emoji button
      if (e.target.closest('[data-action="drag-handle"]') || e.target.closest('[data-action="pick-calendar-emoji"]')) {
        return;
      }

      hasMoved = false;
      isSwiping = false;
      startIsOpen = item.classList.contains('swiped-open') || wrapper.classList.contains('has-swiped-open');
      currentShiftPct = startIsOpen ? -25 : 0;
      touchStartX = (e.touches && e.touches[0]) ? e.touches[0].clientX : e.clientX;
      touchStartY = (e.touches && e.touches[0]) ? e.touches[0].clientY : e.clientY;
      clearHold();

      // Holding task (including in piggy bank or padlock area) reveals the red X!
      holdTimer = setTimeout(() => {
        if (!hasMoved && !isSwiping) {
          wrapper.classList.add('has-swiped-open');
          item.classList.add('swiped-open');
          item.style.removeProperty('transform');
          mobileServices.hapticTap();
        }
      }, 350);
    };

    const handleTaskTouchMove = (e) => {
      if (e.target.closest('[data-action="drag-handle"]') || e.target.closest('[data-action="pick-calendar-emoji"]')) {
        return;
      }

      const clientX = (e.touches && e.touches[0]) ? e.touches[0].clientX : e.clientX;
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
    };

    const handleTaskTouchEnd = (e) => {
      clearHold();
      if (isSwiping) {
        wrapper.classList.remove('is-swiping');
        item.style.transition = '';
        item.style.removeProperty('transform');

        // If shifted at least halfway to -25% (<= -12%), snap open; otherwise snap closed
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
    };

    item.addEventListener('touchstart', handleTaskTouchStart, { passive: true });
    item.addEventListener('touchmove', handleTaskTouchMove, { passive: true });
    item.addEventListener('touchend', handleTaskTouchEnd, { passive: true });
    item.addEventListener('touchcancel', () => {
      clearHold();
      item.style.transition = '';
      item.style.transform = '';
    });

    item.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
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
          e.target.closest('[data-action="drag-handle"]')) {
        return;
      }
      openTaskEditModal(task.id);
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
    wrapper.appendChild(item);
    calendarTimelineList.appendChild(wrapper);
  });
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

    const item = document.createElement('div');
    item.className = `todo-block ${todo.completed ? 'completed' : ''}`;
    item.setAttribute('data-id', todo.id);
    item.setAttribute('data-index', idx);

    item.innerHTML = `
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
      </div>
      <button type="button" class="todo-checkbox-btn ${todo.completed ? 'checked' : ''}" data-action="toggle-todo" data-id="${todo.id}" title="${todo.completed ? 'Mark uncompleted' : 'Mark done'}">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="20 6 9 17 4 12"></polyline>
        </svg>
      </button>
    `;

    // Checkbox toggle
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

    // Swipe & Hold gestures (identical to calendar delete mechanic)
    let touchStartX = 0;
    let touchStartY = 0;
    let isSwiping = false;
    let holdTimer = null;
    let startIsOpen = false;
    let currentShiftPct = 0;

    item.addEventListener('touchstart', (e) => {
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
      if (e.target.closest('[data-action="drag-handle"], .drag-handle-compact') || e.target.closest('[data-action="pick-todo-emoji"]')) {
        return;
      }
      const clientX = (e.touches && e.touches[0]) ? e.touches[0].clientX : e.clientX;
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
}
window.renderTodoList = renderTodoList;

function setupInteractiveTodoDrag(container) {
  if (!container || container._hasInteractiveDrag) return;
  container._hasInteractiveDrag = true;

  container.addEventListener('pointerdown', (e) => {
    if (e.button !== undefined && e.button !== 0) return;
    const handle = e.target.closest('[data-action="drag-handle"]');
    if (!handle) return;

    const card = e.target.closest('.todo-item-wrapper');
    if (!card) return;

    const allCards = Array.from(container.children).filter(c => c.matches('.todo-item-wrapper'));
    const fromIndex = allCards.indexOf(card);
    if (fromIndex === -1) return;

    const activePointerId = e.pointerId;
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
      try {
        handle.setPointerCapture(activePointerId);
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
          c.style.transition = 'transform 0.22s cubic-bezier(0.2, 0, 0, 1)';
        }
      });

      draggedCard.classList.add('is-live-dragging');
      draggedCard.style.zIndex = '999';
      mobileServices.hapticBuzz();
    }, 180);

    const onPointerMove = (moveEv) => {
      if (moveEv.pointerId !== activePointerId) return;
      if (!isDragActive) {
        if (holdTimer) {
          clearTimeout(holdTimer);
          holdTimer = null;
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

      try {
        handle.releasePointerCapture(activePointerId);
      } catch (_) {}

      allCards.forEach(c => {
        c.classList.remove('is-live-dragging');
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
  refreshAddCategoryChips = setupCategorySelector('addModalCategoryChips', 'addModalCategory', 'btnAddCategory');
  refreshEditCategoryChips = setupCategorySelector('editModalCategoryChips', 'editTaskCategory', 'btnEditAddCategory');
  const refreshCalCategoryChips = setupCategorySelector('calEventCategoryChips', 'calEventCategory', 'btnAddCalCategory', (cat) => {
    if (calendarView) calendarView.currentCategory = cat;
  });
  if (calendarView) calendarView.refreshCategoryChips = refreshCalCategoryChips;

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
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        mobileServices.hapticTap();
        if (textInput && textInput.value && textInput.value.length === 5) {
          nativeInput.value = textInput.value;
        }
        if (typeof nativeInput.showPicker === 'function') {
          try {
            nativeInput.showPicker();
          } catch (err) {
            nativeInput.focus();
            nativeInput.click();
          }
        } else {
          nativeInput.focus();
          nativeInput.click();
        }
      });

      nativeInput.addEventListener('change', () => {
        if (nativeInput.value && textInput) {
          textInput.value = nativeInput.value;
          textInput.dispatchEvent(new Event('input', { bubbles: true }));
          textInput.dispatchEvent(new Event('change', { bubbles: true }));
          if (onTimeSelected) onTimeSelected();
        }
      });
    }
  }

  // Start & End Time calculation listeners for Add Task Modal
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
    if (!(addModalStartTime && addModalStartTime.value) || !(addModalDurationInput && addModalDurationInput.value)) return;
    const startMin = parseTimeToMinutes(addModalStartTime.value);
    const dur = parseInt(addModalDurationInput.value, 10) || 0;
    const endMin = (startMin + dur) % 1440;
    if (addModalEndTime) addModalEndTime.value = formatMinutesToTime(endMin);
  }

  bindClockPicker('btnAddModalStartTimeClock', 'addModalStartTimeNative', 'addModalStartTime', () => {
    if (addModalEndTime && addModalEndTime.value) {
      updateAddModalDurationFromTimeSpan();
    } else {
      updateAddModalEndTimeFromDuration();
    }
  });

  bindClockPicker('btnAddModalEndTimeClock', 'addModalEndTimeNative', 'addModalEndTime', () => {
    updateAddModalDurationFromTimeSpan();
  });

  if (addModalStartTime) {
    addModalStartTime.addEventListener('input', () => {
      if (addModalStartTime.value.length === 5) {
        if (addModalEndTime && addModalEndTime.value) {
          updateAddModalDurationFromTimeSpan();
        } else if (addModalDurationInput && addModalDurationInput.value) {
          updateAddModalEndTimeFromDuration();
        }
      }
    });
    addModalStartTime.addEventListener('change', () => {
      if (addModalEndTime && addModalEndTime.value) {
        updateAddModalDurationFromTimeSpan();
      } else if (addModalDurationInput && addModalDurationInput.value) {
        updateAddModalEndTimeFromDuration();
      }
    });
  }
  if (addModalEndTime) {
    addModalEndTime.addEventListener('input', () => {
      if (addModalEndTime.value.length === 5) updateAddModalDurationFromTimeSpan();
    });
    addModalEndTime.addEventListener('change', updateAddModalDurationFromTimeSpan);
  }
  if (addModalDurationInput) {
    addModalDurationInput.addEventListener('input', () => {
      updateAddModalEndTimeFromDuration();
      const val = addModalDurationInput.value;
      document.querySelectorAll('#addModalDurationChips .duration-chip').forEach(c => {
        c.classList.toggle('active', c.getAttribute('data-min') === val);
      });
    });
    addModalDurationInput.addEventListener('change', updateAddModalEndTimeFromDuration);
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
    if (editTaskEndTime && editTaskEndTime.value) {
      updateEditModalDurationFromTimeSpan();
    } else {
      updateEditModalEndTimeFromDuration();
    }
  });

  bindClockPicker('btnEditTaskEndTimeClock', 'editTaskEndTimeNative', 'editTaskEndTime', () => {
    updateEditModalDurationFromTimeSpan();
  });

  if (editTaskStartTime) {
    editTaskStartTime.addEventListener('input', () => {
      if (editTaskStartTime.value.length === 5) {
        if (editTaskEndTime && editTaskEndTime.value) {
          updateEditModalDurationFromTimeSpan();
        } else if (editTaskDurationInput && editTaskDurationInput.value) {
          updateEditModalEndTimeFromDuration();
        }
      }
    });
    editTaskStartTime.addEventListener('change', () => {
      if (editTaskEndTime && editTaskEndTime.value) {
        updateEditModalDurationFromTimeSpan();
      } else if (editTaskDurationInput && editTaskDurationInput.value) {
        updateEditModalEndTimeFromDuration();
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
    const duration = parseInt((durInput ? durInput.value : ""), 10) || (currentAddTaskType === 'break' ? 10 : 25);

    const catInput = document.getElementById('addModalCategory');
    const category = (catInput ? catInput.value : "").trim() || (currentAddTaskType === 'break' ? 'Break' : 'General');

    const fixedInput = document.getElementById('addModalFixedTime');
    const startInput = document.getElementById('addModalStartTime');
    const fixedStartTime = (startInput ? startInput.value : "") || (fixedInput ? fixedInput.value : "") || null;

    const bankInput = document.getElementById('addModalTimeBank');
    const useTimeBank = bankInput ? bankInput.checked : true;

    const lockInput = document.getElementById('addModalIsLocked');
    const isLocked = lockInput ? lockInput.checked : Boolean(fixedStartTime);

    if (category) taskStore.addCategory(category);

    taskStore.addTask({
      title,
      plannedDuration: duration,
      category,
      fixedStartTime,
      isLocked: Boolean(isLocked),
      useTimeBank,
      emoji: currentAddTaskEmoji || (currentAddTaskType === 'break' ? '☕' : '📝')
    });

    runtime.initialTasks = taskStore.getTasks();
    runtime.recalculate();
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

  // Swipe right on screen to smoothly open nav menu; swipe left to smoothly close
  let navTouchStartX = null;
  let navTouchStartY = null;
  let isNavSwiping = false;
  let isDrawerOpenAtTouchStart = false;

  window.addEventListener('touchstart', (e) => {
    if (!navDrawer || !navDrawerBackdrop) return;
    const target = e.target;

    // Guard: Never open side menu if ANY modal is currently open
    const openModal = document.querySelector('.modal-backdrop:not(.hidden)');
    if (openModal) {
      navTouchStartX = null;
      navTouchStartY = null;
      return;
    }

    // Guard: If touch starts inside Today's Tasks drawer or its header pull pill, ignore for nav menu
    if (target.closest('.task-drawer, #taskDrawer, .task-drawer-backdrop, #taskDrawerBackdrop, .drawer-header, #drawerHeader, .drawer-pull-pill')) {
      navTouchStartX = null;
      navTouchStartY = null;
      return;
    }

    // Guard: If touch starts inside or on the timer wheel/dial elements, ignore for nav menu
    // This directly prevents thumb interactions on the dial from accidentally triggering the menu bar
    if (target.closest('.wheel-container, #wheelContainer, .rotary-dial-group, #rotaryDialGroup, .revolving-circle-group, #revolvingCircleGroup, .dial-hit-ring, .timer-center-display')) {
      navTouchStartX = null;
      navTouchStartY = null;
      return;
    }

    const touch = e.touches[0];
    // Guard: Bottom 95px of viewport is where collapsed Today's Tasks tab header sits
    if (touch && touch.clientY > window.innerHeight - 95) {
      navTouchStartX = null;
      navTouchStartY = null;
      return;
    }

    // Never start nav menu swipe if Today's Tasks drawer is open or being interacted with
    if (isDrawerTouching || isDrawerPullingUp || isDrawerPullingDown || (taskDrawer && !taskDrawer.classList.contains('collapsed'))) {
      navTouchStartX = null;
      navTouchStartY = null;
      return;
    }

    isDrawerOpenAtTouchStart = navDrawer.classList.contains('open');
    navTouchStartX = touch.clientX;
    navTouchStartY = touch.clientY;
    isNavSwiping = false;
  }, { passive: true });

  window.addEventListener('touchmove', (e) => {
    if (!navDrawer || !navDrawerBackdrop) return;
    if (navTouchStartX === null || navTouchStartY === null) return;
    if (isDraggingOuterDial || isScrubbingGreenLine || isDrawerTouching || isDrawerPullingUp || isDrawerPullingDown) {
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

    const touch = e.touches[0];
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
        isNavSwiping = true;
        navDrawer.style.transition = 'none';
        navDrawer.style.visibility = 'visible';
        navDrawerBackdrop.classList.remove('hidden');
        navDrawerBackdrop.style.transition = 'none';

        const progress = Math.max(0, Math.min(1, diffX / 160));
        const currentX = -drawerW * (1 - progress);
        navDrawer.style.transform = `translateX(${currentX}px)`;
        navDrawerBackdrop.style.opacity = progress.toString();
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
  }, { passive: true });

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
  });

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
      calendarView.close();
      const navItemFullCalendar = document.getElementById('navItemFullCalendar');
      if (navItemFullCalendar) navItemFullCalendar.classList.remove('active');
      navItemTimer.classList.add('active');
      if (navItemCalendar) navItemCalendar.classList.remove('active');
      if (navItemTodo) navItemTodo.classList.remove('active');
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

  if (navItemSettings) {
    navItemSettings.addEventListener('click', () => {
      analytics.trackInteraction('tab_switch', 'settings');
      openSettings();
    });
  }

  // Settings modal
  if (btnCloseSettings) btnCloseSettings.addEventListener('click', closeSettings);
  if (settingsModalBackdrop) {
    settingsModalBackdrop.addEventListener('click', (e) => {
      if (e.target === settingsModalBackdrop) closeSettings();
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

  // Live Digital Clock ticker: dynamic time span before timer starts
  setInterval(() => {
    if (!runtime || !runtime.getActiveTask() || runtime.status === TimerStatus.IDLE) {
      updateActiveTaskTimeSpanDynamic();
    }
  }, 1000);

  // Calendar modal buttons
  if (btnCloseCalendar) btnCloseCalendar.addEventListener('click', closeCalendar);
  if (calendarModalBackdrop) {
    calendarModalBackdrop.addEventListener('click', (e) => {
      if (e.target === calendarModalBackdrop) closeCalendar();
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

  if (btnOpenAddTodoModal) {
    btnOpenAddTodoModal.addEventListener('click', () => {
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
}

// Track visibility changes (app backgrounding during active session)
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      if (runtime && runtime.status === TimerStatus.RUNNING) {
        analytics.recordSessionEvent('visibility_loss');
        analytics.trackInteraction('app_lifecycle', 'visibility_hidden_while_running');
      }
    }
  });
}

// Start application: immediately if DOM is already ready, or on DOMContentLoaded
if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}
