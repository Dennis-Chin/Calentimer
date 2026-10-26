/**
 * schedulerEngine.js
 * 
 * Standalone calculation engine for the Hard-Stop Study Timer.
 * Handles time calculation, proportional compression with zero-drift
 * whole-minute integer apportionment, and multi-criteria task sorting.
 * 
 * Pure JavaScript with zero external dependencies.
 */

/**
 * Parses a time representation into integer minutes from midnight (0 - 1439).
 * Accepts:
 *   - "HH:MM" 24-hour string (e.g. "13:00", "09:30")
 *   - Date object (uses local hours and minutes)
 *   - Number (assumed to already be minutes from midnight)
 * 
 * @param {string|Date|number} timeInput 
 * @returns {number} Minutes from midnight (0 - 1439)
 */
export function parseTimeToMinutes(timeInput) {
  if (timeInput === null || timeInput === undefined) {
    return 0;
  }

  if (typeof timeInput === 'number' && !isNaN(timeInput)) {
    return Math.floor(timeInput) % 1440;
  }

  if (timeInput instanceof Date && !isNaN(timeInput.getTime())) {
    return timeInput.getHours() * 60 + timeInput.getMinutes();
  }

  if (typeof timeInput === 'string') {
    const match = timeInput.trim().match(/^(\d{1,2}):(\d{2})$/);
    if (!match) {
      throw new Error(`Invalid time format: "${timeInput}". Expected "HH:MM" (24-hour format).`);
    }
    const hours = parseInt(match[1], 10);
    const minutes = parseInt(match[2], 10);

    if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
      throw new Error(`Invalid time values: "${timeInput}". Hours must be 0-23, minutes 0-59.`);
    }

    return hours * 60 + minutes;
  }

  throw new Error(`Unsupported time format: ${typeof timeInput}`);
}

/**
 * Formats integer minutes from midnight into 24-hour "HH:MM" format.
 * Automatically wraps times >= 1440.
 * 
 * @param {number} totalMinutes 
 * @returns {string} "HH:MM"
 */
