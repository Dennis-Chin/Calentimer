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
import { formatMinutesToTime } from './schedulerEngine.js';

// DOM Elements
const hardStopInput = document.getElementById('hardStopInput');
const statusBanner = document.getElementById('statusBanner');
const statusText = document.getElementById('statusText');

const btnNotifToggle = document.getElementById('btnNotifToggle');
const notifStatusText = document.getElementById('notifStatusText');

const wheelContainer = document.getElementById('wheelContainer');
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
const taskTagsContainer = document.getElementById('taskTagsContainer');

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

// Initialize Timer Runtime
let runtime = null;

function initApp() {
  const savedHardStop = taskStore.getHardStop();
  hardStopInput.value = savedHardStop;

  const tasks = taskStore.getTasks();

  runtime = new TimerRuntime({
    hardStop: savedHardStop,
    tasks: tasks
  });

  renderDialTicks();
  setupRuntimeEvents();
  setupControls();
  setupRotaryWheel();
  setupTaskPipeline();

  // Initial render
  updateScheduleUI(runtime.currentSchedule);
  updateActiveTaskDisplay();
  updateResetButtonUI();
  updateNotifToggleUI();
  renderClockTime(runtime.getActiveTask()?.allocatedDuration * 60 || 1500);
  updateWheelProgress(0);
}

function updateNotifToggleUI() {
  if (!btnNotifToggle || !notifStatusText) return;
  if (mobileServices.hasNotificationPermission()) {
    btnNotifToggle.classList.add('granted');
    notifStatusText.textContent = 'Alerts On';
    btnNotifToggle.title = 'Android notification panel countdown enabled';
  } else {
    btnNotifToggle.classList.remove('granted');
    notifStatusText.textContent = 'Alerts';
    btnNotifToggle.title = 'Tap to enable Android notification panel alerts';
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
    const r1 = isMajor ? 138 : 143;
    const r2 = 149;
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
    // Only update digital clock & wheel from tick if user is NOT currently scrubbing or dragging the dial
    if (!isScrubbingGreenLine && !isDraggingOuterDial) {
      renderClockTime(data.remainingSeconds);
      updateWheelProgress(data.progressRatio);
    }

    // Android notification panel live countdown update
    if (runtime.status === TimerStatus.RUNNING) {
      const nextTask = runtime.currentSchedule?.tasks[runtime.activeTaskIndex + 1] || null;
      mobileServices.updateLiveNotification({
        activeTask: data.activeTask,
        remainingSeconds: data.remainingSeconds,
        nextTask,
        isPaused: false
      });
    }

    // Dynamic intuitive text explaining the reclaim bonus
    if (finishEarlyText) {
      const remainingMin = Math.floor(data.remainingSeconds / 60);
      if (remainingMin > 0) {
        finishEarlyText.textContent = `✓ Finish Early & Share +${remainingMin}m to Remaining Tasks`;
      } else {
        finishEarlyText.textContent = `✓ Complete Task Early & Move to Next`;
      }
    }
  });

  runtime.on('taskStart', (data) => {
    updateActiveTaskDisplay();
    renderTaskList(runtime.currentSchedule?.tasks || []);
  });

  runtime.on('taskComplete', (data) => {
    audioManager.playTaskCompleteChime();
    mobileServices.hapticCelebration();
    const nextTask = runtime.currentSchedule?.tasks[runtime.activeTaskIndex + 1] || null;
    mobileServices.notifyTaskComplete({
      completedTask: data.task,
      nextTask
    });
    updateActiveTaskDisplay();
    renderTaskList(runtime.currentSchedule?.tasks || []);
  });

  runtime.on('allTasksCompleted', () => {
    mobileServices.disableWakeLock();
    mobileServices.clearLiveNotification();
    updateActiveTaskDisplay();
    updateResetButtonUI();
    renderTaskList(runtime.currentSchedule?.tasks || []);
  });

  runtime.on('scheduleUpdate', (schedule) => {
    updateScheduleUI(schedule);
  });

  runtime.on('statusChange', (status) => {
    if (status === TimerStatus.RUNNING) {
      iconPlay.classList.add('hidden');
      iconPause.classList.remove('hidden');
      mobileServices.enableWakeLock();
      const activeTask = runtime.getActiveTask();
      const nextTask = runtime.currentSchedule?.tasks[runtime.activeTaskIndex + 1] || null;
      mobileServices.updateLiveNotification({
        activeTask,
        remainingSeconds: runtime.getRemainingSeconds(),
        nextTask,
        isPaused: false
      });
    } else if (status === TimerStatus.PAUSED) {
      iconPlay.classList.remove('hidden');
      iconPause.classList.add('hidden');
      mobileServices.disableWakeLock();
      const activeTask = runtime.getActiveTask();
      const nextTask = runtime.currentSchedule?.tasks[runtime.activeTaskIndex + 1] || null;
      mobileServices.updateLiveNotification({
        activeTask,
        remainingSeconds: runtime.getRemainingSeconds(),
        nextTask,
        isPaused: true
      });
    } else {
      iconPlay.classList.remove('hidden');
      iconPause.classList.add('hidden');
      mobileServices.disableWakeLock();
      mobileServices.clearLiveNotification();
    }
    updateResetButtonUI();
    renderTaskList(runtime.currentSchedule?.tasks || []);
  });

  runtime.on('error', (err) => {
    if (err.code === 'LOCKED_TASKS_EXCEED_TIME') {
      warningAlertCard.classList.remove('hidden');
      warningDesc.textContent = err.message;
      statusBanner.classList.add('compressed');
      statusText.textContent = 'Locked tasks exceed Hard Stop!';
    } else {
      statusText.textContent = err.message;
    }
  });
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

