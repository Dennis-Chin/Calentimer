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
  ALERTS_ENABLED: 'calentimer_alerts_enabled_v1'
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

  /**
   * Adds a new task.
   */
  addTask(task) {
    const tasks = this.getTasks();
    const newTask = {
      id: `task-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
      title: task.title || 'Untitled Task',
      plannedDuration: Math.max(1, parseInt(task.plannedDuration, 10) || 25),
      isLocked: Boolean(task.isLocked || task.fixedStartTime),
      useTimeBank: task.useTimeBank !== undefined ? Boolean(task.useTimeBank) : true,
      fixedStartTime: task.fixedStartTime || null,
      category: task.category || 'General',
      tags: Array.isArray(task.tags) ? task.tags : (task.tags ? task.tags.split(',').map(t => t.trim()).filter(Boolean) : []),
      emoji: task.emoji || '📌'
    };
    tasks.push(newTask);
    this.saveTasks(tasks);
    return newTask;
  }

  /**
   * Deletes a task by ID.
   */
  deleteTask(taskId) {
    const tasks = this.getTasks().filter(t => t.id !== taskId);
    this.saveTasks(tasks);
  }

  /**
   * Toggles lock status of a task.
   */
  toggleLock(taskId) {
    const tasks = this.getTasks().map(t => {
      if (t.id === taskId) {
        return { ...t, isLocked: !t.isLocked };
      }
      return t;
    });
    this.saveTasks(tasks);
  }

  /**
   * Toggles Time Bank permission on a task.
   */
  toggleTaskTimeBank(taskId) {
    const tasks = this.getTasks().map(t => {
      if (t.id === taskId) {
        return { ...t, useTimeBank: !(t.useTimeBank !== false) };
      }
      return t;
    });
    this.saveTasks(tasks);
  }

  /**
   * Updates task properties.
   */
  updateTask(taskId, updates) {
    const tasks = this.getTasks().map(t => {
      if (t.id === taskId) {
        return { ...t, ...updates };
      }
      return t;
    });
    this.saveTasks(tasks);
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
   * Clears all tasks from schedule.
   */
  clearAllTasks() {
    this.saveTasks([]);
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
   * Default is 'system'.
   * @returns {string}
   */
  getTheme() {
    try {
      return safeGetItem('calentimer_theme') || 'system';
    } catch (e) {
      return 'system';
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
}

export const taskStore = new TaskStore();
export default taskStore;
