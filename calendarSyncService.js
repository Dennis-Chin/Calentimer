/**
 * calendarSyncService.js
 * 
 * Unified External Calendar Synchronization Engine for Calentimer.
 * Orchestrates Google & Microsoft adapters, Echo Guard hash reconciliation,
 * automatic delta synchronization, and seamless Today's Schedule integration.
 * Strictly zero optional chaining and zero nullish coalescing operators.
 */

import { taskStore } from './taskStore.js';
import { googleCalendarAdapter } from './googleCalendarAdapter.js';
import { microsoftCalendarAdapter } from './microsoftCalendarAdapter.js';
import { getCategoryColor } from './eventClassifier.js';

export class CalendarSyncService {
  constructor(options) {
    const opts = (options && typeof options === 'object') ? options : {};
    this.adapters = {
      google: opts.googleAdapter || googleCalendarAdapter,
      microsoft: opts.microsoftAdapter || microsoftCalendarAdapter
    };
    this.isSyncing = false;
    this.syncListeners = new Set();
    this.autoSyncTimer = null;
    this._visibilityHandler = null;
    this.isAutoSyncRunning = false;
    this.cloudSyncEventId = null;
    this._creatingEventIds = new Set();
  }

  isCreatingEvent(id) {
    return Boolean(id && this._creatingEventIds.has(id));
  }

  /**
   * Initializes adapters and starts background auto-sync if enabled.
   */
  init() {
    if (this.adapters.google && typeof this.adapters.google.init === 'function') {
      this.adapters.google.init();
    }
    if (this.adapters.microsoft && typeof this.adapters.microsoft.init === 'function') {
      this.adapters.microsoft.init();
    }

    this.startAutoSync();
  }

  /**
   * Registers a sync status change listener (e.g. for spinners or badges).
   * @param {Function} callback 
   * @returns {Function} unbind
   */
  onSyncStatusChange(callback) {
    if (typeof callback === 'function') {
      this.syncListeners.add(callback);
    }
    return () => {
      this.syncListeners.delete(callback);
    };
  }

  _notifySyncStatus(isSyncing, details) {
    this.isSyncing = Boolean(isSyncing);
    this.syncListeners.forEach(fn => {
      try {
        fn(this.isSyncing, details);
      } catch (_) {}
    });
  }

  // ==========================================
  // 1. Connection & Provider State
  // ==========================================

  isProviderConnected(provider) {
    if (provider === 'google') {
      return (typeof taskStore.getGoogleCalendarConnected === 'function')
        ? taskStore.getGoogleCalendarConnected()
        : false;
    }
    if (provider === 'microsoft') {
      return (typeof taskStore.getMicrosoftCalendarConnected === 'function')
        ? taskStore.getMicrosoftCalendarConnected()
        : false;
    }
    return false;
  }

  async connectProvider(provider) {
    const adapter = this.adapters[provider];
    if (!adapter) {
      throw new Error(`Unknown calendar provider: ${provider}`);
    }

    this._notifySyncStatus(true, { action: 'connect', provider: provider });

    try {
      await adapter.requestAccessToken();
      const email = await adapter.fetchUserEmail();

      if (provider === 'google') {
        if (typeof taskStore.setGoogleCalendarConnected === 'function') taskStore.setGoogleCalendarConnected(true);
        if (typeof taskStore.setGoogleUserEmail === 'function') taskStore.setGoogleUserEmail(email);
        if (typeof taskStore.setGoogleSyncToken === 'function') taskStore.setGoogleSyncToken(null);
        if (typeof taskStore.setGoogleSelectedCalendarIds === 'function') taskStore.setGoogleSelectedCalendarIds(null);
      } else if (provider === 'microsoft') {
        if (typeof taskStore.setMicrosoftCalendarConnected === 'function') taskStore.setMicrosoftCalendarConnected(true);
        if (typeof taskStore.setMicrosoftUserEmail === 'function') taskStore.setMicrosoftUserEmail(email);
        if (typeof taskStore.setMicrosoftDeltaLink === 'function') taskStore.setMicrosoftDeltaLink(null);
        if (typeof taskStore.setMicrosoftSelectedCalendarIds === 'function') taskStore.setMicrosoftSelectedCalendarIds(null);
      }

      if (typeof taskStore.clearDeletedIdsForProvider === 'function') {
        taskStore.clearDeletedIdsForProvider(provider);
      }

      // Ensure dedicated Calentimer secondary calendar exists upfront
      if (typeof adapter.getOrCreateCalentimerCalendar === 'function') {
        try {
          await adapter.getOrCreateCalentimerCalendar();
        } catch (calErr) {
          console.warn(`CalendarSyncService: Failed to get/create dedicated Calentimer calendar for ${provider}:`, calErr);
        }
      }

      // Initial full import
      await this.syncProvider(provider, true);

      // Save/Restore Cross-Device Profile payload
      if (!this.cloudSyncEventId) {
        try {
          await this.saveCloudProfile(provider);
        } catch (_) {}
      }

      this._notifySyncStatus(false, { action: 'connect_success', provider: provider, email: email });
      return { success: true, email: email };
    } catch (err) {
      this._notifySyncStatus(false, { action: 'connect_error', provider: provider, error: err });
      throw err;
    }
  }

