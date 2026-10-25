/**
 * testCalendarView.js
 * 
 * Unit tests for CalendarView DOM interactions:
 * - Touch & mouse event lifecycle across Day, Week, and Month views
 * - Verification that drag coordinates (lastClientX, lastClientY, startX, startY)
 *   are declared and execute cleanly in strict mode with zero ReferenceError
 * - Tap-to-inspect and hold-to-drag state transitions
 * - Event inspector opening and ghost-click protection
 */

// 1. Setup Mock DOM Environment before importing CalendarView
const mockStorage = {};
global.localStorage = {
  getItem: (k) => (mockStorage[k] !== undefined ? mockStorage[k] : null),
  setItem: (k, v) => { mockStorage[k] = String(v); },
  removeItem: (k) => { delete mockStorage[k]; },
  clear: () => { Object.keys(mockStorage).forEach(k => delete mockStorage[k]); }
};

function createMockElement(tagName = 'div', id = '') {
  const listeners = {};
  const classes = new Set();
  const attributes = {};
  const children = [];
  let rawInnerHtml = '';

  const el = {
    tagName: tagName.toUpperCase(),
    id: id || '',
    get className() {
      return Array.from(classes).join(' ');
    },
    set className(val) {
      classes.clear();
      if (val) {
        val.split(/\s+/).forEach(c => { if (c) classes.add(c); });
      }
    },
    textContent: '',
    value: '',
    get innerHTML() { return rawInnerHtml; },
    set innerHTML(val) {
      rawInnerHtml = val;
      if (val === '') {
        children.length = 0;
      }
    },
    clientWidth: 360,
    clientHeight: 600,
    scrollTop: 0,
    scrollLeft: 0,
    style: {
      setProperty: (prop, val) => { el.style[prop] = val; },
      removeProperty: (prop) => { delete el.style[prop]; }
    },
    classList: {
      add: (...cls) => {
        cls.forEach(c => classes.add(c));
      },
      remove: (...cls) => {
        cls.forEach(c => classes.delete(c));
      },
      toggle: (c, force) => {
        if (force === true) classes.add(c);
        else if (force === false) classes.delete(c);
        else if (classes.has(c)) classes.delete(c);
        else classes.add(c);
        return classes.has(c);
      },
      contains: (c) => classes.has(c)
    },
    setAttribute: (name, val) => { attributes[name] = String(val); },
    getAttribute: (name) => (attributes[name] !== undefined ? attributes[name] : null),
    hasAttribute: (name) => (attributes[name] !== undefined),
    removeAttribute: (name) => { delete attributes[name]; },
    appendChild: (child) => {
      child.parentNode = el;
      child.parentElement = el;
      children.push(child);
      return child;
    },
    removeChild: (child) => {
      const idx = children.indexOf(child);
      if (idx !== -1) {
        children.splice(idx, 1);
        child.parentNode = null;
        child.parentElement = null;
      }
      return child;
    },
    querySelector: (selector) => {
      if (selector.startsWith('.')) {
        const cls = selector.substring(1);
        for (let i = 0; i < children.length; i++) {
          if (children[i].classList && children[i].classList.contains(cls)) return children[i];
          const found = children[i].querySelector ? children[i].querySelector(selector) : null;
          if (found) return found;
        }
      } else if (selector.startsWith('#')) {
        const targetId = selector.substring(1);
        for (let i = 0; i < children.length; i++) {
          if (children[i].id === targetId) return children[i];
          const found = children[i].querySelector ? children[i].querySelector(selector) : null;
          if (found) return found;
        }
      }
      return null;
    },
    querySelectorAll: (selector) => {
      const results = [];
      const search = (node) => {
        if (node.children) {
          for (let i = 0; i < node.children.length; i++) {
            const child = node.children[i];
            if (selector.startsWith('.')) {
              if (child.classList && child.classList.contains(selector.substring(1))) results.push(child);
            } else if (selector.startsWith('#')) {
              if (child.id === selector.substring(1)) results.push(child);
            } else if (child.tagName === selector.toUpperCase()) {
              results.push(child);
            }
            search(child);
          }
        }
      };
      search({ children });
      return results;
    },
    closest: (selector) => {
      let cur = el;
      while (cur) {
        if (selector.startsWith('.')) {
          if (cur.classList && cur.classList.contains(selector.substring(1))) return cur;
        } else if (selector.startsWith('#')) {
          if (cur.id === selector.substring(1)) return cur;
        }
        cur = cur.parentElement || cur.parentNode || null;
      }
      return null;
    },
    getBoundingClientRect: () => ({
      top: 0,
      bottom: 600,
      left: 0,
      right: 360,
      width: 360,
      height: 600
    }),
    addEventListener: (type, fn) => {
      if (!listeners[type]) listeners[type] = [];
      listeners[type].push(fn);
    },
    removeEventListener: (type, fn) => {
      if (listeners[type]) {
        listeners[type] = listeners[type].filter(f => f !== fn);
      }
    },
    dispatchSimulatedEvent: (type, eventObj = {}) => {
      const fns = listeners[type] || [];
      const ev = {
        type,
        target: el,
        currentTarget: el,
        preventDefault: () => {},
        stopPropagation: () => {},
        cancelable: true,
        ...eventObj
      };
      fns.forEach(fn => fn(ev));
    },
    children
  };

  return el;
}

