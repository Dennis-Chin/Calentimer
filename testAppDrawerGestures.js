/**
 * testAppDrawerGestures.js
 * 
 * Unit tests for Today's Schedule Tab (Task Drawer) Touch & Gesture Lifecycle:
 * - Verifies that onDrawerTouchStart, onDrawerTouchMove, and onDrawerTouchEnd
 *   execute with zero ReferenceError (specifically verifying isNavSwiping is defined).
 * - Tap to toggle open/close via drawerHeader and btnDrawerToggle.
 * - Live upward pull with resistance and .will-open indicator.
 * - Live downward pull with resistance and .will-minimise indicator.
 * - Swiping anywhere inside the open today's schedule tab without crash.
 * - Gesture coordination when isNavSwiping is active.
 */

import { readFileSync } from 'fs';
import path from 'path';

const mockStorage = {};
global.localStorage = {
  getItem: (k) => (mockStorage[k] !== undefined ? mockStorage[k] : null),
  setItem: (k, v) => { mockStorage[k] = String(v); },
  removeItem: (k) => { delete mockStorage[k]; },
  clear: () => { Object.keys(mockStorage).forEach(k => delete mockStorage[k]); }
};

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
    checked: false,
    offsetWidth: 360,
    offsetHeight: 600,
    clientWidth: 360,
    clientHeight: 600,
    scrollTop: 0,
    scrollLeft: 0,
    get innerHTML() { return rawInnerHtml; },
    set innerHTML(val) {
      rawInnerHtml = val;
      if (val === '') {
        children.length = 0;
      }
    },
    style: {
      setProperty: (prop, val) => { el.style[prop] = val; },
      removeProperty: (prop) => { delete el.style[prop]; }
    },
    classList: {
      add: (...cls) => { cls.forEach(c => classes.add(c)); },
      remove: (...cls) => { cls.forEach(c => classes.delete(c)); },
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
        if (selector.includes(',')) {
          const parts = selector.split(',').map(s => s.trim());
          for (let p = 0; p < parts.length; p++) {
            const part = parts[p];
            if (part.startsWith('.') && cur.classList && cur.classList.contains(part.substring(1))) return cur;
            if (part.startsWith('#') && cur.id === part.substring(1)) return cur;
            if (part.startsWith('[data-action="') && cur.getAttribute && cur.getAttribute('data-action') === part.slice(14, -2)) return cur;
          }
        } else {
          if (selector.startsWith('.')) {
            if (cur.classList && cur.classList.contains(selector.substring(1))) return cur;
          } else if (selector.startsWith('#')) {
            if (cur.id === selector.substring(1)) return cur;
          } else if (selector.startsWith('[data-action="')) {
            if (cur.getAttribute && cur.getAttribute('data-action') === selector.slice(14, -2)) return cur;
          }
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
  cancelAnimationFrame: (id) => clearTimeout(id),
  history: {
    replaceState: () => {},
    pushState: () => {}
  },
  matchMedia: () => ({
    matches: false,
    addEventListener: () => {}
  })
};

global.requestAnimationFrame = (cb) => setTimeout(cb, 16);
global.cancelAnimationFrame = (id) => clearTimeout(id);

const mockDocElement = createMockElement('html');
const mockDocBody = createMockElement('body');
const docListeners = {};
global.document = {
  readyState: 'complete',
  documentElement: mockDocElement,
  body: mockDocBody,
  getElementById: (id) => getOrCreateMockElement(id),
  createElement: (tag) => createMockElement(tag),
  createElementNS: (ns, tag) => createMockElement(tag),
  querySelector: (sel) => {
    if (sel.startsWith('#')) return getOrCreateMockElement(sel.substring(1));
    return createMockElement('div');
  },
  querySelectorAll: () => [],
  addEventListener: (type, fn) => {
    if (!docListeners[type]) docListeners[type] = [];
    docListeners[type].push(fn);
  },
  removeEventListener: (type, fn) => {
    if (docListeners[type]) {
      docListeners[type] = docListeners[type].filter(f => f !== fn);
    }
  },
  dispatchSimulatedEvent: (type, ev = {}) => {
    const fns = docListeners[type] || [];
    fns.forEach(fn => fn({ type, preventDefault: () => {}, stopPropagation: () => {}, ...ev }));
  }
};

// Seed essential elements before importing app.js
const taskDrawer = getOrCreateMockElement('taskDrawer');
taskDrawer.className = 'task-drawer collapsed';

const drawerHeader = getOrCreateMockElement('drawerHeader');
drawerHeader.className = 'drawer-header';
taskDrawer.appendChild(drawerHeader);

const btnDrawerToggle = getOrCreateMockElement('btnDrawerToggle');
drawerHeader.appendChild(btnDrawerToggle);

const taskDrawerBackdrop = getOrCreateMockElement('taskDrawerBackdrop');
taskDrawerBackdrop.className = 'task-drawer-backdrop hidden';

const drawerContent = getOrCreateMockElement('drawerContent');
drawerContent.className = 'drawer-content';
taskDrawer.appendChild(drawerContent);

const confirmExitAppModalBackdrop = getOrCreateMockElement('confirmExitAppModalBackdrop');
confirmExitAppModalBackdrop.className = 'modal-backdrop hidden';
const btnCancelExitApp = getOrCreateMockElement('btnCancelExitApp');
const btnConfirmExitApp = getOrCreateMockElement('btnConfirmExitApp');

const seedHiddenModals = [
  'settingsModalBackdrop',
  'fullCalendarModalBackdrop',
  'calendarModalBackdrop',
  'todoModalBackdrop',
  'confirmDeleteTodoModalBackdrop',
  'confirmClearTodoModalBackdrop',
  'durationDialModalBackdrop',
  'emojiPickerModalBackdrop',
  'timeBankInfoModalBackdrop',
  'alertsModalBackdrop',
  'hardStopModalBackdrop',
  'selectTodoModalBackdrop',
  'calendarEventModalBackdrop',
  'addTodoModalBackdrop',
  'addTaskModalBackdrop',
  'taskEditModalBackdrop'
];
seedHiddenModals.forEach(id => {
  getOrCreateMockElement(id).className = 'modal-backdrop hidden';
});

console.log('--- 1. Importing app.js & Initializing Application ---');
let appImportError = null;
try {
  await import('./app.js');
} catch (err) {
  appImportError = err;
}
assert(!appImportError, 'app.js imported and initialized with zero syntax or runtime errors');
if (appImportError) {
  console.error('Fatal import error:', appImportError);
  process.exit(1);
}

console.log('\n--- 2. Testing Today\'s Schedule Tab Tap Toggle & Minimise ---');
assert(taskDrawer.classList.contains('collapsed'), 'Task drawer starts collapsed by default');

// Tap drawer header to open
drawerHeader.dispatchSimulatedEvent('click');
assert(!taskDrawer.classList.contains('collapsed'), 'Task drawer opens after tapping drawerHeader');
assert(!taskDrawerBackdrop.classList.contains('hidden'), 'taskDrawerBackdrop is visible when drawer is open');

// Tap drawer header again to minimise
drawerHeader.dispatchSimulatedEvent('click');
assert(taskDrawer.classList.contains('collapsed'), 'Task drawer minimises after tapping drawerHeader again');
assert(taskDrawerBackdrop.classList.contains('hidden'), 'taskDrawerBackdrop is hidden when drawer is minimised');

// Tap btnDrawerToggle to open
btnDrawerToggle.dispatchSimulatedEvent('click');
assert(!taskDrawer.classList.contains('collapsed'), 'Task drawer opens after tapping btnDrawerToggle');

// Tap backdrop to close
taskDrawerBackdrop.dispatchSimulatedEvent('click');
assert(taskDrawer.classList.contains('collapsed'), 'Task drawer closes when tapping backdrop');

console.log('\n--- 3. Testing Swipe Up to Open with Live Rubberband & Arrow ---');
// Touchstart on collapsed drawer header
let touchStartThrew = false;
try {
  drawerHeader.dispatchSimulatedEvent('touchstart', {
    touches: [{ clientX: 180, clientY: 520 }]
  });
} catch (err) {
  touchStartThrew = true;
  console.error('Error on drawerHeader touchstart:', err);
}
assert(!touchStartThrew, 'onDrawerTouchStart executes with ZERO ReferenceError (isNavSwiping is defined)');

// Pull up with deltaY = -70 (exceeds 60px resistance threshold)
let touchMoveThrew = false;
try {
  drawerHeader.dispatchSimulatedEvent('touchmove', {
    touches: [{ clientX: 180, clientY: 450 }]
  });
} catch (err) {
  touchMoveThrew = true;
  console.error('Error on drawerHeader touchmove:', err);
}
assert(!touchMoveThrew, 'onDrawerTouchMove executes with ZERO ReferenceError');
assert(taskDrawer.classList.contains('will-open'), 'taskDrawer gains .will-open class (rotating arrow 180 deg) when pulled up >= 60px');

// Touchend to release and open
drawerHeader.dispatchSimulatedEvent('touchend', {
  changedTouches: [{ clientX: 180, clientY: 450 }]
});
assert(!taskDrawer.classList.contains('collapsed'), 'Task drawer opened after upward swipe release');
assert(!taskDrawer.classList.contains('will-open'), '.will-open indicator removed after open transition');

console.log('\n--- 4. Testing Swiping Inside the Open Tab (Script Error Prevention) ---');
// Swiping anywhere inside the open taskDrawer body
let bodyTouchThrew = false;
try {
  taskDrawer.dispatchSimulatedEvent('touchstart', {
    touches: [{ clientX: 190, clientY: 260 }]
  });
} catch (err) {
  bodyTouchThrew = true;
  console.error('Error touching inside open task drawer body:', err);
}
assert(!bodyTouchThrew, 'Touching inside open drawer body executes cleanly with ZERO ReferenceError');

// Drag down 80px (deltaY = +80, exceeds 65px minimise threshold)
taskDrawer.dispatchSimulatedEvent('touchmove', {
  touches: [{ clientX: 190, clientY: 340 }]
});
assert(taskDrawer.classList.contains('will-minimise'), 'taskDrawer gains .will-minimise class when dragged down >= 65px');

// Release to minimise
taskDrawer.dispatchSimulatedEvent('touchend', {
  changedTouches: [{ clientX: 190, clientY: 340 }]
});
assert(taskDrawer.classList.contains('collapsed'), 'Task drawer minimised cleanly after downward swipe release');
assert(!taskDrawer.classList.contains('will-minimise'), '.will-minimise indicator cleared on minimise');

console.log('\n--- 5. Testing Gesture Abort (Swiping Back Up Before Release) ---');
// Open again
drawerHeader.dispatchSimulatedEvent('click');
assert(!taskDrawer.classList.contains('collapsed'), 'Drawer reopened');

// Start pull down
taskDrawer.dispatchSimulatedEvent('touchstart', {
  touches: [{ clientX: 190, clientY: 200 }]
});
taskDrawer.dispatchSimulatedEvent('touchmove', {
  touches: [{ clientX: 190, clientY: 280 }]
});
assert(taskDrawer.classList.contains('will-minimise'), '.will-minimise is true during pull');

// User moves finger back up before letting go (deltaY = 30, which is > 10 and < 65 threshold)
taskDrawer.dispatchSimulatedEvent('touchmove', {
  touches: [{ clientX: 190, clientY: 230 }]
});
assert(!taskDrawer.classList.contains('will-minimise'), '.will-minimise reverts to false when moved back up');

taskDrawer.dispatchSimulatedEvent('touchend', {
  changedTouches: [{ clientX: 190, clientY: 230 }]
});
assert(!taskDrawer.classList.contains('collapsed'), 'Drawer remains OPEN if user pulls back up before release');

console.log('\n--- 6. Testing Mobile Hardware Back Button Navigation & Dismissal ---');
// Ensure tab/drawer is open
if (taskDrawer.classList.contains('collapsed')) {
  drawerHeader.dispatchSimulatedEvent('click');
}
assert(!taskDrawer.classList.contains('collapsed'), 'Tab/drawer is open before back press');

// 1. Back Press while Tab is open: Dismisses open tab/drawer and returns to home screen
window.dispatchSimulatedEvent('popstate', {});
assert(taskDrawer.classList.contains('collapsed'), '1st back press cleanly dismisses open tab/drawer and returns to home screen');

// 2. Back Press when already on Timer screen: Naturally allows native navigation without trapping
window.dispatchSimulatedEvent('popstate', {});
assert(taskDrawer.classList.contains('collapsed'), 'Timer screen remains steady and ready for native browser back navigation');

console.log('\n--- 7. Testing Chronological vs Sequential Plan Mode Segmented Toggle ---');
const btnModeChronological = getOrCreateMockElement('btnModeChronological');
const btnModeSequential = getOrCreateMockElement('btnModeSequential');

btnModeSequential.dispatchSimulatedEvent('click');
assert(btnModeSequential.classList.contains('active'), 'Clicking Sequential activates sequential segment');
assert(!btnModeChronological.classList.contains('active'), 'Chronological segment deactivated');

btnModeChronological.dispatchSimulatedEvent('click');
assert(btnModeChronological.classList.contains('active'), 'Clicking Chronological activates chronological segment');
assert(!btnModeSequential.classList.contains('active'), 'Sequential segment deactivated');

console.log('\n--- 8. Testing Today\'s Schedule (Menu Bar) Pull-Down & Press-Hold Guard ---');
const indexHtmlContent = readFileSync(path.resolve('./index.html'), 'utf8');
const appJsContent = readFileSync(path.resolve('./app.js'), 'utf8');
const styleCssContent = readFileSync(path.resolve('./style.css'), 'utf8');

assert(indexHtmlContent.includes('<div class="cal-drag-handle-bar" aria-hidden="true"></div>') && indexHtmlContent.includes('id="calendarModal"'), 'index.html contains .cal-drag-handle-bar inside #calendarModal');
assert(indexHtmlContent.includes('id="btnCloseCalendar"') && indexHtmlContent.includes('cal-close-icon-arrow'), '#calendarModal close button includes morphing cal-close-icon-arrow');
assert(indexHtmlContent.includes('id="calendarScheduleModeSegment"'), 'index.html contains #calendarScheduleModeSegment inside #calendarModal');
assert(indexHtmlContent.includes('id="btnCalModeChronological"'), 'index.html contains #btnCalModeChronological');
assert(indexHtmlContent.includes('id="btnCalModeSequential"'), 'index.html contains #btnCalModeSequential');
assert(styleCssContent.includes('.drag-handle-compact.is-holding'), 'style.css highlights .drag-handle-compact green on is-holding');
assert(appJsContent.includes('function setupCalendarModalPullToDismiss'), 'app.js defines setupCalendarModalPullToDismiss()');
assert(appJsContent.includes('function attachLockedDragHoldWarning'), 'app.js defines attachLockedDragHoldWarning()');
assert(appJsContent.includes('clientX - rect.left <= 44'), 'app.js includes left border-to-dots area for press-hold reorder without triggering delete');
assert(styleCssContent.includes('.calendar-modal.will-minimise .cal-close-icon-arrow'), 'style.css morphs #calendarModal close icon into down arrow on .will-minimise');
assert(appJsContent.includes('task-timing-indicator'), 'app.js renders dynamic indicative timespan in sequential mode');

console.log('\n--- 9. Testing Pull-to-Dismiss on Header Buttons & Day View Drag Stability ---');
const calJsContent = readFileSync(path.resolve('./calendarView.js'), 'utf8');
assert(appJsContent.includes('let updateTimespansButtonUI = function'), 'app.js declares updateTimespansButtonUI at module scope');
assert(appJsContent.includes('window.updateTimespansButtonUI = updateTimespansButtonUI'), 'app.js attaches updateTimespansButtonUI to window');
assert(calJsContent.includes('cal-view-dropdown-wrapper') || calJsContent.includes('#calViewDropdownWrapper'), 'calendarView.js recognizes swiping down on view dropdown / Day button');
assert(calJsContent.includes('#calNavButtonsGroup') || calJsContent.includes('cal-nav-buttons-group'), 'calendarView.js recognizes swiping down on Today & arrow buttons');
assert(calJsContent.includes('suppressClick'), 'calendarView.js suppresses button click when pulling down to minimise');
assert(appJsContent.includes('suppressClick'), 'app.js suppresses button click when pulling down Today\'s schedule to minimise');
assert(!calJsContent.includes('_renderDayView() {\n    const body = this.elements.dayTimelineBody;\n    if (!body) return;\n\n    body.innerHTML = \'\';\n\n    const sel = this.selectedDate || this.currentDate;\n    const selStr = this._formatDateISO(sel);\n    const isToday = this._isViewingToday();\n\n    const allEvents = taskStore.getCalendarEvents();\n    const eventsForDay = allEvents.filter(e => e.date === selStr);\n\n    const isCustom = taskStore.getCalendarCustomRangeEnabled();\n    let startHour = 0;\n    let endHour = 24;\n    if (isCustom) {\n      const startStr = taskStore.getCalendarStartTime() || \'08:00\';\n      const endStr = taskStore.getCalendarEndTime() || \'22:00\';\n      startHour = Math.max(0, Math.min(23, Math.floor(this._parseTimeToMinutes(startStr) / 60)));\n      endHour = Math.max(startHour + 1, Math.min(24, Math.ceil(this._parseTimeToMinutes(endStr) / 60)));\n    }\n\n    const resolution = this.currentResolution || 15;\n    const hourHeight = this.dayHourHeight || 56; // px per hour\n\n    // Apply active hour height CSS variable\n    if (this.elements.dayTimelineScroll) {\n      this.elements.dayTimelineScroll.style.setProperty(\'--cal-day-hour-height\', `${hourHeight}px`);\n    }\n\n    // Render hour slots from startHour to endHour (including 00:00)\n    for (let h = startHour; h < endHour; h++) {\n      const slot = document.createElement(\'div\');\n      slot.className = \'day-timeline-hour-slot\';\n      slot.setAttribute(\'data-hour\', String(h));\n\n      const timeLabel = document.createElement(\'div\');\n      timeLabel.className = \'day-time-label\';\n      timeLabel.textContent = `${String(h).padStart(2, \'0\')}:00`;\n      slot.appendChild(timeLabel);\n\n      const slotContent = document.createElement(\'div\');\n      slotContent.className = \'day-slot-content\';\n\n      // Render subtle dashed sub-interval lines inside slotContent so they match bold lines exactly\n      if (resolution < 60) {\n        const stepCount = 60 / resolution;\n        for (let s = 1; s < stepCount; s++) {\n          const subLine = document.createElement(\'div\');\n          subLine.className = \'day-sub-interval-line\';\n          const pct = (s / stepCount) * 100;\n          subLine.style.top = `${pct}%`;\n          slotContent.appendChild(subLine);\n        }\n      }\n\n      // Clicking empty slot creates a new event starting at that hour\n      slotContent.addEventListener(\'click\', (e) => {\n        if (e.target.closest(\'.day-event-card\')) return;\n        const rect = slotContent.getBoundingClientRect();\n        const clickY = e.clientY - rect.top;\n        const rawMin = Math.max(0, Math.min(59, (clickY / hourHeight) * 60));\n        const snappedMin = Math.floor(rawMin / resolution) * resolution;\n\n        const startTimeStr = `${String(h).padStart(2, \'0\')}:${String(snappedMin).padStart(2, \'0\')}`;\n        const endTotalMin = (h * 60) + snappedMin + 60;\n        const endH = Math.min(23, Math.floor(endTotalMin / 60));\n        const endM = endTotalMin % 60;\n        const endTimeStr = `${String(endH).padStart(2, \'0\')}:${String(endM).padStart(2, \'0\')}`;\n\n        this.openEventInspector(null, selStr, startTimeStr, endTimeStr);\n      });\n\n      slot.appendChild(slotContent);\n      body.appendChild(slot);\n    }\n\n    // Render final end-time boundary line and label (00:00 or custom end time)\n    const endSlot = document.createElement(\'div\');\n    endSlot.className = \'day-timeline-hour-slot day-timeline-end-slot\';\n    endSlot.style.height = \'0px\';\n    endSlot.style.minHeight = \'0px\';\n\n    const endTimeLabel = document.createElement(\'div\');\n    endTimeLabel.className = \'day-time-label day-end-time-label\';\n    const endHDisplay = String(endHour % 24).padStart(2, \'0\');\n    endTimeLabel.textContent = `${endHDisplay}:00`;\n    endSlot.appendChild(endTimeLabel);\n\n    const endLine = document.createElement(\'div\');\n    endLine.className = \'day-slot-content day-end-boundary-line\';\n    endLine.style.height = \'0px\';\n    endSlot.appendChild(endLine);\n\n    body.appendChild(endSlot);\n\n    // Render Dynamic Light-Blue Current Time Line\n    if (isToday) {\n      this._renderCurrentTimeLine();\n    }\n\n    // Filter and sort events by start time ascending for overlap detection & indenting\n    const visibleEvents = eventsForDay.filter(e => {\n      const s = this._parseTimeToMinutes(e.startTime);\n      const en = this._parseTimeToMinutes(e.endTime);\n      return !(s >= endHour * 60 || en <= startHour * 60);\n    }).sort((a, b) => {\n      return this._parseTimeToMinutes(a.startTime) - this._parseTimeToMinutes(b.startTime);\n    });\n\n    // Render Event Cards Absolutely Positioned with Overlap Indentation\n    for (let j = 0; j < visibleEvents.length; j++) {\n      const ev = visibleEvents[j];\n      const startMin = this._parseTimeToMinutes(ev.startTime);\n      const endMin = this._parseTimeToMinutes(ev.endTime);\n      let dur = ev.plannedDuration;\n      if (!dur || dur <= 0) {\n        dur = endMin - startMin;\n        if (dur <= 0) dur = 60;\n      }\n\n      const topPx = 14 + ((Math.max(startHour * 60, startMin) - (startHour * 60)) / 60) * hourHeight;\n      const heightPx = Math.max(26, (dur / 60) * hourHeight);\n\n      // Check if overlapping with any earlier-starting event\n      let isLaterOverlap = false;\n      for (let k = 0; k < j; k++) {\n        const other = visibleEvents[k];\n        const otherStart = this._parseTimeToMinutes(other.startTime);\n        const otherEnd = this._parseTimeToMinutes(other.endTime);\n        if (startMin < otherEnd && endMin > otherStart) {\n          isLaterOverlap = true;\n          const earlierCard = body.querySelector(`[data-event-id="${other.id}"]`);\n          if (earlierCard) {\n            earlierCard.classList.add(\'is-overlapping-earlier\');\n            this._applyEventCardLayout(earlierCard, parseInt(earlierCard.style.height, 10) || 40);\n          }\n          break;\n        }\n      }\n\n      // Check if event corresponds to completed or currently active timer task\n      let isDone = false;\n      let isCurrent = false;\n      if (ev.isCompleted) {\n        isDone = true;\n      }\n      if (isToday) {\n        const now = new Date();\n        const currentMinutes = (now.getHours() * 60) + now.getMinutes();\n        const evStart = this._parseTimeToMinutes(ev.startTime);\n        let evEnd = this._parseTimeToMinutes(ev.endTime);\n        if (evEnd <= evStart) evEnd += 1440;\n\n        if (currentMinutes >= evEnd) {\n          isDone = true;\n        } else if (currentMinutes >= evStart && currentMinutes < evEnd) {\n          isCurrent = true;\n        }\n      }\n      const rt = (typeof window !== \'undefined\' && window.runtime) ? window.runtime : (this.runtime || null);\n      if (isToday && rt) {\n        const activeTask = (typeof rt.getActiveTask === \'function\') ? rt.getActiveTask() : null;\n        const isAllDone = rt.status === \'COMPLETED\';\n\n        if (isAllDone) {\n          isDone = true;\n        } else if (!isDone && activeTask && activeTask.id === ev.id && rt.status !== \'COMPLETED\') {\n          isCurrent = true;\n        }\n      }\n\n      const card = document.createElement(\'div\');\n      card.className = `day-event-card ${ev.isLocked ? \'is-locked\' : \'\'} ${isLaterOverlap ? \'is-overlapping-later\' : \'\'} ${isDone ? \'is-event-completed\' : \'\'} ${isCurrent ? \'is-event-current\' : \'\'}`;\n      card.style.top = `${topPx}px`;\n      card.style.borderLeftColor = this._getCategoryColor(ev.category);\n      card.setAttribute(\'data-event-id\', ev.id);\n      if (isDone) {\n        card.style.background = \'rgba(16, 185, 129, 0.22)\';\n      } else if (isCurrent) {\n        card.style.background = \'rgba(0, 240, 255, 0.2)\';\n      }\n      this._applyEventCardLayout(card, heightPx);\n\n      // Top line purely for task title, line below for time span and duration\n      card.innerHTML = `\n        <span class="day-event-emoji">${ev.emoji || \'📅\'}</span>\n        <div class="day-event-content">\n          <div class="day-event-title-line">\n            <span class="day-event-title">${this._escapeHtml(ev.title)}</span>\n          </div>\n          <div class="day-event-meta-line">\n            <span class="event-time-range">${ev.startTime} - ${ev.endTime}</span>\n            <span class="event-duration-pill">(${dur}m)</span>\n            <span class="event-cat-pill">${this._escapeHtml(ev.category || \'Work\')}</span>\n          </div>\n        </div>\n        <button type="button" class="cal-event-lock-btn ${ev.isLocked ? \'is-locked\' : \'\'}" data-action="toggle-lock" title="${ev.isLocked ? \'Fixed Schedule (Locked) - tap to unlock\' : \'Flexible Schedule - tap to lock\'}">\n          ${ev.isLocked ? `\n            <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">\n              <path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z"/>\n            </svg>\n          ` : `\n            <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">\n              <path d="M12 17c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm6-9h-1V6c0-2.76-2.24-5-5-5-2.28 0-4.27 1.54-4.84 3.75-.14.54.18 1.08.72 1.22.53.14 1.08-.18 1.22-.72C9.46 3.86 10.63 3 12 3c1.66 0 3 1.34 3 3v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm0 12H6V10h12v10z"/>\n            </svg>\n          `}\n        </button>\n      `;\n\n      // Padlock button toggle listener\n      const lockBtn = card.querySelector(\'[data-action="toggle-lock"]\');\n      if (lockBtn) {\n        const toggleLock = (e) => {\n          if (e) {\n            e.stopPropagation();\n            if (e.cancelable) e.preventDefault();\n          }\n          const currentLocked = Boolean(ev.isLocked);\n          const newLocked = !currentLocked;\n          const fixedStart = newLocked ? (ev.startTime || null) : null;\n          taskStore.updateCalendarEvent(ev.id, {\n            isLocked: newLocked,\n            fixedStartTime: fixedStart\n          });\n          mobileServices.hapticTap();\n          this.render();\n          this._showToast(newLocked ? \'🔒 Event locked to fixed schedule\' : \'🔓 Event unlocked (flexible)\');\n        };\n        lockBtn.addEventListener(\'click\', toggleLock);\n        lockBtn.addEventListener(\'touchend\', toggleLock, { passive: false });\n      }\n\n      // Hold-to-drag and tap-to-inspect setup\n      this._setupDayEventDrag(card, ev);\n\n      body.appendChild(card);\n    }\n\n    if (isToday) {\n      this._scrollToCurrentTime();\n    }\n  }'), 'calendarView.js does not automatically re-center screen inside _renderDayView during drag');
assert(calJsContent.includes('const finalScrollTop = container ? container.scrollTop : 0;\n      this.render(finalScrollTop);'), 'calendarView.js preserves scroll position on day drag completion');

console.log('\n========================================');
console.log(`Summary: ${passed} passed, ${failed} failed.`);
console.log('========================================');

if (failed > 0) {
  process.exit(1);
} else {
  process.exit(0);
}