  async disconnectProvider(provider) {
    const adapter = this.adapters[provider];
    if (adapter && typeof adapter.signOut === 'function') {
      adapter.signOut();
    }

    if (provider === 'google') {
      if (typeof taskStore.setGoogleCalendarConnected === 'function') taskStore.setGoogleCalendarConnected(false);
      if (typeof taskStore.setGoogleSyncToken === 'function') taskStore.setGoogleSyncToken(null);
      if (typeof taskStore.setGoogleUserEmail === 'function') taskStore.setGoogleUserEmail(null);
      if (typeof taskStore.setGoogleCalentimerCalendarId === 'function') taskStore.setGoogleCalentimerCalendarId(null);
      if (typeof taskStore.setGoogleSelectedCalendarIds === 'function') taskStore.setGoogleSelectedCalendarIds(null);
    } else if (provider === 'microsoft') {
      if (typeof taskStore.setMicrosoftCalendarConnected === 'function') taskStore.setMicrosoftCalendarConnected(false);
      if (typeof taskStore.setMicrosoftDeltaLink === 'function') taskStore.setMicrosoftDeltaLink(null);
      if (typeof taskStore.setMicrosoftUserEmail === 'function') taskStore.setMicrosoftUserEmail(null);
      if (typeof taskStore.setMicrosoftCalentimerCalendarId === 'function') taskStore.setMicrosoftCalentimerCalendarId(null);
      if (typeof taskStore.setMicrosoftSelectedCalendarIds === 'function') taskStore.setMicrosoftSelectedCalendarIds(null);
    }

    if (typeof taskStore.clearDeletedIdsForProvider === 'function') {
      taskStore.clearDeletedIdsForProvider(provider);
    }

    // Remove imported events from calendarEvents
    const allEvents = taskStore.getCalendarEvents();
    const remaining = allEvents.filter(ev => {
      const p = (ev && (ev.provider || ev.source)) ? (ev.provider || ev.source) : 'local';
      const isIdMatch = ev && ev.id && (provider === 'google' ? ev.id.indexOf('cal-gcal-') === 0 : ev.id.indexOf('cal-ms-') === 0);
      return p !== provider && !isIdMatch;
    });

    if (remaining.length !== allEvents.length) {
      taskStore.saveCalendarEvents(remaining);
    }

    // Remove imported tasks from tasks
    const allTasks = taskStore.getTasks();
    const remainingTasks = allTasks.filter(t => {
      const p = (t && (t.provider || t.source)) ? (t.provider || t.source) : 'local';
      const isIdMatch = t && t.id && (provider === 'google' ? t.id.indexOf('cal-gcal-') === 0 : t.id.indexOf('cal-ms-') === 0);
      return p !== provider && !isIdMatch;
    });
    if (remainingTasks.length !== allTasks.length) {
      taskStore.saveTasks(remainingTasks);
    }

    const todayStr = (typeof taskStore.getTodayDateString === 'function')
      ? taskStore.getTodayDateString()
      : new Date().toISOString().split('T')[0];
    if (typeof taskStore.syncScheduleAndCalendar === 'function') {
      taskStore.syncScheduleAndCalendar(todayStr);
    }

    this._notifySyncStatus(false, { action: 'disconnect', provider: provider });
    return true;
  }

  // ==========================================
  // 2. Echo Guard & Hash Signature
  // ==========================================

  /**
   * Computes deterministic hash for event payload to detect echo loops.
   * If incoming delta event hash matches our stored syncHash, the update originated locally.
   * @param {object} ev 
   * @returns {string}
   */
  computeSyncHash(ev) {
    if (!ev) return '';
    const title = ev.title ? String(ev.title).trim() : '';
    const date = ev.date ? String(ev.date).trim() : '';
    const start = ev.startTime ? String(ev.startTime).trim() : '';
    const end = ev.endTime ? String(ev.endTime).trim() : '';
    const locked = ev.isLocked ? '1' : '0';

    const raw = `${title}|${date}|${start}|${end}|${locked}`;
    let hash = 0;
    for (let i = 0; i < raw.length; i++) {
      hash = ((hash << 5) - hash) + raw.charCodeAt(i);
      hash = hash & hash; // Convert to 32bit integer
    }
    return 'h' + Math.abs(hash).toString(36);
  }

  // ==========================================
  // 3. Bidirectional Sync Operations
  // ==========================================

  /**
   * Syncs all connected providers.
   * @param {boolean} [forceFullSync=false]
   */
  async syncAll(forceFullSync) {
    const isForce = Boolean(forceFullSync);
    if (this.isSyncing) return { skipped: true };
    this._notifySyncStatus(true, { action: 'syncAll' });

    const results = {};
    try {
      if (this.isProviderConnected('google')) {
        results.google = await this.syncProvider('google', isForce);
      }
      if (this.isProviderConnected('microsoft')) {
        results.microsoft = await this.syncProvider('microsoft', isForce);
      }
      if (typeof taskStore.setLastSyncTimestamp === 'function') {
        taskStore.setLastSyncTimestamp('all', Date.now());
      }
      try {
        await this.saveCloudProfile();
      } catch (_) {}
    } finally {
      this._notifySyncStatus(false, { action: 'syncAll_complete', results: results });
    }
    return Object.assign({ providers: results }, results);
  }

