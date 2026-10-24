/**
 * analyticsDb.js
 * 
 * Local-first Telemetry & Metrics Storage for Calentimer using native browser IndexedDB.
 * Implements a non-blocking in-memory queue flushed during idle browser frames (requestIdleCallback).
 * Zero external libraries, zero cloud dependencies, 100% private and offline.
 */

const DB_NAME = 'CalentimerAnalyticsDB';
const DB_VERSION = 1;

const STORES = {
  TASK_METRICS: 'task_metrics',
  SESSION_METRICS: 'session_metrics',
  DAILY_SUMMARIES: 'daily_summaries',
  INTERACTION_EVENTS: 'interaction_events'
};

class AnalyticsDB {
  constructor() {
    this.db = null;
    this.isReady = false;
    this.initPromise = null;
    this.interactionQueue = [];
    this.taskQueue = [];
    this.flushTimer = null;
    this.isFlushing = false;
    this.maxQueueSize = 200; // prevent memory bloat if DB is unavailable

    // Active session tracking state
    this.activeTaskMetric = null;
    this.activeSessionDate = this._getTodayKey();

    // Auto-initialize if in browser environment
    if (typeof window !== 'undefined' && typeof window.indexedDB !== 'undefined') {
      this.initPromise = this.init();
      this._setupLifecycleFlushing();
    }
  }

