/**
 * timerRuntime.js
 * 
 * Real-time Execution Runtime for Hard-Stop Study Timer.
 * Designed for both Mobile (Android/Capacitor/PWA) and Web environments.
 * 
 * Key Highlights:
 * 1. Timestamp-based delta timekeeping (immune to mobile background throttling & sleep drift).
 * 2. Real-time dynamic re-compression when tasks finish early, are skipped, or paused.
 * 3. Event-driven architecture with clean subscription hooks.
 * 4. Zero external dependencies.
 */

import { calculateSchedule, formatMinutesToTime, parseTimeToMinutes } from './schedulerEngine.js';

export const TimerStatus = {
  IDLE: 'IDLE',
  RUNNING: 'RUNNING',
  PAUSED: 'PAUSED',
  COMPLETED: 'COMPLETED'
};

export class TimerRuntime {
  /**
   * @param {object} config
   * @param {string|Date|number} config.hardStop - Hard Stop clock time (e.g. "13:00")
   * @param {Array<object>} config.tasks - Task list
   * @param {string|Function|Array<string|Function>} [config.sortBy] - Task sorting criteria
   * @param {object} [config.options] - Options passed to calculateSchedule
   */
  constructor(config = {}) {
    this.hardStop = config.hardStop || null;
    this.initialTasks = config.tasks ? JSON.parse(JSON.stringify(config.tasks)) : [];
    this.sortBy = config.sortBy || null;
    this.options = config.options || {};

    // Execution state
    this.status = TimerStatus.IDLE;
    this.activeTaskIndex = -1;
    this.currentSchedule = null;

    // Timestamp-based tracking for mobile resilience
    this.taskStartedAt = null;       // Timestamp (ms) when current task started
    this.taskDurationMs = 0;         // Current task allocated duration in ms
    this.accumulatedElapsedMs = 0;   // Elapsed ms accumulated before any pauses
    this.lastResumeTimestamp = null; // Timestamp (ms) when last resumed

    // Ticker reference
    this._intervalId = null;

    // Event listeners: Map<eventName, Set<Function>>
    this._listeners = new Map();

    // Initialize initial schedule if tasks and hardStop provided
    if (this.hardStop && this.initialTasks.length > 0) {
      this.recalculate();
    }
  }

  // ==========================================
  // Event Subscription System
  // ==========================================

  /**
   * Subscribes to runtime events.
   * Events: 'tick', 'taskStart', 'taskComplete', 'scheduleUpdate', 'statusChange', 'hardStopReached', 'allTasksCompleted', 'error'
   * 
   * @param {string} event 
   * @param {Function} callback 
   * @returns {Function} Unsubscribe function
   */
  on(event, callback) {
    if (!this._listeners.has(event)) {
      this._listeners.set(event, new Set());
    }
    this._listeners.get(event).add(callback);
    return () => this.off(event, callback);
  }

  off(event, callback) {
    if (this._listeners.has(event)) {
      this._listeners.get(event).delete(callback);
    }
  }

  _emit(event, payload) {
    if (this._listeners.has(event)) {
      for (const listener of this._listeners.get(event)) {
        try {
          listener(payload);
        } catch (err) {
          console.error(`Error in event listener for "${event}":`, err);
        }
      }
    }
  }

  // ==========================================
  // Schedule Recalculation & Re-compression
  // ==========================================