  /**
   * Syncs a specific provider (Google or Microsoft).
   * Pulls deltas, reconciles conflicts, and pushes pending offline changes.
   * @param {string} provider 
   * @param {boolean} [forceFullSync=false]
   */
  async syncProvider(provider, forceFullSync) {
    const isForce = Boolean(forceFullSync);
    const adapter = this.adapters[provider];
    if (!adapter) return { skipped: true, reason: 'No adapter' };
    let isAuth = (typeof adapter.isAuthenticated === 'function') ? adapter.isAuthenticated() : true;
    if (!isAuth && typeof adapter.ensureValidToken === 'function') {
      try {
        await adapter.ensureValidToken();
      } catch (_) {}
      isAuth = (typeof adapter.isAuthenticated === 'function') ? adapter.isAuthenticated() : true;
    }

    if (!this.isProviderConnected(provider) && !isAuth) {
      return { skipped: true, reason: 'Not connected' };
    }

    if (!isAuth) {
      if (!isForce) {
        return { skipped: true, reason: 'Session token expired; awaiting interactive renewal' };
      } else {
        const provName = provider === 'google' ? 'Google' : 'Microsoft';
        throw new Error(`${provName} session expired. Tap Connect in Settings to renew.`);
      }
    }

    let token = null;
    if (!isForce) {
      if (provider === 'google' && typeof taskStore.getGoogleSyncToken === 'function') {
        token = taskStore.getGoogleSyncToken();
      } else if (provider === 'microsoft' && typeof taskStore.getMicrosoftDeltaLink === 'function') {
        token = taskStore.getMicrosoftDeltaLink();
      }
    } else {
      if (provider === 'google' && typeof taskStore.setGoogleSyncToken === 'function') {
        taskStore.setGoogleSyncToken(null);
      } else if (provider === 'microsoft' && typeof taskStore.setMicrosoftDeltaLink === 'function') {
        taskStore.setMicrosoftDeltaLink(null);
      }
    }

    let deltaResult = null;
    const fetchFn = (adapter && typeof adapter.fetchEvents === 'function')
      ? (t) => adapter.fetchEvents(null, null, t)
      : ((adapter && typeof adapter.pullDelta === 'function') ? (t) => adapter.pullDelta(t) : null);

    try {
      if (provider === 'google') {
        if (fetchFn) {
          deltaResult = await fetchFn(token);
        }
        if (deltaResult && deltaResult.syncTokenExpired) {
          // Sync token was 410 Gone, fetch full window fresh
          if (typeof taskStore.setGoogleSyncToken === 'function') taskStore.setGoogleSyncToken(null);
          if (fetchFn) deltaResult = await fetchFn(null);
        }
        if (deltaResult && deltaResult.nextSyncToken && typeof taskStore.setGoogleSyncToken === 'function') {
          taskStore.setGoogleSyncToken(deltaResult.nextSyncToken);
        }
      } else if (provider === 'microsoft') {
        if (fetchFn) {
          deltaResult = await fetchFn(token);
        }
        if (deltaResult && deltaResult.deltaLinkExpired) {
          if (typeof taskStore.setMicrosoftDeltaLink === 'function') taskStore.setMicrosoftDeltaLink(null);
          if (fetchFn) deltaResult = await fetchFn(null);
        }
        if (deltaResult && deltaResult.nextDeltaLink && typeof taskStore.setMicrosoftDeltaLink === 'function') {
          taskStore.setMicrosoftDeltaLink(deltaResult.nextDeltaLink);
        }
      }
    } catch (err) {
      console.warn(`CalendarSyncService: ${provider} inbound fetch warning:`, err);
      return { error: err };
    }

    // Inbound reconciliation
    const incomingEvents = (deltaResult && Array.isArray(deltaResult.events)) ? deltaResult.events : [];
    const inboundSummary = this._reconcileInboundEvents(provider, incomingEvents);

    // Outbound push for dirty / pending items
    const outboundSummary = await this._pushDirtyEvents(provider);

    if (typeof taskStore.setLastSyncTimestamp === 'function') {
      taskStore.setLastSyncTimestamp(provider, Date.now());
    }

    return {
      imported: inboundSummary.added,
      added: inboundSummary.added,
      updated: inboundSummary.updated,
      deleted: inboundSummary.deleted,
      echoesSuppressed: inboundSummary.echoes,
      echoes: inboundSummary.echoes,
      inbound: inboundSummary,
      outbound: outboundSummary
    };
  }

