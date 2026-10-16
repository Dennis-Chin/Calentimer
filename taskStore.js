/**
 * taskStore.js
 * 
 * LocalStorage state persistence for tasks and Hard Stop settings.
 * Ensures data is preserved across page reloads and Android app restarts.
 */

const STORAGE_KEYS = {
  TASKS: 'calentimer_tasks_v1',
  HARD_STOP: 'calentimer_hard_stop_v1',
  SETTINGS: 'calentimer_settings_v1'
};

const DEFAULT_TASKS = [
  {
    id: 'task-1',
    title: 'Core Reading & Notes',
    plannedDuration: 45,
    isLocked: false,
    category: 'Study',
    tags: ['focus', 'reading'],
    emoji: '📚'
  },
  {
    id: 'task-2',
    title: 'Practice Problems',
    plannedDuration: 30,
    isLocked: false,
    category: 'Practice',
    tags: ['exercises'],
    emoji: '📝'
  },
  {
    id: 'task-3',
    title: 'Submission & Review',
    plannedDuration: 15,
    isLocked: true,
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
      const data = localStorage.getItem(STORAGE_KEYS.TASKS);
      if (data) {
        const parsed = JSON.parse(data);
        if (Array.isArray(parsed) && parsed.length > 0) {
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
      localStorage.setItem(STORAGE_KEYS.TASKS, JSON.stringify(tasks));
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
      const saved = localStorage.getItem(STORAGE_KEYS.HARD_STOP);
      if (saved && /^\d{1,2}:\d{2}$/.test(saved)) {
        return saved;
      }
    } catch (e) {
      // ignore
    }

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
      localStorage.setItem(STORAGE_KEYS.HARD_STOP, hardStop);
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
   * Retrieves whether user wants a confirmation modal when adjusting dial.
   * Default is false (auto-apply without confirmation).
   * @returns {boolean}
   */
  getConfirmAdjustments() {
    try {
      const val = localStorage.getItem('calentimer_confirm_adjustments');
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
      localStorage.setItem('calentimer_confirm_adjustments', value ? 'true' : 'false');
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
      return localStorage.getItem('calentimer_theme') || 'system';
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
      localStorage.setItem('calentimer_theme', theme);
      this._notify();
    } catch (e) {}
  }
}

export const taskStore = new TaskStore();
export default taskStore;
