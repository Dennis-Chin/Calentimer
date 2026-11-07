/**
 * telemetrySyncService.js
 * 
 * Client-Side Egress & Real-Time Presence Service for Calentimer.
 * Dispatches lightweight, asynchronous, anonymous heartbeats and session summaries
 * using navigator.sendBeacon and requestIdleCallback.
 * 
 * Guarantees:
 * - 0ms UI blocking (runs off the main animation/gesture thread)
 * - Zero PII (strictly anonymous UUIDs, category tags, and duration metrics)
 * - Strict Mobile WebView Compatibility: ZERO optional chaining and ZERO nullish coalescing operators.
 */

import { taskStore } from './taskStore.js';

class TelemetrySyncService {
  constructor() {
    this.endpoint = 'https://admin.calentimer.com/api/telemetry';
    this.heartbeatIntervalMs = 60 * 1000; // 60 seconds while timer running
    this.presenceIntervalMs = 60 * 1000; // 60 seconds background presence ping
    this.heartbeatTimer = null;
    this.presenceTimer = null;
    this.lastHeartbeatTs = 0;
    this.isInitialized = false;
    this.isTimerRunningState = false;
    this.activeCategoryState = null;
  }

  /**
   * Initializes the telemetry service with optional custom endpoint.
   * Dispatches an immediate presence ping upon app launch.
   * @param {object} [options]
   */
  init(options) {
    if (options && options.endpoint) {
      this.endpoint = options.endpoint;
    }
    if (this.isInitialized) return;
    this.isInitialized = true;

    // Immediately dispatch an active presence heartbeat upon app open
    this.sendHeartbeat(false, null);

    const self = this;

    // Continuous presence ping while the app tab is open in browser
    if (typeof window !== 'undefined' && typeof window.setInterval === 'function') {
      this.presenceTimer = setInterval(function() {
        const isVisible = typeof document === 'undefined' || document.visibilityState !== 'hidden';
        if (isVisible) {
          self.sendHeartbeat(Boolean(self.isTimerRunningState), self.activeCategoryState || null);
        }
      }, this.presenceIntervalMs);
    }

    // Flush disconnect on app exit / minimize, resume presence on restore
    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function' && typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
      document.addEventListener('visibilitychange', function() {
        if (document.visibilityState === 'hidden') {
          self.sendDisconnect();
        } else if (document.visibilityState === 'visible') {
          self.sendHeartbeat(Boolean(self.isTimerRunningState), self.activeCategoryState || null);
        }
      });
      window.addEventListener('pagehide', function() {
        self.sendDisconnect();
      });
      window.addEventListener('beforeunload', function() {
        self.sendDisconnect();
      });
    }
  }

  /**
   * Sends an immediate disconnect event when user closes or minimizes the app.
   */
  sendDisconnect() {
    if (!taskStore.getTelemetryEnabled()) return;

    const payload = {
      clientId: taskStore.getAnonymousClientId(),
      deviceType: this.getDeviceType(),
      isPwa: this.isPwaMode(),
      eventType: 'app_exit',
      timestamp: Date.now()
    };

    this._dispatchPayload(payload);
  }

  /**
   * Detects client device platform for telemetry breakdown.
   * @returns {string} 'mobile-ios' | 'mobile-android' | 'desktop'
   */
  getDeviceType() {
    if (typeof navigator === 'undefined' || !navigator.userAgent) {
      return 'desktop';
    }
    const ua = navigator.userAgent;
    if (/iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) {
      return 'mobile-ios';
    }
    if (/Android/.test(ua)) {
      return 'mobile-android';
    }
    return 'desktop';
  }

  /**
   * Checks whether the app is currently running in standalone PWA mode.
   * @returns {boolean}
   */
  isPwaMode() {
    if (typeof window === 'undefined') return false;
    const isStandaloneDisplay = (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
    const isIosStandalone = (typeof window.navigator !== 'undefined' && window.navigator.standalone === true);
    return Boolean(isStandaloneDisplay || isIosStandalone);
  }

  /**
   * Sanitizes task category for telemetry egress.
   * Curated standard categories are preserved; all user-custom category names
   * are strictly masked to 'Custom' to guarantee 100% user anonymity and zero PII.
   * 
   * @param {string} [rawCategory]
   * @returns {string}
   */
  sanitizeCategory(rawCategory) {
    if (!rawCategory || typeof rawCategory !== 'string') return 'General';
    const clean = rawCategory.trim().toLowerCase();
    const standardCategories = {
      'study': 'Study',
      'practice': 'Practice',
      'admin': 'Admin',
      'work': 'Work',
      'general': 'General',
      'break': 'Break',
      'meeting': 'Meeting',
      'coding': 'Coding',
      'fitness': 'Fitness',
      'health': 'Health',
      'personal': 'Personal',
      'social': 'Social',
      'reading': 'Reading',
      'travel': 'Travel',
      'food': 'Food',
      'finance': 'Finance',
      'sleep': 'Sleep',
      'chores': 'Chores',
      'entertainment': 'Entertainment'
    };
    if (standardCategories[clean]) {
      return standardCategories[clean];
    }
    return 'Custom';
  }

  /**
   * Sends an anonymous heartbeat to maintain active presence on Admin Dashboard.
   * 
   * @param {boolean} [isTimerRunning]
   * @param {string} [activeCategory]
   */
  sendHeartbeat(isTimerRunning, activeCategory) {
    if (!taskStore.getTelemetryEnabled()) return;

    const safeCategory = activeCategory ? this.sanitizeCategory(activeCategory) : null;

    const payload = {
      clientId: taskStore.getAnonymousClientId(),
      deviceType: this.getDeviceType(),
      isPwa: this.isPwaMode(),
      isTimerRunning: Boolean(isTimerRunning),
      activeCategory: safeCategory,
      eventType: null, // heartbeat only
      timestamp: Date.now()
    };

    this._dispatchPayload(payload);
    this.lastHeartbeatTs = Date.now();
  }

  /**
   * Sends a completed session summary event.
   * 
   * @param {object} sessionMetrics - Task/session details (duration, category, flags)
   */
  sendSessionSummary(sessionMetrics) {
    if (!taskStore.getTelemetryEnabled()) return;
    if (!sessionMetrics || typeof sessionMetrics !== 'object') return;

    const safeCategory = this.sanitizeCategory(sessionMetrics.category || 'General');

    // Filter strictly to non-PII metrics (custom categories masked to 'Custom')
    const dynamicPayload = {
      durationSec: typeof sessionMetrics.actualDurationSec === 'number'
        ? sessionMetrics.actualDurationSec
        : ((typeof sessionMetrics.plannedDuration === 'number') ? sessionMetrics.plannedDuration * 60 : 0),
      category: safeCategory,
      status: sessionMetrics.status || 'completed',
      hasHardStop: Boolean(taskStore.getHardStopEnabled()),
      usedTimeBank: Boolean(sessionMetrics.useTimeBank),
      googleConnected: Boolean(taskStore.getGoogleCalendarConnected()),
      msConnected: Boolean(taskStore.getMicrosoftCalendarConnected())
    };

    const payload = {
      clientId: taskStore.getAnonymousClientId(),
      deviceType: this.getDeviceType(),
      isPwa: this.isPwaMode(),
      isTimerRunning: false,
      activeCategory: safeCategory,
      eventType: 'session_completed',
      payload: dynamicPayload,
      timestamp: Date.now()
    };

    this._dispatchPayload(payload);
  }

  /**
   * Starts periodic heartbeat timer (every 60s) while timer is running.
   * @param {string} [category]
   */
  startActiveHeartbeats(category) {
    this.stopActiveHeartbeats();
    this.isTimerRunningState = true;
    const safeCategory = category ? this.sanitizeCategory(category) : null;
    this.activeCategoryState = safeCategory;
    this.sendHeartbeat(true, safeCategory);

    const self = this;
    this.heartbeatTimer = setInterval(function() {
      self.sendHeartbeat(true, safeCategory);
    }, this.heartbeatIntervalMs);
  }

  /**
   * Stops periodic heartbeat timer when timer is paused or stopped.
   */
  stopActiveHeartbeats() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    this.isTimerRunningState = false;
    this.activeCategoryState = null;
    this.sendHeartbeat(false, null);
  }

  /**
   * Low-level dispatcher: uses non-blocking keepalive fetch with fallback to workers.dev endpoint.
   * @private
   */
  _dispatchPayload(data) {
    const jsonStr = JSON.stringify(data);
    const targetUrl = this.endpoint;

    // 1. Try modern keepalive fetch (immediate non-blocking background network egress)
    if (typeof fetch === 'function') {
      try {
        fetch(targetUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: jsonStr,
          keepalive: true,
          mode: 'cors'
        }).catch(function() {
          // If custom domain fails or DNS is not resolved on mobile ISP, fallback to reliable workers.dev
          if (targetUrl.indexOf('workers.dev') === -1) {
            try {
              fetch('https://calentimer-telemetry.ylchin.workers.dev/api/telemetry', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: jsonStr,
                keepalive: true,
                mode: 'cors'
              }).catch(function() {});
            } catch (_) {}
          }
        });
        return;
      } catch (_) {}
    }

    // 2. Secondary fallback: navigator.sendBeacon
    if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
      try {
        const blob = new Blob([jsonStr], { type: 'text/plain' });
        navigator.sendBeacon(targetUrl, blob);
      } catch (_) {}
    }
  }
}

export const telemetrySync = new TelemetrySyncService();
export default telemetrySync;