  _reconcileInboundEvents(provider, incomingList) {
    if (!incomingList || incomingList.length === 0) {
      return { added: 0, updated: 0, deleted: 0, echoes: 0 };
    }

    const allEvents = taskStore.getCalendarEvents();
    const eventMap = new Map();
    allEvents.forEach(e => {
      if (!e) return;
      if (e.externalId) {
        eventMap.set(e.externalId, e);
      }
      if (e.googleEventId) {
        eventMap.set(e.googleEventId, e);
      }
      if (e.microsoftEventId) {
        eventMap.set(e.microsoftEventId, e);
      }
      if (e.id) {
        eventMap.set(e.id, e);
      }
    });

    let added = 0;
    let updated = 0;
    let deleted = 0;
    let echoes = 0;
    let hasTodayChanges = false;
    const todayStr = (typeof taskStore.getTodayDateString === 'function')
      ? taskStore.getTodayDateString()
      : new Date().toISOString().split('T')[0];
    const deletedIds = (typeof taskStore.getDeletedIds === 'function')
      ? taskStore.getDeletedIds()
      : new Set();

    const updatedEvents = [...allEvents];

    for (let i = 0; i < incomingList.length; i++) {
      const incoming = incomingList[i];
      if (!incoming || !incoming.externalId) continue;

      // Cross-Device Profile Shield: Intercept cloud sync event, restore profile, and hide from timeline
      const incTitle = incoming.title || incoming.summary || '';
      if (incTitle === '[Calentimer Cloud Sync]' || (incoming.id && incoming.id.indexOf('cal-sync-profile') !== -1)) {
        this._restoreCloudProfile(incoming);
        echoes++;
        continue;
      }

      // Tombstone Shield: Check if this external event was deleted locally in Calentimer
      if ((incoming.id && deletedIds.has(incoming.id)) || (incoming.externalId && deletedIds.has(incoming.externalId))) {
        echoes++;
        continue;
      }

      const existing = eventMap.get(incoming.externalId);

      // 1. Deletion / Cancellation in cloud
      if (incoming.isCancelled || incoming.status === 'cancelled' || incoming.deleted) {
        if (existing) {
          const isExplicitExternal = Boolean(
            existing.origin === 'external' ||
            existing.createdInApp === false ||
            (existing.id && (existing.id.indexOf('cal-gcal-') === 0 || existing.id.indexOf('cal-ms-') === 0 || existing.id.indexOf('cal-sync-') === 0)) ||
            ((existing.source === 'google' || existing.source === 'microsoft') && (!existing.origin || existing.origin !== 'local'))
          );
          const isLocalItem = !isExplicitExternal && Boolean(
            (existing.id && (existing.id.startsWith('cal-event-') || existing.id.startsWith('task-'))) ||
            existing.source === 'local' ||
            existing.origin === 'local' ||
            existing.createdInApp === true
          );
          if (isLocalItem) {
            // Local Calentimer item: detach external sync pairing, do NOT delete local item
            if (provider === 'google') existing.googleEventId = null;
            if (provider === 'microsoft') existing.microsoftEventId = null;
            existing.externalId = null;
            existing.provider = 'local';
            existing.isDirty = false;
            existing.lastModified = Date.now();
            updated++;
          } else {
            // Pure external event imported from cloud: proceed with deletion
            if (typeof taskStore.addDeletedId === 'function') {
              taskStore.addDeletedId(existing.id);
            }
            const idx = updatedEvents.findIndex(e => e.id === existing.id);
            if (idx !== -1) {
              updatedEvents.splice(idx, 1);
              deleted++;
              if (existing.date === todayStr) {
                hasTodayChanges = true;
                if (typeof taskStore.getTasks === 'function' && typeof taskStore.saveTasks === 'function') {
                  const remainingTasks = taskStore.getTasks().filter(t => t.id !== existing.id);
                  taskStore.saveTasks(remainingTasks);
                }
              }
            }
          }
        }
        continue;
      }

      const isLockedVal = incoming.isLocked !== undefined
        ? Boolean(incoming.isLocked)
        : (existing ? Boolean(existing.isLocked) : true);
      const incomingHash = this.computeSyncHash(Object.assign({}, incoming, { isLocked: isLockedVal }));

      // 2. Existing local item matching incoming externalId
      if (existing) {
        // Echo Guard Check: If local item already has this exact hash, it is our own emitted echo!
        if (existing.syncHash && existing.syncHash === incomingHash) {
          echoes++;
          // Just update ETag and lastSyncedAt quietly
          existing.etag = incoming.etag;
          existing.lastSyncedAt = Date.now();
          continue;
        }

        // Genuine external edit from cloud
        existing.title = incoming.title;
        existing.date = incoming.date;
        existing.startTime = incoming.startTime;
        existing.endTime = incoming.endTime;
        existing.plannedDuration = incoming.plannedDuration;
        if (incoming.category) existing.category = incoming.category;
        if (incoming.emoji) existing.emoji = incoming.emoji;
        if (incoming.color) existing.color = incoming.color;
        if (incoming.colorId) existing.colorId = incoming.colorId;
        if (incoming.externalCalendarId) existing.externalCalendarId = incoming.externalCalendarId;
        if (typeof incoming.isCalentimerMirror === 'boolean') existing.isCalentimerMirror = incoming.isCalentimerMirror;
        existing.etag = incoming.etag;
        existing.syncHash = incomingHash;
        existing.lastSyncedAt = Date.now();
        existing.lastModified = Date.now();
        existing.isDirty = false;
        updated++;

        if (existing.date === todayStr || incoming.date === todayStr) {
          hasTodayChanges = true;
        }
      } else {
        if (!incoming.date) continue;

        // Dedup Guard: Check if an existing local event on this date matches title, start, and end time
        let existingLocal = null;
        if (incoming.title && incoming.startTime) {
          const incTitle = incoming.title.trim().toLowerCase();
          for (let k = 0; k < allEvents.length; k++) {
            const cand = allEvents[k];
            if (cand && cand.date === incoming.date && cand.startTime === incoming.startTime) {
              const candTitle = (cand.title || '').trim().toLowerCase();
              if (candTitle === incTitle) {
                existingLocal = cand;
                break;
              }
            }
          }
        }

        if (existingLocal) {
          // Reconcile and pair local event with incoming external ID to prevent duplicate clone
          existingLocal.externalId = incoming.externalId;
          if (provider === 'google') existingLocal.googleEventId = incoming.externalId;
          if (provider === 'microsoft') existingLocal.microsoftEventId = incoming.externalId;
          existingLocal.etag = incoming.etag;
          existingLocal.syncHash = incomingHash;
          existingLocal.lastSyncedAt = Date.now();
          existingLocal.lastModified = Date.now();
          existingLocal.isDirty = false;
          updated++;
          eventMap.set(incoming.externalId, existingLocal);
          continue;
        }

        // 3. New event imported from cloud (default to locked for fixed wall-clock schedule)
        const newEvent = Object.assign({}, incoming, {
          id: incoming.id || ('cal-sync-' + Date.now() + '-' + Math.random().toString(36).substr(2, 5)),
          provider: provider,
          source: provider,
          origin: 'external',
          createdInApp: false,
          isLocked: isLockedVal,
          syncHash: incomingHash,
          isDirty: false,
          lastSyncedAt: Date.now(),
          lastModified: Date.now()
        });
        updatedEvents.push(newEvent);
        eventMap.set(incoming.externalId, newEvent);
        added++;

        if (newEvent.date === todayStr) {
          hasTodayChanges = true;
        }
      }
    }

    if (added > 0 || updated > 0 || deleted > 0) {
      taskStore.saveCalendarEvents(updatedEvents);
      this._notifySyncStatus(false, {
        action: 'events_reconciled',
        provider: provider,
        added: added,
        updated: updated,
        deleted: deleted,
        hasTodayChanges: hasTodayChanges
      });
    }
    if (typeof taskStore.syncScheduleAndCalendar === 'function') {
      taskStore.syncScheduleAndCalendar(todayStr);
    }

    return { added, updated, deleted, echoes };
  }

