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

console.log('\n========================================');
console.log(`Summary: ${passed} passed, ${failed} failed.`);
console.log('========================================');

if (failed > 0) {
  process.exit(1);
} else {
  process.exit(0);
}
