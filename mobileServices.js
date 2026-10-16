/**
 * mobileServices.js
 * 
 * Native Mobile Enhancements for Android & PWA:
 * 1. Screen Wake Lock (prevents screen dimming during active timer sessions)
 * 2. Haptic Vibration Feedback (dial scrub ticks & celebratory finish buzz)
 * 3. Notification Panel Live Countdown & Task Transition Alerts
 */

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
        this.swRegistration = await navigator.serviceWorker.register('/sw.js');
      } catch (err) {
        console.warn('Service worker registration failed:', err);
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
    if (this.wakeLock) {
      this.wakeLock.release().catch(() => {});
      this.wakeLock = null;
    }
  }

  _setupVisibilityListener() {
    document.addEventListener('visibilitychange', async () => {
      if (document.visibilityState === 'visible' && this.isWakeLockRequested) {
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
    if ('vibrate' in navigator) {
      try {
        navigator.vibrate(15);
      } catch (e) {}
    }
  }

  /**
   * Celebratory rhythmic vibration pattern when task completes
   */
  hapticCelebration() {
    if ('vibrate' in navigator) {
      try {
        // Rhythmic victory burst: tap, tap, buzz, long buzz
        navigator.vibrate([100, 60, 100, 60, 220, 100, 380]);
      } catch (e) {}
    }
  }

  // ========================================================
  // 4. Live Notification Panel Countdown & Transition Alerts
  // ========================================================
  /**
   * Updates or creates the live timer notification in the Android notification panel
   */
  async updateLiveNotification({ activeTask, remainingSeconds, nextTask, isPaused = false }) {
    if (!this.hasNotificationPermission() || !activeTask) return;

    // Throttle updates: update on minute changes or when 5 seconds pass to save battery
    const mins = Math.floor(remainingSeconds / 60);
    const secs = remainingSeconds % 60;
    const timeStr = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;

    const title = isPaused
      ? `⏸ [${timeStr}] Paused: ${activeTask.title}`
      : `⏱ [${timeStr}] ${activeTask.title}`;

    const endTime = activeTask.endTime || 'End of schedule';
    const nextText = nextTask ? `\nNext up: ${nextTask.title} (${nextTask.endTime})` : '\nFinal task on schedule!';
    const body = `⏳ ${mins}m ${secs}s left • Ends at ${endTime}${nextText}`;

    try {
      const reg = this.swRegistration || await navigator.serviceWorker.ready;
      if (reg && reg.showNotification) {
        await reg.showNotification(title, {
          body,
          icon: '/icon.png',
          badge: '/icon.png',
          tag: 'calentimer-active-countdown',
          renotify: false,
          silent: true,
          requireInteraction: !isPaused
        });
      }
    } catch (err) {
      // Background notifications might fail if document is strictly inactive
    }
  }

  /**
   * Celebratory transition alert banner when a task finishes
   */
  async notifyTaskComplete({ completedTask, nextTask }) {
    if (!this.hasNotificationPermission() || !completedTask) return;

    const title = `🎉 Task Complete: ${completedTask.title}`;
    const nextStr = nextTask
      ? `Next: ${nextTask.title} (Starts now · Ends at ${nextTask.endTime})`
      : 'All tasks on your schedule are complete! 🌟';

    try {
      const reg = this.swRegistration || await navigator.serviceWorker.ready;
      if (reg && reg.showNotification) {
        await reg.showNotification(title, {
          body: nextStr,
          icon: '/icon.png',
          badge: '/icon.png',
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
      const reg = this.swRegistration || await navigator.serviceWorker.ready;
      if (reg && reg.getNotifications) {
        const notifs = await reg.getNotifications({ tag: 'calentimer-active-countdown' });
        notifs.forEach(n => n.close());
      }
    } catch (err) {}
  }
}

export const mobileServices = new MobileServices();
export default mobileServices;