  /**
   * Recalculates the schedule starting from the current time.
   * If a task is currently active or tasks have completed, only remaining tasks are scheduled.
   * 
   * @param {string|Date|number} [referenceTime] - Optional reference start time (defaults to now)
   * @returns {object} Schedule calculation result
   */
  recalculate(referenceTime = new Date()) {
    if (!this.hardStop) {
      const err = { code: 'MISSING_HARD_STOP', message: 'No Hard Stop specified.' };
      this._emit('error', err);
      return { success: false, error: err };
    }

    // Determine which tasks still need scheduling
    let remainingTasks = [];
    if (this.status === TimerStatus.IDLE) {
      remainingTasks = this.initialTasks.map(t => ({ ...t }));
    } else if (this.currentSchedule && this.currentSchedule.tasks) {
      // Current active task remaining duration + all subsequent tasks
      const allScheduled = this.currentSchedule.tasks;
      for (let i = this.activeTaskIndex; i < allScheduled.length; i++) {
        const task = allScheduled[i];
        if (i === this.activeTaskIndex) {
          // Compute remaining minutes for current task
          const remainingSec = this.getRemainingSeconds();
          const remainingMin = Math.max(1, Math.ceil(remainingSec / 60));

          remainingTasks.push({
            ...task,
            plannedDuration: remainingMin,
            // Keep active task locked so its in-progress remaining time is preserved
            isLocked: true
          });
        } else {
          // Future task: use original planned duration from initialTasks for fair proportional re-compression
          const origTask = this.initialTasks.find(t => t.id === task.id) || task;
          remainingTasks.push({
            id: task.id,
            title: task.title,
            category: task.category,
            tags: task.tags,
            isLocked: origTask.isLocked,
            plannedDuration: origTask.plannedDuration
          });
        }
      }
    } else {
      remainingTasks = this.initialTasks.map(t => ({ ...t }));
    }

    if (remainingTasks.length === 0) {
      return { success: true, tasks: [], bufferMinutes: 0 };
    }

    const schedule = calculateSchedule({
      hardStop: this.hardStop,
      startTime: referenceTime,
      tasks: remainingTasks,
      sortBy: this.status === TimerStatus.IDLE ? this.sortBy : null, // keep execution order if running
      options: this.options
    });

    if (schedule.success) {
      if (this.status === TimerStatus.IDLE) {
        this.currentSchedule = schedule;
      } else {
        // Merge completed tasks with updated upcoming schedule
        const completedTasks = (this.currentSchedule?.tasks || []).slice(0, this.activeTaskIndex);
        this.currentSchedule = {
          ...schedule,
          tasks: [...completedTasks, ...schedule.tasks]
        };
      }
      this._emit('scheduleUpdate', this.currentSchedule);
    } else {
      this._emit('error', schedule.error);
    }

    return schedule;
  }

  // ==========================================
  // Timer Controls
  // ==========================================

  /**
   * Starts or resumes the timer.
   */
  start() {
    if (this.status === TimerStatus.RUNNING) return;

    if (this.status === TimerStatus.IDLE) {
      const scheduleResult = this.recalculate();
      if (!scheduleResult.success) return scheduleResult;

      if (!this.currentSchedule || this.currentSchedule.tasks.length === 0) {
        this._setStatus(TimerStatus.COMPLETED);
        this._emit('allTasksCompleted', {});
        return;
      }

      this.activeTaskIndex = 0;
      this._startTask(0);
    } else if (this.status === TimerStatus.PAUSED) {
      // Resume
      this.lastResumeTimestamp = Date.now();
      this._setStatus(TimerStatus.RUNNING);
      this._startTicker();
      this._emit('resume', { activeTask: this.getActiveTask() });
    }

    return { success: true };
  }

  /**
   * Pauses the timer.
   */
  pause() {
    if (this.status !== TimerStatus.RUNNING) return;

    // Capture exact elapsed time before pausing
    if (this.lastResumeTimestamp) {
      this.accumulatedElapsedMs += (Date.now() - this.lastResumeTimestamp);
      this.lastResumeTimestamp = null;
    }

    this._stopTicker();
    this._setStatus(TimerStatus.PAUSED);
    this._emit('pause', {
      activeTask: this.getActiveTask(),
      elapsedSeconds: this.getElapsedSeconds(),
      remainingSeconds: this.getRemainingSeconds()
    });
  }