  async _pushDirtyEvents(provider) {
    const adapter = this.adapters[provider];
    if (!adapter) return { pushed: 0 };

    const allEvents = taskStore.getCalendarEvents();
    const dirtyEvents = allEvents.filter(ev => {
      if (!ev || !ev.isDirty) return false;
      if (this._creatingEventIds.has(ev.id)) return false; // In-flight creation guard
      const p = (ev.provider || ev.source || 'local');
      if (provider === 'google') {
        return Boolean(p === 'google' || ev.googleEventId || (p === 'local' && ev.externalId));
      }
      if (provider === 'microsoft') {
        return Boolean(p === 'microsoft' || ev.microsoftEventId || (p === 'local' && ev.externalId));
      }
      return false;
    });

    let pushed = 0;
    for (let i = 0; i < dirtyEvents.length; i++) {
      const ev = dirtyEvents[i];
      try {
        const extId = provider === 'google'
          ? (ev.googleEventId || (ev.provider === 'google' ? ev.externalId : null))
          : (ev.microsoftEventId || (ev.provider === 'microsoft' ? ev.externalId : null));

        if (extId) {
          const updatePayload = Object.assign({}, ev, { externalId: extId });
          const res = await adapter.updateEvent(updatePayload);
          if (res) {
            ev.etag = res.etag;
            ev.syncHash = this.computeSyncHash(ev);
            ev.isDirty = false;
            ev.lastSyncedAt = Date.now();
            pushed++;
          }
        } else {
          this._creatingEventIds.add(ev.id);
          try {
            const res = await adapter.createEvent(ev);
            if (res && (res.externalId || res.id)) {
              const newExtId = res.externalId || res.id;
              if (provider === 'google') ev.googleEventId = newExtId;
              if (provider === 'microsoft') ev.microsoftEventId = newExtId;
              ev.externalId = newExtId;
              ev.etag = res.etag;
              ev.syncHash = this.computeSyncHash(ev);
              ev.isDirty = false;
              ev.lastSyncedAt = Date.now();
              pushed++;

              if (typeof taskStore.getTasks === 'function' && typeof taskStore.updateTask === 'function') {
                const tasks = taskStore.getTasks();
                const match = tasks.find(t => t.id === ev.id);
                if (match) {
                  const patch = { externalId: newExtId, isDirty: false };
                  if (provider === 'google') patch.googleEventId = newExtId;
                  if (provider === 'microsoft') patch.microsoftEventId = newExtId;
                  taskStore.updateTask(ev.id, patch);
                }
              }
            }
          } finally {
            this._creatingEventIds.delete(ev.id);
          }
        }
      } catch (err) {
        console.warn(`CalendarSyncService: Failed to push dirty event ${ev.id}:`, err);
      }
    }

    if (pushed > 0) {
      taskStore.saveCalendarEvents(allEvents);
    }

    return { pushed };
  }

  // ==========================================
  // 4. Outbound Event Dispatchers
  // ==========================================

  /**
   * Pushes an event creation to the appropriate connected provider.
   * @param {object} event 
   */
  async pushEventCreate(event) {
    if (!event) return null;
    const provider = (event.provider || event.source || 'local');
    if (provider === 'local') return null;

    const adapter = this.adapters[provider];
    if (!adapter || !this.isProviderConnected(provider)) {
      // Mark as dirty so it syncs when connected
      event.isDirty = true;
      event.syncHash = this.computeSyncHash(event);
      return null;
    }

    try {
      const created = await adapter.createEvent(event);
      if (created) {
        const hash = this.computeSyncHash(event);
        taskStore.updateCalendarEvent(event.id, {
          externalId: created.externalId,
          etag: created.etag,
          syncHash: hash,
          isDirty: false,
          lastSyncedAt: Date.now()
        });
        return created;
      }
    } catch (err) {
      console.warn(`CalendarSyncService: Outbound create error (${provider}):`, err);
      taskStore.updateCalendarEvent(event.id, {
        isDirty: true,
        syncHash: this.computeSyncHash(event)
      });
    }
    return null;
  }

  /**
   * Pushes an event update to the appropriate connected provider.
   * @param {object} event 
   */
  async pushEventUpdate(event) {
    if (!event || !event.externalId) return null;
    const provider = (event.provider || event.source || 'local');
    if (provider === 'local') return null;

    const adapter = this.adapters[provider];
    const hash = this.computeSyncHash(event);

    if (!adapter || !this.isProviderConnected(provider)) {
      taskStore.updateCalendarEvent(event.id, {
        isDirty: true,
        syncHash: hash
      });
      return null;
    }

    try {
      const updated = await adapter.updateEvent(event);
      if (updated) {
        taskStore.updateCalendarEvent(event.id, {
          etag: updated.etag,
          syncHash: hash,
          isDirty: false,
          lastSyncedAt: Date.now()
        });
        return updated;
      }
    } catch (err) {
      console.warn(`CalendarSyncService: Outbound update error (${provider}):`, err);
      taskStore.updateCalendarEvent(event.id, {
        isDirty: true,
        syncHash: hash
      });
    }
    return null;
  }