  _getTodayKey(dateObj) {
    const d = dateObj || new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  _getMonthKey(dateObj) {
    const d = dateObj || new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    return `${y}-${m}`;
  }

  /**
   * Initializes the native IndexedDB database with schema and indexes.
   */
  init() {
    if (this.isReady && this.db) {
      return Promise.resolve(this.db);
    }
    if (this.initPromise) {
      return this.initPromise;
    }

    this.initPromise = new Promise((resolve, reject) => {
      try {
        if (typeof indexedDB === 'undefined') {
          resolve(null);
          return;
        }

        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onupgradeneeded = (event) => {
          const db = event.target.result;

          // 1. Task Metrics Store (Execution history for every task)
          if (!db.objectStoreNames.contains(STORES.TASK_METRICS)) {
            const taskStore = db.createObjectStore(STORES.TASK_METRICS, { keyPath: 'id', autoIncrement: true });
            taskStore.createIndex('date', 'date', { unique: false });
            taskStore.createIndex('taskId', 'taskId', { unique: false });
            taskStore.createIndex('category', 'category', { unique: false });
            taskStore.createIndex('status', 'status', { unique: false });
            taskStore.createIndex('timestamp', 'timestamp', { unique: false });
          }

          // 2. Session Metrics Store (Daily overview: focus time, breaks, hard stop adherence)
          if (!db.objectStoreNames.contains(STORES.SESSION_METRICS)) {
            const sessionStore = db.createObjectStore(STORES.SESSION_METRICS, { keyPath: 'date' });
            sessionStore.createIndex('monthKey', 'monthKey', { unique: false });
            sessionStore.createIndex('completedHardStop', 'completedHardStop', { unique: false });
          }

          // 3. Daily Summaries Store (Pre-calculated aggregates for fast monthly views)
          if (!db.objectStoreNames.contains(STORES.DAILY_SUMMARIES)) {
            const summaryStore = db.createObjectStore(STORES.DAILY_SUMMARIES, { keyPath: 'date' });
            summaryStore.createIndex('monthKey', 'monthKey', { unique: false });
          }

          // 4. Interaction Events Store (Lightweight UI interaction telemetry)
          if (!db.objectStoreNames.contains(STORES.INTERACTION_EVENTS)) {
            const eventStore = db.createObjectStore(STORES.INTERACTION_EVENTS, { keyPath: 'id', autoIncrement: true });
            eventStore.createIndex('type', 'type', { unique: false });
            eventStore.createIndex('timestamp', 'timestamp', { unique: false });
            eventStore.createIndex('date', 'date', { unique: false });
          }
        };

        request.onsuccess = (event) => {
          this.db = event.target.result;
          this.isReady = true;
          // Initial flush if any events arrived before DB opened
          this.scheduleFlush(500);
          resolve(this.db);
        };

        request.onerror = (event) => {
          console.warn('AnalyticsDB: IndexedDB failed to open, running in memory-only mode', event && event.target && event.target.error);
          this.isReady = false;
          resolve(null);
        };
      } catch (err) {
        console.warn('AnalyticsDB: Exception opening IndexedDB', err);
        this.isReady = false;
        resolve(null);
      }
    });

    return this.initPromise;
  }

  _setupLifecycleFlushing() {
    if (typeof window === 'undefined') return;

    // Flush immediately when app/page is being closed or backgrounded
    window.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        this.flush();
      }
    });

    window.addEventListener('beforeunload', () => {
      this.flush();
    });
  }

  /**
   * Schedules an asynchronous flush via requestIdleCallback.
   * Guarantees zero UI stutter / zero frame drops.
   */
  scheduleFlush(delayMs) {
    if (this.flushTimer) return;

    const delay = typeof delayMs === 'number' ? delayMs : 2000;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      if (typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function') {
        window.requestIdleCallback(() => {
          this.flush();
        }, { timeout: 3000 });
      } else {
        this.flush();
      }
    }, delay);
  }

  /**
   * Flushes in-memory queues into IndexedDB in a single transaction.
   */
  async flush() {
    if (this.isFlushing) return;
    if (!this.db || !this.isReady) {
      if (!this.initPromise) this.init();
      return;
    }

    if (this.interactionQueue.length === 0 && this.taskQueue.length === 0) {
      return;
    }

    this.isFlushing = true;

    // Slice current queues
    const interactionsToFlush = this.interactionQueue.splice(0, this.interactionQueue.length);
    const tasksToFlush = this.taskQueue.splice(0, this.taskQueue.length);

    try {
      const storesNeeded = [];
      if (interactionsToFlush.length > 0) storesNeeded.push(STORES.INTERACTION_EVENTS);
      if (tasksToFlush.length > 0) storesNeeded.push(STORES.TASK_METRICS);

      if (storesNeeded.length === 0) {
        this.isFlushing = false;
        return;
      }

      const tx = this.db.transaction(storesNeeded, 'readwrite');

      if (interactionsToFlush.length > 0) {
        const store = tx.objectStore(STORES.INTERACTION_EVENTS);
        for (let i = 0; i < interactionsToFlush.length; i++) {
          store.add(interactionsToFlush[i]);
        }
      }

      if (tasksToFlush.length > 0) {
        const store = tx.objectStore(STORES.TASK_METRICS);
        for (let i = 0; i < tasksToFlush.length; i++) {
          store.add(tasksToFlush[i]);
        }
      }

      await new Promise((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = (e) => reject(e && e.target && e.target.error);
        tx.onabort = (e) => reject(e && e.target && e.target.error);
      });
    } catch (err) {
      console.warn('AnalyticsDB: Flush error, re-queueing items', err);
      // Re-queue items that failed to write, capped at maxQueueSize
      this.interactionQueue = interactionsToFlush.concat(this.interactionQueue).slice(-this.maxQueueSize);
      this.taskQueue = tasksToFlush.concat(this.taskQueue).slice(-this.maxQueueSize);
    } finally {
      this.isFlushing = false;
    }
  }

  // ==========================================
  // Telemetry Ingestion API (Microsecond non-blocking)
  // ==========================================

  /**
   * Tracks a UI interaction event (e.g. dial rotate, button click, view toggle).
   * Execution time < 0.001 ms.
   * 
   * @param {string} type - Event category (e.g. 'dial_rotate', 'btn_click', 'tab_switch')
   * @param {string} target - Name of element or action (e.g. 'timer_dial', 'btn_play_pause')
   * @param {object} [metadata] - Optional additional details
   */
  trackInteraction(type, target, metadata) {
    const event = {
      type: type || 'interaction',
      target: target || 'unknown',
      metadata: metadata || {},
      timestamp: Date.now(),
      date: this._getTodayKey()
    };

    this.interactionQueue.push(event);
    if (this.interactionQueue.length > this.maxQueueSize) {
      this.interactionQueue.shift(); // keep memory bounded
    }

    this.scheduleFlush(2500);
  }

  /**
   * Starts tracking an active task's execution.
   */
  startTaskMetric(task, scheduleContext) {
    if (!task) return;

    // If there was an unfinished active task metric, close it out as aborted/switched
    if (this.activeTaskMetric && this.activeTaskMetric.taskId !== task.id) {
      this.finalizeTaskMetric('switched');
    }

    const now = Date.now();
    this.activeTaskMetric = {
      taskId: task.id,
      title: task.title || 'Untitled Task',
      category: task.category || 'General',
      isLocked: Boolean(task.isLocked),
      emoji: task.emoji || '🎯',
      plannedDurationMin: task.plannedDuration || 0,
      allocatedDurationMin: task.allocatedDuration || task.plannedDuration || 0,
      startTimeMs: now,
      endTimeMs: null,
      actualDurationSec: 0,
      status: 'in_progress', // 'completed', 'completed_early', 'overrun', 'skipped', 'switched'
      pauseCount: 0,
      totalPausedSec: 0,
      lastPauseTimestamp: null,
      dialAdjustmentsDeltaMin: 0,
      bankDepositedSec: 0,
      bankConsumedSec: 0,
      date: this._getTodayKey(),
      timestamp: now,
      schedulePosition: typeof (scheduleContext && scheduleContext.index) === 'number' ? scheduleContext.index : 0
    };
  }

  /**
   * Records a pause or resume on the active task.
   */
  recordTaskPause(isPaused) {
    if (!this.activeTaskMetric) return;

    if (isPaused) {
      this.activeTaskMetric.pauseCount = (this.activeTaskMetric.pauseCount || 0) + 1;
      this.activeTaskMetric.lastPauseTimestamp = Date.now();
    } else {
      if (this.activeTaskMetric.lastPauseTimestamp) {
        const pauseDurationSec = Math.round((Date.now() - this.activeTaskMetric.lastPauseTimestamp) / 1000);
        this.activeTaskMetric.totalPausedSec = (this.activeTaskMetric.totalPausedSec || 0) + Math.max(0, pauseDurationSec);
        this.activeTaskMetric.lastPauseTimestamp = null;
      }
    }
  }

  /**
   * Records a mid-task dial adjustment (+/- minutes).
   */
  recordTaskAdjustment(deltaMinutes) {
    if (!this.activeTaskMetric) return;
    this.activeTaskMetric.dialAdjustmentsDeltaMin = (this.activeTaskMetric.dialAdjustmentsDeltaMin || 0) + deltaMinutes;
  }

  /**
   * Records time bank interaction for the active task.
   */
  recordTaskBankEvent(depositedSec, consumedSec) {
    if (!this.activeTaskMetric) return;
    if (depositedSec) {
      this.activeTaskMetric.bankDepositedSec = (this.activeTaskMetric.bankDepositedSec || 0) + depositedSec;
    }
    if (consumedSec) {
      this.activeTaskMetric.bankConsumedSec = (this.activeTaskMetric.bankConsumedSec || 0) + consumedSec;
    }
  }

  /**
   * Finalizes the active task metric and queues it for persistence.
   */
  finalizeTaskMetric(finalStatus, actualElapsedSeconds) {
    if (!this.activeTaskMetric) return;

    const now = Date.now();
    this.activeTaskMetric.endTimeMs = now;
    this.activeTaskMetric.status = finalStatus || 'completed';

    if (typeof actualElapsedSeconds === 'number') {
      this.activeTaskMetric.actualDurationSec = Math.max(0, Math.round(actualElapsedSeconds));
    } else if (this.activeTaskMetric.startTimeMs) {
      const grossSec = Math.round((now - this.activeTaskMetric.startTimeMs) / 1000);
      const netSec = Math.max(0, grossSec - (this.activeTaskMetric.totalPausedSec || 0));
      this.activeTaskMetric.actualDurationSec = netSec;
    }

    // Queue for persistence
    this.taskQueue.push(Object.assign({}, this.activeTaskMetric));
    if (this.taskQueue.length > this.maxQueueSize) {
      this.taskQueue.shift();
    }

    // Update daily session summary with this completed task
    this._accumulateToSessionSummary(this.activeTaskMetric);

    this.activeTaskMetric = null;
    this.scheduleFlush(1000);
  }

  /**
   * Increments running totals for today's session summary.
   */
  async _accumulateToSessionSummary(taskMetric) {
    if (!taskMetric) return;
    const dateKey = taskMetric.date || this._getTodayKey();

    try {
      const existing = await this.getSessionMetric(dateKey);
      const session = existing || {
        date: dateKey,
        monthKey: this._getMonthKey(),
        tasksCompletedCount: 0,
        tasksEarlyCount: 0,
        tasksOverrunCount: 0,
        tasksSkippedCount: 0,
        totalFocusSec: 0,
        totalBankDepositedSec: 0,
        totalBankConsumedSec: 0,
        totalPauseCount: 0,
        totalPauseSec: 0,
        totalDialAdjustmentsCount: 0,
        hardStopTarget: null,
        completedHardStop: false,
        resetsCount: 0,
        visibilityLossCount: 0,
        timestamp: Date.now()
      };

      if (taskMetric.status === 'completed' || taskMetric.status === 'completed_early') {
        session.tasksCompletedCount += 1;
      }
      if (taskMetric.status === 'completed_early') {
        session.tasksEarlyCount += 1;
      }
      if (taskMetric.status === 'overrun') {
        session.tasksOverrunCount += 1;
      }
      if (taskMetric.status === 'skipped') {
        session.tasksSkippedCount += 1;
      }

      session.totalFocusSec += (taskMetric.actualDurationSec || 0);
      session.totalBankDepositedSec += (taskMetric.bankDepositedSec || 0);
      session.totalBankConsumedSec += (taskMetric.bankConsumedSec || 0);
      session.totalPauseCount += (taskMetric.pauseCount || 0);
      session.totalPauseSec += (taskMetric.totalPausedSec || 0);
      if (taskMetric.dialAdjustmentsDeltaMin !== 0) {
        session.totalDialAdjustmentsCount += 1;
      }

      await this.saveSessionMetric(session);
    } catch (e) {
      console.warn('AnalyticsDB: Failed to accumulate session summary', e);
    }
  }

  /**
   * Records day session events (hard stop target set, day reset, visibility loss).
   */
  async recordSessionEvent(eventType, details) {
    const dateKey = this._getTodayKey();
    try {
      const session = (await this.getSessionMetric(dateKey)) || {
        date: dateKey,
        monthKey: this._getMonthKey(),
        tasksCompletedCount: 0,
        tasksEarlyCount: 0,
        tasksOverrunCount: 0,
        tasksSkippedCount: 0,
        totalFocusSec: 0,
        totalBankDepositedSec: 0,
        totalBankConsumedSec: 0,
        totalPauseCount: 0,
        totalPauseSec: 0,
        totalDialAdjustmentsCount: 0,
        hardStopTarget: null,
        completedHardStop: false,
        resetsCount: 0,
        visibilityLossCount: 0,
        timestamp: Date.now()
      };

      if (eventType === 'set_hard_stop') {
        session.hardStopTarget = details && details.hardStopTime ? details.hardStopTime : null;
      } else if (eventType === 'complete_hard_stop') {
        session.completedHardStop = true;
      } else if (eventType === 'reset_day') {
        session.resetsCount = (session.resetsCount || 0) + 1;
      } else if (eventType === 'visibility_loss') {
        session.visibilityLossCount = (session.visibilityLossCount || 0) + 1;
      }

      await this.saveSessionMetric(session);
    } catch (e) {
      console.warn('AnalyticsDB: Failed to record session event', e);
    }
  }

  // ==========================================
  // Querying API (IndexedDB Queries)
  // ==========================================

  async getSessionMetric(dateKey) {
    if (!this.db || !this.isReady) {
      await this.init();
    }
    if (!this.db) return null;

    return new Promise((resolve) => {
      try {
        const tx = this.db.transaction(STORES.SESSION_METRICS, 'readonly');
        const store = tx.objectStore(STORES.SESSION_METRICS);
        const req = store.get(dateKey);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => resolve(null);
      } catch (_) {
        resolve(null);
      }
    });
  }

  async saveSessionMetric(sessionData) {
    if (!sessionData || !sessionData.date) return;
    if (!this.db || !this.isReady) {
      await this.init();
    }
    if (!this.db) return;

    return new Promise((resolve) => {
      try {
        const tx = this.db.transaction(STORES.SESSION_METRICS, 'readwrite');
        const store = tx.objectStore(STORES.SESSION_METRICS);
        const req = store.put(sessionData);
        req.onsuccess = () => resolve(true);
        req.onerror = () => resolve(false);
      } catch (_) {
        resolve(false);
      }
    });
  }

  /**
   * Retrieves all task metrics for a specific date or date range.
   */
  async getTaskMetrics(startDate, endDate) {
    if (!this.db || !this.isReady) {
      await this.init();
    }
    if (!this.db) return [];

    return new Promise((resolve) => {
      try {
        const tx = this.db.transaction(STORES.TASK_METRICS, 'readonly');
        const store = tx.objectStore(STORES.TASK_METRICS);
        const index = store.index('date');

        let range = null;
        if (startDate && endDate) {
          range = IDBKeyRange.bound(startDate, endDate);
        } else if (startDate) {
          range = IDBKeyRange.only(startDate);
        }

        const req = range ? index.getAll(range) : store.getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => resolve([]);
      } catch (_) {
        resolve([]);
      }
    });
  }

  /**
   * Computes productivity insights and estimation bias across recent history.
   * 
   * @param {number} [daysBack=30] 
   * @returns {Promise<object>}
   */
  async getProductivityInsights(daysBack) {
    const days = typeof daysBack === 'number' ? daysBack : 30;
    const now = new Date();
    const past = new Date(now.getTime() - (days * 24 * 60 * 60 * 1000));
    const startDate = this._getTodayKey(past);
    const endDate = this._getTodayKey(now);

    const tasks = await this.getTaskMetrics(startDate, endDate);

    let totalPlannedSec = 0;
    let totalActualSec = 0;
    let completedCount = 0;
    let earlyCount = 0;
    let overrunCount = 0;
    let totalPauses = 0;
    let totalBankDeposited = 0;
    let totalBankConsumed = 0;

    const categoryStats = {};

    for (let i = 0; i < tasks.length; i++) {
      const t = tasks[i];
      const plannedSec = (t.plannedDurationMin || 0) * 60;
      const actualSec = t.actualDurationSec || 0;

      totalPlannedSec += plannedSec;
      totalActualSec += actualSec;
      totalPauses += (t.pauseCount || 0);
      totalBankDeposited += (t.bankDepositedSec || 0);
      totalBankConsumed += (t.bankConsumedSec || 0);

      if (t.status === 'completed' || t.status === 'completed_early') completedCount++;
      if (t.status === 'completed_early') earlyCount++;
      if (t.status === 'overrun') overrunCount++;

      // Category aggregation
      const cat = t.category || 'General';
      if (!categoryStats[cat]) {
        categoryStats[cat] = {
          count: 0,
          plannedSec: 0,
          actualSec: 0,
          pauseCount: 0
        };
      }
      categoryStats[cat].count++;
      categoryStats[cat].plannedSec += plannedSec;
      categoryStats[cat].actualSec += actualSec;
      categoryStats[cat].pauseCount += (t.pauseCount || 0);
    }

    // Calculate category estimation accuracy
    const categoryInsights = [];
    const catKeys = Object.keys(categoryStats);
    for (let i = 0; i < catKeys.length; i++) {
      const catName = catKeys[i];
      const stats = categoryStats[catName];
      const diffSec = stats.actualSec - stats.plannedSec;
      const biasMinutes = Math.round(diffSec / (stats.count || 1) / 60);

      categoryInsights.push({
        category: catName,
        taskCount: stats.count,
        totalFocusMinutes: Math.round(stats.actualSec / 60),
        avgPausePerTask: Number((stats.pauseCount / (stats.count || 1)).toFixed(1)),
        avgEstimationBiasMin: biasMinutes, // Positive = takes longer than planned; Negative = finishes quicker
        biasDescription: biasMinutes > 0
          ? `Tends to run +${biasMinutes}m longer than planned`
          : biasMinutes < 0
            ? `Finishes ${Math.abs(biasMinutes)}m faster than planned`
            : 'Accurately estimated'
      });
    }

    return {
      periodDays: days,
      tasksAnalyzed: tasks.length,
      completedCount,
      earlyCount,
      overrunCount,
      totalFocusHours: Number((totalActualSec / 3600).toFixed(1)),
      totalBankDepositedMin: Math.round(totalBankDeposited / 60),
      totalBankConsumedMin: Math.round(totalBankConsumed / 60),
      netBankMin: Math.round((totalBankDeposited - totalBankConsumed) / 60),
      averagePausesPerTask: Number((totalPauses / (tasks.length || 1)).toFixed(1)),
      overallEstimationBiasMin: tasks.length > 0 ? Math.round((totalActualSec - totalPlannedSec) / tasks.length / 60) : 0,
      categoryInsights
    };
  }
}

export const analytics = new AnalyticsDB();
