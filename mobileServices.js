/**
 * mobileServices.js
 * 
 * Native Mobile Enhancements for Android & PWA:
 * 1. Screen Wake Lock (prevents screen dimming during active timer sessions)
 * 2. Haptic Vibration Feedback (dial scrub ticks & celebratory finish buzz)
 * 3. Notification Panel Live Countdown & Task Transition Alerts
 */

import { taskStore } from './taskStore.js';

class MobileServices {
  constructor() {
    this.wakeLock = null;
    this.swRegistration = null;
    this.isWakeLockRequested = false;
    this.lastNotificationUpdateSec = -1;
    this.notificationPermission = typeof Notification !== 'undefined' ? Notification.permission : 'default';

    this._initServiceWorker();
    this._setupVisibilityListener();
  }

  // ========================================================
  // 1. Service Worker & Notification Initialization
  // ========================================================
  async _initServiceWorker() {
    if ('serviceWorker' in navigator) {
      try {
        this.swRegistration = await navigator.serviceWorker.register('./sw.js', { scope: './' });
        if (this.swRegistration && typeof this.swRegistration.update === 'function') {
          this.swRegistration.update();
        }
      } catch (err) {
        try {
          this.swRegistration = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
          if (this.swRegistration && typeof this.swRegistration.update === 'function') {
            this.swRegistration.update();
          }
        } catch (fallbackErr) {
          console.warn('Service worker registration failed:', fallbackErr);
        }
      }
    }
  }

  async requestNotificationPermission() {
    if (!('Notification' in window)) {
      return false;
    }
    try {
      const permission = await Notification.requestPermission();
      this.notificationPermission = permission;
      return permission === 'granted';
    } catch (err) {
      console.warn('Notification permission request error:', err);
      return false;
    }
  }

  hasNotificationPermission() {
    return 'Notification' in window && Notification.permission === 'granted';
  }

  // ========================================================
  // 2. Screen Wake Lock API
  // ========================================================
  async enableWakeLock() {
    this.isWakeLockRequested = true;
    if (!('wakeLock' in navigator)) return;

    try {
      if (!this.wakeLock) {
        this.wakeLock = await navigator.wakeLock.request('screen');
        this.wakeLock.addEventListener('release', () => {
          this.wakeLock = null;
        });
      }
    } catch (err) {
      // Screen lock can be rejected if battery saver is on or window minimized
      console.log('WakeLock request:', err.message);
    }
  }

  disableWakeLock() {
    this.isWakeLockRequested = false;
    if (typeof taskStore.getKeepScreenAwake === 'function' && taskStore.getKeepScreenAwake()) {
      return;
    }
    if (this.wakeLock) {
      this.wakeLock.release().catch(() => {});
      this.wakeLock = null;
    }
  }

  forceReleaseWakeLock() {
    this.isWakeLockRequested = false;
    if (this.wakeLock) {
      this.wakeLock.release().catch(() => {});
      this.wakeLock = null;
    }
  }

  _setupVisibilityListener() {
    document.addEventListener('visibilitychange', async () => {
      const isKeepAwake = typeof taskStore.getKeepScreenAwake === 'function' && taskStore.getKeepScreenAwake();
      if (document.visibilityState === 'visible' && (this.isWakeLockRequested || isKeepAwake)) {
        // Re-acquire wake lock after switching back to app
        await this.enableWakeLock();
      }
    });
  }

  // ========================================================
  // 3. Haptic Vibration Feedback
  // ========================================================
  /**
   * Subtle tactile tick on rotary dial movement / second scrub
   */
  hapticTick() {
    if (!taskStore.getHapticsEnabled()) return;
    if ('vibrate' in navigator) {
      try {
        navigator.vibrate(10);
      } catch (e) {}
    }
  }

  /**
   * Crisp tap on buttons
   */
  hapticTap() {
    if (!taskStore.getHapticsEnabled()) return;
    if ('vibrate' in navigator) {
      try {
        navigator.vibrate(15);
      } catch (e) {}
    }
  }

  /**
   * Celebratory rhythmic vibration pattern when task or break completes
   */
  hapticCelebration() {
    const isCompletionHaptics = (typeof taskStore !== 'undefined' && typeof taskStore.getCompletionHapticsEnabled === 'function')
      ? taskStore.getCompletionHapticsEnabled()
      : (typeof taskStore !== 'undefined' && typeof taskStore.getHapticsEnabled === 'function' ? taskStore.getHapticsEnabled() : true);
    if (!isCompletionHaptics) return;
    if ('vibrate' in navigator) {
      try {
        // Rhythmic victory burst: tap, tap, buzz, long buzz
        navigator.vibrate([120, 80, 120, 80, 260, 100, 400]);
      } catch (e) {}
    }
  }

  hapticTaskComplete() {
    this.hapticCelebration();
  }

  /**
   * Warning vibration pattern (e.g. attempting to drag a locked task)
   */
  hapticWarning() {
    if (!taskStore.getHapticsEnabled()) return;
    if ('vibrate' in navigator) {
      try {
        navigator.vibrate([40, 50, 40]);
      } catch (e) {}
    }
  }