  /**
   * Pushes a new event create to an external provider directly from a task or event object.
   * @param {string} provider ('google' | 'microsoft')
   * @param {object} taskOrEvent
   * @returns {Promise<object|null>}
   */
  async createRemoteEvent(provider, taskOrEvent) {
    if (!provider || provider === 'local' || !taskOrEvent) return null;
    const adapter = this.adapters[provider];
    if (!adapter || !this.isProviderConnected(provider)) return null;

    const eventId = taskOrEvent.id || ('event-' + Date.now());
    if (this._creatingEventIds.has(eventId)) return null;
    this._creatingEventIds.add(eventId);

    const todayStr = (typeof taskStore.getTodayDateString === 'function')
      ? taskStore.getTodayDateString()
      : new Date().toISOString().split('T')[0];

    const startTime = taskOrEvent.startTime || taskOrEvent.fixedStartTime || '09:00';
    const durMin = taskOrEvent.plannedDuration || 30;
    let endTime = taskOrEvent.endTime;
    if (!endTime && startTime) {
      const parts = startTime.split(':');
      const startMin = (parseInt(parts[0], 10) || 0) * 60 + (parseInt(parts[1], 10) || 0);
      const endTotal = (startMin + durMin) % 1440;
      const endH = Math.floor(endTotal / 60);
      const endM = endTotal % 60;
      endTime = `${String(endH).padStart(2, '0')}:${String(endM).padStart(2, '0')}`;
    }
    if (!endTime) endTime = '10:00';

    const category = taskOrEvent.category || 'General';
    const resolvedColor = taskOrEvent.color || (typeof getCategoryColor === 'function' ? getCategoryColor(category) : '#3b82f6');

    const calEvent = {
      id: eventId,
      title: taskOrEvent.title || 'Event',
      date: taskOrEvent.date || todayStr,
      startTime: startTime,
      endTime: endTime,
      plannedDuration: durMin,
      category: category,
      emoji: taskOrEvent.emoji || '📌',
      color: resolvedColor,
      colorId: taskOrEvent.colorId || null,
      provider: provider,
      source: provider
    };

    try {
      const res = await adapter.createEvent(calEvent);
      if (res && (res.externalId || res.id)) {
        const extId = res.externalId || res.id;
        const hash = this.computeSyncHash(Object.assign({}, calEvent, { externalId: extId }));
        const patch = {
          externalId: extId,
          etag: res.etag || null,
          syncHash: hash,
          isDirty: false,
          lastSyncedAt: Date.now()
        };
        if (provider === 'google') patch.googleEventId = extId;
        if (provider === 'microsoft') patch.microsoftEventId = extId;

        if (typeof taskStore.updateCalendarEvent === 'function') {
          taskStore.updateCalendarEvent(eventId, patch);
        }
        if (typeof taskStore.getTasks === 'function' && typeof taskStore.updateTask === 'function') {
          const tasks = taskStore.getTasks();
          const match = tasks.find(t => t.id === eventId);
          if (match) {
            taskStore.updateTask(eventId, patch);
          }
        }
        return res;
      }
    } catch (err) {
      console.warn(`CalendarSyncService: Failed to create remote event on ${provider}:`, err);
    } finally {
      this._creatingEventIds.delete(eventId);
    }
    return null;
  }

  /**
   * Pushes an event delete to the appropriate connected provider.
   * STRICT SAFETY SHIELD: Remote deletions are ONLY permitted for events originally
   * created within Calentimer (origin === 'local' or createdInApp === true),
   * OR events residing inside Calentimer's dedicated secondary calendar.
   * External calendar meetings (origin === 'external' on non-Calentimer calendars) are strictly blocked from remote deletion.
   * @param {object|string} eventOrTask 
   * @param {string} [provider]
   * @returns {Promise<boolean>}
   */
  async pushEventDelete(eventOrTask, provider) {
    if (!eventOrTask) return false;

    // Dedicated Calentimer Mirror Calendar Exception
    const googleCalentimerId = (typeof taskStore !== 'undefined' && typeof taskStore.getGoogleCalentimerCalendarId === 'function')
      ? taskStore.getGoogleCalentimerCalendarId()
      : null;
    const msCalentimerId = (typeof taskStore !== 'undefined' && typeof taskStore.getMicrosoftCalentimerCalendarId === 'function')
      ? taskStore.getMicrosoftCalentimerCalendarId()
      : null;

    let isDedicatedCalentimerEvent = false;
    let targetExtCalId = null;

    if (typeof eventOrTask === 'object' && eventOrTask !== null) {
      if (eventOrTask.externalCalendarId) {
        targetExtCalId = eventOrTask.externalCalendarId;
      }
      if (eventOrTask.isCalentimerMirror === true) {
        isDedicatedCalentimerEvent = true;
      }
      if (googleCalentimerId && targetExtCalId === googleCalentimerId) {
        isDedicatedCalentimerEvent = true;
      }
      if (msCalentimerId && targetExtCalId === msCalentimerId) {
        isDedicatedCalentimerEvent = true;
      }
    }

    // Strict Provenance Verification (Safety Shield)
    let isCreatedInApp = false;
    let isExplicitlyExternal = false;

    if (typeof eventOrTask === 'object' && eventOrTask !== null) {
      if (eventOrTask.origin === 'external' || eventOrTask.createdInApp === false) {
        isExplicitlyExternal = true;
      }
      const id = eventOrTask.id ? String(eventOrTask.id) : '';
      if (id.indexOf('cal-gcal-') === 0 || id.indexOf('cal-ms-') === 0 || id.indexOf('cal-sync-') === 0) {
        isExplicitlyExternal = true;
      }
      if (eventOrTask.origin === 'local' || eventOrTask.createdInApp === true) {
        isCreatedInApp = true;
      } else if (id.indexOf('task-') === 0 || id.indexOf('cal-event-') === 0) {
        isCreatedInApp = true;
      }
    }

    if (!isDedicatedCalentimerEvent && (isExplicitlyExternal || !isCreatedInApp)) {
      console.warn('[SAFETY SHIELD] Blocked remote deletion of external calendar event:', typeof eventOrTask === 'object' ? eventOrTask.id : eventOrTask);
      return false; // Safely refuse: user's real Google / Microsoft calendar is never touched
    }

    let externalId = null;
    let prov = provider || null;

    if (typeof eventOrTask === 'string') {
      externalId = eventOrTask;
    } else {
      externalId = eventOrTask.externalId || (prov === 'google' ? eventOrTask.googleEventId : (prov === 'microsoft' ? eventOrTask.microsoftEventId : null)) || eventOrTask.googleEventId || eventOrTask.microsoftEventId;
      if (!prov) {
        prov = eventOrTask.provider || eventOrTask.source || (eventOrTask.googleEventId ? 'google' : (eventOrTask.microsoftEventId ? 'microsoft' : null));
      }
    }

    if (!externalId || !prov || prov === 'local') return false;
    const adapter = this.adapters[prov];
    if (!adapter || !this.isProviderConnected(prov)) return false;

    try {
      await adapter.deleteEvent(externalId, targetExtCalId);
      return true;
    } catch (err) {
      console.warn(`CalendarSyncService: Outbound delete error (${prov}):`, err);
      return false;
    }
  }