const elementRegistry = {};
function getOrCreateMockElement(id) {
  if (!elementRegistry[id]) {
    elementRegistry[id] = createMockElement('div', id);
  }
  return elementRegistry[id];
}

const windowListeners = {};
global.window = {
  addEventListener: (type, fn) => {
    if (!windowListeners[type]) windowListeners[type] = [];
    windowListeners[type].push(fn);
  },
  removeEventListener: (type, fn) => {
    if (windowListeners[type]) {
      windowListeners[type] = windowListeners[type].filter(f => f !== fn);
    }
  },
  dispatchSimulatedEvent: (type, ev = {}) => {
    const fns = windowListeners[type] || [];
    fns.forEach(fn => fn({ type, preventDefault: () => {}, stopPropagation: () => {}, ...ev }));
  },
  requestAnimationFrame: (cb) => setTimeout(cb, 16),
  cancelAnimationFrame: (id) => clearTimeout(id)
};

global.requestAnimationFrame = (cb) => setTimeout(cb, 16);
global.cancelAnimationFrame = (id) => clearTimeout(id);

const docListeners = {};
const mockDocBody = createMockElement('body');
global.document = {
  body: mockDocBody,
  getElementById: (id) => getOrCreateMockElement(id),
  createElement: (tag) => createMockElement(tag),
  querySelector: (sel) => {
    if (sel.startsWith('#')) return getOrCreateMockElement(sel.substring(1));
    return createMockElement('div');
  },
  querySelectorAll: () => [],
  elementFromPoint: () => createMockElement('div'),
  addEventListener: (type, fn) => {
    if (!docListeners[type]) docListeners[type] = [];
    docListeners[type].push(fn);
  },
  removeEventListener: (type, fn) => {
    if (docListeners[type]) {
      docListeners[type] = docListeners[type].filter(f => f !== fn);
    }
  }
};