function updateActiveTaskDisplay() {
  const activeTask = runtime.getActiveTask();
  if (!activeTask || runtime.status === TimerStatus.COMPLETED) {
    activeCategoryChip.textContent = 'DONE';
    activeTaskTitle.textContent = 'All tasks completed!';
    taskTagsContainer.innerHTML = '';
    return;
  }

  activeCategoryChip.textContent = (activeTask.category || 'Focus').toUpperCase();
  activeTaskTitle.textContent = activeTask.title;

  // Tags rendering directly below digital timer
  taskTagsContainer.innerHTML = '';
  if (Array.isArray(activeTask.tags) && activeTask.tags.length > 0) {
    activeTask.tags.forEach(tag => {
      const tagSpan = document.createElement('span');
      tagSpan.className = 'task-tag';
      tagSpan.textContent = tag.startsWith('#') ? tag : `#${tag}`;
      taskTagsContainer.appendChild(tagSpan);
    });
  }
}

function updateScheduleUI(schedule) {
  if (!schedule || !schedule.success) return;

  warningAlertCard.classList.add('hidden');

  if (schedule.isCompressed) {
    statusBanner.classList.add('compressed');
    const pct = Math.round(schedule.compressionRatio * 100);
    statusText.textContent = `⚡ Compressed to ${pct}% to meet Hard Stop`;
  } else {
    statusBanner.classList.remove('compressed');
    statusText.textContent = `✓ On track · ${schedule.bufferMinutes}m buffer before Hard Stop`;
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
    const rect = (rotarySvg || wheelContainer).getBoundingClientRect();
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

  // Continuous scrubbing state (wraps across 0 / 12 o'clock adding minutes)
  let scrubStartAngleRad = 0;
  let accumulatedScrubAngleDeltaDeg = 0;
  let baseSecondsAtScrubStart = 0;

  // Outer dial state
  let dialStartAngleRad = 0;
  let accumulatedDialAngleDeltaDeg = 0;
  let baseDialSeconds = 0;

  // -------------------------------------------------------------
  // Mode 1: Scrub Green Line Handle (1-second precision seek)
  // Tracks cursor directly with ZERO lag. Wrapping past 0 adds/subtracts minutes!
  // -------------------------------------------------------------
  function onScrubStart(e) {
    e.stopPropagation();
    isScrubbingGreenLine = true;
    document.body.classList.add('is-scrubbing');
    scrubStartAngleRad = getAngleFromEvent(e);
    accumulatedScrubAngleDeltaDeg = 0;
    baseSecondsAtScrubStart = runtime.status === TimerStatus.IDLE
      ? (runtime.getActiveTask()?.allocatedDuration || 25) * 60
      : runtime.getRemainingSeconds();
    lastScrubbedSecond = baseSecondsAtScrubStart;

    // Immediately snap visual circle to cursor position (no lag)
    updateCircleToAngle(scrubStartAngleRad);
  }

  function handleScrubMove(e) {
    if (!isScrubbingGreenLine) return;

    const currentAngleRad = getAngleFromEvent(e);
    // Instant visual update - directly follows cursor on every frame!
    updateCircleToAngle(currentAngleRad);

    let diff = (currentAngleRad - scrubStartAngleRad) * (180 / Math.PI);

    // Normalize wrap-around across -180 / +180
    if (diff > 180) diff -= 360;
    if (diff < -180) diff += 360;

    scrubStartAngleRad = currentAngleRad;
    accumulatedScrubAngleDeltaDeg += diff;

    // 6 degrees of rotation = 1 second of time.
    // 360 degrees = 60 seconds (1 full minute added/subtracted)!
    // Turning counter-clockwise (diff < 0) adds time past 0.
    // Turning clockwise (diff > 0) fast-forwards/consumes time.
    const secondsDelta = -Math.round(accumulatedScrubAngleDeltaDeg / 6);
    const targetRemainingSec = Math.max(0, baseSecondsAtScrubStart + secondsDelta);

    // Live update digital clock as you drag
    renderClockTime(targetRemainingSec);

    if (targetRemainingSec !== lastScrubbedSecond) {
      lastScrubbedSecond = targetRemainingSec;
      audioManager.playRotaryTick();
      mobileServices.hapticTick();
      runtime.seek(targetRemainingSec);
    }
  }

  function onScrubEnd() {
    if (!isScrubbingGreenLine) return;
    isScrubbingGreenLine = false;
    document.body.classList.remove('is-scrubbing');
    if (lastScrubbedSecond >= 0) {
      runtime.seek(lastScrubbedSecond);
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

    isDraggingOuterDial = true;
    document.body.classList.add('is-dragging-dial');
    dialStartAngleRad = getAngleFromEvent(e);
    accumulatedDialAngleDeltaDeg = 0;
    pendingMinuteAdjustment = 0;
    lastAudibleMinuteTick = 0;

    baseDialSeconds = runtime.status === TimerStatus.IDLE
      ? (runtime.getActiveTask()?.allocatedDuration || 25) * 60
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
      }

      const sign = pendingMinuteAdjustment > 0 ? '+' : '';
      rotaryPreviewBadge.textContent = `${sign}${pendingMinuteAdjustment}m`;

      // LIVE TIMER ADJUSTMENT: User sees what the next time would be if applied!
      const previewSeconds = Math.max(60, baseDialSeconds + pendingMinuteAdjustment * 60);
      renderClockTime(previewSeconds);
    }
  }

  function onDialEnd() {
    if (!isDraggingOuterDial) return;
    isDraggingOuterDial = false;
    document.body.classList.remove('is-dragging-dial');
    rotaryPreviewBadge.classList.add('hidden');

    if (pendingMinuteAdjustment !== 0) {
      const previewSeconds = Math.max(60, baseDialSeconds + pendingMinuteAdjustment * 60);
      const sign = pendingMinuteAdjustment > 0 ? '+' : '';
      const previewMins = Math.floor(previewSeconds / 60);
      const previewSecs = previewSeconds % 60;
      const formattedTime = `${String(previewMins).padStart(2, '0')}:${String(previewSecs).padStart(2, '0')}`;

      rotaryConfirmText.textContent = `Apply ${formattedTime} (${sign}${pendingMinuteAdjustment}m)?`;
      rotaryConfirmPill.classList.remove('hidden');
      renderClockTime(previewSeconds);
    } else {
      currentDialRotationDeg = 0;
      if (rotaryDialGroup) {
        rotaryDialGroup.setAttribute('transform', 'rotate(0 160 160)');
      }
      renderClockTime(baseDialSeconds);
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
    mobileServices.hapticTap();
    rotaryConfirmPill.classList.add('hidden');
    if (pendingMinuteAdjustment !== 0) {
      // 1. Adjust active task duration and re-compress all other tasks in the pipeline
      runtime.adjustActiveTaskDuration(pendingMinuteAdjustment);

      // 2. Persist updated task plannedDuration into taskStore
      const activeTask = runtime.getActiveTask();
      if (activeTask) {
        taskStore.updateTask(activeTask.id, { plannedDuration: activeTask.plannedDuration });
      }

      // 3. Reset wheel angle and update UI displays
      currentDialRotationDeg = 0;
      if (rotaryDialGroup) {
        rotaryDialGroup.setAttribute('transform', 'rotate(0 160 160)');
      }
      updateActiveTaskDisplay();
      renderClockTime(runtime.status === TimerStatus.IDLE ? (runtime.getActiveTask()?.allocatedDuration * 60 || 1500) : runtime.getRemainingSeconds());
      updateWheelProgress(runtime.getProgress());
      pendingMinuteAdjustment = 0;
    }
  });

  btnCancelAdjust.addEventListener('click', () => {
    mobileServices.hapticTap();
    rotaryConfirmPill.classList.add('hidden');
    pendingMinuteAdjustment = 0;
    currentDialRotationDeg = 0;
    if (rotaryDialGroup) {
      rotaryDialGroup.setAttribute('transform', 'rotate(0 160 160)');
    }
    // Revert clock display back to original time!
    renderClockTime(baseDialSeconds);
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
  mobileServices.disableWakeLock();
  mobileServices.clearLiveNotification();
  runtime.reset();
  currentDialRotationDeg = 0;
  if (rotaryDialGroup) {
    rotaryDialGroup.setAttribute('transform', 'rotate(0 160 160)');
  }
  updateActiveTaskDisplay();
  const firstTask = runtime.getActiveTask();
  renderClockTime(firstTask?.allocatedDuration * 60 || 1500);
  updateWheelProgress(0);
  updateScheduleUI(runtime.currentSchedule);
  updateResetButtonUI();
}

function setupControls() {
  if (btnNotifToggle) {
    btnNotifToggle.addEventListener('click', async () => {
      mobileServices.hapticTap();
      const granted = await mobileServices.requestNotificationPermission();
      updateNotifToggleUI();
      if (granted && runtime) {
        const activeTask = runtime.getActiveTask();
        if (activeTask) {
          const nextTask = runtime.currentSchedule?.tasks[runtime.activeTaskIndex + 1] || null;
          mobileServices.updateLiveNotification({
            activeTask,
            remainingSeconds: runtime.status === TimerStatus.IDLE
              ? (activeTask.allocatedDuration || 25) * 60
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
    if (runtime.status === TimerStatus.RUNNING) {
      runtime.resetCurrentTask();
      updateActiveTaskDisplay();
      const activeTask = runtime.getActiveTask();
      renderClockTime(activeTask?.allocatedDuration * 60 || 1500);
      updateWheelProgress(0);
      updateResetButtonUI();
      renderTaskList(runtime.currentSchedule?.tasks || []);
    } else {
      resetWholeDay();
    }
  });

  btnSkipTask.addEventListener('click', () => {
    mobileServices.hapticTap();
    runtime.skipCurrentTask();
  });

  btnFinishEarly.addEventListener('click', () => {
    mobileServices.hapticTap();
    runtime.completeCurrentTaskEarly();
  });

  hardStopInput.addEventListener('change', (e) => {
    const newStop = e.target.value;
    if (newStop) {
      taskStore.saveHardStop(newStop);
      runtime.updateHardStop(newStop);
    }
  });

  drawerHeader.addEventListener('click', () => {
    taskDrawer.classList.toggle('collapsed');
  });
}

// ==========================================
// Task Pipeline List & Add Form
// ==========================================
function setupTaskPipeline() {
  addTaskForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const title = document.getElementById('inputTaskTitle').value.trim();
    const duration = parseInt(document.getElementById('inputTaskDuration').value, 10);
    const category = document.getElementById('inputTaskCategory').value.trim() || 'General';
    const tagsRaw = document.getElementById('inputTaskTags').value.trim();
    const fixedTime = document.getElementById('inputTaskFixedTime').value || null;

    if (title && duration > 0) {
      taskStore.addTask({
        title,
        plannedDuration: duration,
        category,
        tags: tagsRaw,
        isLocked: Boolean(fixedTime),
        fixedStartTime: fixedTime
      });

      // Clear inputs
      document.getElementById('inputTaskTitle').value = '';
      document.getElementById('inputTaskCategory').value = '';
      document.getElementById('inputTaskTags').value = '';
      document.getElementById('inputTaskFixedTime').value = '';

      // Reload into runtime
      runtime.initialTasks = taskStore.getTasks();
      runtime.recalculate();
      updateActiveTaskDisplay();
    }
  });
}

function renderTaskList(tasks) {
  taskCountBadge.textContent = `${tasks.length} task${tasks.length === 1 ? '' : 's'}`;
  taskListContainer.innerHTML = '';

  const activeIdx = runtime.activeTaskIndex >= 0 ? runtime.activeTaskIndex : 0;
  const isAllCompleted = runtime.status === TimerStatus.COMPLETED;

  tasks.forEach((task, idx) => {
    const card = document.createElement('div');
    const isImmovable = Boolean(task.fixedStartTime);

    let statusClass = 'task-pending';
    let statusBadge = '<span class="task-status-pill pending">⏳ NOT DONE</span>';

    if (isAllCompleted || (runtime.activeTaskIndex > 0 && idx < runtime.activeTaskIndex)) {
      statusClass = 'task-completed';
      statusBadge = '<span class="task-status-pill completed">✓ COMPLETED</span>';
    } else if (idx === activeIdx && !isAllCompleted) {
      statusClass = 'task-current';
      statusBadge = '<span class="task-status-pill current">▶ CURRENT</span>';
    } else {
      statusClass = 'task-pending';
      statusBadge = '<span class="task-status-pill pending">⏳ NOT DONE</span>';
    }

    card.className = `task-card ${statusClass} ${task.isLocked || isImmovable ? 'locked' : ''}`;

    const isCompressed = task.allocatedDuration < task.plannedDuration;
    const durationText = isCompressed
      ? `${task.allocatedDuration}m <span style="text-decoration:line-through;color:var(--text-dim)">${task.plannedDuration}m</span>`
      : `${task.allocatedDuration}m`;

    const lockTitle = isImmovable
      ? `🔒 Fixed in place at ${task.fixedStartTime} (Immovable)`
      : (task.isLocked ? 'Locked (Incompressible)' : 'Unlocked');

    card.innerHTML = `
      <div class="card-left">
        <div class="card-title-row">
          <span class="card-title">${escapeHtml(task.title)}</span>
          ${statusBadge}
          <span class="card-end-badge ${isImmovable ? 'immovable' : ''}">
            ${isImmovable ? '🔒 FIXED END' : 'HARD STOP'}: ${task.endTime}
          </span>
        </div>
        <div class="card-meta-row">
          <span class="card-time-slot">${task.startTime || ''} → ${task.endTime || ''}</span>
          <span>•</span>
          <span>${escapeHtml(task.category || 'General')}</span>
          ${isImmovable ? '<span style="color:var(--locked-color);font-weight:600">• Fixed</span>' : ''}
        </div>
      </div>
      <div class="card-right">
        <div class="duration-badge ${isCompressed ? 'compressed' : ''}">
          ${durationText}
        </div>
        <button class="btn-icon-action ${task.isLocked || isImmovable ? 'locked' : ''}" data-action="toggle-lock" data-id="${task.id}" title="${lockTitle}">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            ${task.isLocked || isImmovable
              ? '<path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z"/>'
              : '<path d="M12 17c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm6-9h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6h1.9c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm0 12H6V10h12v10z"/>'
            }
          </svg>
        </button>
        <button class="btn-icon-action" data-action="delete" data-id="${task.id}" title="Delete task">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>
      </div>
    `;

    // Lock toggle event
    card.querySelector('[data-action="toggle-lock"]').addEventListener('click', (e) => {
      e.stopPropagation();
      taskStore.toggleLock(task.id);
      runtime.initialTasks = taskStore.getTasks();
      runtime.recalculate();
      updateActiveTaskDisplay();
    });

    // Delete event
    card.querySelector('[data-action="delete"]').addEventListener('click', (e) => {
      e.stopPropagation();
      taskStore.deleteTask(task.id);
      runtime.initialTasks = taskStore.getTasks();
      runtime.recalculate();
      updateActiveTaskDisplay();
    });

    taskListContainer.appendChild(card);
  });
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Start application
window.addEventListener('DOMContentLoaded', initApp);
