/**
 * taskStore.js
 * 
 * LocalStorage state persistence for tasks and Hard Stop settings.
 * Ensures data is preserved across page reloads and Android app restarts.
 */

const STORAGE_KEYS = {
  TASKS: 'calentimer_tasks_v1',
  HARD_STOP: 'calentimer_hard_stop_v1',
  SETTINGS: 'calentimer_settings_v1',
  TIME_BANK: 'calentimer_time_bank_v1',
  CATEGORIES: 'calentimer_categories_v1',
  ALERTS_ENABLED: 'calentimer_alerts_enabled_v1',
  DURATION_PRESETS: 'calentimer_duration_presets_v1',
  TODO_TASKS: 'calentimer_todo_tasks_v1',
  CALENDAR_EVENTS: 'calentimer_calendar_events_v1',
  CAL_RANGE_ENABLED: 'calentimer_cal_range_enabled_v1',
  CAL_START_TIME: 'calentimer_cal_start_time_v1',
  CAL_END_TIME: 'calentimer_cal_end_time_v1',
  DELETED_IDS: 'calentimer_deleted_ids_v1',
  TIMESPANS_ENABLED: 'calentimer_timespans_enabled_v1'
};

const memoryStorage = {};
function safeGetItem(key) {
  try {
    if (typeof localStorage !== 'undefined' && localStorage !== null) {
      return localStorage.getItem(key);
    }
  } catch (_) {}
  return memoryStorage[key] !== undefined ? memoryStorage[key] : null;
}

function safeSetItem(key, val) {
  const strVal = String(val);
  memoryStorage[key] = strVal;
  try {
    if (typeof localStorage !== 'undefined' && localStorage !== null) {
      localStorage.setItem(key, strVal);
    }
  } catch (_) {}
}

const DEFAULT_TASKS = [
  {
    id: 'task-1',
    title: 'Core Reading & Notes',
    plannedDuration: 45,
    isLocked: false,
    useTimeBank: true,
    category: 'Study',
    tags: ['focus', 'reading'],
    emoji: '📚'
  },
  {
    id: 'task-2',
    title: 'Practice Problems',
    plannedDuration: 30,
    isLocked: false,
    useTimeBank: true,
    category: 'Practice',
    tags: ['exercises'],
    emoji: '📝'
  },
  {
    id: 'task-3',
    title: 'Submission & Review',
    plannedDuration: 15,
    isLocked: true,
    useTimeBank: true,
    category: 'Admin',
    tags: ['urgent'],
    emoji: '🎯'
  }
];

export class TaskStore {
  constructor() {
    this._listeners = new Set();
    this._isSyncing = false;
  }

