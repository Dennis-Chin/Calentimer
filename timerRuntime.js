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

import { calculateSchedule, formatMinutesToTime, parseTimeToMinutes, calculateAvailableMinutes } from './schedulerEngine.js';
import { taskStore } from './taskStore.js';

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
    this.isHardStopEnabled = config.isHardStopEnabled !== undefined ? Boolean(config.isHardStopEnabled) : true;
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

    // Time Bank Overrun state
    this.isOverrunning = false;
    this.overrunStartTime = null;
    this.initialOverrunBankSeconds = 0;
    this.overrunPausedElapsedMs = 0;

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
      const allScheduled = this.currentSchedule.tasks;
      const completedTaskIds = new Set(
        allScheduled.slice(0, Math.max(0, this.activeTaskIndex)).map(t => t.id)
      );

      // Active task
      const activeTask = (this.activeTaskIndex >= 0 && this.activeTaskIndex < allScheduled.length)
        ? allScheduled[this.activeTaskIndex]
        : null;

      if (activeTask && this.initialTasks.some(t => t.id === activeTask.id)) {
        const origTask = this.initialTasks.find(t => t.id === activeTask.id);
        const isCurrentInProgress = (
          this.status === TimerStatus.RUNNING &&
          this.taskStartedAt !== null &&
          !this.isOverrunning
        );

        if (isCurrentInProgress || (this.status === TimerStatus.PAUSED && this.taskStartedAt !== null)) {
          const remainingSec = this.getRemainingSeconds();
          const remainingMin = Math.max(1, Math.ceil(remainingSec / 60));
          remainingTasks.push({
            ...origTask,
            plannedDuration: remainingMin,
            isLocked: this.status === TimerStatus.RUNNING ? true : Boolean(origTask.isLocked || origTask.fixedStartTime)
          });
        } else {
          // Task has not started ticking yet: use its full planned duration!
          remainingTasks.push({
            ...origTask,
            plannedDuration: origTask.plannedDuration,
            isLocked: Boolean(origTask.isLocked || origTask.fixedStartTime)
          });
        }
      }

      // Future tasks in the order they appear in this.initialTasks!
      const activeId = activeTask?.id;
      for (const initTask of this.initialTasks) {
        if (initTask.id === activeId || completedTaskIds.has(initTask.id)) continue;
        remainingTasks.push({
          id: initTask.id,
          title: initTask.title,
          category: initTask.category,
          emoji: initTask.emoji,
          useTimeBank: initTask.useTimeBank !== false,
          tags: initTask.tags,
          fixedStartTime: initTask.fixedStartTime,
          isLocked: Boolean(initTask.isLocked || initTask.fixedStartTime),
          plannedDuration: initTask.plannedDuration
        });
      }
    } else {
      remainingTasks = this.initialTasks.map(t => ({ ...t }));
    }

    if (remainingTasks.length === 0) {
      this.currentSchedule = { success: true, tasks: [], bufferMinutes: 0 };
      this._emit('scheduleUpdate', this.currentSchedule);
      return this.currentSchedule;
    }

    const schedule = calculateSchedule({
      hardStop: this.hardStop,
      startTime: referenceTime,
      tasks: remainingTasks,
      disableHardStop: !this.isHardStopEnabled,
      sortBy: this.status === TimerStatus.IDLE ? this.sortBy : null, // keep execution order if running
      options: this.options
    });

    if (schedule.success) {
      if (this.status === TimerStatus.IDLE) {
        this.currentSchedule = schedule;
      } else {
        // Merge completed tasks with updated upcoming schedule, ensuring updated properties (emoji, title, category) are reflected
        const completedTasks = (this.currentSchedule?.tasks || []).slice(0, this.activeTaskIndex).map(t => {
          const orig = this.initialTasks.find(init => init.id === t.id);
          return orig ? { ...t, emoji: orig.emoji, title: orig.title, category: orig.category } : t;
        });
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
      if (this.isOverrunning && this.overrunPausedElapsedMs) {
        this.overrunStartTime = Date.now() - this.overrunPausedElapsedMs;
      }
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

    if (this.isOverrunning && this.overrunStartTime) {
      this.overrunPausedElapsedMs = Date.now() - this.overrunStartTime;
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
    this.isOverrunning = false;
    this.overrunStartTime = null;
    this.initialOverrunBankSeconds = 0;
    this.overrunPausedElapsedMs = 0;
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
    this.isOverrunning = false;
    this.overrunStartTime = null;
    this.initialOverrunBankSeconds = 0;
    this.overrunPausedElapsedMs = 0;
    this.recalculate();
    this._emit('statusChange', this.status);
  }

  /**
   * Removes a task from the session, recomputing the timeline and advancing if necessary.
   * @param {string} taskId 
   */
  deleteTask(taskId) {
    this.initialTasks = this.initialTasks.filter(t => t.id !== taskId);

    if (this.currentSchedule && this.currentSchedule.tasks) {
      const idx = this.currentSchedule.tasks.findIndex(t => t.id === taskId);
      if (idx !== -1) {
        if (idx === this.activeTaskIndex) {
          if (this.status === TimerStatus.RUNNING || this.status === TimerStatus.PAUSED) {
            this.currentSchedule.tasks.splice(idx, 1);
            if (this.activeTaskIndex >= this.currentSchedule.tasks.length) {
              this._stopTicker();
              this._setStatus(TimerStatus.COMPLETED);
              this._emit('allTasksCompleted', {});
            } else {
              this._startTask(this.activeTaskIndex);
            }
          } else {
            this.currentSchedule.tasks.splice(idx, 1);
            if (this.activeTaskIndex >= this.currentSchedule.tasks.length) {
              this.activeTaskIndex = Math.max(0, this.currentSchedule.tasks.length - 1);
            }
          }
        } else if (idx < this.activeTaskIndex) {
          this.currentSchedule.tasks.splice(idx, 1);
          this.activeTaskIndex = Math.max(0, this.activeTaskIndex - 1);
        } else {
          this.currentSchedule.tasks.splice(idx, 1);
        }
      }
    }

    this.recalculate();
    this._emit('scheduleUpdate', this.currentSchedule);
  }

  /**
   * Marks current task as completed early, deposits surplus time into Time Bank,
   * then dynamically re-compresses the remaining tasks!
   */
  completeCurrentTaskEarly() {
    if (this.status !== TimerStatus.RUNNING && this.status !== TimerStatus.PAUSED) return;

    const currentTask = this.getActiveTask();
    const remainingSec = this.getRemainingSeconds();

    if (this.isOverrunning) {
      this.isOverrunning = false;
      this.overrunStartTime = null;
      this.initialOverrunBankSeconds = 0;
    } else if (remainingSec > 0) {
      taskStore.addTimeBankSeconds(remainingSec);
      this._emit('timeBankDeposit', {
        depositedSeconds: remainingSec,
        secondsDeposited: remainingSec,
        totalTimeBankSeconds: taskStore.getTimeBankSeconds(),
        totalBankSeconds: taskStore.getTimeBankSeconds()
      });
    }

    this._emit('taskComplete', {
      task: currentTask,
      index: this.activeTaskIndex,
      completedEarly: true,
      timeSpentSeconds: this.getElapsedSeconds(),
      bankedSeconds: remainingSec > 0 ? remainingSec : 0
    });

    this._advanceToNextTask();
  }

  /**
   * Skips current task and re-schedules remaining tasks.
   * If in IDLE state, skips ahead to the next task in queue without starting timer.
   */
  skipCurrentTask() {
    const tasks = this.currentSchedule?.tasks || this.initialTasks || [];
    if (tasks.length === 0) return;

    if (this.status === TimerStatus.IDLE) {
      const currentIndex = this.activeTaskIndex >= 0 ? this.activeTaskIndex : 0;
      const nextIndex = (currentIndex + 1) % tasks.length;
      this.activeTaskIndex = nextIndex;

      const nextTask = tasks[this.activeTaskIndex];
      this.taskDurationMs = (nextTask?.allocatedDuration || nextTask?.plannedDuration || 25) * 60 * 1000;
      this.accumulatedElapsedMs = 0;
      this.taskStartedAt = null;
      this.lastResumeTimestamp = null;

      this._emit('taskSkipped', {
        task: tasks[currentIndex],
        index: currentIndex,
        nextTask,
        nextIndex: this.activeTaskIndex
      });

      return;
    }

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
   * Locks the task to prevent stepping back.
   * 
   * @param {number} deltaMinutes 
   */
  adjustActiveTaskDuration(deltaMinutes) {
    if (!deltaMinutes || isNaN(deltaMinutes)) return;

    if (this.status === TimerStatus.IDLE) {
      const targetIndex = Math.max(0, this.activeTaskIndex);
      const targetTask = this.initialTasks[targetIndex];
      if (targetTask) {
        const newDur = Math.max(
          1,
          (targetTask.plannedDuration || 1) + deltaMinutes
        );
        targetTask.plannedDuration = newDur;
        targetTask.allocatedDuration = newDur;
        targetTask.isLocked = true;

        this._ensureHardStopAccommodatesTasks();
        const schedule = this.recalculate();
        this._emit('taskAdjusted', {
          task: targetTask,
          deltaMinutes,
          targetMinutes: newDur
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
      const newDur = Math.ceil(this.taskDurationMs / 60000);
      activeTask.allocatedDuration = newDur;
      activeTask.plannedDuration = newDur;
      activeTask.isLocked = true;

      // Also update in initialTasks so it persists
      const initialTask = this.initialTasks.find(t => t.id === activeTask.id);
      if (initialTask) {
        initialTask.plannedDuration = newDur;
        initialTask.isLocked = true;
      }

      this._ensureHardStopAccommodatesTasks();
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
   * Directly sets the active task to an exact minute target (from rotary dial release).
   * Guarantees the timer stays at that exact minute without stepping back.
   * 
   * @param {number} targetMinutes 
   * @param {number} deltaMinutes 
   */
  setActiveTaskTargetMinutes(targetMinutes, deltaMinutes = 0) {
    targetMinutes = Math.max(1, Math.round(targetMinutes));

    if (this.status === TimerStatus.IDLE) {
      const targetIndex = Math.max(0, this.activeTaskIndex);
      const targetTask = this.initialTasks[targetIndex];
      if (targetTask) {
        targetTask.plannedDuration = targetMinutes;
        targetTask.allocatedDuration = targetMinutes;
        targetTask.isLocked = true;

        this._ensureHardStopAccommodatesTasks();
        const schedule = this.recalculate();
        this._emit('taskAdjusted', {
          task: targetTask,
          targetMinutes,
          deltaMinutes
        });
        return schedule;
      }
    } else {
      const activeTask = this.getActiveTask();
      if (!activeTask) return;

      const elapsedSec = this.getElapsedSeconds();
      // targetMinutes represents the desired remaining minutes on the clock.
      // Total duration for the active task = elapsed seconds + remaining target seconds.
      const targetRemainingSec = Math.max(60, targetMinutes * 60);
      const newTotalSec = elapsedSec + targetRemainingSec;
      const newTotalMinutes = Math.max(1, Math.round(newTotalSec / 60));

      this.taskDurationMs = newTotalSec * 1000;

      activeTask.allocatedDuration = newTotalMinutes;
      activeTask.plannedDuration = newTotalMinutes;
      activeTask.isLocked = true;

      const initialTask = this.initialTasks.find(t => t.id === activeTask.id);
      if (initialTask) {
        initialTask.plannedDuration = newTotalMinutes;
        initialTask.isLocked = true;
      }

      this._ensureHardStopAccommodatesTasks();
      const schedule = this.recalculate(new Date());

      this._emit('taskAdjusted', {
        task: activeTask,
        targetMinutes: newTotalMinutes,
        remainingMinutes: targetMinutes,
        deltaMinutes,
        newRemainingSeconds: targetRemainingSec
      });

      this._tick();
      return schedule;
    }
  }

  /**
   * If total locked tasks exceed available time before Hard Stop,
   * automatically extends Hard Stop so no deficit error or compression occurs.
   */
  _ensureHardStopAccommodatesTasks() {
    if (!this.hardStop) return;
    try {
      const nowMin = parseTimeToMinutes(new Date());
      const stopMin = parseTimeToMinutes(this.hardStop);
      const available = calculateAvailableMinutes(nowMin, stopMin);

      let totalLocked = 0;
      for (const t of this.initialTasks) {
        if (t.isLocked) {
          totalLocked += Math.round(t.plannedDuration || 1);
        }
      }

      if (totalLocked > available) {
        const newStopMin = (nowMin + totalLocked + 15) % 1440;
        this.hardStop = formatMinutesToTime(newStopMin);
      }
    } catch (e) {
      // ignore
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

  /**
   * Toggles or sets whether Hard Stop compression is active.
   * @param {boolean} enabled 
   */
  setHardStopEnabled(enabled) {
    this.isHardStopEnabled = Boolean(enabled);
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
    this.isOverrunning = false;
    this.overrunStartTime = null;
    this.initialOverrunBankSeconds = 0;
    this.overrunPausedElapsedMs = 0;

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
    this.isOverrunning = false;
    this.overrunStartTime = null;
    this.initialOverrunBankSeconds = 0;
    this.overrunPausedElapsedMs = 0;

    const tasks = this.currentSchedule?.tasks || [];
    if (this.activeTaskIndex >= tasks.length) {
      this._stopTicker();
      this._setStatus(TimerStatus.COMPLETED);
      this._emit('allTasksCompleted', {});
      return;
    }

    // Reset task duration to the new task's own planned duration so it never inherits previous task's time
    const nextTask = tasks[this.activeTaskIndex];
    const origNext = this.initialTasks.find(t => t.id === nextTask?.id) || nextTask;
    this.taskDurationMs = (origNext?.allocatedDuration || origNext?.plannedDuration || 25) * 60 * 1000;

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

    const nowMinutes = parseTimeToMinutes(new Date());
    const stopMinutes = parseTimeToMinutes(this.hardStop);
    const isHardStopPassed = (stopMinutes >= nowMinutes)
      ? (nowMinutes >= stopMinutes)
      : false; // midnight wrap handled by calculateSchedule

    // 1. Check if currently in Overrun Mode (consuming Time Bank)
    if (this.isOverrunning) {
      const overrunElapsedSec = Math.floor((Date.now() - this.overrunStartTime) / 1000);
      const currentBankLeft = Math.max(0, this.initialOverrunBankSeconds - overrunElapsedSec);
      taskStore.setTimeBankSeconds(currentBankLeft);

      // Dial goes back to 0 degrees and counts down from total left in Time Bank
      const bankProgressRatio = this.initialOverrunBankSeconds > 0
        ? Math.min(1, overrunElapsedSec / this.initialOverrunBankSeconds)
        : 1;

      this._emit('tick', {
        activeTask: this.getActiveTask(),
        taskIndex: this.activeTaskIndex,
        isOverrunning: true,
        overrunSecondsElapsed: overrunElapsedSec,
        overrunSecondsRemaining: currentBankLeft,
        timeBankSeconds: currentBankLeft,
        elapsedSeconds: Math.floor(this.getElapsedMilliseconds() / 1000),
        remainingSeconds: currentBankLeft,
        totalSeconds: this.initialOverrunBankSeconds,
        progressRatio: bankProgressRatio,
        currentClock: formatMinutesToTime(nowMinutes),
        hardStop: typeof this.hardStop === 'string' ? this.hardStop : formatMinutesToTime(stopMinutes)
      });

      // Time Bank exhausted!
      if (currentBankLeft <= 0) {
        const completedTask = this.getActiveTask();
        this.isOverrunning = false;
        this.overrunStartTime = null;
        this._emit('timeBankExhausted', { task: completedTask, index: this.activeTaskIndex });
        this._emit('taskComplete', {
          task: completedTask,
          index: this.activeTaskIndex,
          completedEarly: false,
          timeSpentSeconds: Math.floor(this.getElapsedMilliseconds() / 1000)
        });
        this._advanceToNextTask();
      }
      return;
    }

    // 2. Normal countdown
    const elapsedMs = this.getElapsedMilliseconds();
    const totalMs = this.taskDurationMs;
    const remainingMs = Math.max(0, totalMs - elapsedMs);

    const elapsedSeconds = Math.floor(elapsedMs / 1000);
    const remainingSeconds = Math.ceil(remainingMs / 1000);
    const progressRatio = totalMs > 0 ? Math.min(1, elapsedMs / totalMs) : 1;

    this._emit('tick', {
      activeTask: this.getActiveTask(),
      taskIndex: this.activeTaskIndex,
      isOverrunning: false,
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

    // 3. Task reached 00:00: check if it should overrun into Time Bank
    if (remainingMs <= 0) {
      const activeTask = this.getActiveTask();
      const currentBank = taskStore.getTimeBankSeconds();

      if (activeTask && activeTask.useTimeBank && currentBank > 0) {
        // Trigger Overrun Mode!
        this.isOverrunning = true;
        this.overrunStartTime = Date.now();
        this.initialOverrunBankSeconds = currentBank;
        this.overrunPausedElapsedMs = 0;

        this._emit('taskOverrunStart', {
          task: activeTask,
          index: this.activeTaskIndex,
          timeBankSeconds: currentBank
        });

        this._tick(); // immediate tick in overrun mode
        return;
      }

      this._emit('taskComplete', {
        task: activeTask,
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