  /**
   * Stops the current task and resets its timer back to the beginning of this task.
   * Preserves current task position in schedule.
   */
  resetCurrentTask() {
    this._stopTicker();
    this.status = TimerStatus.PAUSED;
    this.accumulatedElapsedMs = 0;
    this.lastResumeTimestamp = null;
    if (this.taskDurationMs <= 0) {
      const activeTask = this.getActiveTask();
      const allocatedMin = activeTask?.allocatedDuration || activeTask?.plannedDuration || 25;
      this.taskDurationMs = allocatedMin * 60 * 1000;
    }
    this.taskStartedAt = Date.now();

    const totalSeconds = Math.floor(this.taskDurationMs / 1000);
    const nowMinutes = parseTimeToMinutes(new Date());
    const stopMinutes = parseTimeToMinutes(this.hardStop);

    this._emit('tick', {
      activeTask: this.getActiveTask(),
      taskIndex: this.activeTaskIndex,
      elapsedSeconds: 0,
      remainingSeconds: totalSeconds,
      totalSeconds,
      progressRatio: 0,
      currentClock: formatMinutesToTime(nowMinutes),
      hardStop: typeof this.hardStop === 'string' ? this.hardStop : formatMinutesToTime(stopMinutes)
    });

    this._emit('statusChange', this.status);
  }

  /**
   * Resets entire timer session back to IDLE state.
   */
  reset() {
    this._stopTicker();
    this.status = TimerStatus.IDLE;
    this.activeTaskIndex = -1;
    this.accumulatedElapsedMs = 0;
    this.lastResumeTimestamp = null;
    this.taskStartedAt = null;
    this.taskDurationMs = 0;
    this.recalculate();
    this._emit('statusChange', this.status);
  }

  /**
   * Marks current task as completed early, then dynamically re-compresses
   * the remaining tasks with the newly reclaimed surplus time!
   */
  completeCurrentTaskEarly() {
    if (this.status !== TimerStatus.RUNNING && this.status !== TimerStatus.PAUSED) return;

    const currentTask = this.getActiveTask();
    this._emit('taskComplete', {
      task: currentTask,
      index: this.activeTaskIndex,
      completedEarly: true,
      timeSpentSeconds: this.getElapsedSeconds()
    });

    this._advanceToNextTask();
  }

  /**
   * Skips current task and re-schedules remaining tasks.
   */
  skipCurrentTask() {
    if (this.status !== TimerStatus.RUNNING && this.status !== TimerStatus.PAUSED) return;

    const currentTask = this.getActiveTask();
    this._emit('taskSkipped', {
      task: currentTask,
      index: this.activeTaskIndex
    });

    this._advanceToNextTask();
  }

  /**
   * Adjusts the active task's duration by deltaMinutes (+ or -) and immediately
   * recalculates the schedule, proportionally re-compressing remaining tasks to fit Hard Stop.
   * 
   * @param {number} deltaMinutes 
   */
  adjustActiveTaskDuration(deltaMinutes) {
    if (!deltaMinutes || isNaN(deltaMinutes)) return;

    if (this.status === TimerStatus.IDLE) {
      const targetIndex = Math.max(0, this.activeTaskIndex);
      if (this.initialTasks[targetIndex]) {
        this.initialTasks[targetIndex].plannedDuration = Math.max(
          1,
          (this.initialTasks[targetIndex].plannedDuration || 1) + deltaMinutes
        );
        const schedule = this.recalculate();
        this._emit('taskAdjusted', {
          task: this.initialTasks[targetIndex],
          deltaMinutes
        });
        return schedule;
      }
    } else {
      // RUNNING or PAUSED
      const activeTask = this.getActiveTask();
      if (!activeTask) return;

      const currentRemainingSec = this.getRemainingSeconds();
      const newRemainingSec = Math.max(60, currentRemainingSec + deltaMinutes * 60);

      // Adjust taskDurationMs so getRemainingSeconds() immediately reflects the new duration
      this.taskDurationMs = (this.getElapsedSeconds() + newRemainingSec) * 1000;

      // Update the active task's duration in currentSchedule
      activeTask.allocatedDuration = Math.max(1, (activeTask.allocatedDuration || 1) + deltaMinutes);
      activeTask.plannedDuration = Math.max(1, (activeTask.plannedDuration || 1) + deltaMinutes);

      // Also update in initialTasks so it persists
      const initialTask = this.initialTasks.find(t => t.id === activeTask.id);
      if (initialTask) {
        initialTask.plannedDuration = activeTask.plannedDuration;
      }

      // Recalculate schedule from current clock time: re-compresses upcoming tasks to fit Hard Stop!
      const schedule = this.recalculate(new Date());

      this._emit('taskAdjusted', {
        task: activeTask,
        deltaMinutes,
        newRemainingSeconds: newRemainingSec
      });

      // Immediate tick emission to refresh UI
      this._tick();

      return schedule;
    }
  }

