/**
 * testStandbyAndLockPulse.js
 * 
 * Unit & Integration tests for:
 * 1. Padlock Pulse Warning on Locked Dial / Scrub Gestures (Touch & Mouse)
 * 2. Distraction-Free Standby Focus Mode on Timer Start, Wakeup on Tap/Move & Reverse Animation
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
        for (let i = 0; i < node.children.length; i++) {
          const c = node.children[i];
          if (selector.startsWith('.') && c.classList && c.classList.contains(selector.substring(1))) {
            results.push(c);
          } else if (selector.startsWith('#') && c.id === selector.substring(1)) {
            results.push(c);
          }
          if (c.children && c.children.length > 0) search(c);
        }
      };
      search({ children });
      return results;
    },
    getBoundingClientRect: () => ({
      top: 100,
      left: 20,
      width: 320,
      height: 320,
      right: 340,
      bottom: 420
    }),
    contains: (target) => {
      if (!target) return false;
      let curr = target;
      while (curr) {
        if (curr === el) return true;
        curr = curr.parentNode || curr.parentElement;
      }
      return false;
    },
    closest: (selector) => {
      let curr = el;
      while (curr) {
        if (selector.startsWith('#') && curr.id === selector.substring(1)) return curr;
        if (selector.startsWith('.') && curr.classList && curr.classList.contains(selector.substring(1))) return curr;
        curr = curr.parentNode || curr.parentElement;
      }
      return null;
    },
    focus: () => {},
    blur: () => {},
    click: () => {
      el.dispatchSimulatedEvent('click');
    },
    addEventListener: (type, fn) => {
      if (!listeners[type]) listeners[type] = [];
      listeners[type].push(fn);
    },
    removeEventListener: (type, fn) => {
      if (listeners[type]) {
        listeners[type] = listeners[type].filter(f => f !== fn);
      }
    },
    dispatchSimulatedEvent: (type, ev = {}) => {
      const fns = listeners[type] || [];
      const syntheticEvent = Object.assign({
        type,
        target: el,
        currentTarget: el,
        preventDefault: () => {},
        stopPropagation: () => {},
        clientX: 160,
        clientY: 160
      }, ev);
      fns.forEach(fn => fn(syntheticEvent));
    },
    dispatchEvent: (ev) => {
      el.dispatchSimulatedEvent(ev.type, ev);
      return true;
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
  localStorage: global.localStorage,
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
    fns.forEach(fn => fn(Object.assign({ type, preventDefault: () => {}, stopPropagation: () => {} }, ev)));
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
  }),
  navigator: {
    vibrate: () => true
  }
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
    if (sel === '.timer-center-display') return getOrCreateMockElement('timerCenterDisplay');
    return null;
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
    fns.forEach(fn => fn(Object.assign({ type, preventDefault: () => {}, stopPropagation: () => {} }, ev)));
  }
};

// Seed essential elements
const timerScreenLockIcon = getOrCreateMockElement('timerScreenLockIcon');
timerScreenLockIcon.className = 'timer-quick-btn timer-lock-indicator locked';
const toastNotification = getOrCreateMockElement('toastNotification');
toastNotification.className = 'toast-notification hidden';

const taskDrawer = getOrCreateMockElement('taskDrawer');
taskDrawer.className = 'task-drawer collapsed';
const drawerHeader = getOrCreateMockElement('drawerHeader');
taskDrawer.appendChild(drawerHeader);
const btnPlayPause = getOrCreateMockElement('btnPlayPause');
const btnStopTime = getOrCreateMockElement('btnStopTime');
const btnSkipTask = getOrCreateMockElement('btnSkipTask');
const btnFinishEarly = getOrCreateMockElement('btnFinishEarly');
const modeSliderWrap = getOrCreateMockElement('modeSliderWrap');
const btnOpenNav = getOrCreateMockElement('btnOpenNav');
const scheduleControlBar = getOrCreateMockElement('scheduleControlBar');
scheduleControlBar.className = 'schedule-control-bar';

// Seed mock initial tasks with a locked task
const initialTasks = [
  {
    id: 'task-test-locked',
    title: 'Locked Focus Session',
    plannedDuration: 25,
    allocatedDuration: 25,
    isLocked: true,
    startTime: '09:00',
    endTime: '09:25',
    category: 'Focus'
  }
];
global.localStorage.setItem('calentimer_tasks', JSON.stringify(initialTasks));

console.log('--- 1. Testing app.js Import and Handler Registration ---');
let appErr = null;
try {
  await import('./app.js');
} catch (e) {
  appErr = e;
}
assert(!appErr, 'app.js loaded without errors');

console.log('\n--- 2. Testing Padlock Pulse Warning on Locked Drag Attempts ---');
assert(typeof window.triggerLockPulseWarning === 'function', 'window.triggerLockPulseWarning is defined');

// Trigger lock pulse warning
window.triggerLockPulseWarning();
assert(timerScreenLockIcon.classList.contains('pulse-locked'), '#timerScreenLockIcon has pulse-locked class applied');
assert(!toastNotification.classList.contains('hidden'), 'Toast notification is shown with locked warning');
assert(toastNotification.textContent.indexOf('Task duration is locked') !== -1, 'Toast notification mentions unlocking padlock');

console.log('\n--- 3. Testing Distraction-Free Standby Focus Mode Activation ---');
assert(typeof window.enterTimerStandbyMode === 'function', 'window.enterTimerStandbyMode is defined');
assert(typeof window.exitTimerStandbyMode === 'function', 'window.exitTimerStandbyMode is defined');

// Start timer: runtime status is RUNNING
const testRuntime = window.runtime || global.runtime;
if (testRuntime) {
  testRuntime.status = 'RUNNING';
}
window.enterTimerStandbyMode();
assert(mockDocBody.classList.contains('is-timer-standby'), 'document.body gains .is-timer-standby when timer is running');

console.log('\n--- 4. Testing Waking Up on User Activity (Tap or Movement) ---');
// Simulating user touch or pointerdown
window.dispatchSimulatedEvent('pointerdown');
assert(!mockDocBody.classList.contains('is-timer-standby'), 'document.body exits .is-timer-standby immediately on pointerdown');

// Test re-entry into standby
window.enterTimerStandbyMode();
assert(mockDocBody.classList.contains('is-timer-standby'), 'Standby mode re-entered');

// Simulating mousemove on desktop
window.dispatchSimulatedEvent('mousemove');
assert(!mockDocBody.classList.contains('is-timer-standby'), 'document.body exits .is-timer-standby smoothly on mousemove');

console.log('\n--- 5. Testing Exit Standby Mode on Pause, Stop & Drawer Open ---');
window.enterTimerStandbyMode();
assert(mockDocBody.classList.contains('is-timer-standby'), 'Standby active before drawer open');

// Open bottom task drawer
if (typeof window.openTaskDrawer === 'function') {
  window.openTaskDrawer();
  assert(!mockDocBody.classList.contains('is-timer-standby'), 'Standby exits when opening task drawer');
}

// Check pause status change
window.enterTimerStandbyMode();
window.exitTimerStandbyMode(false);
assert(!mockDocBody.classList.contains('is-timer-standby'), 'Standby exits when timer pauses or stops');

console.log('\n--- 6. Verifying CSS Keyframes & Rules for Standby & Padlock Pulse ---');
const cssContent = readFileSync(path.resolve(process.cwd(), 'style.css'), 'utf8');

assert(cssContent.indexOf('.timer-lock-indicator.pulse-locked') !== -1, 'style.css contains .timer-lock-indicator.pulse-locked');
assert(cssContent.indexOf('@keyframes timerLockPulseWarning') !== -1, 'style.css defines @keyframes timerLockPulseWarning');
assert(cssContent.indexOf('body.is-timer-standby .schedule-control-bar') !== -1, 'style.css defines sliding up schedule control bar in standby');
assert(cssContent.indexOf('body.is-timer-standby #taskDrawer') !== -1, 'style.css defines sliding down task drawer in standby');
assert(cssContent.indexOf('body.is-timer-standby .timer-controls') !== -1, 'style.css defines fading timer controls in standby');
assert(cssContent.indexOf('body.is-timer-standby .secondary-actions') !== -1, 'style.css defines fading finish early action in standby');
assert(cssContent.indexOf('body.is-timer-standby #btnOpenNav') !== -1, 'style.css defines fading hamburger menu in standby');
assert(cssContent.indexOf('body.is-timer-standby #modeSliderWrap') !== -1, 'style.css defines fading simple mode toggle in standby');

console.log('\n========================================');
console.log(`Summary: ${passed} passed, ${failed} failed.`);
console.log('========================================');

if (failed > 0) {
  process.exit(1);
} else {
  process.exit(0);
}
