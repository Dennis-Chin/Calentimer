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
      children.length = 0;
      if (val && typeof val === 'string') {
        const tagRegex = /<([a-z0-9]+)([^>]*)>/gi;
        let match;
        while ((match = tagRegex.exec(val)) !== null) {
          const tagName = match[1];
          const attrs = match[2];
          const childEl = createMockElement(tagName);
          const classMatch = attrs.match(/class=["']([^"']+)["']/i);
          if (classMatch) childEl.className = classMatch[1];
          const idMatch = attrs.match(/id=["']([^"']+)["']/i);
          if (idMatch) childEl.id = idMatch[1];
          const actionMatch = attrs.match(/data-action=["']([^"']+)["']/i);
          if (actionMatch) childEl.setAttribute('data-action', actionMatch[1]);
          childEl.parentNode = el;
          childEl.parentElement = el;
          children.push(childEl);
        }
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
      } else if (selector.startsWith('[') && selector.endsWith(']')) {
        const attrExpr = selector.substring(1, selector.length - 1);
        const eqIdx = attrExpr.indexOf('=');
        const attrName = eqIdx !== -1 ? attrExpr.substring(0, eqIdx) : attrExpr;
        let attrVal = eqIdx !== -1 ? attrExpr.substring(eqIdx + 1) : null;
        if (attrVal) attrVal = attrVal.replace(/^["']|["']$/g, '');
        for (let i = 0; i < children.length; i++) {
          const val = children[i].getAttribute ? children[i].getAttribute(attrName) : null;
          if (eqIdx !== -1 ? val === attrVal : (children[i].hasAttribute && children[i].hasAttribute(attrName))) {
            return children[i];
          }
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
(async function runCalendarTests() {
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

console.log('\n--- 11. Testing Pull Down to Minimise Modal & will-minimise Indicator ---');
calendar.open();
assert(calendar.elements.backdrop.classList.contains('hidden') === false, 'Calendar modal is open');

const modalHeader = calendar.elements.header;
const modalEl = calendar.elements.modal;

// Pull down with deltaY < 110 threshold
modalEl.dispatchSimulatedEvent('touchstart', {
  target: modalHeader,
  touches: [{ clientX: 180, clientY: 50 }]
});
modalEl.dispatchSimulatedEvent('touchmove', {
  target: modalHeader,
  touches: [{ clientX: 180, clientY: 100 }], // deltaY = 50 < 110px
  cancelable: true
});
assert(modalEl.classList.contains('will-minimise') === false, 'will-minimise is false when pull distance is under threshold');

// Pull down further past 110px threshold
modalEl.dispatchSimulatedEvent('touchmove', {
  target: modalHeader,
  touches: [{ clientX: 180, clientY: 200 }], // deltaY = 150 >= 110px
  cancelable: true
});
assert(modalEl.classList.contains('will-minimise') === true, 'will-minimise is true when dragged past threshold, turning close icon into down arrow');

// Swipe back up before release
modalEl.dispatchSimulatedEvent('touchmove', {
  target: modalHeader,
  touches: [{ clientX: 180, clientY: 90 }], // deltaY = 40 < 110px
  cancelable: true
});
assert(modalEl.classList.contains('will-minimise') === false, 'will-minimise reverts to false if user swipes back up before release');

// Pull past threshold again and release to minimise
modalEl.dispatchSimulatedEvent('touchmove', {
  target: modalHeader,
  touches: [{ clientX: 180, clientY: 200 }],
  cancelable: true
});
assert(modalEl.classList.contains('will-minimise') === true, 'will-minimise is true before release');
modalEl.dispatchSimulatedEvent('touchend', { target: modalHeader });
assert(modalEl.classList.contains('will-minimise') === false, 'will-minimise class removed on dismiss');
await new Promise(resolve => setTimeout(resolve, 290));
assert(calendar.elements.backdrop.classList.contains('hidden') === true, 'Calendar modal dismissed smoothly on pull-down release');

console.log('\n--- 12. Testing Day View Locked Pulse Glow & Drop Silhouette ---');
calendar.open();
calendar.switchView('day');
calendar.render();

// Check locked card in day view
const dayLockedCard = calendar.elements.dayTimelineBody.children.find(c => c.getAttribute && c.getAttribute('data-event-id') === 'cal_test_event_locked');
assert(dayLockedCard !== null && dayLockedCard !== undefined, 'Locked day card found in day timeline');
assert(dayLockedCard.classList.contains('is-locked'), 'Locked day card has .is-locked inner orange border');

// Attempt to drag locked card
dayLockedCard.dispatchSimulatedEvent('touchstart', {
  touches: [{ clientX: 150, clientY: 200 }]
});
await new Promise(resolve => setTimeout(resolve, 220));
assert(dayLockedCard.classList.contains('lock-pulse-glow'), 'Day locked card triggers lock-pulse-glow border');
assert(calendar.isDraggingEvent !== true, 'Locked day card cannot be dragged');
dayLockedCard.dispatchSimulatedEvent('touchend', { cancelable: true });

// Check unlocked card drag and drop silhouette in day view
const dayUnlockedCard = calendar.elements.dayTimelineBody.children.find(c => c.getAttribute && c.getAttribute('data-event-id') === 'cal_test_event_1');
assert(dayUnlockedCard !== null && dayUnlockedCard !== undefined, 'Unlocked day card found');

dayUnlockedCard.dispatchSimulatedEvent('touchstart', {
  touches: [{ clientX: 150, clientY: 200 }]
});
await new Promise(resolve => setTimeout(resolve, 220));
assert(calendar.isDraggingEvent === true, 'Unlocked day card enters drag mode after 200ms hold');

const daySilhouette = calendar.elements.dayTimelineBody.children.find(c => c.classList && c.classList.contains('day-drop-preview-silhouette'));
assert(daySilhouette !== null && daySilhouette !== undefined, 'Day drop preview silhouette is attached to day timeline');
assert(daySilhouette.style.display !== 'none', 'Day drop preview silhouette is visible during drag');

dayUnlockedCard.dispatchSimulatedEvent('touchend', { cancelable: true });
assert(calendar.isDraggingEvent === false, 'Day drag finishes cleanly on touchend');
const daySilhouetteAfter = calendar.elements.dayTimelineBody.children.find(c => c.classList && c.classList.contains('day-drop-preview-silhouette'));
assert(!daySilhouetteAfter, 'Day drop preview silhouette is removed after drag ends');

console.log('\n--- 13. Testing Month View Drag Target Cell Highlight (No Silhouette) & 50% Sensitivity ---');
calendar.switchView('month');
calendar.render();

const targetCellMock = createMockElement('div');
targetCellMock.className = 'month-day-cell';
targetCellMock.setAttribute('data-date', tomorrowStr);
const targetList = createMockElement('div');
targetList.className = 'cell-events-list';
targetCellMock.appendChild(targetList);

const origElementFromPoint = global.document.elementFromPoint;
global.document.elementFromPoint = (x, y) => targetCellMock;

let monthPillForSilhouette = null;
const monthGridCellsList = calendar.elements.monthGrid.children.filter(c => c.classList && c.classList.contains('month-day-cell'));
for (let i = 0; i < monthGridCellsList.length; i++) {
  const list = monthGridCellsList[i].children.find(c => c.classList && c.classList.contains('cell-events-list'));
  if (list && list.children.length > 0) {
    const unlockedPill = list.children.find(c => c.getAttribute && c.getAttribute('data-event-id') === 'cal_test_event_month_unlocked');
    if (unlockedPill) {
      monthPillForSilhouette = unlockedPill;
      break;
    }
  }
}
assert(monthPillForSilhouette !== null, 'Unlocked month event pill found for drag test');

monthPillForSilhouette.dispatchSimulatedEvent('touchstart', {
  touches: [{ clientX: 100, clientY: 150 }]
});
await new Promise(resolve => setTimeout(resolve, 220));
assert(calendar.isDraggingEvent === true, 'Month pill in drag mode');

// Simulate touchmove across to target cell
window.dispatchSimulatedEvent('touchmove', {
  touches: [{ clientX: 120, clientY: 160 }],
  cancelable: true
});

assert(targetCellMock.classList.contains('drag-target-over'), 'Target day cell receives drag-target-over glowing highlight');
const monthSilhouette = targetList.children.find(c => c.classList && c.classList.contains('month-drop-preview-silhouette'));
assert(!monthSilhouette, 'Month view does not render separate silhouette (cell glowing blue highlight is sufficient)');

monthPillForSilhouette.dispatchSimulatedEvent('touchend', { cancelable: true });
assert(calendar.isDraggingEvent === false, 'Month drag mode finished');
assert(targetCellMock.classList.contains('drag-target-over') === false, 'drag-target-over cleanly removed on finishDrag');

global.document.elementFromPoint = origElementFromPoint;

console.log('\n--- 14. Testing Pinch-to-Zoom Multi-Touch Conflict Suppression ---');
// Switch to Day view
calendar.switchView('day');
calendar.render();

const dayPinchCard = calendar.elements.dayTimelineBody.children.find(c => c.getAttribute && c.getAttribute('data-event-id') === 'cal_test_event_1');
assert(dayPinchCard !== null && dayPinchCard !== undefined, 'Day pinch card found');

// Scenario A: User touches event card with 2 fingers at once (initiating pinch on event)
dayPinchCard.dispatchSimulatedEvent('touchstart', {
  touches: [{ clientX: 120, clientY: 200 }, { clientX: 200, clientY: 260 }]
});
await new Promise(resolve => setTimeout(resolve, 220));
assert(calendar.isDraggingEvent === false, 'Day card does not enter drag mode when touched with 2 fingers');
assert(dayPinchCard.style.position !== 'fixed', 'Day card is not lifted to fixed position during 2-finger touch');
const dayPinchSilhouette = calendar.elements.dayTimelineBody.children.find(c => c.classList && c.classList.contains('day-drop-preview-silhouette'));
assert(!dayPinchSilhouette, 'Day drop preview silhouette is not created during 2-finger touch');

// Scenario B: User touches card with 1 finger, but a 2nd finger touches window immediately (pinch gesture starts)
dayPinchCard.dispatchSimulatedEvent('touchstart', {
  touches: [{ clientX: 120, clientY: 200 }]
});
// 30ms later, 2nd touch appears on window/modal
window.dispatchSimulatedEvent('touchstart', {
  touches: [{ clientX: 120, clientY: 200 }, { clientX: 220, clientY: 300 }]
});
assert(calendar.isPinching === true, 'calendar.isPinching is set to true on multi-touch');
await new Promise(resolve => setTimeout(resolve, 220));
assert(calendar.isDraggingEvent === false, 'Day card drag mode aborted when 2nd finger lands');
assert(dayPinchCard.style.position !== 'fixed', 'Day card does not lift after multi-touch cancel');

// Scenario C: Week View - 2 fingers touching week event card
calendar.switchView('week');
calendar.render();

const weekColsList = calendar.elements.weekGridBody.children.filter(c => c.classList && c.classList.contains('week-day-col'));
let weekPinchCard = null;
for (let i = 0; i < weekColsList.length; i++) {
  const events = weekColsList[i].children.filter(c => c.classList && c.classList.contains('week-event-card'));
  if (events.length > 0) {
    weekPinchCard = events[0];
    break;
  }
}
assert(weekPinchCard !== null, 'Week pinch card found');

// 2-finger touchstart on week card
weekPinchCard.dispatchSimulatedEvent('touchstart', {
  touches: [{ clientX: 140, clientY: 210 }, { clientX: 210, clientY: 280 }]
});
await new Promise(resolve => setTimeout(resolve, 220));
assert(calendar.isDraggingEvent === false, 'Week card does not enter drag mode when multi-touch on card');
assert(weekPinchCard.style.position !== 'fixed', 'Week card not lifted to fixed during pinch');
const weekPinchSilhouette = calendar.elements.weekGridBody.querySelector ? calendar.elements.weekGridBody.querySelector('.week-drop-preview-silhouette') : null;
assert(!weekPinchSilhouette, 'Week drop preview silhouette is not created during pinch');

// Scenario D: Month View - 2 fingers touching month event pill
calendar.switchView('month');
calendar.render();

let monthPinchPill = null;
const mCells = calendar.elements.monthGrid.children.filter(c => c.classList && c.classList.contains('month-day-cell'));
for (let i = 0; i < mCells.length; i++) {
  const list = mCells[i].children.find(c => c.classList && c.classList.contains('cell-events-list'));
  if (list && list.children.length > 0) {
    monthPinchPill = list.children[0];
    break;
  }
}
assert(monthPinchPill !== null, 'Month pinch pill found');

monthPinchPill.dispatchSimulatedEvent('touchstart', {
  touches: [{ clientX: 100, clientY: 150 }, { clientX: 180, clientY: 200 }]
});
await new Promise(resolve => setTimeout(resolve, 220));
assert(calendar.isDraggingEvent === false, 'Month pill does not enter drag mode during multi-touch');
assert(monthPinchPill.style.position !== 'fixed', 'Month pill is not lifted to fixed during multi-touch');
window.dispatchSimulatedEvent('touchend', {});
calendar.isPinching = false;
calendar.pinchCooldownUntil = 0;

console.log('\n--- 11. Testing Work / Break Segmented Toggle in Calendar Event Modal ---');
// Scenario A: Opening new event defaults to Work
calendar.openEventInspector(null);
assert(calendar.currentEventType === 'work', 'Default new calendar event is work');
assert(calendar.elements.calTypeSegmentWork.classList.contains('active'), 'Work segment button has active class');
assert(!calendar.elements.calTypeSegmentBreak.classList.contains('active'), 'Break segment button does not have active class');
assert(calendar.elements.eventDurationInput.value === '60', 'Default work duration is 60m');
assert(calendar.elements.calEventTitleLabel.textContent === 'Event Name', 'Title label says Event Name');
assert(calendar.elements.btnSaveCalEvent.textContent === 'Save Event', 'Save button says Save Event');
assert(calendar.elements.eventTimeBankToggle.checked === true, 'Time bank toggle is checked for work by default');

// Scenario B: Switching to Break
calendar.elements.calTypeSegmentBreak.dispatchSimulatedEvent('click');
assert(calendar.currentEventType === 'break', 'Current event type switched to break');
assert(calendar.elements.calTypeSegmentBreak.classList.contains('active'), 'Break segment button has active class');
assert(!calendar.elements.calTypeSegmentWork.classList.contains('active'), 'Work segment button does not have active class');
assert(calendar.elements.eventDurationInput.value === '10', 'Break duration defaults to 10m');
assert(calendar.currentEmoji === '☕', 'Break emoji is ☕');
assert(calendar.elements.calEventTitleLabel.textContent === 'Break Name', 'Title label switches to Break Name');
assert(calendar.elements.btnSaveCalEvent.classList.contains('is-break-btn'), 'Save button has is-break-btn class');
assert(calendar.elements.btnSaveCalEvent.textContent.includes('Break'), 'Save button text references Break');
assert(calendar.elements.eventTimeBankToggle.checked === false, 'Time bank toggle is disabled for break by default');

// Scenario C: Switching back to Work
calendar.elements.calTypeSegmentWork.dispatchSimulatedEvent('click');
assert(calendar.currentEventType === 'work', 'Current event type switched back to work');
assert(calendar.elements.calTypeSegmentWork.classList.contains('active'), 'Work segment button has active class');
assert(calendar.elements.eventDurationInput.value === '60', 'Work duration restored to 60m');
assert(calendar.currentEmoji === '💼', 'Work emoji is 💼');
assert(!calendar.elements.btnSaveCalEvent.classList.contains('is-break-btn'), 'Save button removes is-break-btn class');
assert(calendar.elements.eventTimeBankToggle.checked === true, 'Time bank toggle re-enabled for work');

// Scenario D: Opening existing break event loads as break
const existingBreakEvent = {
  id: 'evt-break-99',
  title: 'Afternoon Tea',
  category: 'Break',
  plannedDuration: 15,
  emoji: '☕',
  startTime: '15:00',
  endTime: '15:15',
  date: '2026-10-25'
};
calendar.openEventInspector(existingBreakEvent);
assert(calendar.currentEventType === 'break', 'Existing break event recognized as break');
assert(calendar.elements.calTypeSegmentBreak.classList.contains('active'), 'Break segment button active for existing break');
assert(calendar.elements.eventDurationInput.value === '15', 'Existing break duration preserved (15m)');
assert(calendar.elements.calEventTitleLabel.textContent === 'Break Name', 'Title label set to Break Name');
assert(calendar.elements.btnSaveCalEvent.textContent === 'Save Break', 'Save button says Save Break');
calendar.closeEventInspector();

console.log('\n--- 12. Testing Locked Event Pulsing, Default Today View on Open & Smooth Arrow Navigation ---');

// 1. Locked Event Toast & Glow in Day View
const lockedDayEvent = {
  id: 'evt-locked-1',
  title: 'Fixed Meeting',
  category: 'Work',
  plannedDuration: 60,
  startTime: '11:00',
  endTime: '12:00',
  date: calendar._formatDateISO(new Date()),
  isLocked: true
};
taskStore.addCalendarEvent(lockedDayEvent);
calendar.switchView('day');
calendar.render();

const testDayLockedCard = calendar.elements.dayTimelineBody.children.find(function(c) {
  return c.getAttribute && c.getAttribute('data-event-id') === lockedDayEvent.id;
});
assert(testDayLockedCard !== null && testDayLockedCard !== undefined, 'Locked day card found in timeline');

// Verify no static orange border inline or on day-event-card
assert(testDayLockedCard.style.borderLeftColor !== '#f59e0b', 'Locked day card does not have static orange border');

// Attempt to drag locked card by holding 200ms
let toastShown = '';
calendar._showToast = function(msg) { toastShown = msg; };

testDayLockedCard.dispatchSimulatedEvent('touchstart', {
  touches: [{ clientX: 100, clientY: 200 }]
});
await new Promise(function(resolve) { setTimeout(resolve, 220); });

assert(toastShown === '🔒 Unlock event before moving', 'Toast pop-up notifies user to unlock event before moving');
assert(testDayLockedCard.classList.contains('lock-pulse-glow'), 'Day card pulses with glowing orange border (lock-pulse-glow)');
const lockBtnInside = testDayLockedCard.querySelector('.cal-event-lock-btn');
assert(lockBtnInside && lockBtnInside.classList.contains('pulse-glow'), 'Padlock icon pulses with glow (pulse-glow)');

// Attempt to move locked day card immediately with finger drag movement (> 8px)
toastShown = '';
testDayLockedCard.classList.remove('lock-pulse-glow');
testDayLockedCard.dispatchSimulatedEvent('touchstart', {
  touches: [{ clientX: 100, clientY: 200 }]
});
testDayLockedCard.dispatchSimulatedEvent('touchmove', {
  touches: [{ clientX: 100, clientY: 215 }] // deltaY = 15 > 8px
});
assert(toastShown === '🔒 Unlock event before moving', 'Immediate finger drag (> 8px) on locked day card triggers toast alert');
assert(testDayLockedCard.classList.contains('lock-pulse-glow'), 'Immediate drag triggers lock-pulse-glow on day card');

// Attempt to move locked week card immediately with finger drag movement (> 8px)
calendar.switchView('week');
calendar.render();
const weekColsListTest = calendar.elements.weekGridBody.children.filter(function(c) {
  return c.classList && c.classList.contains('week-day-col');
});
let lockedWeekCardTest = null;
for (let w = 0; w < weekColsListTest.length; w++) {
  const card = weekColsListTest[w].children.find(function(c) {
    return c.getAttribute && c.getAttribute('data-event-id') === lockedDayEvent.id;
  });
  if (card) { lockedWeekCardTest = card; break; }
}
if (lockedWeekCardTest) {
  toastShown = '';
  lockedWeekCardTest.dispatchSimulatedEvent('touchstart', {
    touches: [{ clientX: 120, clientY: 200 }]
  });
  lockedWeekCardTest.dispatchSimulatedEvent('touchmove', {
    touches: [{ clientX: 135, clientY: 200 }] // deltaX = 15 > 8px
  });
  assert(toastShown === '🔒 Unlock event before moving', 'Immediate finger drag (> 8px) on locked week card triggers toast alert');
  assert(lockedWeekCardTest.classList.contains('lock-pulse-glow'), 'Immediate drag triggers lock-pulse-glow on week card');
}

// Attempt to move locked month pill immediately with finger drag movement (> 8px)
calendar.switchView('month');
calendar.render();
let lockedMonthPillTest = null;
const mCellsTest = calendar.elements.monthGrid.children.filter(function(c) {
  return c.classList && c.classList.contains('month-day-cell');
});
for (let m = 0; m < mCellsTest.length; m++) {
  const list = mCellsTest[m].children.find(function(c) {
    return c.classList && c.classList.contains('cell-events-list');
  });
  if (list && list.children) {
    const pill = list.children.find(function(p) {
      return p.getAttribute && p.getAttribute('data-event-id') === lockedDayEvent.id;
    });
    if (pill) { lockedMonthPillTest = pill; break; }
  }
}
if (lockedMonthPillTest) {
  toastShown = '';
  lockedMonthPillTest.dispatchSimulatedEvent('touchstart', {
    touches: [{ clientX: 100, clientY: 150 }]
  });
  lockedMonthPillTest.dispatchSimulatedEvent('touchmove', {
    touches: [{ clientX: 120, clientY: 150 }] // deltaX = 20 > 8px
  });
  assert(toastShown === '🔒 Unlock event before moving', 'Immediate finger drag (> 8px) on locked month pill triggers toast alert');
  assert(lockedMonthPillTest.classList.contains('lock-pulse-glow'), 'Immediate drag triggers lock-pulse-glow on month pill');
}

// 2. Calendar Tab defaults to today's date and user's chosen view upon opening
calendar.currentDate.setDate(calendar.currentDate.getDate() + 14); // moved 2 weeks in future
calendar.switchView('week'); // user selected week view
taskStore.setCalendarView('week');

calendar.open();
const todayISO = calendar._formatDateISO(new Date());
assert(calendar._formatDateISO(calendar.currentDate) === todayISO, 'calendar.open() resets date to today');
assert(calendar.activeView === 'week', 'calendar.open() loads user-selected view (week)');

// 3. Smooth Arrow Navigation & Glow Disablement
calendar.switchView('day');
calendar.render();
const prevDateStr = calendar._formatDateISO(calendar.currentDate);

const btnNext = calendar.elements.btnNext;
assert(btnNext !== null, 'btnNext element exists');

calendar.slideNavigate(1, btnNext);
assert(btnNext.classList.contains('is-active-nav'), 'btnNext gains is-active-nav (green glow) during slide navigation');
assert(calendar.isNavigating === true, 'calendar.isNavigating is true during animation');

await new Promise(resolve => setTimeout(resolve, 340));

assert(!btnNext.classList.contains('is-active-nav'), 'Green glow stops (is-active-nav removed) after view has moved over');
assert(calendar.isNavigating === false, 'calendar.isNavigating resets to false after animation completes');
const nextDate = new Date(prevDateStr);
nextDate.setDate(nextDate.getDate() + 1);
assert(calendar._formatDateISO(calendar.currentDate) === calendar._formatDateISO(nextDate), 'View transitioned to next day');

  console.log('\n========================================');
  console.log(`Summary: ${passed} passed, ${failed} failed.`);
  console.log('========================================');

  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
})().catch(function(err) {
  console.error('Unhandled error in testCalendarView:', err);
  process.exit(1);
});