  /**
   * Updates Hard Stop clock time and re-compresses schedule.
   * @param {string|Date|number} newHardStop 
   */
  updateHardStop(newHardStop) {
    this.hardStop = newHardStop;
    return this.recalculate();
  }

  // ==========================================
  // Internal State Transitions
  // ==========================================

  _startTask(index) {
    const tasks = this.currentSchedule?.tasks || [];
    if (index >= tasks.length) {
      this._stopTicker();
      this._setStatus(TimerStatus.COMPLETED);
      this._emit('allTasksCompleted', {});
      return;
    }

    this.activeTaskIndex = index;
    const task = tasks[index];
    this.taskDurationMs = (task.allocatedDuration || 1) * 60 * 1000;
    this.accumulatedElapsedMs = 0;
    this.taskStartedAt = Date.now();
    this.lastResumeTimestamp = this.taskStartedAt;

    this._setStatus(TimerStatus.RUNNING);
    this._startTicker();

    this._emit('taskStart', {
      task,
      index,
      totalDurationSeconds: Math.floor(this.taskDurationMs / 1000)
    });

    // Immediate initial tick
    this._tick();
  }

  _advanceToNextTask() {
    this.activeTaskIndex++;
    this.accumulatedElapsedMs = 0;
    this.lastResumeTimestamp = null;
    this.taskStartedAt = null;

    const tasks = this.currentSchedule?.tasks || [];
    if (this.activeTaskIndex >= tasks.length) {
      this._stopTicker();
      this._setStatus(TimerStatus.COMPLETED);
      this._emit('allTasksCompleted', {});
      return;
    }

    // Dynamic re-compression for remaining tasks from current wall-clock time
    this.recalculate();

    if (this.status === TimerStatus.RUNNING) {
      this._startTask(this.activeTaskIndex);
    }
  }

  _setStatus(newStatus) {
    if (this.status !== newStatus) {
      this.status = newStatus;
      this._emit('statusChange', newStatus);
    }
  }

  // ==========================================
  // Precision Clock & Delta Ticking (Mobile Safe)
  // ==========================================

  _startTicker() {
    this._stopTicker();
    // 500ms ticker interval prevents jitter while staying lightweight on battery
    this._intervalId = setInterval(() => this._tick(), 500);
  }

  _stopTicker() {
    if (this._intervalId) {
      clearInterval(this._intervalId);
      this._intervalId = null;
    }
  }

  _tick() {
    if (this.status !== TimerStatus.RUNNING) return;

    const elapsedMs = this.getElapsedMilliseconds();
    const totalMs = this.taskDurationMs;
    const remainingMs = Math.max(0, totalMs - elapsedMs);

    const elapsedSeconds = Math.floor(elapsedMs / 1000);
    const remainingSeconds = Math.ceil(remainingMs / 1000);
    const progressRatio = totalMs > 0 ? Math.min(1, elapsedMs / totalMs) : 1;

    // Check if Hard Stop has been passed
    const nowMinutes = parseTimeToMinutes(new Date());
    const stopMinutes = parseTimeToMinutes(this.hardStop);
    const isHardStopPassed = (stopMinutes >= nowMinutes)
      ? (nowMinutes >= stopMinutes)
      : false; // midnight wrap handled by calculateSchedule

    this._emit('tick', {
      activeTask: this.getActiveTask(),
      taskIndex: this.activeTaskIndex,
      elapsedSeconds,
      remainingSeconds,
      totalSeconds: Math.floor(totalMs / 1000),
      progressRatio,
      currentClock: formatMinutesToTime(nowMinutes),
      hardStop: typeof this.hardStop === 'string' ? this.hardStop : formatMinutesToTime(stopMinutes)
    });

    if (isHardStopPassed && remainingSeconds === 0) {
      this._emit('hardStopReached', { currentClock: formatMinutesToTime(nowMinutes) });
    }

    // Task finished naturally
    if (remainingMs <= 0) {
      const completedTask = this.getActiveTask();
      this._emit('taskComplete', {
        task: completedTask,
        index: this.activeTaskIndex,
        completedEarly: false,
        timeSpentSeconds: elapsedSeconds
      });

      this._advanceToNextTask();
    }
  }