  getTodayDateString() {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  /**
   * Retrieves set of deleted IDs for a given date.
   * Prevents deleted items from resurrecting during cross-sync.
   * @param {string} [targetDateStr]
   * @returns {Set<string>}
   */
  getDeletedIds(targetDateStr) {
    try {
      const today = targetDateStr || this.getTodayDateString();
      const raw = safeGetItem(STORAGE_KEYS.DELETED_IDS);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          const list = parsed[today];
          if (Array.isArray(list)) return new Set(list);
        }
      }
    } catch (_) {}
    return new Set();
  }

  /**
   * Records a deleted item ID in tombstones for target date.
   * @param {string} id
   * @param {string} [targetDateStr]
   */
  addDeletedId(id, targetDateStr) {
    if (!id) return;
    try {
      const today = targetDateStr || this.getTodayDateString();
      let record = {};
      const raw = safeGetItem(STORAGE_KEYS.DELETED_IDS);
      if (raw) {
        try { record = JSON.parse(raw) || {}; } catch (_) {}
      }
      const list = Array.isArray(record[today]) ? record[today] : [];
      if (list.indexOf(id) === -1) {
        list.push(id);
      }
      record[today] = list;
      safeSetItem(STORAGE_KEYS.DELETED_IDS, JSON.stringify(record));
    } catch (_) {}
  }

  /**
   * Removes an item ID from tombstones (e.g. when explicitly created).
   * @param {string} id
   * @param {string} [targetDateStr]
   */
  removeDeletedId(id, targetDateStr) {
    if (!id) return;
    try {
      const today = targetDateStr || this.getTodayDateString();
      const raw = safeGetItem(STORAGE_KEYS.DELETED_IDS);
      if (raw) {
        const record = JSON.parse(raw) || {};
        if (Array.isArray(record[today])) {
          record[today] = record[today].filter(item => item !== id);
          safeSetItem(STORAGE_KEYS.DELETED_IDS, JSON.stringify(record));
        }
      }
    } catch (_) {}
  }

  onChange(callback) {
    this._listeners.add(callback);
    return () => this._listeners.delete(callback);
  }

  _notify() {
    for (const listener of this._listeners) {
      try {
        listener();
      } catch (e) {
        console.error('TaskStore listener error:', e);
      }
    }
  }

  /**
   * Retrieves tasks from localStorage, or defaults.
   * @returns {Array<object>}
   */
  getTasks() {
    try {
      const data = safeGetItem(STORAGE_KEYS.TASKS);
      if (data !== null) {
        const parsed = JSON.parse(data);
        if (Array.isArray(parsed)) {
          return parsed;
        }
      }
    } catch (e) {
      console.warn('Could not read tasks from localStorage:', e);
    }
    return JSON.parse(JSON.stringify(DEFAULT_TASKS));
  }

  /**
   * Persists task list.
   * @param {Array<object>} tasks 
   */
  saveTasks(tasks) {
    try {
      safeSetItem(STORAGE_KEYS.TASKS, JSON.stringify(tasks));
      this._notify();
    } catch (e) {
      console.error('Could not save tasks to localStorage:', e);
    }
  }

  /**
   * Retrieves saved Hard Stop or generates default 2 hours from now.
   * @returns {string} "HH:MM"
   */
  getHardStop() {
    try {
      const saved = safeGetItem(STORAGE_KEYS.HARD_STOP);
      if (saved && /^\d{1,2}:\d{2}$/.test(saved)) {
        return saved;
      }
    } catch (e) {}

    // Default: 2 hours from now
    const now = new Date();
    const targetHour = (now.getHours() + 2) % 24;
    return `${String(targetHour).padStart(2, '0')}:00`;
  }

  /**
   * Saves Hard Stop time.
   * @param {string} hardStop "HH:MM"
   */
  saveHardStop(hardStop) {
    try {
      safeSetItem(STORAGE_KEYS.HARD_STOP, hardStop);
      this._notify();
    } catch (e) {
      console.error('Could not save Hard Stop:', e);
    }
  }

  setHardStop(hardStop) {
    return this.saveHardStop(hardStop);
  }

  /**
   * Adds a new task.
   */
  addTask(task) {
    const tasks = this.getTasks();
    const now = Date.now();
    const newTask = {
      id: (task && task.id) ? task.id : `task-${now}-${Math.random().toString(36).substr(2, 4)}`,
      title: (task && task.title) ? task.title : 'Untitled Task',
      plannedDuration: Math.max(1, parseInt(task && task.plannedDuration, 10) || 25),
      isLocked: (task && task.isLocked !== undefined) ? Boolean(task.isLocked) : false,
      useTimeBank: (task && task.useTimeBank !== undefined) ? Boolean(task.useTimeBank) : false,
      fixedStartTime: (task && task.fixedStartTime) ? task.fixedStartTime : null,
      startTime: (task && task.startTime) ? task.startTime : null,
      endTime: (task && task.endTime) ? task.endTime : null,
      category: (task && task.category) ? task.category : 'General',
      tags: (task && Array.isArray(task.tags)) ? task.tags : ((task && task.tags) ? task.tags.split(',').map(t => t.trim()).filter(Boolean) : []),
      emoji: (task && task.emoji) ? task.emoji : '📌',
      source: (task && task.source) ? task.source : 'local',
      externalId: (task && task.externalId) ? task.externalId : null,
      lastModified: now
    };
    tasks.push(newTask);
    this.removeDeletedId(newTask.id);
    this.saveTasks(tasks);

    if (!this._isSyncing) {
      this._syncTaskToCalendar(newTask);
    }

    return newTask;
  }

  /**
   * Deletes a task by ID.
   */
  deleteTask(taskId) {
    this.addDeletedId(taskId);
    const tasks = this.getTasks().filter(t => t.id !== taskId);
    this.saveTasks(tasks);

    if (!this._isSyncing) {
      this._isSyncing = true;
      try {
        const calEvents = this.getCalendarEvents();
        const filteredCal = calEvents.filter(e => e.id !== taskId);
        if (filteredCal.length !== calEvents.length) {
          this.saveCalendarEvents(filteredCal);
        }
      } finally {
        this._isSyncing = false;
      }
    }
  }

  /**
   * Toggles lock status of a task.
   */
  toggleLock(taskId) {
    const tasks = this.getTasks().map(t => {
      if (t.id === taskId) {
        const nextLocked = !t.isLocked;
        return Object.assign({}, t, {
          isLocked: nextLocked,
          fixedStartTime: nextLocked ? (t.fixedStartTime || t.startTime || null) : null,
          lastModified: Date.now()
        });
      }
      return t;
    });
    this.saveTasks(tasks);

    if (!this._isSyncing) {
      const updated = tasks.find(t => t.id === taskId);
      if (updated) {
        this._syncTaskToCalendar(updated);
      }
    }
  }

  /**
   * Toggles Time Bank permission on a task.
   */
  toggleTaskTimeBank(taskId) {
    const tasks = this.getTasks().map(t => {
      if (t.id === taskId) {
        return Object.assign({}, t, {
          useTimeBank: !(t.useTimeBank !== false),
          lastModified: Date.now()
        });
      }
      return t;
    });
    this.saveTasks(tasks);

    if (!this._isSyncing) {
      const updated = tasks.find(t => t.id === taskId);
      if (updated) {
        this._syncTaskToCalendar(updated);
      }
    }
  }

  /**
   * Updates task properties.
   */
  updateTask(taskId, updates) {
    const tasks = this.getTasks().map(t => {
      if (t.id === taskId) {
        return Object.assign({}, t, updates, { lastModified: Date.now() });
      }
      return t;
    });
    this.saveTasks(tasks);

    if (!this._isSyncing) {
      const updated = tasks.find(t => t.id === taskId);
      if (updated) {
        this._syncTaskToCalendar(updated);
      }
    }
  }

  /**
   * Reorders tasks by moving task from fromIndex to toIndex.
   * @param {number} fromIndex 
   * @param {number} toIndex 
   */
  reorderTasks(fromIndex, toIndex) {
    const tasks = this.getTasks();
    if (fromIndex < 0 || fromIndex >= tasks.length || toIndex < 0 || toIndex >= tasks.length) return tasks;
    const [moved] = tasks.splice(fromIndex, 1);
    tasks.splice(toIndex, 0, moved);
    this.saveTasks(tasks);
    return tasks;
  }

  /**
   * Reorders tasks by moving sourceTaskId to targetTaskId position.
   * @param {string} sourceId 
   * @param {string} targetId 
   */
  reorderTaskById(sourceId, targetId) {
    const tasks = this.getTasks();
    const fromIndex = tasks.findIndex(t => t.id === sourceId);
    const toIndex = tasks.findIndex(t => t.id === targetId);
    if (fromIndex === -1 || toIndex === -1 || fromIndex === toIndex) return tasks;
    const [moved] = tasks.splice(fromIndex, 1);
    tasks.splice(toIndex, 0, moved);
    this.saveTasks(tasks);
    return tasks;
  }

  /**
   * Gets banked seconds in the Time Bank.
   * @returns {number}
   */
  getTimeBankSeconds() {
    try {
      const val = safeGetItem(STORAGE_KEYS.TIME_BANK);
      if (val !== null) {
        const sec = parseInt(val, 10);
        return isNaN(sec) ? 0 : Math.max(0, sec);
      }
    } catch (e) {}
    return 0;
  }

  /**
   * Sets banked seconds in the Time Bank.
   * @param {number} seconds 
   */
  setTimeBankSeconds(seconds) {
    try {
      const sec = Math.max(0, Math.floor(seconds));
      safeSetItem(STORAGE_KEYS.TIME_BANK, sec.toString());
      this._notify();
    } catch (e) {}
  }

  /**
   * Adds seconds to the Time Bank.
   * @param {number} seconds 
   */
  addTimeBankSeconds(seconds) {
    const current = this.getTimeBankSeconds();
    this.setTimeBankSeconds(current + seconds);
  }

  /**
   * Clears all tasks from schedule and removes today's calendar events.
   */
  clearAllTasks() {
    const todayStr = this.getTodayDateString();
    const tasks = this.getTasks();
    tasks.forEach(t => this.addDeletedId(t.id, todayStr));
    const calEvents = this.getCalendarEvents();
    calEvents.filter(e => e.date === todayStr).forEach(e => this.addDeletedId(e.id, todayStr));

    this.saveTasks([]);

    if (!this._isSyncing) {
      this._isSyncing = true;
      try {
        const filteredCal = calEvents.filter(e => e.date !== todayStr);
        if (filteredCal.length !== calEvents.length) {
          this.saveCalendarEvents(filteredCal);
        }
      } finally {
        this._isSyncing = false;
      }
    }
  }

  /**
   * Retrieves whether Hard Stop is enabled.
   * Default is true.
   * @returns {boolean}
   */
  getHardStopEnabled() {
    try {
      const val = safeGetItem('calentimer_hard_stop_enabled');
      if (val !== null) {
        return val === 'true';
      }
    } catch (e) {}
    return true; // Default: true (Hard stop enabled)
  }

  /**
   * Sets whether Hard Stop is enabled.
   * @param {boolean} value 
   */
  setHardStopEnabled(value) {
    try {
      safeSetItem('calentimer_hard_stop_enabled', value ? 'true' : 'false');
      this._notify();
    } catch (e) {}
  }

  /**
   * Retrieves whether user wants a confirmation modal when adjusting dial.
   * Default is false (auto-apply without confirmation).
   * @returns {boolean}
   */
  getConfirmAdjustments() {
    try {
      const val = safeGetItem('calentimer_confirm_adjustments');
      if (val !== null) {
        return val === 'true';
      }
    } catch (e) {}
    return false; // Default: false (do NOT prompt for confirmation)
  }

  /**
   * Sets whether user wants a confirmation modal when adjusting dial.
   * @param {boolean} value 
   */
  setConfirmAdjustments(value) {
    try {
      safeSetItem('calentimer_confirm_adjustments', value ? 'true' : 'false');
      this._notify();
    } catch (e) {}
  }

  /**
   * Retrieves user theme mode ('system', 'light', 'dark').
   * Default is 'dark'.
   * @returns {string}
   */
  getTheme() {
    try {
      return safeGetItem('calentimer_theme') || 'dark';
    } catch (e) {
      return 'dark';
    }
  }

  /**
   * Sets user theme mode ('system', 'light', 'dark').
   * @param {string} theme 
   */
  setTheme(theme) {
    try {
      safeSetItem('calentimer_theme', theme);
      this._notify();
    } catch (e) {}
  }

  /**
   * Retrieves preferred calendar view ('day', 'week', 'month').
   * Default is 'day'.
   * @returns {string}
   */
  getCalendarView() {
    try {
      return safeGetItem('calentimer_calendar_view') || 'day';
    } catch (e) {
      return 'day';
    }
  }

  /**
   * Sets preferred calendar view ('day', 'week', 'month').
   * @param {string} view
   */
  setCalendarView(view) {
    try {
      if (view === 'day' || view === 'week' || view === 'month') {
        safeSetItem('calentimer_calendar_view', view);
        this._notify();
      }
    } catch (e) {}
  }

  /**
   * Retrieves whether haptic feedback (vibrations) is enabled.
   * Default is true.
   * @returns {boolean}
   */
  getHapticsEnabled() {
    try {
      return safeGetItem('calentimer_haptics_enabled') !== 'false';
    } catch (e) {
      return true;
    }
  }

  /**
   * Sets whether haptic feedback is enabled.
   * @param {boolean} enabled
   */
  setHapticsEnabled(enabled) {
    try {
      safeSetItem('calentimer_haptics_enabled', enabled ? 'true' : 'false');
      this._notify();
    } catch (e) {}
  }

  /**
   * Retrieves alert volume (0.0 to 1.0).
   * Default is 0.8.
   * @returns {number}
   */
  getAlertVolume() {
    try {
      const v = safeGetItem('calentimer_alert_volume');
      if (v !== null && !isNaN(parseFloat(v))) {
        return Math.max(0, Math.min(1, parseFloat(v)));
      }
      return 0.8;
    } catch (e) {
      return 0.8;
    }
  }

  /**
   * Sets alert volume (0.0 to 1.0).
   * @param {number} volume
   */
  setAlertVolume(volume) {
    try {
      const clamped = Math.max(0, Math.min(1, Number(volume) || 0));
      safeSetItem('calentimer_alert_volume', String(clamped));
      this._notify();
    } catch (e) {}
  }

  /**
   * Retrieves saved user categories with defaults.
   * @returns {string[]}
   */
  getCategories() {
    const defaultCats = ['Study', 'Practice', 'Admin', 'Work', 'General', 'Break'];
    try {
      const saved = safeGetItem(STORAGE_KEYS.CATEGORIES);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed;
        }
      }
    } catch (e) {}
    return defaultCats;
  }

  /**
   * Adds and persists a new category.
   * @param {string} catName
   * @returns {string[]}
   */
  addCategory(catName) {
    if (!catName || typeof catName !== 'string') return this.getCategories();
    const clean = catName.trim();
    if (!clean) return this.getCategories();

    const cats = this.getCategories();
    const exists = cats.some(c => c.toLowerCase() === clean.toLowerCase());
    if (!exists) {
      // Capitalize nicely
      const formatted = clean.charAt(0).toUpperCase() + clean.slice(1);
      cats.push(formatted);
      try {
        safeSetItem(STORAGE_KEYS.CATEGORIES, JSON.stringify(cats));
        this._notify();
      } catch (e) {}
    }
    return cats;
  }

  /**
   * Deletes a category and persists.
   * @param {string} catName
   * @returns {string[]}
   */
  deleteCategory(catName) {
    if (!catName) return this.getCategories();
    const clean = catName.trim().toLowerCase();
    const cats = this.getCategories().filter(c => c.toLowerCase() !== clean);
    try {
      safeSetItem(STORAGE_KEYS.CATEGORIES, JSON.stringify(cats));
      this._notify();
    } catch (e) {}
    return cats;
  }

  /**
   * Gets whether alerts/notifications are toggled on.
   * @returns {boolean}
   */
  getAlertsEnabled() {
    try {
      const val = safeGetItem(STORAGE_KEYS.ALERTS_ENABLED);
      if (val !== null) {
        return val === 'true';
      }
    } catch (e) {}
    return true; // Default enabled
  }

  /**
   * Sets whether alerts/notifications are toggled on.
   * @param {boolean} enabled 
   */
  setAlertsEnabled(enabled) {
    try {
      safeSetItem(STORAGE_KEYS.ALERTS_ENABLED, enabled ? 'true' : 'false');
      this._notify();
    } catch (e) {}
  }
  /**
   * Gets remembered duration presets in ascending numerical order.
   * @returns {number[]}
   */
  getDurationPresets() {
    try {
      const data = safeGetItem(STORAGE_KEYS.DURATION_PRESETS);
      if (data) {
        const parsed = JSON.parse(data);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed.map(Number).filter(n => !isNaN(n) && n > 0).sort((a, b) => a - b);
        }
      }
    } catch (_) {}
    return [15, 30, 45, 60, 90, 120];
  }

  /**
   * Saves duration presets.
   * @param {number[]} presets 
   * @returns {number[]}
   */
  saveDurationPresets(presets) {
    const list = Array.isArray(presets) ? presets : [];
    const unique = [];
    list.map(Number).filter(n => !isNaN(n) && n > 0).forEach(n => {
      if (unique.indexOf(n) === -1) unique.push(n);
    });
    unique.sort((a, b) => a - b);
    try {
      safeSetItem(STORAGE_KEYS.DURATION_PRESETS, JSON.stringify(unique));
      this._notify();
    } catch (_) {}
    return unique;
  }

  /**
   * Adds a new preset and saves.
   * @param {number|string} min 
   * @returns {number[]}
   */
  addDurationPreset(min) {
    const n = parseInt(min, 10);
    if (isNaN(n) || n <= 0) return this.getDurationPresets();
    const current = this.getDurationPresets();
    if (current.indexOf(n) === -1) {
      current.push(n);
    }
    return this.saveDurationPresets(current);
  }

  /**
   * Deletes a preset and saves.
   * @param {number|string} min 
   * @returns {number[]}
   */
  deleteDurationPreset(min) {
    const n = parseInt(min, 10);
    const current = this.getDurationPresets().filter(m => m !== n);
    return this.saveDurationPresets(current);
  }

  /**
   * Gets all saved To-Do items.
   * @returns {Array<{id: string, title: string, emoji: string, completed: boolean, createdAt: number}>}
   */
  getTodoTasks() {
    try {
      const data = safeGetItem(STORAGE_KEYS.TODO_TASKS);
      if (data) {
        const parsed = JSON.parse(data);
        if (Array.isArray(parsed)) {
          return parsed;
        }
      }
    } catch (_) {}
    return [];
  }

  /**
   * Saves To-Do items.
   * @param {Array} tasks
   * @returns {Array}
   */
  saveTodoTasks(tasks) {
    const list = Array.isArray(tasks) ? tasks : [];
    try {
      safeSetItem(STORAGE_KEYS.TODO_TASKS, JSON.stringify(list));
      this._notify();
    } catch (_) {}
    return list;
  }

  /**
   * Adds a new To-Do item.
   * @param {{title: string, emoji?: string, completed?: boolean}} todo
   * @returns {Object}
   */
  addTodoTask(todo) {
    const title = todo && todo.title ? String(todo.title).trim() : 'Task';
    const emoji = todo && todo.emoji ? String(todo.emoji) : '📌';
    const completed = Boolean(todo && todo.completed);
    const newTask = {
      id: 'todo-' + Date.now() + '-' + Math.random().toString(36).substr(2, 5),
      title: title,
      emoji: emoji,
      completed: completed,
      createdAt: Date.now()
    };
    const current = this.getTodoTasks();
    current.push(newTask);
    this.saveTodoTasks(current);
    return newTask;
  }

  /**
   * Updates an existing To-Do item.
   * @param {string} id
   * @param {Object} updates
   * @returns {Object|null}
   */
  updateTodoTask(id, updates) {
    const current = this.getTodoTasks();
    const index = current.findIndex(t => t.id === id);
    if (index === -1) return null;
    const item = current[index];
    if (updates.title !== undefined) item.title = String(updates.title).trim();
    if (updates.emoji !== undefined) item.emoji = String(updates.emoji);
    if (updates.completed !== undefined) item.completed = Boolean(updates.completed);
    current[index] = item;
    this.saveTodoTasks(current);
    return item;
  }

  /**
   * Deletes a To-Do item.
   * @param {string} id
   * @returns {boolean}
   */
  deleteTodoTask(id) {
    const current = this.getTodoTasks();
    const filtered = current.filter(t => t.id !== id);
    if (filtered.length !== current.length) {
      this.saveTodoTasks(filtered);
      return true;
    }
    return false;
  }

  /**
   * Reorders To-Do items.
   * @param {number} fromIndex
   * @param {number} toIndex
   * @returns {Array}
   */
  reorderTodoTasks(fromIndex, toIndex) {
    const current = this.getTodoTasks();
    if (fromIndex < 0 || fromIndex >= current.length || toIndex < 0 || toIndex >= current.length) {
      return current;
    }
    const moved = current.splice(fromIndex, 1)[0];
    current.splice(toIndex, 0, moved);
    this.saveTodoTasks(current);
    return current;
  }

  /**
   * Clears all completed To-Do tasks.
   * @returns {Array}
   */
  clearCompletedTodoTasks() {
    const current = this.getTodoTasks();
    const incomplete = current.filter(t => !t.completed);
    this.saveTodoTasks(incomplete);
    return incomplete;
  }

  // ==========================================
  // Calendar Events (Month/Week/Day Integration)
  // ==========================================

  /**
   * Retrieves all calendar events from storage.
   * @returns {Array<object>}
   */
  getCalendarEvents() {
    try {
      const data = safeGetItem(STORAGE_KEYS.CALENDAR_EVENTS);
      if (data !== null) {
        const parsed = JSON.parse(data);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch (_) {}

    // Seed with realistic default events for today and surrounding days
    const today = new Date();
    const y = today.getFullYear();
    const m = String(today.getMonth() + 1).padStart(2, '0');
    const d = String(today.getDate()).padStart(2, '0');
    const todayStr = `${y}-${m}-${d}`;

    const defaults = [
      {
        id: 'cal-event-1',
        title: 'Team Standup',
        date: todayStr,
        startTime: '10:00',
        endTime: '10:45',
        plannedDuration: 45,
        isLocked: true,
        emoji: '💼',
        category: 'Work'
      },
      {
        id: 'cal-event-2',
        title: 'Lunch & Recharge',
        date: todayStr,
        startTime: '12:30',
        endTime: '13:15',
        plannedDuration: 45,
        isLocked: false,
        emoji: '🍱',
        category: 'Break'
      },
      {
        id: 'cal-event-3',
        title: 'Deep Focus Sprint',
        date: todayStr,
        startTime: '14:30',
        endTime: '16:00',
        plannedDuration: 90,
        isLocked: true,
        emoji: '🎯',
        category: 'Study'
      }
    ];
    this.saveCalendarEvents(defaults);
    return defaults;
  }

  /**
   * Saves calendar events list to storage.
   * @param {Array<object>} events 
   */
  saveCalendarEvents(events) {
    try {
      const serialized = JSON.stringify(events || []);
      safeSetItem(STORAGE_KEYS.CALENDAR_EVENTS, serialized);
      this._notify();
    } catch (e) {
      console.error('TaskStore: Failed to save calendar events', e);
    }
  }

  /**
   * Adds a new calendar event.
   * @param {object} eventData
   * @returns {object}
   */
  addCalendarEvent(eventData) {
    const current = this.getCalendarEvents();
    const now = Date.now();
    const newEvent = {
      id: (eventData && eventData.id) ? eventData.id : `cal-event-${now}-${Math.random().toString(36).substr(2, 5)}`,
      title: (eventData && eventData.title) ? String(eventData.title).trim() : 'New Event',
      date: (eventData && eventData.date) ? eventData.date : this.getTodayDateString(),
      startTime: (eventData && eventData.startTime) ? eventData.startTime : null,
      endTime: (eventData && eventData.endTime) ? eventData.endTime : null,
      plannedDuration: (eventData && typeof eventData.plannedDuration === 'number') ? eventData.plannedDuration : 60,
      isLocked: (eventData && typeof eventData.isLocked === 'boolean') ? eventData.isLocked : false,
      useTimeBank: (eventData && eventData.useTimeBank !== undefined) ? Boolean(eventData.useTimeBank) : false,
      emoji: (eventData && eventData.emoji) ? eventData.emoji : '📅',
      category: (eventData && eventData.category) ? eventData.category : 'General',
      source: (eventData && eventData.source) ? eventData.source : 'local',
      externalId: (eventData && eventData.externalId) ? eventData.externalId : null,
      lastModified: now
    };
    current.push(newEvent);
    this.removeDeletedId(newEvent.id);
    this.saveCalendarEvents(current);

    if (!this._isSyncing) {
      this._syncCalendarToTask(newEvent);
    }

    return newEvent;
  }

  /**
   * Updates an existing calendar event.
   * @param {string} id
   * @param {object} updates
   * @returns {object|null}
   */
  updateCalendarEvent(id, updates) {
    const current = this.getCalendarEvents();
    const index = current.findIndex(e => e.id === id);
    if (index === -1) return null;

    const prevDate = current[index].date;
    const item = Object.assign({}, current[index], updates, { lastModified: Date.now() });
    current[index] = item;
    this.saveCalendarEvents(current);

    if (!this._isSyncing) {
      const todayStr = this.getTodayDateString();
      if (prevDate === todayStr && item.date !== todayStr) {
        // Event was moved away from today to another date -> remove from today's schedule
        this._isSyncing = true;
        try {
          const tasks = this.getTasks().filter(t => t.id !== id);
          this.saveTasks(tasks);
        } finally {
          this._isSyncing = false;
        }
      } else if (item.date === todayStr) {
        this._syncCalendarToTask(item);
      }
    }

    return item;
  }

  /**
   * Deletes a calendar event.
   * @param {string} id
   * @returns {boolean}
   */
  deleteCalendarEvent(id) {
    this.addDeletedId(id);
    const current = this.getCalendarEvents();
    const filtered = current.filter(e => e.id !== id);
    if (filtered.length !== current.length) {
      this.saveCalendarEvents(filtered);

      if (!this._isSyncing) {
        this._isSyncing = true;
        try {
          const tasks = this.getTasks();
          const filteredTasks = tasks.filter(t => t.id !== id);
          if (filteredTasks.length !== tasks.length) {
            this.saveTasks(filteredTasks);
          }
        } finally {
          this._isSyncing = false;
        }
      }
      return true;
    }
    return false;
  }

  // ==========================================
  // Schedule & Calendar Bi-directional Sync Bridge
  // ==========================================

  _syncTaskToCalendar(task) {
    this._isSyncing = true;
    try {
      const todayStr = this.getTodayDateString();
      const calEvents = this.getCalendarEvents();
      const existingIdx = calEvents.findIndex(e => e.id === task.id && e.date === todayStr);

      const startTime = task.fixedStartTime || task.startTime || '09:00';
      let endTime = task.endTime;
      if (!endTime) {
        const dur = task.plannedDuration || 30;
        const parts = startTime.split(':');
        const startMin = (parseInt(parts[0], 10) || 0) * 60 + (parseInt(parts[1], 10) || 0);
        const endMin = (startMin + dur) % 1440;
        const endH = Math.floor(endMin / 60);
        const endM = endMin % 60;
        endTime = `${String(endH).padStart(2, '0')}:${String(endM).padStart(2, '0')}`;
      }

      const eventPayload = {
        id: task.id,
        title: task.title,
        date: todayStr,
        startTime: startTime,
        endTime: endTime,
        plannedDuration: task.plannedDuration,
        isLocked: Boolean(task.isLocked),
        useTimeBank: task.useTimeBank !== false,
        emoji: task.emoji || '📌',
        category: task.category || 'General',
        source: task.source || 'local',
        externalId: task.externalId || null,
        lastModified: task.lastModified || Date.now()
      };

      if (existingIdx >= 0) {
        calEvents[existingIdx] = Object.assign({}, calEvents[existingIdx], eventPayload);
      } else {
        calEvents.push(eventPayload);
      }
      this.saveCalendarEvents(calEvents);
    } finally {
      this._isSyncing = false;
    }
  }

  _syncCalendarToTask(calEvent) {
    const todayStr = this.getTodayDateString();
    if (calEvent.date !== todayStr) return;

    this._isSyncing = true;
    try {
      const tasks = this.getTasks();
      const existingIdx = tasks.findIndex(t => t.id === calEvent.id);
      const isEventLocked = Boolean(calEvent.isLocked);
      const fixedStart = calEvent.fixedStartTime || calEvent.startTime || null;
      const taskPayload = {
        id: calEvent.id,
        title: calEvent.title,
        plannedDuration: calEvent.plannedDuration,
        category: calEvent.category,
        emoji: calEvent.emoji,
        isLocked: isEventLocked,
        useTimeBank: calEvent.useTimeBank !== false,
        fixedStartTime: fixedStart,
        startTime: calEvent.startTime,
        endTime: calEvent.endTime,
        source: calEvent.source || 'local',
        externalId: calEvent.externalId || null,
        lastModified: calEvent.lastModified || Date.now()
      };

      if (existingIdx >= 0) {
        tasks[existingIdx] = Object.assign({}, tasks[existingIdx], taskPayload);
      } else {
        tasks.push(taskPayload);
      }

      const allEvents = this.getCalendarEvents().filter(e => e.date === todayStr);
      const eventTimeMap = new Map();
      allEvents.forEach(e => {
        if (e.startTime) eventTimeMap.set(e.id, e.startTime);
      });

      tasks.sort((a, b) => {
        const timeA = a.startTime || a.fixedStartTime || (eventTimeMap.has(a.id) ? eventTimeMap.get(a.id) : null);
        const timeB = b.startTime || b.fixedStartTime || (eventTimeMap.has(b.id) ? eventTimeMap.get(b.id) : null);
        const aStart = timeA ? (parseInt(timeA.split(':')[0], 10) * 60 + parseInt(timeA.split(':')[1], 10)) : 1440;
        const bStart = timeB ? (parseInt(timeB.split(':')[0], 10) * 60 + parseInt(timeB.split(':')[1], 10)) : 1440;
        return aStart - bStart;
      });

      this.saveTasks(tasks);
    } finally {
      this._isSyncing = false;
    }
  }

  /**
   * Reconciles all items between Today's Schedule and Calendar for today.
   */
  syncScheduleAndCalendar(targetDateStr) {
    if (this._isSyncing) return;
    this._isSyncing = true;
    try {
      const todayStr = targetDateStr || this.getTodayDateString();
      const deletedIds = this.getDeletedIds(todayStr);

      const rawTasks = this.getTasks();
      const currentTasks = rawTasks.filter(t => !deletedIds.has(t.id));
      const allCalEvents = this.getCalendarEvents();

      const todayCalEvents = allCalEvents.filter(e => e.date === todayStr && !deletedIds.has(e.id));
      const otherCalEvents = allCalEvents.filter(e => e.date !== todayStr);

      const taskMap = new Map();
      currentTasks.forEach(t => taskMap.set(t.id, t));

      const calMap = new Map();
      todayCalEvents.forEach(e => calMap.set(e.id, e));

      let tasksChanged = rawTasks.length !== currentTasks.length;
      let calChanged = false;

      const mergedTasks = [...currentTasks];
      const mergedTodayEvents = [...todayCalEvents];

      // 1. Sync Calendar Events -> Tasks (Events created or edited on Calendar for Today)
      todayCalEvents.forEach(calEvent => {
        if (deletedIds.has(calEvent.id)) return;
        const existingTask = taskMap.get(calEvent.id);
        const isEventLocked = Boolean(calEvent.isLocked);
        const fixedStart = calEvent.fixedStartTime || calEvent.startTime || null;
        if (!existingTask) {
          const newTask = {
            id: calEvent.id,
            title: calEvent.title || 'Event',
            plannedDuration: calEvent.plannedDuration || 30,
            category: calEvent.category || 'General',
            emoji: calEvent.emoji || '📅',
            isLocked: isEventLocked,
            useTimeBank: calEvent.useTimeBank !== false,
            fixedStartTime: fixedStart,
            startTime: calEvent.startTime || null,
            endTime: calEvent.endTime || null,
            source: calEvent.source || 'local',
            externalId: calEvent.externalId || null,
            lastModified: calEvent.lastModified || Date.now()
          };
          mergedTasks.push(newTask);
          taskMap.set(newTask.id, newTask);
          tasksChanged = true;
        } else {
          const calMod = calEvent.lastModified || 0;
          const taskMod = existingTask.lastModified || 0;
          if (calMod > taskMod) {
            existingTask.title = calEvent.title;
            existingTask.plannedDuration = calEvent.plannedDuration;
            existingTask.category = calEvent.category;
            existingTask.emoji = calEvent.emoji;
            existingTask.isLocked = isEventLocked;
            existingTask.useTimeBank = calEvent.useTimeBank !== false;
            existingTask.fixedStartTime = fixedStart;
            existingTask.startTime = calEvent.startTime;
            existingTask.endTime = calEvent.endTime;
            existingTask.lastModified = calMod;
            tasksChanged = true;
          }
        }
      });

      // 2. Remove any tasks whose calendar event was moved away from today or deleted
      const tasksToKeep = [];
      mergedTasks.forEach(task => {
        if (deletedIds.has(task.id)) {
          tasksChanged = true;
          return;
        }
        const movedAway = otherCalEvents.some(e => e.id === task.id);
        if (movedAway) {
          tasksChanged = true;
          return;
        }
        tasksToKeep.push(task);
      });

      // 3. Sync Tasks -> Calendar Events (Tasks created, reordered, or edited in Schedule)
      tasksToKeep.forEach(task => {
        if (deletedIds.has(task.id)) return;
        const existingEvent = calMap.get(task.id);
        const startTime = task.fixedStartTime || task.startTime || '09:00';
        let endTime = task.endTime;
        if (!endTime && startTime) {
          const dur = task.plannedDuration || 30;
          const startParts = startTime.split(':');
          const startMin = (parseInt(startParts[0], 10) || 0) * 60 + (parseInt(startParts[1], 10) || 0);
          const endMin = (startMin + dur) % 1440;
          const endH = Math.floor(endMin / 60);
          const endM = endMin % 60;
          endTime = `${String(endH).padStart(2, '0')}:${String(endM).padStart(2, '0')}`;
        }

        if (!existingEvent) {
          const newEvent = {
            id: task.id,
            title: task.title || 'Task',
            date: todayStr,
            startTime: startTime,
            endTime: endTime || '10:00',
            plannedDuration: task.plannedDuration || 30,
            isLocked: Boolean(task.isLocked),
            useTimeBank: task.useTimeBank !== false,
            emoji: task.emoji || '📌',
            category: task.category || 'General',
            source: task.source || 'local',
            externalId: task.externalId || null,
            lastModified: task.lastModified || Date.now()
          };
          mergedTodayEvents.push(newEvent);
          calMap.set(newEvent.id, newEvent);
          calChanged = true;
        } else {
          const taskMod = task.lastModified || 0;
          const calMod = existingEvent.lastModified || 0;
          if (taskMod >= calMod || !existingEvent.isLocked) {
            let updated = false;
            if (existingEvent.title !== task.title) { existingEvent.title = task.title; updated = true; }
            if (existingEvent.plannedDuration !== task.plannedDuration) { existingEvent.plannedDuration = task.plannedDuration; updated = true; }
            if (existingEvent.category !== task.category) { existingEvent.category = task.category; updated = true; }
            if (existingEvent.emoji !== task.emoji) { existingEvent.emoji = task.emoji; updated = true; }
            if (existingEvent.useTimeBank !== (task.useTimeBank !== false)) { existingEvent.useTimeBank = task.useTimeBank !== false; updated = true; }
            if (task.startTime && existingEvent.startTime !== task.startTime) { existingEvent.startTime = task.startTime; updated = true; }
            if (task.endTime && existingEvent.endTime !== task.endTime) { existingEvent.endTime = task.endTime; updated = true; }
            const lockedState = Boolean(task.isLocked);
            if (existingEvent.isLocked !== lockedState) { existingEvent.isLocked = lockedState; updated = true; }
            if (updated) {
              existingEvent.lastModified = Date.now();
              calChanged = true;
            }
          }
        }
      });

      tasksToKeep.sort((a, b) => {
        const timeA = a.startTime || a.fixedStartTime || (calMap.has(a.id) ? calMap.get(a.id).startTime : null);
        const timeB = b.startTime || b.fixedStartTime || (calMap.has(b.id) ? calMap.get(b.id).startTime : null);
        const aStart = timeA ? (parseInt(timeA.split(':')[0], 10) * 60 + parseInt(timeA.split(':')[1], 10)) : 1440;
        const bStart = timeB ? (parseInt(timeB.split(':')[0], 10) * 60 + parseInt(timeB.split(':')[1], 10)) : 1440;
        return aStart - bStart;
      });
      safeSetItem(STORAGE_KEYS.TASKS, JSON.stringify(tasksToKeep));
      tasksChanged = true;
      const todayEventsWithDeletes = allCalEvents.some(e => e.date === todayStr && deletedIds.has(e.id));
      if (calChanged || todayEventsWithDeletes) {
        const finalEvents = otherCalEvents.concat(mergedTodayEvents);
        safeSetItem(STORAGE_KEYS.CALENDAR_EVENTS, JSON.stringify(finalEvents));
      }
      if (tasksChanged || calChanged || todayEventsWithDeletes) {
        this._notify();
      }
    } finally {
      this._isSyncing = false;
    }
  }

  /**
   * Calendar Custom Display Time Window Settings
   */
  getCalendarCustomRangeEnabled() {
    try {
      const v = safeGetItem(STORAGE_KEYS.CAL_RANGE_ENABLED);
      return v === 'true';
    } catch (_) {
      return false;
    }
  }

  setCalendarCustomRangeEnabled(enabled) {
    safeSetItem(STORAGE_KEYS.CAL_RANGE_ENABLED, Boolean(enabled) ? 'true' : 'false');
    this._notify();
  }

  getCalendarStartTime() {
    try {
      const v = safeGetItem(STORAGE_KEYS.CAL_START_TIME);
      if (v && /^\d{1,2}:\d{2}$/.test(v)) return v;
    } catch (_) {}
    return '08:00';
  }

  setCalendarStartTime(timeStr) {
    if (timeStr && /^\d{1,2}:\d{2}$/.test(timeStr)) {
      safeSetItem(STORAGE_KEYS.CAL_START_TIME, timeStr);
      this._notify();
    }
  }

  getCalendarEndTime() {
    try {
      const v = safeGetItem(STORAGE_KEYS.CAL_END_TIME);
      if (v && /^\d{1,2}:\d{2}$/.test(v)) return v;
    } catch (_) {}
    return '22:00';
  }

  setCalendarEndTime(timeStr) {
    if (timeStr && /^\d{1,2}:\d{2}$/.test(timeStr)) {
      safeSetItem(STORAGE_KEYS.CAL_END_TIME, timeStr);
      this._notify();
    }
  }

  getTimespansEnabled() {
    try {
      const v = safeGetItem(STORAGE_KEYS.TIMESPANS_ENABLED);
      if (v !== null) return v === 'true';
    } catch (_) {}
    return true;
  }

  setTimespansEnabled(enabled) {
    safeSetItem(STORAGE_KEYS.TIMESPANS_ENABLED, Boolean(enabled) ? 'true' : 'false');
    this._notify();
  }
}

export const taskStore = new TaskStore();
export default taskStore;