  // ==========================================
  // 4b. Cross-Device Cloud Profile Backup & Restore
  // ==========================================

  _restoreCloudProfile(incoming) {
    if (!incoming) return;
    try {
      this.cloudSyncEventId = incoming.id || incoming.externalId || this.cloudSyncEventId;
      const desc = incoming.description || (incoming.extendedProperties && incoming.extendedProperties.private && incoming.extendedProperties.private.calentimer_data) || '';
      if (!desc) return;
      let data = null;
      try {
        data = JSON.parse(desc);
      } catch (_) {
        return;
      }
      if (!data || !data._calentimer_cloud_profile) return;

      // 1. Categories
      if (Array.isArray(data.categories) && data.categories.length > 0) {
        for (let c = 0; c < data.categories.length; c++) {
          const cat = data.categories[c];
          if (cat && typeof taskStore.addCategory === 'function') {
            taskStore.addCategory(cat);
          }
        }
      }

      // 2. To-Dos
      if (Array.isArray(data.todos) && data.todos.length > 0) {
        const curTodos = (typeof taskStore.getTodoTasks === 'function') ? taskStore.getTodoTasks() : [];
        if (curTodos.length === 0) {
          if (typeof taskStore.saveTodoTasks === 'function') taskStore.saveTodoTasks(data.todos);
        } else {
          const existingIds = new Set(curTodos.map(t => t.id));
          const toAdd = data.todos.filter(t => !existingIds.has(t.id));
          if (toAdd.length > 0 && typeof taskStore.saveTodoTasks === 'function') {
            taskStore.saveTodoTasks(curTodos.concat(toAdd));
          }
        }
      }

      // 3. Local Calendar Events
      if (Array.isArray(data.events) && data.events.length > 0) {
        const curEvents = (typeof taskStore.getCalendarEvents === 'function') ? taskStore.getCalendarEvents() : [];
        const existingEventIds = new Set(curEvents.map(e => e.id));
        const newEvents = data.events.filter(e => e && e.id && !existingEventIds.has(e.id));
        if (newEvents.length > 0 && typeof taskStore.saveCalendarEvents === 'function') {
          taskStore.saveCalendarEvents(curEvents.concat(newEvents));
        }
      }

      // 4. Schedule Tasks
      if (Array.isArray(data.tasks) && data.tasks.length > 0) {
        const curTasks = (typeof taskStore.getTasks === 'function') ? taskStore.getTasks() : [];
        if (curTasks.length === 0 && typeof taskStore.saveTasks === 'function') {
          taskStore.saveTasks(data.tasks);
        }
      }

      // 5. Time Bank & Settings
      if (typeof data.timeBankSeconds === 'number' && typeof taskStore.saveTimeBankBalance === 'function') {
        const curBank = (typeof taskStore.getTimeBankBalance === 'function') ? taskStore.getTimeBankBalance() : 0;
        if (curBank === 0) {
          taskStore.saveTimeBankBalance(data.timeBankSeconds);
        }
      }
      if (data.hardStop && typeof taskStore.saveHardStop === 'function') {
        taskStore.saveHardStop(data.hardStop);
      }
      if (typeof data.hardStopEnabled === 'boolean' && typeof taskStore.setHardStopEnabled === 'function') {
        taskStore.setHardStopEnabled(data.hardStopEnabled);
      }
      if (typeof data.timespansEnabled === 'boolean' && typeof taskStore.setTimespansEnabled === 'function') {
        taskStore.setTimespansEnabled(data.timespansEnabled);
      }
    } catch (err) {
      console.warn('Failed restoring Calentimer cloud profile:', err);
    }
  }