  /**
   * Seeks / scrubs active timer remaining time in 1-second increments.
   * Can be adjusted while RUNNING, PAUSED, or IDLE.
   * 
   * @param {number} remainingSeconds 
   */
  seek(remainingSeconds) {
    if (this.taskDurationMs <= 0) {
      const activeTask = this.getActiveTask();
      const allocatedMin = activeTask?.allocatedDuration || activeTask?.plannedDuration || 25;
      this.taskDurationMs = allocatedMin * 60 * 1000;
    }

    // Allow taskDurationMs to dynamically expand if remainingSeconds exceeds current duration (e.g. scrubbing past 0)
    const targetMs = Math.round(remainingSeconds) * 1000;
    if (targetMs > this.taskDurationMs) {
      this.taskDurationMs = targetMs;
      const activeTask = this.getActiveTask();
      if (activeTask) {
        activeTask.allocatedDuration = Math.ceil(remainingSeconds / 60);
      }
    }

    const totalSeconds = Math.floor(this.taskDurationMs / 1000);
    const clampedRemaining = Math.max(0, Math.min(totalSeconds, Math.round(remainingSeconds)));
    const newElapsedSeconds = totalSeconds - clampedRemaining;

    this.accumulatedElapsedMs = newElapsedSeconds * 1000;
    if (this.status === TimerStatus.RUNNING) {
      this.lastResumeTimestamp = Date.now();
    }

    const progressRatio = totalSeconds > 0 ? newElapsedSeconds / totalSeconds : 0;
    const nowMinutes = parseTimeToMinutes(new Date());
    const stopMinutes = parseTimeToMinutes(this.hardStop);

    this._emit('tick', {
      activeTask: this.getActiveTask(),
      taskIndex: this.activeTaskIndex,
      elapsedSeconds: newElapsedSeconds,
      remainingSeconds: clampedRemaining,
      totalSeconds,
      progressRatio,
      currentClock: formatMinutesToTime(nowMinutes),
      hardStop: typeof this.hardStop === 'string' ? this.hardStop : formatMinutesToTime(stopMinutes)
    });

    this._emit('seek', {
      remainingSeconds: clampedRemaining,
      elapsedSeconds: newElapsedSeconds,
      progressRatio
    });
  }

  // ==========================================
  // Public Accessors & Helpers
  // ==========================================

  getActiveTask() {
    if (!this.currentSchedule?.tasks || this.currentSchedule.tasks.length === 0) return null;
    if (this.status === TimerStatus.COMPLETED) return null;
    const index = this.activeTaskIndex >= 0 ? this.activeTaskIndex : 0;
    return this.currentSchedule.tasks[index] || null;
  }

  getElapsedMilliseconds() {
    let elapsed = this.accumulatedElapsedMs;
    if (this.status === TimerStatus.RUNNING && this.lastResumeTimestamp) {
      elapsed += (Date.now() - this.lastResumeTimestamp);
    }
    return elapsed;
  }

  getElapsedSeconds() {
    return Math.floor(this.getElapsedMilliseconds() / 1000);
  }

  getRemainingSeconds() {
    const totalSeconds = Math.floor(this.taskDurationMs / 1000);
    return Math.max(0, totalSeconds - this.getElapsedSeconds());
  }

  getProgress() {
    const totalMs = this.taskDurationMs;
    if (totalMs <= 0) return 0;
    return Math.min(1, Math.max(0, this.getElapsedMilliseconds() / totalMs));
  }

  getState() {
    return {
      status: this.status,
      activeTaskIndex: this.activeTaskIndex,
      activeTask: this.getActiveTask(),
      elapsedSeconds: this.getElapsedSeconds(),
      remainingSeconds: this.getRemainingSeconds(),
      progress: this.getProgress(),
      schedule: this.currentSchedule
    };
  }
}

export default TimerRuntime;
