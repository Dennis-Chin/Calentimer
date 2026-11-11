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
    this.isLoopEnabled = config.isLoopEnabled !== undefined ? Boolean(config.isLoopEnabled) : false;
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

  /**
   * Sets whether the timer continuously loops through its schedule.
   * @param {boolean} enabled
   */
  setLoopEnabled(enabled) {
    this.isLoopEnabled = Boolean(enabled);
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

    if (this.status === TimerStatus.COMPLETED && this.initialTasks && this.initialTasks.length > 0) {
      this.status = TimerStatus.IDLE;
      this.activeTaskIndex = 0;
    }

    const isSimple = (typeof taskStore !== 'undefined' && typeof taskStore.getAppMode === 'function')
      ? taskStore.getAppMode() === 'simple'
      : false;
    const isSequential = isSimple || (typeof taskStore !== 'undefined' && typeof taskStore.getTimespansEnabled === 'function' && !taskStore.getTimespansEnabled());

    // Determine which tasks still need scheduling
    let remainingTasks = [];
    if (this.status === TimerStatus.IDLE) {
      remainingTasks = this.initialTasks.map(t => {
        const copy = Object.assign({}, t);
        if (isSequential && !t.isCompleted) {
          copy.fixedStartTime = null;
          copy.fixedEndTime = null;
          copy.startTime = null;
          copy.endTime = null;
        }
        return copy;
      });
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
          const startedStartStr = formatMinutesToTime(parseTimeToMinutes(new Date(this.taskStartedAt)));
          remainingTasks.push(Object.assign({}, origTask, {
            fixedStartTime: (!isSequential && origTask.isLocked) ? (origTask.fixedStartTime || origTask.startTime) : startedStartStr,
            fixedEndTime: (!isSequential && origTask.isLocked) ? (origTask.fixedEndTime || origTask.endTime) : null,
            startTime: (!isSequential && origTask.isLocked) ? (origTask.startTime || origTask.fixedStartTime) : startedStartStr,
            endTime: (!isSequential && origTask.isLocked) ? (origTask.endTime || origTask.fixedEndTime) : undefined,
            plannedDuration: (!isSequential && origTask.isLocked) ? origTask.plannedDuration : remainingMin,
            isLocked: Boolean(origTask.isLocked)
          }));
        } else {
          // Task has not started ticking yet: use its full planned duration!
          remainingTasks.push(Object.assign({}, origTask, {
            startTime: isSequential ? null : (origTask.startTime || null),
            endTime: isSequential ? null : (origTask.endTime || null),
            fixedStartTime: isSequential ? null : (origTask.fixedStartTime || (origTask.isLocked ? origTask.startTime : null)),
            fixedEndTime: isSequential ? null : (origTask.fixedEndTime || (origTask.isLocked ? origTask.endTime : null)),
            plannedDuration: origTask.plannedDuration,
            isLocked: Boolean(origTask.isLocked)
          }));
        }
      }

      // Future tasks in the order they appear in this.initialTasks!
      const activeId = activeTask ? activeTask.id : null;
      for (const initTask of this.initialTasks) {
        if (initTask.id === activeId || completedTaskIds.has(initTask.id)) continue;
        remainingTasks.push({
          id: initTask.id,
          title: initTask.title,
          category: initTask.category,
          emoji: initTask.emoji,
          color: initTask.color || null,
          colorId: initTask.colorId || null,
          useTimeBank: initTask.useTimeBank !== false,
          tags: initTask.tags,
          startTime: isSequential ? null : (initTask.startTime || null),
          endTime: isSequential ? null : (initTask.endTime || null),
          fixedStartTime: isSequential ? null : (initTask.fixedStartTime || (initTask.isLocked ? initTask.startTime : null)),
          fixedEndTime: isSequential ? null : (initTask.fixedEndTime || (initTask.isLocked ? initTask.endTime : null)),
          isLocked: Boolean(initTask.isLocked),
          isCompleted: Boolean(initTask.isCompleted),
          completedDate: initTask.completedDate || null,
          manualCompleted: (typeof initTask.manualCompleted === 'boolean') ? initTask.manualCompleted : null,
          plannedDuration: initTask.plannedDuration
        });
      }
    } else {
      remainingTasks = this.initialTasks.map(t => {
        const copy = Object.assign({}, t);
        if (isSequential) {
          copy.fixedStartTime = null;
          copy.fixedEndTime = null;
          copy.startTime = null;
          copy.endTime = null;
        }
        return copy;
      });
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
      isSequential: isSequential,
      options: Object.assign({}, this.options, { isSequential: isSequential })
    });

    if (schedule.success) {
      if (this.status === TimerStatus.IDLE) {
        this.currentSchedule = schedule;
      } else {
        // Merge completed tasks with updated upcoming schedule, ensuring updated properties (emoji, title, category, color, completion status) are reflected
        const completedTasks = ((this.currentSchedule && this.currentSchedule.tasks) || []).slice(0, this.activeTaskIndex).map(t => {
          const orig = this.initialTasks.find(init => init.id === t.id);
          return orig ? {
            ...t,
            emoji: orig.emoji,
            title: orig.title,
            category: orig.category,
            color: orig.color,
            colorId: orig.colorId,
            isCompleted: Boolean(orig.isCompleted),
            completedDate: orig.completedDate || null,
            manualCompleted: (typeof orig.manualCompleted === 'boolean') ? orig.manualCompleted : null
          } : t;
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

    if (this.isHardStopEnabled && this.hardStop) {
      const nowMin = parseTimeToMinutes(new Date());
      const stopMin = parseTimeToMinutes(this.hardStop);
      if (calculateAvailableMinutes(nowMin, stopMin) <= 0) {
        this._emit('hardStopReached', { currentClock: formatMinutesToTime(nowMin), hardStop: this.hardStop });
        return { success: false, error: 'HARD_STOP_PASSED' };
      }
    }

    if (this.status === TimerStatus.IDLE) {
      if (!this.initialTasks || this.initialTasks.length === 0) {
        return { success: false, reason: 'NO_TASKS' };
      }

      const scheduleResult = this.recalculate();
      if (!scheduleResult.success) return scheduleResult;

      if (!this.currentSchedule || this.currentSchedule.tasks.length === 0) {
        return { success: false, reason: 'NO_TASKS' };
      }

      const isTimespans = (typeof taskStore !== 'undefined' && typeof taskStore.getTimespansEnabled === 'function')
        ? taskStore.getTimespansEnabled()
        : true;
      const indentedIds = this.getIndentedOverlapTaskIds(this.currentSchedule.tasks);
      if (this.activeTaskIndex >= 0 && this.activeTaskIndex < this.currentSchedule.tasks.length && !indentedIds.has(this.currentSchedule.tasks[this.activeTaskIndex] && this.currentSchedule.tasks[this.activeTaskIndex].id)) {
        // User explicitly focused or viewed this non-indented task on the timer screen: start this exact task!
      } else if (isTimespans) {
        let targetIdx = this.getActiveTaskIndexByTime(this.currentSchedule.tasks);
        if (targetIdx < 0) {
          if (this.currentSchedule.tasks.length > 0) {
            targetIdx = this.currentSchedule.tasks.findIndex(t => t && !indentedIds.has(t.id));
            if (targetIdx < 0) targetIdx = 0;
          } else {
            this._setStatus(TimerStatus.COMPLETED);
            this._emit('allTasksCompleted', {});
            return { success: false, reason: 'ALL_TASKS_PAST' };
          }
        }
        this.activeTaskIndex = targetIdx;
      } else {
        const firstNonIndented = this.currentSchedule.tasks.findIndex(t => t && !indentedIds.has(t.id));
        this.activeTaskIndex = firstNonIndented >= 0 ? firstNonIndented : 0;
      }
      this._startTask(this.activeTaskIndex);
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
    this.saveSessionState();
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
      const allocatedMin = (activeTask && (activeTask.allocatedDuration || activeTask.plannedDuration)) || 25;
      this.taskDurationMs = allocatedMin * 60 * 1000;
    }
    this.taskStartedAt = Date.now();
    this.saveSessionState();

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
    this.saveSessionState();

    this._emit('statusChange', this.status);
  }

  /**
   * Resets entire timer session back to IDLE state.
   */
  reset() {
    this._stopTicker();
    this.status = TimerStatus.IDLE;
    this.activeTaskIndex = 0;
    this.accumulatedElapsedMs = 0;
    this.lastResumeTimestamp = null;
    this.taskStartedAt = null;
    this.taskDurationMs = 0;
    this.isOverrunning = false;
    this.overrunStartTime = null;
    this.initialOverrunBankSeconds = 0;
    this.overrunPausedElapsedMs = 0;
    if (typeof taskStore !== 'undefined' && typeof taskStore.clearTimerSession === 'function') {
      taskStore.clearTimerSession();
    }
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

    if (currentTask && currentTask.id) {
      const todayStr = (typeof taskStore !== 'undefined' && typeof taskStore.getTodayDateString === 'function')
        ? taskStore.getTodayDateString()
        : new Date().toISOString().split('T')[0];
      currentTask.isCompleted = true;
      currentTask.completedDate = todayStr;
      if (typeof taskStore !== 'undefined' && typeof taskStore.updateTask === 'function') {
        taskStore.updateTask(currentTask.id, {
          isCompleted: true,
          completedDate: todayStr
        });
      }
    }

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
    const tasks = (this.currentSchedule && this.currentSchedule.tasks) || this.initialTasks || [];
    if (tasks.length === 0) return;

    if (this.status === TimerStatus.IDLE) {
      const indentedIds = this.getIndentedOverlapTaskIds(tasks);
      const currentIndex = this.activeTaskIndex >= 0 ? this.activeTaskIndex : 0;
      let nextIndex = (currentIndex + 1) % tasks.length;
      for (let step = 0; step < tasks.length; step++) {
        const cand = tasks[nextIndex];
        if (cand && !indentedIds.has(cand.id)) break;
        nextIndex = (nextIndex + 1) % tasks.length;
      }
      this.activeTaskIndex = nextIndex;

      const nextTask = tasks[this.activeTaskIndex];
      this.taskDurationMs = ((nextTask && (nextTask.allocatedDuration || nextTask.plannedDuration)) || 25) * 60 * 1000;
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
      const activeTask = this.getActiveTask();
      const targetTask = (activeTask && this.initialTasks.find(t => t.id === activeTask.id))
        || this.initialTasks[Math.max(0, this.activeTaskIndex)];
      if (targetTask) {
        const baseDur = (activeTask && (activeTask.allocatedDuration || activeTask.plannedDuration)) || targetTask.plannedDuration || 1;
        const newDur = Math.max(1, baseDur + deltaMinutes);
        targetTask.plannedDuration = newDur;
        targetTask.allocatedDuration = newDur;
        targetTask.fixedEndTime = null;
        targetTask.dialAdjusted = true;
        if (!targetTask.isLocked) {
          targetTask.fixedStartTime = null;
        }
        this.taskDurationMs = newDur * 60 * 1000;
        this.accumulatedElapsedMs = 0;

        this._ensureHardStopAccommodatesTasks();
        const schedule = this.recalculate();
        const updatedActive = this.getActiveTask();
        if (updatedActive && updatedActive.id === targetTask.id) {
          updatedActive.fixedEndTime = null;
          updatedActive.dialAdjusted = true;
        }
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

      // Anchor elapsed ms accurately and set taskDurationMs so getRemainingSeconds() immediately reflects the new duration
      const elapsedMs = this.getElapsedMilliseconds();
      this.accumulatedElapsedMs = elapsedMs;
      if (this.status === TimerStatus.RUNNING) {
        this.lastResumeTimestamp = Date.now();
      }
      this.taskDurationMs = this.accumulatedElapsedMs + (newRemainingSec * 1000);

      // Update the active task's duration in currentSchedule
      const newDur = Math.ceil(this.taskDurationMs / 60000);
      activeTask.allocatedDuration = newDur;
      activeTask.plannedDuration = newDur;
      activeTask.fixedEndTime = null;
      activeTask.dialAdjusted = true;

      // Also update in initialTasks so it persists
      const initialTask = this.initialTasks.find(t => t.id === activeTask.id);
      if (initialTask) {
        initialTask.plannedDuration = newDur;
        initialTask.allocatedDuration = newDur;
        initialTask.fixedEndTime = null;
        initialTask.dialAdjusted = true;
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
   * Directly sets the active task to an exact second target (from rotary dial release).
   * Preserves exact seconds and prevents rounding off to whole minutes.
   * 
   * @param {number} targetRemainingSec 
   * @param {number} deltaMinutes 
   */
  setActiveTaskTargetSeconds(targetRemainingSec, deltaMinutes = 0) {
    targetRemainingSec = Math.max(10, Math.round(targetRemainingSec));

    if (this.status === TimerStatus.IDLE) {
      const activeTask = this.getActiveTask();
      const targetTask = (activeTask && this.initialTasks.find(t => t.id === activeTask.id))
        || this.initialTasks[Math.max(0, this.activeTaskIndex)];
      if (targetTask) {
        const targetMinutes = Math.max(1, Math.round(targetRemainingSec / 60));
        targetTask.plannedDuration = targetMinutes;
        targetTask.allocatedDuration = targetMinutes;
        targetTask.fixedEndTime = null;
        targetTask.dialAdjusted = true;
        if (!targetTask.isLocked) {
          targetTask.fixedStartTime = null;
        }
        this.taskDurationMs = targetRemainingSec * 1000;
        this.accumulatedElapsedMs = 0;

        this._ensureHardStopAccommodatesTasks();
        const schedule = this.recalculate();
        const updatedActive = this.getActiveTask();
        if (updatedActive && updatedActive.id === targetTask.id) {
          updatedActive.fixedEndTime = null;
          updatedActive.dialAdjusted = true;
        }
        this._emit('taskAdjusted', {
          task: targetTask,
          targetMinutes,
          deltaMinutes,
          newRemainingSeconds: targetRemainingSec
        });
        return schedule;
      }
    } else {
      const activeTask = this.getActiveTask();
      if (!activeTask) return;

      const elapsedMs = this.getElapsedMilliseconds();
      this.accumulatedElapsedMs = elapsedMs;
      if (this.status === TimerStatus.RUNNING) {
        this.lastResumeTimestamp = Date.now();
      }
      this.taskDurationMs = this.accumulatedElapsedMs + (targetRemainingSec * 1000);

      const newTotalSec = Math.round(this.taskDurationMs / 1000);
      const newTotalMinutes = Math.max(1, Math.round(newTotalSec / 60));

      activeTask.allocatedDuration = newTotalMinutes;
      activeTask.plannedDuration = newTotalMinutes;
      activeTask.fixedEndTime = null;
      activeTask.dialAdjusted = true;

      const initialTask = this.initialTasks.find(t => t.id === activeTask.id);
      if (initialTask) {
        initialTask.plannedDuration = newTotalMinutes;
        initialTask.allocatedDuration = newTotalMinutes;
        initialTask.fixedEndTime = null;
        initialTask.dialAdjusted = true;
      }

      this._ensureHardStopAccommodatesTasks();
      const schedule = this.recalculate(new Date());

      this._emit('taskAdjusted', {
        task: activeTask,
        targetMinutes: newTotalMinutes,
        remainingMinutes: Math.round(targetRemainingSec / 60),
        deltaMinutes,
        newRemainingSeconds: targetRemainingSec
      });

      this._tick();
      return schedule;
    }
  }

  /**
   * Directly sets the active task to an exact minute target (from rotary dial release).
   * 
   * @param {number} targetMinutes 
   * @param {number} deltaMinutes 
   */
  setActiveTaskTargetMinutes(targetMinutes, deltaMinutes = 0) {
    return this.setActiveTaskTargetSeconds(targetMinutes * 60, deltaMinutes);
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
    const tasks = (this.currentSchedule && this.currentSchedule.tasks) || [];
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

    const isTimespans = (typeof taskStore !== 'undefined' && typeof taskStore.getTimespansEnabled === 'function')
      ? taskStore.getTimespansEnabled()
      : true;

    if (isTimespans) {
      // Chronological mode:
      const origTask = (this.initialTasks && task && this.initialTasks.find(t => t.id === task.id)) || task;
      const isLockedTask = Boolean(origTask && origTask.isLocked);
      const startTimeVal = (origTask && (origTask.fixedStartTime || origTask.startTime)) || (task && (task.fixedStartTime || task.startTime));
      const hasDefinedEndTime = (Boolean(origTask && origTask.fixedEndTime) || Boolean(task && task.fixedEndTime))
        && !Boolean(origTask && origTask.dialAdjusted)
        && !Boolean(task && task.dialAdjusted);
      const endTimeVal = hasDefinedEndTime
        ? ((origTask && origTask.fixedEndTime) || (task && task.fixedEndTime))
        : ((origTask && origTask.endTime) || (task && task.endTime));

      if (isLockedTask && startTimeVal && endTimeVal) {
        const sMin = parseTimeToMinutes(startTimeVal);
        let eMin = parseTimeToMinutes(endTimeVal);
        if (eMin <= sMin) eMin += 1440;
        const now = new Date();
        const nowMin = (now.getHours() * 60) + now.getMinutes();

        if (nowMin > sMin && nowMin < eMin) {
          // Time is past the start time: remaining duration counts down, but scheduled timespan remains fixed
          const remainingDurationMin = eMin - nowMin;
          this.taskDurationMs = remainingDurationMin * 60 * 1000;
          this.accumulatedElapsedMs = 0;
          task.startTime = startTimeVal;
          task.endTime = endTimeVal;
          task.allocatedDuration = remainingDurationMin;
        } else if (nowMin <= sMin) {
          // Started before or at scheduled start time: full duration
          const fullDurationMin = eMin - sMin;
          this.taskDurationMs = fullDurationMin * 60 * 1000;
          this.accumulatedElapsedMs = 0;
          task.startTime = startTimeVal;
          task.endTime = endTimeVal;
          task.allocatedDuration = fullDurationMin;
        } else {
          // Past end time: run with planned duration or remaining time
          const fullDurationMin = Math.max(1, (task.allocatedDuration || task.plannedDuration || (eMin - sMin) || 1));
          this.taskDurationMs = fullDurationMin * 60 * 1000;
          this.accumulatedElapsedMs = 0;
          task.startTime = startTimeVal;
          task.endTime = endTimeVal;
        }
      } else if (!isLockedTask && hasDefinedEndTime) {
        // Chronological mode, unlocked, but has explicitly defined fixed end time:
        const eMin = parseTimeToMinutes(endTimeVal);
        const now = new Date();
        const nowMin = (now.getHours() * 60) + now.getMinutes();
        let diffMin = eMin - nowMin;
        if (diffMin <= 0 && eMin < 360) diffMin += 1440;
        const remainingDurationMin = Math.max(1, diffMin);
        this.taskDurationMs = remainingDurationMin * 60 * 1000;
        this.accumulatedElapsedMs = 0;
        task.startTime = formatMinutesToTime(nowMin);
        task.endTime = formatMinutesToTime(eMin % 1440);
        task.allocatedDuration = remainingDurationMin;
      } else {
        // Chronological mode, unlocked and end time hasn't been defined:
        // Full defined duration is preserved without shrinking! Only time span shifts to current time.
        const plannedDur = (task.allocatedDuration || task.plannedDuration || (origTask ? (origTask.allocatedDuration || origTask.plannedDuration) : 0) || 1);
        this.taskDurationMs = plannedDur * 60 * 1000;
        this.accumulatedElapsedMs = 0;
        const now = new Date();
        const nowMin = (now.getHours() * 60) + now.getMinutes();
        task.startTime = formatMinutesToTime(nowMin);
        task.endTime = formatMinutesToTime((nowMin + plannedDur) % 1440);
        task.allocatedDuration = plannedDur;
      }
      if (origTask && !isLockedTask) {
        origTask.startTime = task.startTime;
        origTask.endTime = task.endTime;
        origTask.allocatedDuration = task.allocatedDuration;
      }
    } else {
      // Sequential mode: tasks start sequentially with planned duration.
      // Padlock in sequential mode only defines the order and prevents drag-drop reordering.
      const plannedDur = (task.allocatedDuration || task.plannedDuration || 1);
      this.taskDurationMs = plannedDur * 60 * 1000;
      this.accumulatedElapsedMs = 0;
    }
    this.taskStartedAt = Date.now();
    this.lastResumeTimestamp = this.taskStartedAt;
    this.isOverrunning = false;
    this.overrunStartTime = null;
    this.initialOverrunBankSeconds = 0;
    this.overrunPausedElapsedMs = 0;

    this._setStatus(TimerStatus.RUNNING);
    this._startTicker();
    this.saveSessionState();

    this._emit('taskStart', {
      task,
      index,
      totalDurationSeconds: Math.floor(this.taskDurationMs / 1000)
    });

    // Immediate initial tick
    this._tick();
  }

  _advanceToNextTask() {
    const finishedTask = this.getActiveTask();
    if (finishedTask && finishedTask.id) {
      const todayStr = (typeof taskStore !== 'undefined' && typeof taskStore.getTodayDateString === 'function')
        ? taskStore.getTodayDateString()
        : new Date().toISOString().split('T')[0];
      finishedTask.isCompleted = true;
      finishedTask.completedDate = todayStr;
      if (typeof taskStore !== 'undefined' && typeof taskStore.updateTask === 'function') {
        taskStore.updateTask(finishedTask.id, {
          isCompleted: true,
          completedDate: todayStr
        });
      }
    }

    this.activeTaskIndex++;
    this.accumulatedElapsedMs = 0;
    this.lastResumeTimestamp = null;
    this.taskStartedAt = null;
    this.isOverrunning = false;
    this.overrunStartTime = null;
    this.initialOverrunBankSeconds = 0;
    this.overrunPausedElapsedMs = 0;

    const tasks = (this.currentSchedule && this.currentSchedule.tasks) || [];
    const indentedIds = this.getIndentedOverlapTaskIds(tasks);
    while (this.activeTaskIndex < tasks.length) {
      const cand = tasks[this.activeTaskIndex];
      if (!cand || !indentedIds.has(cand.id)) break;
      this.activeTaskIndex++;
    }
    if (this.activeTaskIndex >= tasks.length) {
      if (this.isLoopEnabled && tasks.length > 0) {
        // Continuous Loop: reset task completion flags and loop back to the start
        this.activeTaskIndex = 0;
        this.initialTasks.forEach(function(t) {
          if (t) {
            t.isCompleted = false;
            t.manualCompleted = false;
            if (typeof taskStore !== 'undefined' && typeof taskStore.updateTask === 'function') {
              taskStore.updateTask(t.id, { isCompleted: false, manualCompleted: false });
            }
          }
        });
        tasks.forEach(function(t) {
          if (t) {
            t.isCompleted = false;
            t.manualCompleted = false;
          }
        });
        this.recalculate();
        this._emit('loopRestarted', { schedule: this.currentSchedule });
        if (this.status === TimerStatus.RUNNING) {
          this._startTask(0);
        } else {
          this._setStatus(TimerStatus.IDLE);
        }
        return;
      }

      this._stopTicker();
      this._setStatus(TimerStatus.COMPLETED);
      this._emit('allTasksCompleted', {});
      return;
    }

    // Reset task duration to the new task's own planned duration so it never inherits previous task's time
    const nextTask = tasks[this.activeTaskIndex];
    const origNext = this.initialTasks.find(t => t.id === (nextTask && nextTask.id)) || nextTask;
    this.taskDurationMs = ((origNext && (origNext.allocatedDuration || origNext.plannedDuration)) || 25) * 60 * 1000;

    // Dynamic re-compression for remaining tasks from current wall-clock time
    this.recalculate();

    if (this.status === TimerStatus.RUNNING) {
      this._startTask(this.activeTaskIndex);
    }
    this.saveSessionState();
  }

  /**
   * Goes back to the previous non-indented task in the schedule,
   * unmarking it as completed if it was done, and setting it active on the timer.
   */
  previousTask() {
    const tasks = (this.currentSchedule && this.currentSchedule.tasks) || this.initialTasks || [];
    if (tasks.length === 0) return null;

    const indentedIds = this.getIndentedOverlapTaskIds(tasks);
    let prevIndex = (this.activeTaskIndex >= 0 ? this.activeTaskIndex : 0) - 1;
    while (prevIndex >= 0) {
      const cand = tasks[prevIndex];
      if (cand && !indentedIds.has(cand.id)) break;
      prevIndex--;
    }

    if (prevIndex < 0) {
      return null;
    }

    this.setActiveTaskByIndex(prevIndex);
    return this.getActiveTask();
  }

  /**
   * Sets a specific task as the active task on the timer by ID.
   * If completed, marks it as to-do so user can work on it again.
   * @param {string} taskId
   */
  setActiveTaskById(taskId) {
    if (!taskId) return;
    const tasks = (this.currentSchedule && this.currentSchedule.tasks) || this.initialTasks || [];
    const index = tasks.findIndex(t => t && t.id === taskId);
    if (index >= 0) {
      this.setActiveTaskByIndex(index);
    }
  }

  /**
   * Sets a specific task as the active task on the timer by index.
   * @param {number} index
   */
  setActiveTaskByIndex(index) {
    const tasks = (this.currentSchedule && this.currentSchedule.tasks) || this.initialTasks || [];
    if (index < 0 || index >= tasks.length) return;

    const wasRunning = this.status === TimerStatus.RUNNING;
    this._stopTicker();
    this.activeTaskIndex = index;
    this.accumulatedElapsedMs = 0;
    this.lastResumeTimestamp = null;
    this.taskStartedAt = null;
    this.isOverrunning = false;
    this.overrunStartTime = null;
    this.initialOverrunBankSeconds = 0;
    this.overrunPausedElapsedMs = 0;

    const targetTask = tasks[index];
    if (targetTask && targetTask.id) {
      targetTask.isCompleted = false;
      targetTask.completedDate = null;
      targetTask.manualCompleted = false;
      if (typeof taskStore !== 'undefined' && typeof taskStore.updateTask === 'function') {
        taskStore.updateTask(targetTask.id, {
          isCompleted: false,
          completedDate: null,
          manualCompleted: false
        });
      }
    }

    const orig = (this.initialTasks && this.initialTasks.find(t => t.id === (targetTask && targetTask.id))) || targetTask;
    this.taskDurationMs = ((orig && (orig.allocatedDuration || orig.plannedDuration)) || 25) * 60 * 1000;

    this.recalculate();

    if (wasRunning) {
      this._startTask(this.activeTaskIndex);
    } else {
      this._setStatus(TimerStatus.IDLE);
      this._emit('taskStart', {
        task: targetTask,
        index: this.activeTaskIndex,
        totalDurationSeconds: Math.floor(this.taskDurationMs / 1000)
      });
      this._tick();
    }
    this.saveSessionState();
  }

  /**
   * Exports active timer session state snapshot without directly saving to taskStore.
   * @returns {object|null}
   */
  exportSessionState() {
    const activeTask = this.getActiveTask();
    if (!activeTask || this.status === TimerStatus.COMPLETED) {
      return null;
    }
    const todayStr = (typeof taskStore !== 'undefined' && typeof taskStore.getTodayDateString === 'function')
      ? taskStore.getTodayDateString()
      : new Date().toISOString().split('T')[0];

    return {
      activeTaskId: activeTask.id,
      activeTaskIndex: this.activeTaskIndex,
      status: this.status,
      taskDurationMs: this.taskDurationMs,
      accumulatedElapsedMs: this.getElapsedMilliseconds(),
      lastResumeTimestamp: this.lastResumeTimestamp,
      taskStartedAt: this.taskStartedAt,
      isOverrunning: this.isOverrunning,
      overrunStartTime: this.overrunStartTime,
      initialOverrunBankSeconds: this.initialOverrunBankSeconds,
      overrunPausedElapsedMs: this.overrunPausedElapsedMs,
      sessionSavedAt: Date.now(),
      sessionDate: todayStr
    };
  }

  /**
   * Saves active timer session state to taskStore for seamless persistence across app close/reopen.
   */
  saveSessionState() {
    if (typeof taskStore === 'undefined' || typeof taskStore.saveTimerSession !== 'function') return;
    const session = this.exportSessionState();
    if (!session) {
      if (typeof taskStore.clearTimerSession === 'function') {
        taskStore.clearTimerSession();
      }
      return;
    }
    taskStore.saveTimerSession(session);
  }

  /**
   * Restores previously saved timer session.
   * @param {object} session
   * @returns {boolean} true if restored
   */
  restoreSessionState(session) {
    if (!session || typeof session !== 'object') return false;
    const todayStr = (typeof taskStore !== 'undefined' && typeof taskStore.getTodayDateString === 'function')
      ? taskStore.getTodayDateString()
      : new Date().toISOString().split('T')[0];
    if (session.sessionDate && session.sessionDate !== todayStr) {
      if (typeof taskStore !== 'undefined' && typeof taskStore.clearTimerSession === 'function') {
        taskStore.clearTimerSession();
      }
      return false;
    }

    const tasks = (this.currentSchedule && this.currentSchedule.tasks) || this.initialTasks || [];
    let targetIdx = -1;
    if (session.activeTaskId) {
      targetIdx = tasks.findIndex(t => t && t.id === session.activeTaskId);
    }
    if (targetIdx === -1 && typeof session.activeTaskIndex === 'number' && session.activeTaskIndex >= 0 && session.activeTaskIndex < tasks.length) {
      targetIdx = session.activeTaskIndex;
    }
    if (targetIdx === -1) return false;

    this.activeTaskIndex = targetIdx;
    const activeTask = tasks[targetIdx];
    this.taskDurationMs = session.taskDurationMs || (((activeTask && (activeTask.allocatedDuration || activeTask.plannedDuration)) || 25) * 60 * 1000);
    this.taskStartedAt = session.taskStartedAt || null;

    if (session.status === TimerStatus.RUNNING) {
      const now = Date.now();
      const timeAwayMs = Math.max(0, now - (session.lastResumeTimestamp || session.sessionSavedAt || now));
      const totalElapsedMs = (session.accumulatedElapsedMs || 0) + timeAwayMs;

      if (totalElapsedMs < this.taskDurationMs) {
        // Still has time remaining on current task
        this.accumulatedElapsedMs = totalElapsedMs;
        this.lastResumeTimestamp = now;
        this.status = TimerStatus.RUNNING;
        this._startTicker();
        this.saveSessionState();
        return true;
      } else {
        // Task duration finished while app was closed
        this.accumulatedElapsedMs = this.taskDurationMs;
        this.lastResumeTimestamp = null;
        this.status = TimerStatus.PAUSED;
        this.saveSessionState();
        return true;
      }
    } else if (session.status === TimerStatus.PAUSED) {
      this.accumulatedElapsedMs = session.accumulatedElapsedMs || 0;
      this.lastResumeTimestamp = null;
      this.status = TimerStatus.PAUSED;
      this.isOverrunning = Boolean(session.isOverrunning);
      this.overrunStartTime = session.overrunStartTime || null;
      this.initialOverrunBankSeconds = session.initialOverrunBankSeconds || 0;
      this.overrunPausedElapsedMs = session.overrunPausedElapsedMs || 0;
      this.saveSessionState();
      return true;
    } else {
      this.accumulatedElapsedMs = session.accumulatedElapsedMs || 0;
      this.lastResumeTimestamp = null;
      this.status = TimerStatus.IDLE;
      return true;
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

    // Dedicated Web Worker prevents Android / browser background timer throttling
    if (typeof Worker !== 'undefined' && typeof Blob !== 'undefined' && typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function') {
      try {
        const workerBlob = new Blob([
          'var intervalId = null;\n' +
          'self.onmessage = function(e) {\n' +
          '  if (e.data === "start") {\n' +
          '    if (intervalId) clearInterval(intervalId);\n' +
          '    intervalId = setInterval(function() {\n' +
          '      self.postMessage("tick");\n' +
          '    }, 500);\n' +
          '  } else if (e.data === "stop") {\n' +
          '    if (intervalId) {\n' +
          '      clearInterval(intervalId);\n' +
          '      intervalId = null;\n' +
          '    }\n' +
          '  }\n' +
          '};\n'
        ], { type: 'application/javascript' });
        const workerUrl = URL.createObjectURL(workerBlob);
        this._worker = new Worker(workerUrl);
        this._workerUrl = workerUrl;
        this._worker.onmessage = (e) => {
          if (e.data === 'tick') {
            this._tick();
          }
        };
        this._worker.postMessage('start');
        return;
      } catch (_) {}
    }

    // 500ms fallback ticker interval
    this._intervalId = setInterval(() => this._tick(), 500);
  }

  _stopTicker() {
    if (this._worker) {
      try {
        this._worker.postMessage('stop');
        this._worker.terminate();
      } catch (_) {}
      this._worker = null;
    }
    if (this._workerUrl) {
      try {
        URL.revokeObjectURL(this._workerUrl);
      } catch (_) {}
      this._workerUrl = null;
    }
    if (this._intervalId) {
      clearInterval(this._intervalId);
      this._intervalId = null;
    }
  }

  _tick() {
    if (this.status !== TimerStatus.RUNNING) return;

    const nowMinutes = parseTimeToMinutes(new Date());
    const stopMinutes = this.hardStop ? parseTimeToMinutes(this.hardStop) : 1440;
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
    this.saveSessionState();

    if (this.isHardStopEnabled && isHardStopPassed) {
      this.pause();
      this.status = TimerStatus.COMPLETED;
      this._emit('hardStopReached', { currentClock: formatMinutesToTime(nowMinutes), hardStop: this.hardStop });
      this._emit('allTasksCompleted', { hardStopReached: true });
      return;
    }

    // 3. Task reached 00:00: check if it should overrun into Time Bank
    if (remainingMs <= 0) {
      const activeTask = this.getActiveTask();
      const currentBank = taskStore.getTimeBankSeconds();

      if (activeTask && (activeTask.useTimeBank !== false) && currentBank > 0) {
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
      const allocatedMin = (activeTask && (activeTask.allocatedDuration || activeTask.plannedDuration)) || 25;
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
    const stopMinutes = this.hardStop ? parseTimeToMinutes(this.hardStop) : 1440;

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
    this.saveSessionState();

    this._emit('seek', {
      remainingSeconds: clampedRemaining,
      elapsedSeconds: newElapsedSeconds,
      progressRatio
    });
  }

  // ==========================================
  // Public Accessors & Helpers
  // ==========================================

  /**
   * Returns a Set of task IDs that are indented (ignored) due to overlapping with a higher-priority task above them.
   */
  getIndentedOverlapTaskIds(scheduleTasks) {
    const indentedIds = new Set();
    const list = scheduleTasks || (this.currentSchedule && this.currentSchedule.tasks) || [];
    const overlapIndices = new Set();
    for (let i = 0; i < list.length; i++) {
      const tA = list[i];
      if (!tA || tA.isCompleted || !tA.startTime || !tA.endTime) continue;
      const aStart = parseTimeToMinutes(tA.startTime);
      let aEnd = parseTimeToMinutes(tA.endTime);
      if (aEnd <= aStart) aEnd += 1440;
      for (let j = i + 1; j < list.length; j++) {
        const tB = list[j];
        if (!tB || tB.isCompleted || !tB.startTime || !tB.endTime) continue;
        const bStart = parseTimeToMinutes(tB.startTime);
        let bEnd = parseTimeToMinutes(tB.endTime);
        if (bEnd <= bStart) bEnd += 1440;
        if (aStart < bEnd && bStart < aEnd) {
          if (!overlapIndices.has(i)) {
            overlapIndices.add(j);
            if (tB.id) indentedIds.add(tB.id);
          }
        }
      }
    }
    return indentedIds;
  }

  getActiveTaskIndexByTime(scheduleTasks, referenceMinutes) {
    if (!scheduleTasks || scheduleTasks.length === 0) return -1;
    const currentMinutes = typeof referenceMinutes === 'number'
      ? referenceMinutes
      : ((new Date().getHours() * 60) + new Date().getMinutes());
    const indentedIds = this.getIndentedOverlapTaskIds(scheduleTasks);

    for (let i = 0; i < scheduleTasks.length; i++) {
      const t = scheduleTasks[i];
      if (!t || indentedIds.has(t.id)) continue;
      if (t.startTime && t.endTime) {
        const s = parseTimeToMinutes(t.startTime);
        let e = parseTimeToMinutes(t.endTime);
        if (e <= s) e += 1440;
        if (currentMinutes >= s && currentMinutes < e) {
          return i;
        }
      }
    }

    for (let i = 0; i < scheduleTasks.length; i++) {
      const t = scheduleTasks[i];
      if (!t || indentedIds.has(t.id)) continue;
      if (t.endTime) {
        const s = t.startTime ? parseTimeToMinutes(t.startTime) : 0;
        let e = parseTimeToMinutes(t.endTime);
        if (e <= s) e += 1440;
        if (e > currentMinutes) {
          return i;
        }
      }
    }

    return -1;
  }

  getActiveTask() {
    if (!this.currentSchedule || !this.currentSchedule.tasks || this.currentSchedule.tasks.length === 0) return null;
    if (this.status === TimerStatus.COMPLETED) return null;

    // While timer is actively running or paused, the active task strictly remains the current task being timed
    if (this.status === TimerStatus.RUNNING || this.status === TimerStatus.PAUSED) {
      if (this.activeTaskIndex >= 0 && this.activeTaskIndex < this.currentSchedule.tasks.length) {
        return this.currentSchedule.tasks[this.activeTaskIndex];
      }
    }

    const allTasks = this.currentSchedule.tasks;
    const indentedIds = this.getIndentedOverlapTaskIds(allTasks);

    // If an active task index is selected and not indented, preserve it (allows returning to previous / completed tasks)
    if (this.activeTaskIndex >= 0 && this.activeTaskIndex < allTasks.length) {
      const candidate = allTasks[this.activeTaskIndex];
      if (candidate && !indentedIds.has(candidate.id)) {
        return candidate;
      }
    }

    const isTimespans = (typeof taskStore !== 'undefined' && typeof taskStore.getTimespansEnabled === 'function')
      ? taskStore.getTimespansEnabled()
      : true;

    if (isTimespans) {
      const nowMin = (new Date().getHours() * 60) + new Date().getMinutes();
      const nextIdx = this.getActiveTaskIndexByTime(allTasks, nowMin);
      if (nextIdx >= 0 && nextIdx < allTasks.length) {
        if (this.status === TimerStatus.IDLE) {
          this.activeTaskIndex = nextIdx;
        }
        return allTasks[nextIdx];
      }
      const firstValidTask = allTasks.find(t => t && !indentedIds.has(t.id)) || allTasks[0] || null;
      if (firstValidTask && this.status === TimerStatus.IDLE) {
        const fIdx = allTasks.indexOf(firstValidTask);
        if (fIdx >= 0) {
          this.activeTaskIndex = fIdx;
        }
      }
      return firstValidTask;
    }

    let index = this.activeTaskIndex;
    if (index < 0 || (allTasks[index] && (indentedIds.has(allTasks[index].id) || allTasks[index].isCompleted))) {
      const firstValidIdx = allTasks.findIndex(t => t && !indentedIds.has(t.id) && !t.isCompleted);
      index = firstValidIdx >= 0 ? firstValidIdx : (allTasks.findIndex(t => t && !indentedIds.has(t.id)) || 0);
      if (index < 0) index = 0;
      if (this.status === TimerStatus.IDLE) {
        this.activeTaskIndex = index;
      }
    }
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
    if (this.status === TimerStatus.COMPLETED) return 0;
    if (this.status === TimerStatus.IDLE) {
      const isTimespans = (typeof taskStore !== 'undefined' && typeof taskStore.getTimespansEnabled === 'function')
        ? taskStore.getTimespansEnabled()
        : true;
      const activeTask = this.getActiveTask();
      const origTask = (this.initialTasks && activeTask && this.initialTasks.find(t => t.id === activeTask.id)) || activeTask;
      const isLocked = Boolean(origTask && origTask.isLocked);
      const sVal = (origTask && (origTask.fixedStartTime || origTask.startTime)) || (activeTask && (activeTask.fixedStartTime || activeTask.startTime));
      const eVal = (origTask && (origTask.fixedEndTime || origTask.endTime)) || (activeTask && (activeTask.fixedEndTime || activeTask.endTime));
      const fixedEVal = (origTask && origTask.fixedEndTime) || (activeTask && activeTask.fixedEndTime);
      const isDialAdjusted = Boolean((origTask && origTask.dialAdjusted) || (activeTask && activeTask.dialAdjusted));
      if (this.taskDurationMs <= 0 && this.accumulatedElapsedMs === 0) {
        if (isTimespans && isLocked && sVal && eVal) {
          const sMin = parseTimeToMinutes(sVal);
          let eMin = parseTimeToMinutes(eVal);
          if (eMin <= sMin) eMin += 1440;
          const now = new Date();
          const nowMin = (now.getHours() * 60) + now.getMinutes();
          if (nowMin > sMin && nowMin < eMin) {
            return (eMin - nowMin) * 60;
          } else if (nowMin <= sMin) {
            return (eMin - sMin) * 60;
          }
        } else if (isTimespans && !isLocked && fixedEVal && !isDialAdjusted) {
          const sMin = sVal ? parseTimeToMinutes(sVal) : 0;
          let eMin = parseTimeToMinutes(fixedEVal);
          if (eMin <= sMin) eMin += 1440;
          const now = new Date();
          const nowMin = (now.getHours() * 60) + now.getMinutes();
          if (nowMin < eMin) {
            return (eMin - nowMin) * 60;
          }
        }
      }
      const allocatedMin = (activeTask && (activeTask.allocatedDuration || activeTask.plannedDuration)) || 30;
      const totalSeconds = this.taskDurationMs > 0
        ? Math.floor(this.taskDurationMs / 1000)
        : (allocatedMin * 60);
      return Math.max(0, totalSeconds - this.getElapsedSeconds());
    }
    const totalSeconds = Math.floor(this.taskDurationMs / 1000);
    return Math.max(0, totalSeconds - this.getElapsedSeconds());
  }

  getProgress() {
    if (this.status === TimerStatus.IDLE) {
      return 0;
    }
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