  /**
   * Distinct buzz on drag drop / deletion / task movement
   */
  hapticBuzz() {
    if ('vibrate' in navigator) {
      try {
        navigator.vibrate(35);
      } catch (e) {}
    }
  }

  // ========================================================
  // 4. Live Notification Panel Countdown & Transition Alerts
  // ========================================================
  /**
   * Updates or creates the live persistent timer notification in the notification bar
   */
  async updateLiveNotification(data) {
    if (!data) return;
    const activeTask = data.activeTask;
    const remainingSeconds = typeof data.remainingSeconds === 'number' ? data.remainingSeconds : 0;
    const nextTask = data.nextTask || null;
    const isPaused = Boolean(data.isPaused);

    if (!this.hasNotificationPermission() || !activeTask || !taskStore.getAlertsEnabled()) return;

    const mins = Math.floor(remainingSeconds / 60);
    const secs = remainingSeconds % 60;
    const timeStr = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;

    // Top line: Name of the task without square brackets
    const title = isPaused
      ? `⏸ Paused · ${activeTask.title}`
      : `${activeTask.title}`;

    const durMin = activeTask.allocatedDuration || activeTask.plannedDuration || Math.max(1, Math.ceil(remainingSeconds / 60));
    const startTime = activeTask.fixedStartTime || activeTask.startTime;
    const endTime = activeTask.fixedEndTime || activeTask.endTime;
    const timespanText = (startTime && endTime) ? `${startTime} → ${endTime}` : (endTime ? `Ends at ${endTime}` : `${durMin}m`);
    const nextPart = nextTask ? `\nNext: ${nextTask.title} (${nextTask.allocatedDuration || nextTask.plannedDuration || 30}m)` : '';

    // Second line: countdown and time span
    const body = `${timeStr} left · ${timespanText}${nextPart}`;

    const notifOptions = {
      body: body,
      icon: '/icon.png',
      badge: '/badge-icon.png',
      tag: 'calentimer-active-countdown',
      renotify: false,
      silent: true,
      requireInteraction: !isPaused,
      ongoing: !isPaused,
      data: {
        url: '/'
      }
    };

    // Forward background timer sync to Service Worker to keep dynamic ticking alive while minimised
    try {
      if (navigator.serviceWorker && navigator.serviceWorker.controller) {
        navigator.serviceWorker.controller.postMessage({
          type: isPaused ? 'STOP_BG_TIMER' : 'START_BG_TIMER',
          payload: {
            activeTask: { title: activeTask.title },
            remainingSeconds: remainingSeconds,
            timespanText: timespanText,
            isPaused: isPaused
          }
        });
      }
    } catch (_) {}

    try {
      const reg = this.swRegistration || (navigator.serviceWorker && (await navigator.serviceWorker.ready));
      if (reg && reg.showNotification) {
        await reg.showNotification(title, notifOptions);
        return;
      }
    } catch (err) {}

    // Fallback standard Web Notification if service worker is not active
    try {
      if (typeof Notification !== 'undefined') {
        new Notification(title, notifOptions);
      }
    } catch (fallbackErr) {}
  }

  /**
   * Celebratory transition alert banner when a task finishes
   */
  async notifyTaskComplete(data) {
    const completedTask = data && data.completedTask;
    const nextTask = data && data.nextTask;
    if (!this.hasNotificationPermission() || !completedTask || !taskStore.getAlertsEnabled()) return;

    const title = `🎉 Task Complete: ${completedTask.title}`;
    const nextStr = nextTask
      ? `Next: ${nextTask.title} (Starts now · Ends at ${nextTask.endTime})`
      : 'All tasks on your schedule are complete! 🌟';

    try {
      if (navigator.serviceWorker && navigator.serviceWorker.controller) {
        navigator.serviceWorker.controller.postMessage({ type: 'STOP_BG_TIMER' });
      }
    } catch (_) {}

    try {
      const reg = this.swRegistration || await navigator.serviceWorker.ready;
      if (reg && reg.showNotification) {
        await reg.showNotification(title, {
          body: nextStr,
          icon: '/icon.png',
          badge: '/badge-icon.png',
          tag: 'calentimer-task-alert',
          renotify: true,
          silent: false,
          vibrate: [200, 100, 200, 100, 300]
        });
      }
    } catch (err) {}
  }

  /**
   * Closes active countdown notification
   */
  async clearLiveNotification() {
    try {
      if (navigator.serviceWorker && navigator.serviceWorker.controller) {
        navigator.serviceWorker.controller.postMessage({ type: 'STOP_BG_TIMER' });
      }
    } catch (_) {}
    try {
      const reg = this.swRegistration || await navigator.serviceWorker.ready;
      if (reg && reg.getNotifications) {
        const notifs = await reg.getNotifications({ tag: 'calentimer-active-countdown' });
        notifs.forEach(n => n.close());
      }
    } catch (err) {}
  }

  async cancelLiveNotification() {
    return this.clearLiveNotification();
  }
}

export const mobileServices = new MobileServices();
export default mobileServices;