  async saveCloudProfile(provider) {
    const prov = provider || (this.isProviderConnected('google') ? 'google' : (this.isProviderConnected('microsoft') ? 'microsoft' : null));
    if (!prov) return null;
    const adapter = this.adapters[prov];
    if (!adapter || !this.isProviderConnected(prov)) return null;

    const profile = {
      _calentimer_cloud_profile: true,
      version: 1,
      savedAt: Date.now(),
      categories: (typeof taskStore.getCategories === 'function') ? taskStore.getCategories() : [],
      todos: (typeof taskStore.getTodoTasks === 'function') ? taskStore.getTodoTasks() : [],
      events: ((typeof taskStore.getCalendarEvents === 'function') ? taskStore.getCalendarEvents() : []).filter(e => e && (e.origin === 'local' || e.createdInApp || e.source === 'local')),
      tasks: (typeof taskStore.getTasks === 'function') ? taskStore.getTasks() : [],
      timeBankSeconds: (typeof taskStore.getTimeBankBalance === 'function') ? taskStore.getTimeBankBalance() : 0,
      hardStop: (typeof taskStore.getHardStop === 'function') ? taskStore.getHardStop() : '18:00',
      hardStopEnabled: (typeof taskStore.getHardStopEnabled === 'function') ? taskStore.getHardStopEnabled() : true,
      timespansEnabled: (typeof taskStore.getTimespansEnabled === 'function') ? taskStore.getTimespansEnabled() : true
    };

    const payloadStr = JSON.stringify(profile);
    const syncEventData = {
      title: '[Calentimer Cloud Sync]',
      description: payloadStr,
      date: '2030-01-01',
      startTime: '00:00',
      endTime: '00:05',
      isLocked: false,
      origin: 'local',
      createdInApp: true,
      category: 'General',
      color: '#64748b'
    };

    try {
      if (this.cloudSyncEventId) {
        syncEventData.externalId = this.cloudSyncEventId;
        if (adapter && typeof adapter.updateEvent === 'function') {
          await adapter.updateEvent(syncEventData);
        }
      } else {
        if (adapter && typeof adapter.createEvent === 'function') {
          const created = await adapter.createEvent(syncEventData);
          if (created && (created.externalId || created.id)) {
            this.cloudSyncEventId = created.externalId || created.id;
          }
        }
      }
      return true;
    } catch (err) {
      console.warn(`saveCloudProfile error for ${prov}:`, err);
      return false;
    }
  }

  // ==========================================
  // 5. Lifecycle & Auto-Sync
  // ==========================================

  /**
   * Debounced outbound push dispatcher (batches drag releases and quick edits within 60ms).
   * @param {number} [delay]
   */
  triggerOutboundSyncDebounced(delay) {
    const ms = (typeof delay === 'number') ? delay : 60;
    if (this._outboundDebounceTimer) {
      clearTimeout(this._outboundDebounceTimer);
    }
    this._outboundDebounceTimer = setTimeout(() => {
      this._outboundDebounceTimer = null;
      this._pushAllDirtyEvents().catch(() => {});
    }, ms);
  }

  async _pushAllDirtyEvents() {
    if (this.isProviderConnected('google')) {
      await this._pushDirtyEvents('google');
    }
    if (this.isProviderConnected('microsoft')) {
      await this._pushDirtyEvents('microsoft');
    }
  }

  startAutoSync() {
    if (this.isAutoSyncRunning) return;
    this.isAutoSyncRunning = true;

    const runSyncSafe = () => {
      // 120Hz Gesture-Aware Shield: If user is actively dragging or adjusting dials, defer sync pass!
      if (typeof window !== 'undefined' && typeof window.isUserInteracting === 'function' && window.isUserInteracting()) {
        return;
      }
      const autoSync = (typeof taskStore.getAutoSyncEnabled === 'function') ? taskStore.getAutoSyncEnabled() : true;
      if (autoSync && (this.isProviderConnected('google') || this.isProviderConnected('microsoft'))) {
        this.syncAll().catch(() => {});
      }
    };

    const startPollingInterval = () => {
      if (this.autoSyncTimer) {
        clearInterval(this.autoSyncTimer);
        this.autoSyncTimer = null;
      }
      // Ultra-tight 2.8-second polling interval while app is in active foreground
      this.autoSyncTimer = setInterval(runSyncSafe, 2800);
    };

    const stopPollingInterval = () => {
      if (this.autoSyncTimer) {
        clearInterval(this.autoSyncTimer);
        this.autoSyncTimer = null;
      }
    };

    // 1. Visibility Change Listener (Sleep in background, instant 0ms sync on wake)
    if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
      this._visibilityHandler = () => {
        if (!document.visibilityState || document.visibilityState === 'visible') {
          runSyncSafe();
          startPollingInterval();
        } else {
          stopPollingInterval();
        }
      };
      document.addEventListener('visibilitychange', this._visibilityHandler);
    }

    // 2. Window Focus Listener (Instant 0ms sync when user returns from external calendar window)
    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      this._focusHandler = () => {
        runSyncSafe();
      };
      window.addEventListener('focus', this._focusHandler);
    }

    // 3. Start polling if document is currently visible (or environment lacks visibility API)
    if (typeof document === 'undefined' || !document.visibilityState || document.visibilityState === 'visible') {
      startPollingInterval();
    }
  }

  stopAutoSync() {
    this.isAutoSyncRunning = false;
    if (this._outboundDebounceTimer) {
      clearTimeout(this._outboundDebounceTimer);
      this._outboundDebounceTimer = null;
    }
    if (this.autoSyncTimer) {
      clearInterval(this.autoSyncTimer);
      this.autoSyncTimer = null;
    }
    if (this._visibilityHandler && typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this._visibilityHandler);
      this._visibilityHandler = null;
    }
    if (this._focusHandler && typeof window !== 'undefined') {
      window.removeEventListener('focus', this._focusHandler);
      this._focusHandler = null;
    }
  }
}

export const calendarSyncService = new CalendarSyncService();
export default calendarSyncService;