// 2. Import CalendarView and taskStore
const { CalendarView } = await import('./calendarView.js');
const { taskStore } = await import('./taskStore.js');

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✓ PASS: ${message}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${message}`);
    failed++;
  }
}

console.log('--- 1. Testing CalendarView Initialization ---');
const calendar = new CalendarView();
calendar.init();
assert(calendar.activeView === 'day', 'CalendarView initializes default activeView to day');
assert(calendar.elements !== null, 'DOM elements bound successfully on init');

console.log('\n--- 2. Testing Day View Rendering & Event Drag Setup ---');
const todayStr = calendar._formatDateISO(new Date());
taskStore.addCalendarEvent({
  id: 'cal_test_event_1',
  title: 'Engineering Review',
  date: todayStr,
  startTime: '10:00',
  endTime: '11:00',
  plannedDuration: 60,
  category: 'Work',
  isLocked: false,
  emoji: '💼'
});

calendar.switchView('day');
calendar.render();

const dayBody = calendar.elements.dayTimelineBody;
const dayCard = dayBody.children.find(c => c.getAttribute && c.getAttribute('data-event-id') === 'cal_test_event_1');
assert(dayCard !== null && dayCard !== undefined, 'Day event card rendered into dayTimelineBody');

console.log('\n--- 3. Testing Day View Touch Interaction (lastClientX & lastClientY Scope Verification) ---');
let touchstartError = null;
try {
  dayCard.dispatchSimulatedEvent('touchstart', {
    touches: [{ clientX: 120, clientY: 180 }]
  });
} catch (err) {
  touchstartError = err;
}
assert(touchstartError === null, 'touchstart executes cleanly without throwing ReferenceError: lastClientX is not defined');

let tapInspectorOpened = false;
const originalOpenInspector = calendar.openEventInspector.bind(calendar);
calendar.openEventInspector = function(ev) {
  tapInspectorOpened = true;
  originalOpenInspector(ev);
};

// Simulate quick tap (touchend before 200ms hold timer)
let touchendError = null;
try {
  dayCard.dispatchSimulatedEvent('touchend', { cancelable: true });
} catch (err) {
  touchendError = err;
}
assert(touchendError === null, 'touchend executes cleanly without ReferenceError');
assert(tapInspectorOpened === true, 'Quick tap on day event card opens event inspector');

console.log('\n--- 4. Testing Day View Hold-to-Drag & Smooth Day Pan ---');
// Trigger touchstart and advance hold timer
dayCard.dispatchSimulatedEvent('touchstart', {
  touches: [{ clientX: 120, clientY: 180 }]
});

// Wait 220ms for holdTimer to trigger startDragMode
await new Promise(resolve => setTimeout(resolve, 220));
assert(calendar.isDraggingEvent === true, 'Hold timer triggers startDragMode (isDraggingEvent = true)');
assert(dayCard.classList.contains('is-dragging-cal-event'), 'Card receives is-dragging-cal-event class');

// Simulate vertical touchmove (time snapping)
let touchmoveError = null;
try {
  dayCard.dispatchSimulatedEvent('touchmove', {
    touches: [{ clientX: 120, clientY: 240 }],
    cancelable: true
  });
} catch (err) {
  touchmoveError = err;
}
assert(touchmoveError === null, 'Vertical touchmove executes without error');

// Simulate horizontal drag exceeding resistance threshold (pan to previous day)
let panError = null;
try {
  dayCard.dispatchSimulatedEvent('touchmove', {
    touches: [{ clientX: 5, clientY: 240 }], // diffX = 5 - 120 = -115px (> 105px resistance)
    cancelable: true
  });
} catch (err) {
  panError = err;
}
assert(panError === null, 'Horizontal resistance pan (diffX < -105) initiates smoothly without error');

// Finish drag
let finishDragError = null;
try {
  dayCard.dispatchSimulatedEvent('touchend', { cancelable: true });
} catch (err) {
  finishDragError = err;
}
assert(finishDragError === null, 'Day drag finishDrag completes without error');
await new Promise(resolve => setTimeout(resolve, 350));
calendar.goToToday();

console.log('\n--- 5. Testing Day View Desktop Mouse Drag Lifecycle ---');
let mousedownError = null;
try {
  dayCard.dispatchSimulatedEvent('mousedown', {
    button: 0,
    clientX: 100,
    clientY: 150
  });
} catch (err) {
  mousedownError = err;
}
assert(mousedownError === null, 'Desktop mousedown executes without throwing ReferenceError: lastClientX');

// Trigger mousemove on window
let mousemoveError = null;
try {
  global.window.dispatchSimulatedEvent('mousemove', {
    clientX: 100,
    clientY: 200
  });
} catch (err) {
  mousemoveError = err;
}
assert(mousemoveError === null, 'Desktop mousemove executes without error');

// Trigger mouseup on window
let mouseupError = null;
try {
  global.window.dispatchSimulatedEvent('mouseup', {
    clientX: 100,
    clientY: 200
  });
} catch (err) {
  mouseupError = err;
}
assert(mouseupError === null, 'Desktop mouseup executes without error');

console.log('\n--- 6. Testing Week View Touch & Drag Interaction ---');
calendar.switchView('week');
calendar.render();

const weekCols = calendar.elements.weekGridBody.children.filter(c => c.classList && c.classList.contains('week-day-col'));
assert(weekCols.length === 7, 'Week view renders 7 day columns');

let weekCard = null;
for (let i = 0; i < weekCols.length; i++) {
  const card = weekCols[i].children.find(c => c.classList && c.classList.contains('week-event-card'));
  if (card) {
    weekCard = card;
    break;
  }
}
assert(weekCard !== null, 'Week event card rendered into week column');

let weekTouchError = null;
try {
  weekCard.dispatchSimulatedEvent('touchstart', {
    touches: [{ clientX: 150, clientY: 200 }]
  });
  weekCard.dispatchSimulatedEvent('touchend', { cancelable: true });
} catch (err) {
  weekTouchError = err;
}
assert(weekTouchError === null, 'Week card touchstart and touchend execute without error');

console.log('\n--- 7. Testing Month View Touch, Drag & Floating Pill ---');
const tomorrowDate = new Date();
tomorrowDate.setDate(tomorrowDate.getDate() + 1);
const tomorrowStr = calendar._formatDateISO(tomorrowDate);

taskStore.addCalendarEvent({
  id: 'cal_test_event_month_unlocked',
  title: 'Month Task',
  date: tomorrowStr,
  startTime: '08:00',
  endTime: '09:00',
  plannedDuration: 60,
  category: 'Work',
  isLocked: false
});

calendar.switchView('month');
calendar.render();

const monthGrid = calendar.elements.monthGrid;
const monthCells = monthGrid.children.filter(c => c.classList && c.classList.contains('month-day-cell'));
assert(monthCells.length >= 35, 'Month view renders at least 35 calendar cells');

let monthPill = null;
for (let i = 0; i < monthCells.length; i++) {
  const list = monthCells[i].children.find(c => c.classList && c.classList.contains('cell-events-list'));
  if (list && list.children.length > 0) {
    const unlockedPill = list.children.find(c => c.getAttribute && c.getAttribute('data-event-id') === 'cal_test_event_month_unlocked');
    if (unlockedPill) {
      monthPill = unlockedPill;
      break;
    }
  }
}
assert(monthPill !== null, 'Unlocked month event pill rendered in month view');

// Test quick tap
monthPill.dispatchSimulatedEvent('touchstart', {
  touches: [{ clientX: 80, clientY: 100 }]
});
monthPill.dispatchSimulatedEvent('touchend', { cancelable: true });

// Test hold-to-drag & floating behavior on top of everything
monthPill.dispatchSimulatedEvent('touchstart', {
  touches: [{ clientX: 80, clientY: 100 }]
});
await new Promise(resolve => setTimeout(resolve, 220));
assert(calendar.isDraggingEvent === true, 'Unlocked month pill enters drag mode after 200ms hold');
assert(monthPill.style.position === 'fixed', 'Month pill has position: fixed so it floats above all cells');
assert(monthPill.style.zIndex === '99999', 'Month pill has z-index: 99999 so it never clips behind adjacent cells');
assert(mockDocBody.children.includes(monthPill), 'Month pill is reparented to document.body to break stacking context');

// Finish drag
monthPill.dispatchSimulatedEvent('touchend', { cancelable: true });
assert(calendar.isDraggingEvent === false, 'Month drag mode finishes cleanly');

console.log('\n--- 8. Testing Event Inspector Defaults & Ghost-Click Protection ---');
const backdropEl = calendar.elements.eventModalBackdrop;
calendar.openEventInspector({
  id: 'cal_test_event_1',
  title: 'Engineering Review',
  date: todayStr,
  startTime: '10:00',
  endTime: '11:00',
  plannedDuration: 60,
  category: 'Work',
  isLocked: false
});

const hasPointerEventsNone = (backdropEl.style.pointerEvents === 'none') || (backdropEl.style['pointer-events'] === 'none');
assert(hasPointerEventsNone, 'Modal backdrop applies pointer-events: none for 250ms on open to prevent synthesized ghost clicks');

// Test that creating a new event defaults isLocked to false (Flexible schedule by default)
calendar.openEventInspector(null);
assert(calendar.elements.eventToggleLock.checked === false, 'New event defaults isLocked to false (flexible schedule)');

console.log('\n--- 9. Testing Locked Event Visuals & Lock-Pulse-Glow on Drag Attempt ---');
taskStore.addCalendarEvent({
  id: 'cal_test_event_locked',
  title: 'Focus Meeting',
  date: todayStr,
  startTime: '14:00',
  endTime: '15:00',
  plannedDuration: 60,
  category: 'Work',
  isLocked: true,
  emoji: '🔒'
});

calendar.switchView('week');
calendar.render();

const weekColsLocked = calendar.elements.weekGridBody.children.filter(c => c.classList && c.classList.contains('week-day-col'));
let lockedWeekCard = null;
for (let i = 0; i < weekColsLocked.length; i++) {
  const card = weekColsLocked[i].children.find(c => c.getAttribute && c.getAttribute('data-event-id') === 'cal_test_event_locked');
  if (card) {
    lockedWeekCard = card;
    break;
  }
}
assert(lockedWeekCard !== null, 'Locked week card rendered');
assert(lockedWeekCard.classList.contains('is-locked'), 'Locked week card has .is-locked class for inner orange border');

// Attempt to drag locked card
lockedWeekCard.dispatchSimulatedEvent('touchstart', {
  touches: [{ clientX: 150, clientY: 200 }]
});
await new Promise(resolve => setTimeout(resolve, 220));
assert(lockedWeekCard.classList.contains('lock-pulse-glow'), 'Attempting to drag locked week card triggers lock-pulse-glow animation');
assert(calendar.isDraggingEvent !== true, 'Locked card does not enter drag mode');
lockedWeekCard.dispatchSimulatedEvent('touchend', { cancelable: true });

console.log('\n--- 10. Testing Week View Unlocked Card Drag & Lift to Body ---');
taskStore.addCalendarEvent({
  id: 'cal_test_event_unlocked_week',
  title: 'Architecture Review',
  date: todayStr,
  startTime: '16:00',
  endTime: '17:00',
  plannedDuration: 60,
  category: 'Work',
  isLocked: false
});

calendar.switchView('week');
calendar.render();

const weekColsUnlocked = calendar.elements.weekGridBody.children.filter(c => c.classList && c.classList.contains('week-day-col'));
let unlockedWeekCard = null;
for (let i = 0; i < weekColsUnlocked.length; i++) {
  const card = weekColsUnlocked[i].children.find(c => c.getAttribute && c.getAttribute('data-event-id') === 'cal_test_event_unlocked_week');
  if (card) {
    unlockedWeekCard = card;
    break;
  }
}
assert(unlockedWeekCard !== null, 'Unlocked week card found in week column');

unlockedWeekCard.dispatchSimulatedEvent('touchstart', {
  touches: [{ clientX: 160, clientY: 220 }]
});
await new Promise(resolve => setTimeout(resolve, 220));
assert(calendar.isDraggingEvent === true, 'Week card enters drag mode after 200ms hold');
assert(unlockedWeekCard.style.position === 'fixed', 'Week card has position: fixed so it floats smoothly across columns');
assert(unlockedWeekCard.style.zIndex === '99999', 'Week card has z-index: 99999');
assert(mockDocBody.children.includes(unlockedWeekCard), 'Week card reparented to document.body to prevent column clipping');

unlockedWeekCard.dispatchSimulatedEvent('touchend', { cancelable: true });
assert(calendar.isDraggingEvent === false, 'Week drag finishes cleanly on touchend');

console.log('\n========================================');
console.log(`Summary: ${passed} passed, ${failed} failed.`);
console.log('========================================');

if (failed > 0) {
  process.exit(1);
} else {
  process.exit(0);
}