export function formatMinutesToTime(totalMinutes) {
  const normalized = ((Math.floor(totalMinutes) % 1440) + 1440) % 1440;
  const hours = Math.floor(normalized / 60);
  const minutes = normalized % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

/**
 * Computes available window in minutes between startTime and hardStop.
 * If hardStop is numerically less than startTime, it is treated as crossing midnight (next day).
 * 
 * @param {string|Date|number} [startTime] - Defaults to current local time if omitted
 * @param {string|Date|number} hardStop - The Hard Stop target time
 * @returns {number} Available duration in minutes
 */
export function calculateAvailableMinutes(startTime, hardStop) {
  const start = startTime != null ? parseTimeToMinutes(startTime) : parseTimeToMinutes(new Date());
  const stop = parseTimeToMinutes(hardStop);

  if (stop > start) {
    return stop - start;
  } else if (stop < start) {
    // Crosses midnight to the next day
    return (1440 - start) + stop;
  } else {
    // Exactly equal -> 0 remaining
    return 0;
  }
}

/**
 * Allocates integer minutes to items using the Largest Remainder Method (Hamilton-Hare method).
 * Guarantees that the sum of allocated whole minutes strictly equals targetTotal with zero rounding drift.
 * 
 * @param {Array<{ plannedDuration: number, [key: string]: any }>} items 
 * @param {number} targetTotal - Exact total integer minutes to distribute
 * @param {object} [options]
 * @param {boolean} [options.enforceMinFloor=true] - If true and targetTotal >= items.length, ensures each item receives at least 1 minute.
 * @returns {number[]} Array of integer allocated minutes matching the input order
 */
export function apportionWholeMinutes(items, targetTotal, options = {}) {
  const count = items.length;
  if (count === 0) return [];
  if (targetTotal <= 0) return items.map(() => 0);

  const enforceFloor = options.enforceMinFloor !== false && targetTotal >= count;

  const totalPlanned = items.reduce((sum, item) => sum + item.plannedDuration, 0);
  if (totalPlanned <= 0) {
    // If all planned durations are 0, divide evenly
    const base = Math.floor(targetTotal / count);
    const rem = targetTotal % count;
    return items.map((_, idx) => base + (idx < rem ? 1 : 0));
  }

  if (enforceFloor) {
    // Reserve 1 minute floor for each item, then distribute the remaining minutes proportionally
    const remainingToDistribute = targetTotal - count;
    const quotas = items.map(item => (item.plannedDuration / totalPlanned) * remainingToDistribute);
    const floors = quotas.map(q => Math.floor(q));
    const assignedSoFar = floors.reduce((a, b) => a + b, 0);
    let remainder = remainingToDistribute - assignedSoFar;

    // Fractional remainders for fair distribution
    const indexedRemainders = quotas.map((q, idx) => ({
      index: idx,
      remainder: q - floors[idx]
    }));

    indexedRemainders.sort((a, b) => b.remainder - a.remainder);

    const bonus = new Array(count).fill(0);
    for (let i = 0; i < remainder; i++) {
      bonus[indexedRemainders[i].index] = 1;
    }

    return items.map((_, idx) => 1 + floors[idx] + bonus[idx]);
  } else {
    // Standard Largest Remainder Method without floor guarantee
    const quotas = items.map(item => (item.plannedDuration / totalPlanned) * targetTotal);
    const floors = quotas.map(q => Math.floor(q));
    const assignedSoFar = floors.reduce((a, b) => a + b, 0);
    let remainder = targetTotal - assignedSoFar;

    const indexedRemainders = quotas.map((q, idx) => ({
      index: idx,
      remainder: q - floors[idx]
    }));

    indexedRemainders.sort((a, b) => b.remainder - a.remainder);

    const bonus = new Array(count).fill(0);
    for (let i = 0; i < remainder; i++) {
      bonus[indexedRemainders[i].index] = 1;
    }

    return items.map((_, idx) => floors[idx] + bonus[idx]);
  }
}

/**
 * Sorts tasks by various criteria (category, tags, plannedDuration, isLocked, or custom comparator).
 * Does not mutate original task array.
 * 
 * @param {Array<object>} tasks 
 * @param {string|Function|Array<string|Function>} criteria 
 * @returns {Array<object>} Shallow copy of tasks, sorted
 */
export function sortTasks(tasks, criteria) {
  if (!tasks || !Array.isArray(tasks)) return [];
  if (!criteria) return [...tasks];

  const criteriaList = Array.isArray(criteria) ? criteria : [criteria];
  const copy = [...tasks];

  copy.sort((a, b) => {
    for (const rule of criteriaList) {
      let comparison = 0;

      if (typeof rule === 'function') {
        comparison = rule(a, b);
      } else if (typeof rule === 'string') {
        const desc = rule.startsWith('-');
        const key = desc ? rule.slice(1) : rule;

        if (key === 'category') {
          const catA = (a.category || '').toLowerCase();
          const catB = (b.category || '').toLowerCase();
          comparison = catA.localeCompare(catB);
        } else if (key === 'tags') {
          // Sort by first tag, or comma-joined tags
          const tagA = (Array.isArray(a.tags) ? a.tags.join(',') : '').toLowerCase();
          const tagB = (Array.isArray(b.tags) ? b.tags.join(',') : '').toLowerCase();
          comparison = tagA.localeCompare(tagB);
        } else if (key === 'plannedDuration') {
          comparison = (a.plannedDuration || 0) - (b.plannedDuration || 0);
        } else if (key === 'isLocked') {
          // true first
          comparison = (b.isLocked ? 1 : 0) - (a.isLocked ? 1 : 0);
        } else if (key in a || key in b) {
          const valA = a[key];
          const valB = b[key];
          if (typeof valA === 'string' && typeof valB === 'string') {
            comparison = valA.localeCompare(valB);
          } else {
            comparison = (valA > valB ? 1 : valA < valB ? -1 : 0);
          }
        }

        if (desc) comparison = -comparison;
      }

      if (comparison !== 0) return comparison;
    }
    return 0;
  });

  return copy;
}

/**
 * Main Scheduling Function
 * 
 * Computes compressed schedule and assigns whole-minute durations and exact start/end clock times.
 * 
 * @param {object} config
 * @param {string|Date|number} config.hardStop - Hard stop clock time (e.g. "13:00")
 * @param {string|Date|number} [config.startTime] - Start time (defaults to current time)
 * @param {Array<object>} config.tasks - List of tasks: { id, title, plannedDuration, isLocked, category?, tags? }
 * @param {string|Function|Array<string|Function>} [config.sortBy] - Optional sorting criteria before scheduling
 * @param {object} [config.options]
 * @param {boolean} [config.options.enforceMinFloor=true] - If true, guarantees >= 1 min per unlocked task if time permits
 * 
 * @returns {object} Schedule result or error object
 */
export function calculateSchedule(config) {
  if (!config || typeof config !== 'object') {
    return {
      success: false,
      error: {
        code: "INVALID_CONFIG",
        message: "Configuration object is required."
      }
    };
  }

  const { hardStop, startTime, options = {} } = config;
  const disableHardStop = Boolean(config.disableHardStop || options.disableHardStop);

  if (hardStop == null && !disableHardStop) {
    return {
      success: false,
      error: {
        code: "MISSING_HARD_STOP",
        message: "A hardStop time (e.g., '13:00' or Date) must be provided."
      }
    };
  }

  // 1. Calculate available window
  let startMinutes;
  let hardStopMinutes;
  let availableMinutes;

  try {
    startMinutes = startTime != null ? parseTimeToMinutes(startTime) : parseTimeToMinutes(new Date());
    hardStopMinutes = hardStop != null ? parseTimeToMinutes(hardStop) : (startMinutes + 480);
    availableMinutes = calculateAvailableMinutes(startMinutes, hardStopMinutes);
  } catch (err) {
    if (!disableHardStop) {
      return {
        success: false,
        error: {
          code: "INVALID_TIME_INPUT",
          message: err.message
        }
      };
    }
    startMinutes = parseTimeToMinutes(new Date());
    hardStopMinutes = startMinutes + 480;
    availableMinutes = 480;
  }

  if (availableMinutes <= 0 && !disableHardStop) {
    return {
      success: false,
      error: {
        code: "HARD_STOP_PASSED",
        message: `The Hard Stop time (${formatMinutesToTime(hardStopMinutes)}) must be later than the start time (${formatMinutesToTime(startMinutes)}).`,
        details: {
          startMinutes,
          hardStopMinutes,
          availableMinutes
        }
      }
    };
  }

  // 2. Normalize and validate tasks
  const rawTasks = Array.isArray(config.tasks) ? config.tasks : [];

  for (const t of rawTasks) {
    if (typeof t.plannedDuration !== 'number' || isNaN(t.plannedDuration) || t.plannedDuration < 0) {
      return {
        success: false,
        error: {
          code: "INVALID_TASK_DURATION",
          message: `Task "${t.title || t.id || 'unnamed'}" has an invalid plannedDuration: ${t.plannedDuration}. Must be non-negative number.`,
          details: { taskId: t.id }
        }
      };
    }
  }

  // 3. Sort tasks if requested
  const tasks = config.sortBy ? sortTasks(rawTasks, config.sortBy) : [...rawTasks];

  // 4. Categorize locked vs unlocked
  let totalLockedMinutes = 0;
  let totalUnlockedMinutes = 0;
  const unlockedIndices = [];

  tasks.forEach((task, index) => {
    const dur = Math.round(task.plannedDuration);
    if (task.isLocked) {
      totalLockedMinutes += dur;
    } else {
      totalUnlockedMinutes += dur;
      unlockedIndices.push(index);
    }
  });

  const totalPlannedMinutes = totalLockedMinutes + totalUnlockedMinutes;

  // 5. Compression Mechanic (Isolated: Disabled by default across the entire app)
  // Tasks retain full duration. Padlock is strictly for rigidity (stops moving/time adjustments).
  // Hard Stop is strictly target finish time.
  const enableCompression = Boolean(options.enableCompression);

  if (enableCompression && !disableHardStop && totalLockedMinutes > availableMinutes) {
    return {
      success: false,
      error: {
        code: "LOCKED_TASKS_EXCEED_TIME",
        message: `Locked tasks require ${totalLockedMinutes}m, but only ${availableMinutes}m are available before Hard Stop (${formatMinutesToTime(hardStopMinutes)}).`,
        details: {
          availableMinutes,
          requiredLockedMinutes: totalLockedMinutes,
          deficitMinutes: totalLockedMinutes - availableMinutes
        }
      }
    };
  }

  // 6. Duration Allocation
  const allocatedDurations = new Array(tasks.length);
  let isCompressed = false;
  let compressionRatio = 1.0;

  if (!enableCompression || disableHardStop || totalPlannedMinutes <= availableMinutes) {
    // Normal / Uncompressed mode: Every task retains exact planned duration without shrinking
    tasks.forEach((task, idx) => {
      allocatedDurations[idx] = Math.max(1, Math.round(task.plannedDuration || 1));
    });
  } else {
    // Isolated legacy compression mode (only if options.enableCompression === true)
    isCompressed = true;
    const availableForUnlocked = availableMinutes - totalLockedMinutes;

    if (totalUnlockedMinutes > 0) {
      compressionRatio = availableForUnlocked / totalUnlockedMinutes;
      const unlockedTasks = unlockedIndices.map(idx => ({
        plannedDuration: Math.round(tasks[idx].plannedDuration)
      }));

      const apportioned = apportionWholeMinutes(unlockedTasks, availableForUnlocked, {
        enforceMinFloor: options.enforceMinFloor !== false
      });

      unlockedIndices.forEach((taskIdx, i) => {
        allocatedDurations[taskIdx] = apportioned[i];
      });
    }

    // Locked tasks keep their exact planned duration
    tasks.forEach((task, idx) => {
      if (task.isLocked) {
        allocatedDurations[idx] = Math.round(task.plannedDuration);
      }
    });
  }

  // 7. Generate timeline schedule (start & end clock times)
  let currentClockMinutes = startMinutes;
  const scheduledTasks = tasks.map((task, idx) => {
    const allocated = allocatedDurations[idx];

    let taskStart = currentClockMinutes;
    const specifiedStart = task.fixedStartTime || task.startTime;
    if (specifiedStart) {
      try {
        const parsedStart = parseTimeToMinutes(specifiedStart);
        taskStart = parsedStart;
      } catch (e) {
        // Fallback to sequential
      }
    }

    const taskEnd = taskStart + allocated;
    currentClockMinutes = taskEnd;

    return {
      id: task.id,
      title: task.title,
      category: task.category || null,
      tags: Array.isArray(task.tags) ? [...task.tags] : [],
      emoji: task.emoji || '📌',
      isLocked: Boolean(task.isLocked),
      useTimeBank: task.useTimeBank !== undefined ? Boolean(task.useTimeBank) : true,
      fixedStartTime: task.fixedStartTime || null,
      isImmovable: Boolean(task.isLocked),
      plannedDuration: Math.round(task.plannedDuration),
      allocatedDuration: allocated,
      startTime: formatMinutesToTime(taskStart),
      endTime: formatMinutesToTime(taskEnd)
    };
  });

  const totalAllocatedMinutes = allocatedDurations.reduce((a, b) => a + b, 0);
  const bufferMinutes = availableMinutes - totalAllocatedMinutes;

  return {
    success: true,
    isCompressed,
    compressionRatio: Number(compressionRatio.toFixed(4)),
    startTime: formatMinutesToTime(startMinutes),
    hardStop: formatMinutesToTime(hardStopMinutes),
    availableMinutes,
    totalPlannedMinutes,
    totalAllocatedMinutes,
    bufferMinutes,
    tasks: scheduledTasks
  };
}

export default {
  parseTimeToMinutes,
  formatMinutesToTime,
  calculateAvailableMinutes,
  apportionWholeMinutes,
  sortTasks,
  calculateSchedule
};
