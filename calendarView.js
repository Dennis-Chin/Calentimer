/**
 * calendarView.js
 * 
 * Multi-View Interactive Calendar (Month, Week, Day) for Calentimer.
 * Provides rich scheduling views, event inspection, duration calculation, and padlock toggle.
 * Strictly zero optional chaining and nullish coalescing operators for older mobile WebView compatibility.
 */

import { taskStore } from './taskStore.js';
import { mobileServices } from './mobileServices.js';
import { analytics } from './analyticsDb.js';
import { calendarSyncService } from './calendarSyncService.js';
import { getCategoryColor, classifyEvent } from './eventClassifier.js';

export class CalendarView {
  constructor() {
    this.activeView = 'day'; // 'day' | 'week' | 'month' (default is 'day')
    this.currentDate = new Date();
    this.selectedDate = new Date();
    this.selectedEvent = null;
    this.currentEmoji = '💼';
    this.currentCategory = 'Work';
    this.currentResolution = 15; // default 15 minutes for day view
    this.weekResolution = 15; // default 15 minutes for week view
    this.dayHourHeight = 56; // dynamic hour height for day view (px)
    this.weekHourHeight = 50; // dynamic hour height for week view (px)
    this.currentTimeTimer = null;
    this.refreshCategoryChips = null;
    this.isDraggingEvent = false; // Prevents page swipe when holding/dragging an event
    this.isPinching = false;
    this.pinchCooldownUntil = 0;
    this.isNavigating = false; // Prevents overlapping arrow transitions
    this._activeDragCancelHandler = null;
    this.activeResizeCard = null;
    this.activeResizeEvent = null;

    // DOM Elements (bound on init)
    this.elements = {};
  }

  init() {
    this.activeView = (typeof taskStore !== 'undefined' && typeof taskStore.getCalendarView === 'function')
      ? (taskStore.getCalendarView() || 'day')
      : 'day';

    // Cache DOM Elements
    this.elements = {
      backdrop: document.getElementById('fullCalendarModalBackdrop'),
      modal: document.getElementById('fullCalendarModal'),
      modalBody: document.querySelector('.full-calendar-body'),
      header: document.getElementById('fullCalendarHeader'),
      subToolbar: document.getElementById('calSubToolbar'),
      btnClose: document.getElementById('btnCloseFullCalendar'),
      btnAddEvent: document.getElementById('btnFullCalAddEvent'),
      viewSelect: document.getElementById('calViewSelect'),
      viewDropdownWrapper: document.getElementById('calViewDropdownWrapper'),
      resolutionSelect: document.getElementById('calResolutionSelect'),
      resolutionWrapper: document.getElementById('calResolutionWrapper'),
      btnPrev: document.getElementById('btnCalPrev'),
      btnNext: document.getElementById('btnCalNext'),
      btnToday: document.getElementById('btnCalToday'),
      rangeLabel: document.getElementById('calCurrentRangeLabel'),
      monthView: document.getElementById('calendarMonthView'),
      monthGrid: document.getElementById('monthGridCells'),
      weekView: document.getElementById('calendarWeekView'),
      weekHeader: document.getElementById('weekHeaderRow'),
      weekGridBody: document.getElementById('weekGridBody'),
      weekGridScroll: document.getElementById('weekGridScroll'),
      dayView: document.getElementById('calendarDayView'),
      dayTimelineScroll: document.getElementById('dayTimelineScroll'),
      dayTimelineBody: document.getElementById('dayTimelineBody'),
      bottomFade: document.querySelector('.calendar-bottom-fade'),

      // Event Inspector Modal
      eventModalBackdrop: document.getElementById('calendarEventModalBackdrop'),
      eventModal: document.getElementById('calendarEventModal'),
      btnCloseEventModal: document.getElementById('btnCloseCalEventModal'),
      btnCancelEvent: document.getElementById('btnCancelCalEvent'),
      formEvent: document.getElementById('formCalEvent'),
      calEventTypeSegment: document.getElementById('calEventTypeSegment'),
      calTypeSegmentWork: document.getElementById('calTypeSegmentWork'),
      calTypeSegmentBreak: document.getElementById('calTypeSegmentBreak'),
      calEventTitleLabel: document.getElementById('calEventTitleLabel'),
      eventIdInput: document.getElementById('calEventId'),
      eventTitleInput: document.getElementById('calEventTitle'),
      eventDateInput: document.getElementById('calEventDate'),
      eventDurationInput: document.getElementById('calEventDuration'),
      btnOpenDial: document.getElementById('btnCalEventOpenDial'),
      eventDurationChips: document.getElementById('calEventDurationChips'),
      eventStartTimeInput: document.getElementById('calEventStartTime'),
      eventEndTimeInput: document.getElementById('calEventEndTime'),
      btnStartTimeClock: document.getElementById('btnCalEventStartTimeClock'),
      btnEndTimeClock: document.getElementById('btnCalEventEndTimeClock'),
      eventStartTimeNative: document.getElementById('calEventStartTimeNative'),
      eventEndTimeNative: document.getElementById('calEventEndTimeNative'),
      eventHeaderEmoji: document.getElementById('calEventHeaderEmoji'),
      btnEventEmoji: document.getElementById('btnCalEventEmoji'),
      eventCategoryInput: document.getElementById('calEventCategory'),
      btnAddCategory: document.getElementById('btnAddCalCategory'),
      eventCategoryChips: document.getElementById('calEventCategoryChips'),
      eventTimeBankToggle: document.getElementById('calEventTimeBank'),
      piggyIcon: document.getElementById('calEventPiggyIcon'),
      eventToggleLock: document.getElementById('calEventToggleLock'),
      lockIcon: document.getElementById('calEventLockIcon'),
      btnSendToToday: document.getElementById('btnSendCalEventToToday'),
      btnDeleteEvent: document.getElementById('btnDeleteCalEvent'),
      btnSaveCalEvent: document.getElementById('btnSaveCalEvent'),

      // Outbound Sync Toggles
      calEventSyncGoogle: document.getElementById('calEventSyncGoogle'),
      calEventSyncMS: document.getElementById('calEventSyncMS'),
      calEventSyncGoogleLabel: document.getElementById('calEventSyncGoogleLabel'),
      calEventSyncMSLabel: document.getElementById('calEventSyncMSLabel'),

      // Phase 3: External Calendar Quick Toggles & Modals
      btnToggleGoogleCal: document.getElementById('btnToggleGoogleCal'),
      btnToggleMicrosoftCal: document.getElementById('btnToggleMicrosoftCal'),
      googleStatusDot: document.getElementById('googleStatusDot'),
      msStatusDot: document.getElementById('msStatusDot'),
      connectModalBackdrop: document.getElementById('calendarConnectModalBackdrop'),
      connectModal: document.getElementById('calendarConnectModal'),
      btnCloseConnectModal: document.getElementById('btnCloseCalendarConnectModal'),
      btnConnectGoogle: document.getElementById('btnConnectGoogle'),
      btnConnectMicrosoft: document.getElementById('btnConnectMicrosoft'),
      btnSkipConnect: document.getElementById('btnSkipConnect'),
      chkDontAskConnectStartup: document.getElementById('chkDontAskConnectStartup'),
      confirmSyncNowModalBackdrop: document.getElementById('confirmSyncNowModalBackdrop'),
      btnConfirmSyncNow: document.getElementById('btnConfirmSyncNow'),
      btnDismissSyncNow: document.getElementById('btnDismissSyncNow')
    };

    this._bindEvents();
    this._setupPullToDismiss();
    this._setupHorizontalSwipeNavigation();
    this._setupPinchZoom(this.elements.dayTimelineScroll, true);
    this._setupPinchZoom(this.elements.weekGridScroll, false);

    // Cancel any active or pending event drag if multi-touch gesture starts anywhere
    const cancelOnMultiTouch = (e) => {
      if (e.touches && e.touches.length >= 2) {
        this.isPinching = true;
        this.pinchCooldownUntil = Date.now() + 400;
        this._cancelActiveEventDrag();
      }
    };
    if (this.elements.modal) {
      this.elements.modal.addEventListener('touchstart', cancelOnMultiTouch, { passive: true });
      this.elements.modal.addEventListener('touchmove', cancelOnMultiTouch, { passive: true });
    }
    window.addEventListener('touchstart', cancelOnMultiTouch, { passive: true });
    window.addEventListener('touchmove', cancelOnMultiTouch, { passive: true });

    if (typeof taskStore !== 'undefined' && typeof taskStore.onChange === 'function') {
      taskStore.onChange(() => {
        if (this.isOpen()) {
          this.render();
        } else {
          this.updateProviderToggleUI();
        }
      });
    }

    this.updateProviderToggleUI();
  }

  isOpen() {
    return Boolean(this.elements && this.elements.backdrop && !this.elements.backdrop.classList.contains('hidden'));
  }

  _cancelActiveEventDrag() {
    if (typeof this._activeDragCancelHandler === 'function') {
      try {
        this._activeDragCancelHandler();
      } catch (_) {}
    }
    this._activeDragCancelHandler = null;
    this.isDraggingEvent = false;
  }

  _bindEvents() {
    const el = this.elements;

    if (el.btnClose) {
      el.btnClose.addEventListener('click', () => this.close());
    }

    if (el.backdrop) {
      el.backdrop.addEventListener('click', (e) => {
        if (e.target === el.backdrop) this.close();
      });
    }

    // View Dropdown Selection (Day, Week, Month)
    if (el.viewSelect) {
      el.viewSelect.value = this.activeView;
      const viewValEl = document.getElementById('calViewVal');
      if (viewValEl) viewValEl.textContent = this.activeView.charAt(0).toUpperCase() + this.activeView.slice(1);
      el.viewSelect.addEventListener('change', (e) => {
        this.switchView(e.target.value);
      });
    }

    // Time Interval Resolution Selector (Day & Week Views)
    if (el.resolutionSelect) {
      el.resolutionSelect.value = String(this.currentResolution);
      const resValEl = document.getElementById('calResolutionVal');
      if (resValEl) resValEl.textContent = `${this.currentResolution}m`;
      el.resolutionSelect.addEventListener('change', (e) => {
        const val = parseInt(e.target.value, 10) || 15;
        if (this.activeView === 'week') {
          this.weekResolution = val;
        } else {
          this.currentResolution = val;
        }
        const activeResEl = document.getElementById('calResolutionVal');
        if (activeResEl) activeResEl.textContent = `${val}m`;
        mobileServices.hapticTick();
        if (this.activeView === 'day') {
          this._renderDayView();
        } else if (this.activeView === 'week') {
          this._renderWeekView();
        }
      });
    }

    // Navigation Buttons (Smooth swipe transition on left/right arrow click)
    if (el.btnPrev) {
      el.btnPrev.addEventListener('click', () => this.slideNavigate(-1, el.btnPrev));
    }
    if (el.btnNext) {
      el.btnNext.addEventListener('click', () => this.slideNavigate(1, el.btnNext));
    }
    if (el.btnToday) {
      el.btnToday.addEventListener('click', () => this.goToToday());
    }
    if (el.btnAddEvent) {
      el.btnAddEvent.addEventListener('click', () => {
        const todayStr = this._formatDateISO(this.selectedDate || new Date());
        this.openEventInspector(null, todayStr);
      });
    }

    // Phase 3: External Calendar Quick Toggles
    if (el.btnToggleGoogleCal) {
      el.btnToggleGoogleCal.addEventListener('click', () => {
        const isConn = (typeof taskStore.getGoogleCalendarConnected === 'function')
          ? taskStore.getGoogleCalendarConnected()
          : false;
        if (!isConn) {
          this.openConnectModal();
        } else {
          const currentVis = (typeof taskStore.getGoogleCalendarVisible === 'function')
            ? taskStore.getGoogleCalendarVisible()
            : true;
          taskStore.setGoogleCalendarVisible(!currentVis);
          mobileServices.hapticTap();
          this.render();
          this._showToast(!currentVis ? 'Google Calendar shown' : 'Google Calendar hidden');
        }
      });
    }

    if (el.btnToggleMicrosoftCal) {
      el.btnToggleMicrosoftCal.addEventListener('click', () => {
        const isConn = (typeof taskStore.getMicrosoftCalendarConnected === 'function')
          ? taskStore.getMicrosoftCalendarConnected()
          : false;
        if (!isConn) {
          this.openConnectModal();
        } else {
          const currentVis = (typeof taskStore.getMicrosoftCalendarVisible === 'function')
            ? taskStore.getMicrosoftCalendarVisible()
            : true;
          taskStore.setMicrosoftCalendarVisible(!currentVis);
          mobileServices.hapticTap();
          this.render();
          this._showToast(!currentVis ? 'Microsoft Calendar shown' : 'Microsoft Calendar hidden');
        }
      });
    }

    // Connect & Sync Modals
    if (el.btnCloseConnectModal) {
      el.btnCloseConnectModal.addEventListener('click', () => this.closeConnectModal());
    }
    if (el.btnSkipConnect) {
      el.btnSkipConnect.addEventListener('click', () => this.closeConnectModal());
    }
    if (el.connectModalBackdrop) {
      el.connectModalBackdrop.addEventListener('click', (e) => {
        if (e.target === el.connectModalBackdrop) this.closeConnectModal();
      });
    }
    if (el.chkDontAskConnectStartup) {
      el.chkDontAskConnectStartup.addEventListener('change', () => {
        if (typeof taskStore.setSkipConnectPrompt === 'function') {
          taskStore.setSkipConnectPrompt(el.chkDontAskConnectStartup.checked);
        }
      });
    }
    if (el.btnDismissSyncNow) {
      el.btnDismissSyncNow.addEventListener('click', () => this.closeSyncConfirmModal());
    }
    if (el.confirmSyncNowModalBackdrop) {
      el.confirmSyncNowModalBackdrop.addEventListener('click', (e) => {
        if (e.target === el.confirmSyncNowModalBackdrop) this.closeSyncConfirmModal();
      });
    }

    // Event Inspector Handlers
    if (el.calTypeSegmentWork) {
      el.calTypeSegmentWork.addEventListener('click', () => {
        this.setCalEventType('work');
        mobileServices.hapticTap();
      });
    }
    if (el.calTypeSegmentBreak) {
      el.calTypeSegmentBreak.addEventListener('click', () => {
        this.setCalEventType('break');
        mobileServices.hapticTap();
      });
    }

    if (el.btnCloseEventModal) {
      el.btnCloseEventModal.addEventListener('click', () => this.closeEventInspector());
    }
    if (el.btnCancelEvent) {
      el.btnCancelEvent.addEventListener('click', () => this.closeEventInspector());
    }
    if (el.eventModalBackdrop) {
      el.eventModalBackdrop.addEventListener('click', (e) => {
        if (e.target === el.eventModalBackdrop) this.closeEventInspector();
      });
    }

    if (el.btnEventEmoji) {
      el.btnEventEmoji.addEventListener('click', (e) => {
        e.preventDefault();
        this._manualEmojiSelected = true;
        if (typeof window !== 'undefined' && typeof window.openEmojiPicker === 'function') {
          window.openEmojiPicker('CAL_EVENT');
        }
      });
    }

    // Live Title Auto-Classification as user types (debounced 150ms)
    if (el.eventTitleInput) {
      let titleDebounce = null;
      el.eventTitleInput.addEventListener('input', () => {
        if (this._manualCategorySelected && this._manualEmojiSelected) return;
        if (titleDebounce) clearTimeout(titleDebounce);
        titleDebounce = setTimeout(() => {
          const val = el.eventTitleInput ? el.eventTitleInput.value.trim() : '';
          if (val && val.length >= 2) {
            const classified = classifyEvent(val);
            if (classified) {
              if (!this._manualEmojiSelected && classified.emoji) {
                this.setEventEmoji(classified.emoji);
              }
              if (!this._manualCategorySelected && classified.category) {
                this.currentCategory = classified.category;
                if (el.eventCategoryInput) el.eventCategoryInput.value = classified.category;
                if (this.refreshCategoryChips) this.refreshCategoryChips();
              }
            }
          }
        }, 150);
      });
    }

    // Outbound Sync Toggles Click Listeners
    if (el.calEventSyncGoogle) {
      el.calEventSyncGoogle.addEventListener('change', () => {
        if (el.calEventSyncGoogleLabel) {
          el.calEventSyncGoogleLabel.classList.toggle('is-checked', Boolean(el.calEventSyncGoogle.checked));
        }
        if (typeof taskStore.setOutboundSyncPreference === 'function') {
          taskStore.setOutboundSyncPreference('google', el.calEventSyncGoogle.checked);
        }
      });
    }

    if (el.calEventSyncMS) {
      el.calEventSyncMS.addEventListener('change', () => {
        if (el.calEventSyncMSLabel) {
          el.calEventSyncMSLabel.classList.toggle('is-checked', Boolean(el.calEventSyncMS.checked));
        }
        if (typeof taskStore.setOutboundSyncPreference === 'function') {
          taskStore.setOutboundSyncPreference('microsoft', el.calEventSyncMS.checked);
        }
      });
    }

    // Duration Dial Trigger
    if (el.btnOpenDial && el.eventDurationInput) {
      el.btnOpenDial.addEventListener('click', () => {
        if (typeof window !== 'undefined' && typeof window.openDurationDialPicker === 'function') {
          window.openDurationDialPicker(el.eventDurationInput, 'cal_event');
        }
      });
    }

    // Duration input change listener -> update end time
    if (el.eventDurationInput) {
      el.eventDurationInput.addEventListener('input', () => {
        this.updateEndTimeFromDuration();
        this._highlightActiveDurationChip();
      });
      el.eventDurationInput.addEventListener('change', () => {
        this.updateEndTimeFromDuration();
        this._highlightActiveDurationChip();
      });
    }

    // Auto-update end time calculation when Start time changes (End Time = Start Time + Duration)
    if (el.eventStartTimeInput) {
      el.eventStartTimeInput.addEventListener('input', () => {
        if (el.eventStartTimeInput.value.length === 5) {
          this.updateEndTimeFromDuration();
        }
      });
      el.eventStartTimeInput.addEventListener('change', () => {
        if (el.eventStartTimeInput.value.length === 5) {
          this.updateEndTimeFromDuration();
        }
      });
    }

    if (el.eventEndTimeInput) {
      el.eventEndTimeInput.addEventListener('input', () => {
        if (el.eventEndTimeInput.value.length === 5) {
          this._updateDurationFromTimeSpan();
        }
      });
      el.eventEndTimeInput.addEventListener('change', () => {
        this._updateDurationFromTimeSpan();
      });
    }

    // Time Clock Pickers
    this._bindClockPicker(el.btnStartTimeClock, el.eventStartTimeNative, el.eventStartTimeInput, () => {
      this.onStartTimeSelected();
    });
    this._bindClockPicker(el.btnEndTimeClock, el.eventEndTimeNative, el.eventEndTimeInput, () => {
      this.onEndTimeSelected();
    });

    // Time Bank toggle icon update
    if (el.eventTimeBankToggle && el.piggyIcon) {
      el.eventTimeBankToggle.addEventListener('change', () => {
        el.piggyIcon.classList.toggle('active', Boolean(el.eventTimeBankToggle.checked));
      });
    }

    // Padlock toggle icon update
    if (el.eventToggleLock && el.lockIcon) {
      el.eventToggleLock.addEventListener('change', () => {
        el.lockIcon.classList.toggle('active', Boolean(el.eventToggleLock.checked));
      });
    }

    // Save Event Form Submit
    if (el.formEvent) {
      el.formEvent.addEventListener('submit', (e) => {
        e.preventDefault();
        this._saveEventFromForm();
      });
    }

    // Delete Event Button
    if (el.btnDeleteEvent) {
      el.btnDeleteEvent.addEventListener('click', () => {
        if (this.selectedEvent && this.selectedEvent.id) {
          const evToDelete = this.selectedEvent;
          const isCreatedInApp = Boolean(
            (evToDelete.origin === 'local' || evToDelete.createdInApp === true) ||
            (evToDelete.id && (evToDelete.id.indexOf('cal-event-') === 0 || evToDelete.id.indexOf('task-') === 0))
          );
          const isExplicitlyExternal = Boolean(
            evToDelete.origin === 'external' ||
            evToDelete.createdInApp === false ||
            (evToDelete.id && (evToDelete.id.indexOf('cal-gcal-') === 0 || evToDelete.id.indexOf('cal-ms-') === 0 || evToDelete.id.indexOf('cal-sync-') === 0))
          );

          taskStore.deleteCalendarEvent(evToDelete.id);
          if (evToDelete.externalId && typeof taskStore.addDeletedId === 'function') {
            taskStore.addDeletedId(evToDelete.externalId);
          }

          if (isCreatedInApp && !isExplicitlyExternal) {
            if (typeof calendarSyncService !== 'undefined' && calendarSyncService && typeof calendarSyncService.pushEventDelete === 'function') {
              calendarSyncService.pushEventDelete(evToDelete);
            }
            this._showToast('🗑️ Event deleted');
          } else {
            // External imported event: strictly protected from remote deletion!
            this._showToast('🗑️ Event removed from Calentimer (external calendar unchanged)');
          }

          mobileServices.hapticTap();
          this.closeEventInspector();
          this.render();
        }
      });
    }

    // Send to Today's Schedule Button
    if (el.btnSendToToday) {
      el.btnSendToToday.addEventListener('click', () => {
        this._sendCurrentEventToTodaySchedule();
      });
    }
  }

  // ==========================================
  // Pull Down with Resistance to Minimise Calendar Tab to Timer
  // Matches exact resistance drag physics used in Today's Schedule bottom drawer
  // ==========================================

  _setupPullToDismiss() {
    const modal = this.elements.modal;
    const backdrop = this.elements.backdrop;
    if (!modal || !backdrop) return;

    let touchStartY = 0;
    let touchStartX = 0;
    let touchStartTime = 0;
    let isPullingDown = false;
    let didPullDown = false;

    const onTouchStart = (e) => {
      if (this.isDraggingEvent || this.activeResizeCard) return;
      // Do not block header controls (Day dropdown, Today/arrow buttons, Close X button).
      // Only block dedicated task drag handles or bottom action buttons.
      if (e.target.closest('.event-resize-handle, .cal-event-lock-btn, .time-clock-addon-btn, #btnFullCalAddEvent, #calResolutionSelect')) return;
      if (!e.touches || e.touches.length !== 1) return;

      const activeScroll = (this.activeView === 'day' && this.elements.dayTimelineScroll)
        ? this.elements.dayTimelineScroll
        : ((this.activeView === 'week' && this.elements.weekGridScroll) ? this.elements.weekGridScroll : null);

      const isAtTop = !activeScroll || activeScroll.scrollTop <= 0;
      const isHeaderTouch = Boolean(e.target.closest('.full-calendar-header, .cal-drag-handle-bar, .cal-sub-toolbar, #calSubToolbar, #calViewDropdownWrapper, #calNavButtonsGroup'));

      if (isAtTop || isHeaderTouch) {
        touchStartY = e.touches[0].clientY;
        touchStartX = e.touches[0].clientX;
        touchStartTime = Date.now();
        isPullingDown = false;
        didPullDown = false;
      }
    };

    const onTouchMove = (e) => {
      if (this.isDraggingEvent) {
        if (isPullingDown) {
          isPullingDown = false;
          modal.classList.remove('will-minimise');
          modal.style.removeProperty('transform');
          modal.style.removeProperty('transition');
        }
        return;
      }
      if (!touchStartY || !e.touches || e.touches.length !== 1) return;
      const currentY = e.touches[0].clientY;
      const currentX = e.touches[0].clientX;
      const deltaY = currentY - touchStartY;
      const deltaX = currentX - touchStartX;

      if (deltaY > 10 && deltaY > Math.abs(deltaX) * 1.3) {
        const activeScroll = (this.activeView === 'day' && this.elements.dayTimelineScroll)
          ? this.elements.dayTimelineScroll
          : ((this.activeView === 'week' && this.elements.weekGridScroll) ? this.elements.weekGridScroll : null);

        const isAtTop = !activeScroll || activeScroll.scrollTop <= 0;
        const isHeaderTouch = Boolean(e.target.closest('.full-calendar-header, .cal-drag-handle-bar, .cal-sub-toolbar, #calSubToolbar, #calViewDropdownWrapper, #calNavButtonsGroup'));

        if (isAtTop || isHeaderTouch) {
          isPullingDown = true;
          didPullDown = true;
          if (e.cancelable) e.preventDefault();
          // Apply firm 0.28 resistance damping for deliberate pull feeling
          const rubberbandY = Math.min(deltaY * 0.28, 140);
          modal.style.transition = 'none';
          modal.style.transform = `translate3d(0, ${rubberbandY}px, 0)`;

          // Deliberate pull threshold: when pulled down >= 110px, X turns into downward arrow
          // If swiped back up, it turns back into X
          if (deltaY >= 110) {
            modal.classList.add('will-minimise');
          } else {
            modal.classList.remove('will-minimise');
          }
        }
      } else if (deltaY <= 0 && isPullingDown) {
        modal.classList.remove('will-minimise');
      }
    };

    const onTouchEnd = (e) => {
      if (didPullDown) {
        const suppressClick = (clickEv) => {
          clickEv.stopPropagation();
          clickEv.preventDefault();
          window.removeEventListener('click', suppressClick, true);
        };
        window.addEventListener('click', suppressClick, true);
        setTimeout(() => {
          window.removeEventListener('click', suppressClick, true);
        }, 350);
      }

      if (!isPullingDown) {
        touchStartY = 0;
        touchStartX = 0;
        didPullDown = false;
        modal.classList.remove('will-minimise');
        return;
      }
      isPullingDown = false;
      const willMinimise = modal.classList.contains('will-minimise');
      modal.classList.remove('will-minimise');

      touchStartY = 0;
      touchStartX = 0;

      if (willMinimise) {
        // Pure slide down animation (identical to Today's Schedule swipe down - no fading)
        modal.style.transition = 'transform 0.28s cubic-bezier(0.16, 1, 0.3, 1)';
        modal.style.transform = 'translate3d(0, 100vh, 0)';
        mobileServices.hapticBuzz();
        setTimeout(() => {
          modal.style.removeProperty('transform');
          modal.style.removeProperty('transition');
          this.close();
        }, 270);
      } else {
        // Did not pull far enough, or swiped back up before letting go: smoothly springs back up
        modal.style.transition = 'transform 0.25s cubic-bezier(0.16, 1, 0.3, 1)';
        modal.style.transform = 'translate3d(0, 0, 0)';
        setTimeout(() => {
          modal.style.removeProperty('transform');
          modal.style.removeProperty('transition');
        }, 250);
      }
    };

    modal.addEventListener('touchstart', onTouchStart, { passive: true });
    modal.addEventListener('touchmove', onTouchMove, { passive: false });
    modal.addEventListener('touchend', onTouchEnd, { passive: true });
    modal.addEventListener('touchcancel', onTouchEnd, { passive: true });
  }

  // ==========================================
  // Progressive Smooth Horizontal Swipe Navigation (Continuous Page-to-Page Transition)
  // ==========================================

  _setupHorizontalSwipeNavigation() {
    const modalBody = document.querySelector('.full-calendar-body');
    if (!modalBody) return;

    let touchStartX = 0;
    let touchStartY = 0;
    let initialScrollTop = 0;
    let swipeStartTime = 0;
    let isSwipingHorizontal = false;
    let isScrollingVertical = false;
    let activeContainer = null;
    let adjacentSlide = null;
    let currentSlideDirection = 0; // -1 for prev, 1 for next

    const getActiveContainer = () => {
      if (this.activeView === 'day') return this.elements.dayView;
      if (this.activeView === 'week') return this.elements.weekView;
      return this.elements.monthView;
    };

    modalBody.addEventListener('touchstart', (e) => {
      if (this.isDraggingEvent || this.activeResizeCard) return;
      if (e.touches && e.touches.length === 1) {
        // Allow touches on event cards so swiping over tasks changes days; ignore only clickable buttons/inputs
        if (e.target.closest('button, select, input, .cal-event-lock-btn, .time-clock-addon-btn, .event-resize-handle')) {
          return;
        }
        touchStartX = e.touches[0].clientX;
        touchStartY = e.touches[0].clientY;
        swipeStartTime = Date.now();
        isSwipingHorizontal = false;
        isScrollingVertical = false;
        activeContainer = getActiveContainer();
        const currentScrollEl = activeContainer ? activeContainer.querySelector('.day-timeline-scroll, .week-grid-scroll') : null;
        initialScrollTop = currentScrollEl ? currentScrollEl.scrollTop : 0;
        currentSlideDirection = 0;
        if (adjacentSlide && adjacentSlide.parentNode) {
          adjacentSlide.parentNode.removeChild(adjacentSlide);
          adjacentSlide = null;
        }
      }
    }, { passive: true });

    modalBody.addEventListener('touchmove', (e) => {
      if (this.isDraggingEvent || this.activeResizeCard) {
        if (isSwipingHorizontal && activeContainer) {
          isSwipingHorizontal = false;
          activeContainer.style.removeProperty('transform');
          if (adjacentSlide && adjacentSlide.parentNode) {
            adjacentSlide.parentNode.removeChild(adjacentSlide);
            adjacentSlide = null;
          }
        }
        return;
      }
      if (isScrollingVertical) return;
      if (!touchStartX || !touchStartY || !activeContainer) return;

      const currentScrollEl = activeContainer.querySelector('.day-timeline-scroll, .week-grid-scroll');
      if (currentScrollEl && Math.abs(currentScrollEl.scrollTop - initialScrollTop) > 1) {
        isScrollingVertical = true;
        return;
      }

      if (e.touches && e.touches.length > 1) {
        if (isSwipingHorizontal) {
          isSwipingHorizontal = false;
          activeContainer.style.removeProperty('transform');
          if (adjacentSlide && adjacentSlide.parentNode) {
            adjacentSlide.parentNode.removeChild(adjacentSlide);
            adjacentSlide = null;
          }
        }
        return;
      }

      const currentX = e.touches[0].clientX;
      const currentY = e.touches[0].clientY;
      const diffX = currentX - touchStartX;
      const diffY = currentY - touchStartY;

      if (!isSwipingHorizontal) {
        // If gesture moved predominantly vertically first, lock into vertical scrolling until touch ends
        if (Math.abs(diffY) > 6 && Math.abs(diffY) >= Math.abs(diffX) * 0.85) {
          isScrollingVertical = true;
          return;
        }
        if (Math.abs(diffX) > 14 && Math.abs(diffX) > Math.abs(diffY) * 1.5) {
          isSwipingHorizontal = true;
        }
      }

      if (isSwipingHorizontal) {
        const bodyWidth = modalBody.clientWidth || 360;
        const targetDirection = diffX < 0 ? 1 : -1; // 1 = next, -1 = prev

        // Prepare adjacent preview slide if direction changed or not yet created
        if (!adjacentSlide || currentSlideDirection !== targetDirection) {
          if (adjacentSlide && adjacentSlide.parentNode) {
            adjacentSlide.parentNode.removeChild(adjacentSlide);
          }
          currentSlideDirection = targetDirection;

          const targetDate = new Date(this.currentDate);
          if (this.activeView === 'day') {
            targetDate.setDate(targetDate.getDate() + (targetDirection > 0 ? 1 : -1));
          } else if (this.activeView === 'week') {
            targetDate.setDate(targetDate.getDate() + ((targetDirection > 0 ? 1 : -1) * 7));
          } else if (this.activeView === 'month') {
            targetDate.setMonth(targetDate.getMonth() + (targetDirection > 0 ? 1 : -1));
          }

          const currentScrollTop = currentScrollEl ? currentScrollEl.scrollTop : 0;

          adjacentSlide = this._buildAdjacentPreviewSlide(targetDate, targetDirection, currentScrollTop);
          modalBody.appendChild(adjacentSlide);

          // Crucial: apply scrollTop AFTER appending to document so it never jumps to 00:00!
          const adjScroll = adjacentSlide.querySelector('.day-timeline-scroll, .week-grid-scroll');
          if (adjScroll) {
            adjScroll.scrollTop = currentScrollTop;
          }
        }

        activeContainer.style.transition = 'none';
        activeContainer.style.transform = `translate3d(${diffX}px, 0, 0)`;

        if (adjacentSlide) {
          adjacentSlide.style.transition = 'none';
          const adjacentX = targetDirection > 0 ? (bodyWidth + diffX) : (-bodyWidth + diffX);
          adjacentSlide.style.transform = `translate3d(${adjacentX}px, 0, 0)`;
        }
      }
    }, { passive: true });

    const onTouchEnd = (e) => {
      isScrollingVertical = false;
      if (!isSwipingHorizontal || !activeContainer) {
        touchStartX = 0;
        touchStartY = 0;
        if (adjacentSlide && adjacentSlide.parentNode) {
          adjacentSlide.parentNode.removeChild(adjacentSlide);
          adjacentSlide = null;
        }
        return;
      }
      isSwipingHorizontal = false;

      const touch = (e.changedTouches && e.changedTouches[0]) ? e.changedTouches[0] : null;
      const currentX = touch ? touch.clientX : touchStartX;
      const diffX = currentX - touchStartX;
      const elapsed = Math.max(1, Date.now() - swipeStartTime);
      const velocity = Math.abs(diffX) / elapsed;
      const bodyWidth = modalBody.clientWidth || 360;

      touchStartX = 0;
      touchStartY = 0;

      if (Math.abs(diffX) > 65 || (Math.abs(diffX) > 24 && velocity > 0.35)) {
        const isNext = diffX < 0;
        const exitX = isNext ? -bodyWidth : bodyWidth;
        const currentScrollEl = activeContainer.querySelector('.day-timeline-scroll, .week-grid-scroll');
        const savedScrollTop = currentScrollEl ? currentScrollEl.scrollTop : 0;

        activeContainer.style.transition = 'transform 0.32s cubic-bezier(0.16, 1, 0.3, 1)';
        activeContainer.style.transform = `translate3d(${exitX}px, 0, 0)`;

        if (adjacentSlide) {
          adjacentSlide.style.transition = 'transform 0.32s cubic-bezier(0.16, 1, 0.3, 1)';
          adjacentSlide.style.transform = 'translate3d(0, 0, 0)';
        }

        setTimeout(() => {
          this.navigate(isNext ? 1 : -1, savedScrollTop);
          if (adjacentSlide && adjacentSlide.parentNode) {
            adjacentSlide.parentNode.removeChild(adjacentSlide);
            adjacentSlide = null;
          }
          activeContainer = getActiveContainer();
          if (activeContainer) {
            activeContainer.style.removeProperty('transform');
            activeContainer.style.removeProperty('transition');
          }
        }, 320);
      } else {
        activeContainer.style.transition = 'transform 0.25s cubic-bezier(0.16, 1, 0.3, 1)';
        activeContainer.style.transform = 'translate3d(0, 0, 0)';
        if (adjacentSlide) {
          adjacentSlide.style.transition = 'transform 0.25s cubic-bezier(0.16, 1, 0.3, 1)';
          const returnX = currentSlideDirection > 0 ? bodyWidth : -bodyWidth;
          adjacentSlide.style.transform = `translate3d(${returnX}px, 0, 0)`;
          setTimeout(() => {
            if (adjacentSlide && adjacentSlide.parentNode) {
              adjacentSlide.parentNode.removeChild(adjacentSlide);
              adjacentSlide = null;
            }
          }, 250);
        }
      }
    };

    modalBody.addEventListener('touchend', onTouchEnd, { passive: true });
    modalBody.addEventListener('touchcancel', onTouchEnd, { passive: true });
  }

  _buildAdjacentPreviewSlide(targetDate, targetDirection, currentScrollTop) {
    const slide = document.createElement('div');
    slide.className = 'cal-adjacent-preview-slide';
    slide.style.position = 'absolute';
    slide.style.top = '0';
    slide.style.left = '0';
    slide.style.width = '100%';
    slide.style.height = '100%';
    slide.style.pointerEvents = 'none';
    slide.style.zIndex = '12';
    slide.style.background = 'var(--bg-surface)';

    const allEvents = this._getVisibleCalendarEvents();

    if (this.activeView === 'day') {
      const dayContainer = document.createElement('div');
      dayContainer.className = 'calendar-view-container';
      const scrollEl = document.createElement('div');
      scrollEl.className = 'day-timeline-scroll';
      const body = document.createElement('div');
      body.className = 'day-timeline-body';
      scrollEl.appendChild(body);
      dayContainer.appendChild(scrollEl);
      slide.appendChild(dayContainer);

      const targetStr = this._formatDateISO(targetDate);
      const eventsForDay = allEvents.filter(e => e.date === targetStr);

      const isCustom = taskStore.getCalendarCustomRangeEnabled();
      let startHour = 0;
      let endHour = 24;
      if (isCustom) {
        const startStr = taskStore.getCalendarStartTime() || '08:00';
        const endStr = taskStore.getCalendarEndTime() || '22:00';
        startHour = Math.max(0, Math.min(23, Math.floor(this._parseTimeToMinutes(startStr) / 60)));
        endHour = Math.max(startHour + 1, Math.min(24, Math.ceil(this._parseTimeToMinutes(endStr) / 60)));
      }
      const hourHeight = this.dayHourHeight || 56;
      scrollEl.style.setProperty('--cal-day-hour-height', `${hourHeight}px`);

      const resolution = this.currentResolution || 15;
      for (let h = startHour; h < endHour; h++) {
        const slot = document.createElement('div');
        slot.className = 'day-timeline-hour-slot';
        slot.setAttribute('data-hour', String(h));
        const timeLabel = document.createElement('div');
        timeLabel.className = 'day-time-label';
        timeLabel.textContent = `${String(h).padStart(2, '0')}:00`;
        slot.appendChild(timeLabel);
        const slotContent = document.createElement('div');
        slotContent.className = 'day-slot-content';

        // Render subtle dashed sub-interval lines inside slotContent so they match bold lines exactly
        if (resolution < 60) {
          const stepCount = 60 / resolution;
          for (let s = 1; s < stepCount; s++) {
            const subLine = document.createElement('div');
            subLine.className = 'day-sub-interval-line';
            const pct = (s / stepCount) * 100;
            subLine.style.top = `${pct}%`;
            slotContent.appendChild(subLine);
          }
        }

        slot.appendChild(slotContent);
        body.appendChild(slot);
      }

      // Render final end-time boundary line and label (00:00 or custom end time) on slide
      const endSlot = document.createElement('div');
      endSlot.className = 'day-timeline-hour-slot day-timeline-end-slot';
      endSlot.style.height = '0px';
      endSlot.style.minHeight = '0px';

      const endTimeLabel = document.createElement('div');
      endTimeLabel.className = 'day-time-label day-end-time-label';
      const endHDisplay = String(endHour % 24).padStart(2, '0');
      endTimeLabel.textContent = `${endHDisplay}:00`;
      endSlot.appendChild(endTimeLabel);

      const endLine = document.createElement('div');
      endLine.className = 'day-slot-content day-end-boundary-line';
      endLine.style.height = '0px';
      endSlot.appendChild(endLine);

      body.appendChild(endSlot);

      // Render Dynamic Light-Blue Current Time Line on slide if target day is today
      const todayStr = this._formatDateISO(new Date());
      if (targetStr === todayStr) {
        this._renderCurrentTimeLine(body);
      }

      const isTargetToday = targetStr === todayStr;

      const visibleEvents = eventsForDay.filter(e => {
        const s = this._parseTimeToMinutes(e.startTime);
        const en = this._parseTimeToMinutes(e.endTime);
        return !(s >= endHour * 60 || en <= startHour * 60);
      }).sort((a, b) => {
        return this._parseTimeToMinutes(a.startTime) - this._parseTimeToMinutes(b.startTime);
      });

      for (let j = 0; j < visibleEvents.length; j++) {
        const ev = visibleEvents[j];
        const startMin = this._parseTimeToMinutes(ev.startTime);
        const endMin = this._parseTimeToMinutes(ev.endTime);
        let dur = ev.plannedDuration;
        if (!dur || dur <= 0) {
          dur = endMin - startMin;
          if (dur <= 0) dur = 60;
        }
        const topPx = 14 + ((Math.max(startHour * 60, startMin) - (startHour * 60)) / 60) * hourHeight;
        const heightPx = Math.max(26, (dur / 60) * hourHeight);

        let isLaterOverlap = false;
        for (let k = 0; k < j; k++) {
          const other = visibleEvents[k];
          const otherStart = this._parseTimeToMinutes(other.startTime);
          const otherEnd = this._parseTimeToMinutes(other.endTime);
          if (startMin < otherEnd && endMin > otherStart) {
            isLaterOverlap = true;
            const earlierCard = body.querySelector(`[data-event-id="${other.id}"]`);
            if (earlierCard) {
              earlierCard.classList.add('is-overlapping-earlier');
              this._applyEventCardLayout(earlierCard, parseInt(earlierCard.style.height, 10) || 40);
            }
            break;
          }
        }

        let isDone = Boolean(ev.isCompleted);
        let isCurrent = false;
        if (isTargetToday) {
          const now = new Date();
          const currentMinutes = (now.getHours() * 60) + now.getMinutes();
          let evEnd = endMin;
          if (evEnd <= startMin) evEnd += 1440;
          if (currentMinutes >= evEnd) {
            isDone = true;
          } else if (currentMinutes >= startMin && currentMinutes < evEnd) {
            isCurrent = true;
          }
        }

        const card = document.createElement('div');
        card.className = `day-event-card ${ev.isLocked ? 'is-locked' : ''} ${isLaterOverlap ? 'is-overlapping-later' : ''} ${isDone ? 'is-event-completed' : ''} ${isCurrent ? 'is-event-current' : ''}`;
        card.style.top = `${topPx}px`;
        card.style.borderLeftColor = ev.color || this._getCategoryColor(ev.category);
        card.setAttribute('data-event-id', ev.id);
        if (isDone) {
          card.style.background = 'rgba(16, 185, 129, 0.22)';
        } else if (isCurrent) {
          card.style.background = 'rgba(0, 240, 255, 0.2)';
        }
        this._applyEventCardLayout(card, heightPx);
        const catBadgeStyle = ev.color ? `background:${this._hexToRgba(ev.color, 0.2)};color:${ev.color};border:1px solid ${this._hexToRgba(ev.color, 0.45)};` : '';
        card.innerHTML = `
          <span class="day-event-emoji">${ev.emoji || '📅'}</span>
          <div class="day-event-content">
            <div class="day-event-title-line">
              <span class="day-event-title">${this._escapeHtml(ev.title)}</span>
            </div>
            <div class="day-event-meta-line">
              <span class="event-time-range">${ev.startTime} - ${ev.endTime}</span>
              <span class="event-duration-pill">(${dur}m)</span>
              <span class="event-cat-pill" style="${catBadgeStyle}">${this._escapeHtml(ev.category || 'Work')}</span>
            </div>
          </div>
          <div class="cal-event-lock-btn ${ev.isLocked ? 'is-locked' : ''}" style="pointer-events:none;">
            ${ev.isLocked ? `
              <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
                <path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z"/>
              </svg>
            ` : `
              <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 17c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm6-9h-1V6c0-2.76-2.24-5-5-5-2.28 0-4.27 1.54-4.84 3.75-.14.54.18 1.08.72 1.22.53.14 1.08-.18 1.22-.72C9.46 3.86 10.63 3 12 3c1.66 0 3 1.34 3 3v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm0 12H6V10h12v10z"/>
              </svg>
            `}
          </div>
        `;
        body.appendChild(card);
      }
    } else if (this.activeView === 'week') {
      const weekContainer = document.createElement('div');
      weekContainer.className = 'calendar-view-container';

      const headerRow = document.createElement('div');
      headerRow.className = 'week-header-row';
      const corner = document.createElement('div');
      headerRow.appendChild(corner);

      const monday = this._getMondayOfWeek(targetDate);
      const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
      const todayStr = this._formatDateISO(new Date());
      const weekDates = [];

      for (let i = 0; i < 7; i++) {
        const d = new Date(monday);
        d.setDate(monday.getDate() + i);
        weekDates.push(d);
        const dStr = this._formatDateISO(d);

        const colHeader = document.createElement('div');
        colHeader.className = `week-col-header ${dStr === todayStr ? 'today' : ''}`;
        colHeader.innerHTML = `
          <span class="week-col-day-name">${dayNames[i]}</span>
          <span class="week-col-day-num">${d.getDate()}</span>
        `;
        headerRow.appendChild(colHeader);
      }
      weekContainer.appendChild(headerRow);

      const scrollEl = document.createElement('div');
      scrollEl.className = 'week-grid-scroll';
      const body = document.createElement('div');
      body.className = 'week-grid-body';

      const isCustom = taskStore.getCalendarCustomRangeEnabled();
      let startHour = 0;
      let endHour = 24;
      if (isCustom) {
        const startStr = taskStore.getCalendarStartTime() || '08:00';
        const endStr = taskStore.getCalendarEndTime() || '22:00';
        startHour = Math.max(0, Math.min(23, Math.floor(this._parseTimeToMinutes(startStr) / 60)));
        endHour = Math.max(startHour + 1, Math.min(24, Math.ceil(this._parseTimeToMinutes(endStr) / 60)));
      }
      const hourHeight = this.weekHourHeight || 50;
      scrollEl.style.setProperty('--cal-week-hour-height', `${hourHeight}px`);

      const timeCol = document.createElement('div');
      timeCol.className = 'week-time-col';
      for (let h = startHour; h <= endHour; h++) {
        const lbl = document.createElement('div');
        lbl.className = 'week-hour-label';
        const hDisplay = String(h % 24).padStart(2, '0');
        lbl.textContent = `${hDisplay}:00`;
        lbl.style.top = `${(h - startHour) * hourHeight}px`;
        timeCol.appendChild(lbl);
      }
      body.appendChild(timeCol);

      for (let i = 0; i < 7; i++) {
        const d = weekDates[i];
        const dStr = this._formatDateISO(d);
        const dayCol = document.createElement('div');
        dayCol.className = 'week-day-col';
        dayCol.style.height = `${(endHour - startHour) * hourHeight}px`;

        const resolution = this.weekResolution || 15;
        for (let h = startHour; h <= endHour; h++) {
          const line = document.createElement('div');
          line.className = 'week-hour-line';
          line.style.top = `${(h - startHour) * hourHeight}px`;
          dayCol.appendChild(line);

          if (h < endHour && resolution < 60) {
            const stepCount = 60 / resolution;
            for (let s = 1; s < stepCount; s++) {
              const subLine = document.createElement('div');
              subLine.className = 'week-sub-interval-line';
              subLine.setAttribute('data-h-idx', String(h - startHour));
              subLine.setAttribute('data-s-ratio', String(s / stepCount));
              subLine.style.top = `${((h - startHour) + (s / stepCount)) * hourHeight}px`;
              dayCol.appendChild(subLine);
            }
          }
        }

        const eventsForDate = allEvents.filter(e => e.date === dStr);
        for (let j = 0; j < eventsForDate.length; j++) {
          const ev = eventsForDate[j];
          const startMin = this._parseTimeToMinutes(ev.startTime);
          const endMin = this._parseTimeToMinutes(ev.endTime);
          const cardStartHour = startMin / 60;
          const cardEndHour = endMin / 60;

          if (cardEndHour > startHour && cardStartHour < endHour) {
            const durationMin = Math.max(10, endMin - startMin);
            const top = Math.max(0, (cardStartHour - startHour) * hourHeight) + 1;
            const height = Math.max(14, ((durationMin / 60) * hourHeight) - 2);
            const card = document.createElement('div');
            card.className = `week-event-card ${ev.isLocked ? 'is-locked' : ''}`;
            card.style.top = `${top}px`;
            card.style.height = `${height}px`;
            card.style.backgroundColor = ev.color || this._getCategoryColor(ev.category);
            const isCompact = height < 44;
            if (isCompact) {
              card.classList.add('is-compact-short');
            }
            card.innerHTML = `
              <div class="week-event-title">${this._escapeHtml(ev.title)}</div>
              <div class="week-event-time">${ev.startTime} - ${ev.endTime}</div>
            `;
            dayCol.appendChild(card);
          }
        }
        body.appendChild(dayCol);
      }

      scrollEl.appendChild(body);
      weekContainer.appendChild(scrollEl);
      slide.appendChild(weekContainer);
    } else {
      // Month View Preview Slide
      const monthContainer = document.createElement('div');
      monthContainer.className = 'calendar-view-container';

      const weekdayHeader = document.createElement('div');
      weekdayHeader.className = 'month-weekday-header';
      weekdayHeader.innerHTML = '<span>Mon</span><span>Tue</span><span>Wed</span><span>Thu</span><span>Fri</span><span>Sat</span><span>Sun</span>';
      monthContainer.appendChild(weekdayHeader);

      const gridCells = document.createElement('div');
      gridCells.className = 'month-grid-cells';

      const year = targetDate.getFullYear();
      const month = targetDate.getMonth();
      const todayStr = this._formatDateISO(new Date());
      const firstDay = new Date(year, month, 1);
      const lastDay = new Date(year, month + 1, 0);
      const totalDays = lastDay.getDate();

      let startDayOfWeek = firstDay.getDay() - 1;
      if (startDayOfWeek === -1) startDayOfWeek = 6;
      const prevMonthLastDay = new Date(year, month, 0).getDate();
      const totalCells = (startDayOfWeek + totalDays > 35) ? 42 : 35;
      const padlockSvg = `<svg class="cal-mini-lock-svg" width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z"/></svg>`;

      for (let i = 0; i < totalCells; i++) {
        const cell = document.createElement('div');
        cell.className = 'month-day-cell';
        let cellDate = null;
        let dayNumber = 0;

        if (i < startDayOfWeek) {
          dayNumber = prevMonthLastDay - (startDayOfWeek - i - 1);
          cellDate = new Date(year, month - 1, dayNumber);
          cell.classList.add('other-month');
        } else if (i >= startDayOfWeek + totalDays) {
          dayNumber = i - (startDayOfWeek + totalDays) + 1;
          cellDate = new Date(year, month + 1, dayNumber);
          cell.classList.add('other-month');
        } else {
          dayNumber = i - startDayOfWeek + 1;
          cellDate = new Date(year, month, dayNumber);
        }

        const dateStr = this._formatDateISO(cellDate);
        if (dateStr === todayStr) cell.classList.add('today');

        cell.innerHTML = `
          <div class="cell-header">
            <span class="cell-day-num">${dayNumber}</span>
          </div>
          <div class="cell-events-list"></div>
        `;

        const eventsList = cell.querySelector('.cell-events-list');
        const eventsForDate = allEvents.filter(e => e.date === dateStr);
        const displayCount = Math.min(eventsForDate.length, 3);

        for (let j = 0; j < displayCount; j++) {
          const ev = eventsForDate[j];
          const pill = document.createElement('div');
          pill.className = `month-event-pill ${ev.isLocked ? 'is-locked' : ''}`;
          pill.style.backgroundColor = ev.color || this._getCategoryColor(ev.category);
          pill.innerHTML = `
            <span class="event-title">${this._escapeHtml(ev.title)}</span>
            ${ev.isLocked && ev.title && ev.title.length <= 5 ? `<span>${padlockSvg}</span>` : ''}
          `;
          eventsList.appendChild(pill);
        }

        if (eventsForDate.length > 3) {
          const more = document.createElement('div');
          more.className = 'month-more-pill';
          more.textContent = `+${eventsForDate.length - 3} more`;
          eventsList.appendChild(more);
        }

        gridCells.appendChild(cell);
      }

      monthContainer.appendChild(gridCells);
      slide.appendChild(monthContainer);
    }

    return slide;
  }

  // ==========================================
  // Pinch-to-Zoom Anchored Around Touch Center
  // ==========================================

  _setupPinchZoom(container, isDayView) {
    if (!container) return;

    let initialDist = 0;
    let initialHourHeight = 60;
    let isPinching = false;
    let centerClientY = 0;
    let offsetFromTop = 0;
    let centerMinutes = 0;

    container.addEventListener('touchstart', (e) => {
      if (e.touches && e.touches.length >= 2) {
        this.isPinching = true;
        this.pinchCooldownUntil = Date.now() + 400;
        this._cancelActiveEventDrag();
        isPinching = true;
        initialDist = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY
        );
        centerClientY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
        initialHourHeight = isDayView ? (this.dayHourHeight || 56) : (this.weekHourHeight || 50);

        const rect = container.getBoundingClientRect();
        offsetFromTop = centerClientY - rect.top;
        const centerTimelineY = container.scrollTop + offsetFromTop;
        centerMinutes = (centerTimelineY / initialHourHeight) * 60;
      }
    }, { passive: true });

    container.addEventListener('touchmove', (e) => {
      if (e.touches && e.touches.length >= 2) {
        this.isPinching = true;
        this.pinchCooldownUntil = Date.now() + 400;
        this._cancelActiveEventDrag();
      }
      if (!isPinching || !(e.touches && e.touches.length === 2)) return;
      const currentDist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      if (initialDist <= 0) return;
      const scale = currentDist / initialDist;

      if (isDayView) {
        const newHeight = Math.round(Math.max(32, Math.min(140, initialHourHeight * scale)));
        if (newHeight !== this.dayHourHeight) {
          this.dayHourHeight = newHeight;
          container.style.setProperty('--cal-day-hour-height', newHeight + 'px');
          this._updateDayViewPositions();

          // Anchor around center point
          const newCenterTimelineY = (centerMinutes / 60) * newHeight;
          container.scrollTop = Math.max(0, newCenterTimelineY - offsetFromTop);
        }
      } else {
        const newHeight = Math.round(Math.max(30, Math.min(120, initialHourHeight * scale)));
        if (newHeight !== this.weekHourHeight) {
          this.weekHourHeight = newHeight;
          this._updateWeekViewPositions();

          // Anchor around center point in week timeline
          const newCenterTimelineY = (centerMinutes / initialHourHeight) * newHeight;
          container.scrollTop = Math.max(0, newCenterTimelineY - offsetFromTop);
        }
      }
    }, { passive: true });

    const endPinch = () => {
      if (isPinching) {
        isPinching = false;
        this.isPinching = false;
        this.pinchCooldownUntil = Date.now() + 350;
        mobileServices.hapticTick();
      }
    };

    container.addEventListener('touchend', endPinch, { passive: true });
    container.addEventListener('touchcancel', endPinch, { passive: true });

    // Trackpad / Ctrl + Wheel Zoom Support
    container.addEventListener('wheel', (e) => {
      if (e.ctrlKey) {
        e.preventDefault();
        const delta = e.deltaY > 0 ? -4 : 4;
        const rect = container.getBoundingClientRect();
        const pointerOffset = e.clientY - rect.top;
        const currentTimelineY = container.scrollTop + pointerOffset;

        if (isDayView) {
          const oldH = this.dayHourHeight || 56;
          const mins = (currentTimelineY / oldH) * 60;
          const newH = Math.max(32, Math.min(140, oldH + delta));
          this.dayHourHeight = newH;
          container.style.setProperty('--cal-day-hour-height', newH + 'px');
          this._updateDayViewPositions();
          container.scrollTop = Math.max(0, (mins / 60) * newH - pointerOffset);
        } else {
          const oldH = this.weekHourHeight || 50;
          const newH = Math.max(30, Math.min(120, oldH + delta));
          this.weekHourHeight = newH;
          this._updateWeekViewPositions();
          container.scrollTop = Math.max(0, (currentTimelineY / oldH) * newH - pointerOffset);
        }
      }
    }, { passive: false });
  }

  // ==========================================
  // Phase 3: External Calendar Provider Filter & Modals
  // ==========================================

  _getVisibleCalendarEvents() {
    const allEvents = (typeof taskStore !== 'undefined' && typeof taskStore.getCalendarEvents === 'function')
      ? (taskStore.getCalendarEvents() || [])
      : [];
    const isGoogleVis = (typeof taskStore !== 'undefined' && typeof taskStore.getGoogleCalendarVisible === 'function')
      ? taskStore.getGoogleCalendarVisible()
      : true;
    const isMsVis = (typeof taskStore !== 'undefined' && typeof taskStore.getMicrosoftCalendarVisible === 'function')
      ? taskStore.getMicrosoftCalendarVisible()
      : true;

    return allEvents.filter(ev => {
      if (!ev) return false;
      if (ev.title === '[Calentimer Cloud Sync]' || ev.summary === '[Calentimer Cloud Sync]') return false;
      const isLocalItem = Boolean(
        (ev.id && (ev.id.startsWith('cal-event-') || ev.id.startsWith('task-'))) ||
        ev.source === 'local' ||
        ev.origin === 'local'
      );
      if (isLocalItem) {
        return true;
      }
      const prov = (ev.provider || ev.source) ? (ev.provider || ev.source) : 'local';
      if (prov === 'google' && !isGoogleVis) return false;
      if (prov === 'microsoft' && !isMsVis) return false;
      return true;
    });
  }

  updateProviderToggleUI() {
    const el = this.elements;
    if (!el || !el.btnToggleGoogleCal || !el.btnToggleMicrosoftCal) return;

    const googleConn = (typeof taskStore !== 'undefined' && typeof taskStore.getGoogleCalendarConnected === 'function')
      ? taskStore.getGoogleCalendarConnected()
      : false;
    const googleVis = (typeof taskStore !== 'undefined' && typeof taskStore.getGoogleCalendarVisible === 'function')
      ? taskStore.getGoogleCalendarVisible()
      : true;

    el.btnToggleGoogleCal.classList.toggle('is-unconnected', !googleConn);
    el.btnToggleGoogleCal.classList.toggle('is-connected', googleConn);
    el.btnToggleGoogleCal.classList.toggle('is-active', googleConn && googleVis);
    el.btnToggleGoogleCal.classList.toggle('is-muted', googleConn && !googleVis);
    if (!googleConn) {
      el.btnToggleGoogleCal.setAttribute('title', 'Google Calendar: Not connected (Click to connect)');
    } else if (googleVis) {
      el.btnToggleGoogleCal.setAttribute('title', 'Google Calendar: Active (Click to hide events)');
    } else {
      el.btnToggleGoogleCal.setAttribute('title', 'Google Calendar: Hidden (Click to show events)');
    }

    const msConn = (typeof taskStore !== 'undefined' && typeof taskStore.getMicrosoftCalendarConnected === 'function')
      ? taskStore.getMicrosoftCalendarConnected()
      : false;
    const msVis = (typeof taskStore !== 'undefined' && typeof taskStore.getMicrosoftCalendarVisible === 'function')
      ? taskStore.getMicrosoftCalendarVisible()
      : true;

    el.btnToggleMicrosoftCal.classList.toggle('is-unconnected', !msConn);
    el.btnToggleMicrosoftCal.classList.toggle('is-connected', msConn);
    el.btnToggleMicrosoftCal.classList.toggle('is-active', msConn && msVis);
    el.btnToggleMicrosoftCal.classList.toggle('is-muted', msConn && !msVis);
    if (!msConn) {
      el.btnToggleMicrosoftCal.setAttribute('title', 'Microsoft Calendar: Not connected (Click to connect)');
    } else if (msVis) {
      el.btnToggleMicrosoftCal.setAttribute('title', 'Microsoft Calendar: Active (Click to hide events)');
    } else {
      el.btnToggleMicrosoftCal.setAttribute('title', 'Microsoft Calendar: Hidden (Click to show events)');
    }
  }

  openConnectModal() {
    const el = this.elements;
    if (!el || !el.connectModalBackdrop) return;
    if (el.chkDontAskConnectStartup && typeof taskStore !== 'undefined' && typeof taskStore.getSkipConnectPrompt === 'function') {
      el.chkDontAskConnectStartup.checked = taskStore.getSkipConnectPrompt();
    }
    el.connectModalBackdrop.classList.remove('hidden');
    mobileServices.hapticTap();
  }

  closeConnectModal() {
    const el = this.elements;
    if (!el || !el.connectModalBackdrop) return;
    el.connectModalBackdrop.classList.add('hidden');
  }

  openSyncConfirmModal(providerName) {
    const el = this.elements;
    if (!el || !el.confirmSyncNowModalBackdrop) return;
    const descEl = document.getElementById('confirmSyncNowDesc');
    if (descEl && providerName) {
      descEl.textContent = `Sync your ${providerName} events now? We will import your upcoming schedule into Calentimer.`;
    }
    el.confirmSyncNowModalBackdrop.classList.remove('hidden');
    mobileServices.hapticTap();
  }

  closeSyncConfirmModal() {
    const el = this.elements;
    if (!el || !el.confirmSyncNowModalBackdrop) return;
    el.confirmSyncNowModalBackdrop.classList.add('hidden');
  }

  _applyEventCardLayout(card, heightPx) {
    card.style.height = `${heightPx}px`;

    // When squashed or short duration (height < 38px), always use single-row layout
    // In this compact mode, category is hidden and timespan+duration are pinned on far right before padlock
    if (heightPx < 38) {
      card.classList.add('is-single-row');
      card.classList.remove('is-compact-two-line');
    } else if (heightPx < 54) {
      card.classList.remove('is-single-row');
      card.classList.add('is-compact-two-line');
    } else {
      card.classList.remove('is-single-row');
      card.classList.remove('is-compact-two-line');
    }
  }

  // Smoothly reposition day event cards and current time line when hour height changes
  _updateDayViewPositions() {
    const body = this.elements.dayTimelineBody;
    if (!body) return;

    const isCustom = taskStore.getCalendarCustomRangeEnabled();
    let startHour = 0;
    if (isCustom) {
      const startStr = taskStore.getCalendarStartTime() || '08:00';
      startHour = Math.max(0, Math.min(23, Math.floor(this._parseTimeToMinutes(startStr) / 60)));
    }

    const hourHeight = this.dayHourHeight || 56;
    const cards = body.querySelectorAll('.day-event-card');
    const allEvents = this._getVisibleCalendarEvents();

    for (let i = 0; i < cards.length; i++) {
      const card = cards[i];
      const eventId = card.getAttribute('data-event-id');
      const ev = allEvents.find(e => e.id === eventId);
      if (ev) {
        const startMin = this._parseTimeToMinutes(ev.startTime);
        const endMin = this._parseTimeToMinutes(ev.endTime);
        let dur = ev.plannedDuration;
        if (!dur || dur <= 0) {
          dur = endMin - startMin;
          if (dur <= 0) dur = 60;
        }
        const topPx = 14 + ((Math.max(startHour * 60, startMin) - (startHour * 60)) / 60) * hourHeight;
        const heightPx = Math.max(24, (dur / 60) * hourHeight);
        card.style.top = `${topPx}px`;
        this._applyEventCardLayout(card, heightPx);
      }
    }

    if (this._isViewingToday()) {
      this._renderCurrentTimeLine();
    }
  }

  // Smoothly reposition week view elements when week hour height changes
  _updateWeekViewPositions() {
    const container = this.elements.weekGridScroll;
    const body = this.elements.weekGridBody;
    if (!container || !body) return;

    const hourHeight = this.weekHourHeight || 50;
    const isCustom = taskStore.getCalendarCustomRangeEnabled();
    let startHour = 0;
    let endHour = 24;
    if (isCustom) {
      const startStr = taskStore.getCalendarStartTime() || '08:00';
      const endStr = taskStore.getCalendarEndTime() || '22:00';
      startHour = Math.max(0, Math.min(23, Math.floor(this._parseTimeToMinutes(startStr) / 60)));
      endHour = Math.max(startHour + 1, Math.min(24, Math.ceil(this._parseTimeToMinutes(endStr) / 60)));
    }

    container.style.setProperty('--cal-week-hour-height', `${hourHeight}px`);

    // Update hour labels in time column
    const labels = body.querySelectorAll('.week-hour-label');
    for (let i = 0; i < labels.length; i++) {
      labels[i].style.top = `${i * hourHeight}px`;
    }

    // Update day columns height and horizontal lines
    const dayCols = body.querySelectorAll('.week-day-col');
    for (let i = 0; i < dayCols.length; i++) {
      dayCols[i].style.height = `${(endHour - startHour) * hourHeight}px`;
      const lines = dayCols[i].querySelectorAll('.week-hour-line');
      for (let j = 0; j < lines.length; j++) {
        lines[j].style.top = `${j * hourHeight}px`;
      }
      const subLines = dayCols[i].querySelectorAll('.week-sub-interval-line');
      for (let s = 0; s < subLines.length; s++) {
        const sub = subLines[s];
        const hIdx = parseFloat(sub.getAttribute('data-h-idx') || '0');
        const ratio = parseFloat(sub.getAttribute('data-s-ratio') || '0');
        sub.style.top = `${(hIdx * hourHeight) + (ratio * hourHeight)}px`;
      }
    }

    // Update event cards positions and heights
    const cards = body.querySelectorAll('.week-event-card');
    const allEvents = this._getVisibleCalendarEvents();
    for (let i = 0; i < cards.length; i++) {
      const card = cards[i];
      const evId = card.getAttribute('data-event-id');
      const ev = allEvents.find(e => e.id === evId);
      if (ev) {
        const startMin = this._parseTimeToMinutes(ev.startTime);
        const endMin = this._parseTimeToMinutes(ev.endTime);
        let dur = ev.plannedDuration;
        if (!dur || dur <= 0) {
          dur = endMin - startMin;
          if (dur <= 0) dur = 60;
        }
        const topPx = Math.max(0, ((startMin - (startHour * 60)) / 60) * hourHeight) + 1;
        const hPx = Math.max(14, ((dur / 60) * hourHeight) - 2);
        card.style.top = `${topPx}px`;
        card.style.height = `${hPx}px`;
      }
    }
  }

  // ==========================================
  // Public Display API
  // ==========================================

  open() {
    if (typeof window !== 'undefined' && typeof window.ensureHistoryBuffer === 'function') {
      window.ensureHistoryBuffer();
    }
    if (this.elements.backdrop) {
      this.elements.backdrop.classList.remove('hidden');
    }
    analytics.trackInteraction('tab_switch', 'full_calendar');
    mobileServices.hapticTap();

    // Reset date to today so it defaults to this day, this week, or this month
    const today = new Date();
    this.currentDate = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    this.selectedDate = new Date(today.getFullYear(), today.getMonth(), today.getDate());

    const savedView = (typeof taskStore !== 'undefined' && typeof taskStore.getCalendarView === 'function')
      ? taskStore.getCalendarView()
      : 'day';
    this.switchView(savedView || 'day');

    // Start dynamic current time ticker
    this._startTimeTicker();

    // If day view and viewing today, auto-scroll to current hour
    if (this.activeView === 'day' && this._isViewingToday()) {
      this._scrollToCurrentTime();
    }
  }

  close() {
    if (this.elements.backdrop) {
      this.elements.backdrop.classList.add('hidden');
    }
    this._stopTimeTicker();

    // Default to timer tab in the menu bar when closed
    const navItemTimer = document.getElementById('navItemTimer');
    const navItemFullCalendar = document.getElementById('navItemFullCalendar');
    if (navItemFullCalendar) navItemFullCalendar.classList.remove('active');
    if (navItemTimer) navItemTimer.classList.add('active');
  }

  _populateResolutionOptions(options, selectedVal) {
    const sel = this.elements.resolutionSelect;
    if (!sel) return;
    sel.innerHTML = '';
    for (let i = 0; i < options.length; i++) {
      const opt = document.createElement('option');
      opt.value = String(options[i]);
      opt.textContent = `${options[i]}m`;
      if (options[i] === selectedVal) opt.selected = true;
      sel.appendChild(opt);
    }
  }

  switchView(viewName) {
    if (!viewName) return;
    this.activeView = viewName;
    if (typeof taskStore !== 'undefined' && typeof taskStore.setCalendarView === 'function') {
      taskStore.setCalendarView(viewName);
    }

    const el = this.elements;
    if (el.viewSelect) {
      el.viewSelect.value = viewName;
    }
    const viewValEl = document.getElementById('calViewVal');
    if (viewValEl) {
      viewValEl.textContent = viewName.charAt(0).toUpperCase() + viewName.slice(1);
    }

    if (el.dayView) el.dayView.classList.toggle('hidden', viewName !== 'day');
    if (el.weekView) el.weekView.classList.toggle('hidden', viewName !== 'week');
    if (el.monthView) el.monthView.classList.toggle('hidden', viewName !== 'month');

    // Remove bottom fade in month view since scrolling is unnecessary
    if (el.modalBody) {
      el.modalBody.classList.toggle('is-month-view', viewName === 'month');
    }
    if (el.bottomFade) {
      el.bottomFade.style.display = (viewName === 'month') ? 'none' : 'block';
    }

    // Interval selector in Day & Week views; hidden in Month view
    if (el.resolutionWrapper) {
      if (viewName === 'day') {
        el.resolutionWrapper.style.visibility = 'visible';
        el.resolutionWrapper.style.display = 'inline-flex';
        this._populateResolutionOptions([5, 10, 15, 30, 60], this.currentResolution || 15);
      } else if (viewName === 'week') {
        el.resolutionWrapper.style.visibility = 'visible';
        el.resolutionWrapper.style.display = 'inline-flex';
        this._populateResolutionOptions([15, 30, 60], this.weekResolution || 15);
      } else {
        // Month view: interval selector is hidden so only Add Event button sits on bottom right
        el.resolutionWrapper.style.display = 'none';
      }
    }

    analytics.trackInteraction('cal_view_switch', viewName);
    mobileServices.hapticTap();
    this.render();

    if (viewName === 'day' && this._isViewingToday()) {
      this._scrollToCurrentTime();
    }
  }

  // Smooth swipe transition when tapping left/right arrow buttons
  slideNavigate(direction, btn) {
    if (this.isNavigating) return;
    this.isNavigating = true;

    if (btn) {
      btn.classList.add('is-active-nav');
    }

    const dir = direction > 0 ? 1 : -1;
    const modalBody = document.querySelector('.full-calendar-body');
    const activeContainer = (this.activeView === 'day')
      ? this.elements.dayView
      : ((this.activeView === 'week') ? this.elements.weekView : this.elements.monthView);

    if (!modalBody || !activeContainer) {
      this.navigate(dir);
      this.isNavigating = false;
      if (btn) {
        btn.classList.remove('is-active-nav');
        if (typeof btn.blur === 'function') btn.blur();
      }
      return;
    }

    const bodyWidth = modalBody.clientWidth || 360;
    const targetDate = new Date(this.currentDate);
    if (this.activeView === 'day') {
      targetDate.setDate(targetDate.getDate() + dir);
    } else if (this.activeView === 'week') {
      targetDate.setDate(targetDate.getDate() + (dir * 7));
    } else if (this.activeView === 'month') {
      targetDate.setMonth(targetDate.getMonth() + dir);
    }

    const currentScrollEl = activeContainer.querySelector('.day-timeline-scroll, .week-grid-scroll');
    const currentScrollTop = currentScrollEl ? currentScrollEl.scrollTop : 0;

    let adjacentSlide = null;
    if (typeof this._buildAdjacentPreviewSlide === 'function') {
      adjacentSlide = this._buildAdjacentPreviewSlide(targetDate, dir, currentScrollTop);
    }

    if (!adjacentSlide) {
      this.navigate(dir, currentScrollTop);
      this.isNavigating = false;
      if (btn) {
        btn.classList.remove('is-active-nav');
        if (typeof btn.blur === 'function') btn.blur();
      }
      return;
    }

    const startXAdj = dir > 0 ? bodyWidth : -bodyWidth;
    adjacentSlide.style.transition = 'none';
    adjacentSlide.style.transform = `translate3d(${startXAdj}px, 0, 0)`;
    modalBody.appendChild(adjacentSlide);

    const adjScroll = adjacentSlide.querySelector('.day-timeline-scroll, .week-grid-scroll');
    if (adjScroll) {
      adjScroll.scrollTop = currentScrollTop;
    }

    // Force reflow for smooth animation
    void adjacentSlide.offsetWidth;

    activeContainer.style.transition = 'transform 0.30s cubic-bezier(0.16, 1, 0.3, 1)';
    adjacentSlide.style.transition = 'transform 0.30s cubic-bezier(0.16, 1, 0.3, 1)';

    activeContainer.style.transform = `translate3d(${-startXAdj}px, 0, 0)`;
    adjacentSlide.style.transform = 'translate3d(0, 0, 0)';

    mobileServices.hapticTap();

    setTimeout(() => {
      this.navigate(dir, currentScrollTop);
      if (adjacentSlide && adjacentSlide.parentNode) {
        adjacentSlide.parentNode.removeChild(adjacentSlide);
      }
      const updatedContainer = (this.activeView === 'day')
        ? this.elements.dayView
        : ((this.activeView === 'week') ? this.elements.weekView : this.elements.monthView);
      if (updatedContainer) {
        updatedContainer.style.removeProperty('transform');
        updatedContainer.style.removeProperty('transition');
      }
      this.isNavigating = false;
      if (btn) {
        btn.classList.remove('is-active-nav');
        if (typeof btn.blur === 'function') btn.blur();
      }
    }, 310);
  }

  navigate(direction, preserveScrollTop) {
    const dir = direction > 0 ? 1 : -1;
    const d = new Date(this.currentDate);

    if (this.activeView === 'month') {
      d.setMonth(d.getMonth() + dir);
    } else if (this.activeView === 'week') {
      d.setDate(d.getDate() + (dir * 7));
    } else if (this.activeView === 'day') {
      d.setDate(d.getDate() + dir);
      this.selectedDate = new Date(d);
    }

    this.currentDate = d;
    mobileServices.hapticTap();
    this.render(preserveScrollTop);

    if (typeof preserveScrollTop !== 'number' && this.activeView === 'day' && this._isViewingToday()) {
      setTimeout(() => this._scrollToCurrentTime(), 60);
    }
  }

  goToToday() {
    this.currentDate = new Date();
    this.selectedDate = new Date();
    mobileServices.hapticTap();
    this.render();

    if (this.activeView === 'day') {
      setTimeout(() => this._scrollToCurrentTime(), 60);
    }
  }

  render(preserveScrollTop) {
    this._clearActiveResizeHandles();
    this._renderRangeLabel();
    this.updateProviderToggleUI();

    if (this.activeView === 'day') {
      const currentScroll = (typeof preserveScrollTop === 'number')
        ? preserveScrollTop
        : (this.elements.dayTimelineScroll ? this.elements.dayTimelineScroll.scrollTop : null);
      this._renderDayView();
      if (typeof currentScroll === 'number' && this.elements.dayTimelineScroll) {
        this.elements.dayTimelineScroll.scrollTop = currentScroll;
      }
    } else if (this.activeView === 'week') {
      const currentScroll = (typeof preserveScrollTop === 'number')
        ? preserveScrollTop
        : (this.elements.weekGridScroll ? this.elements.weekGridScroll.scrollTop : null);
      this._renderWeekView();
      if (typeof currentScroll === 'number' && this.elements.weekGridScroll) {
        this.elements.weekGridScroll.scrollTop = currentScroll;
      }
    } else if (this.activeView === 'month') {
      this._renderMonthView();
    }
  }

  // ==========================================
  // Render View Implementations
  // ==========================================

  _getOrdinalSuffix(day) {
    const j = day % 10;
    const k = day % 100;
    if (j === 1 && k !== 11) return day + 'st';
    if (j === 2 && k !== 12) return day + 'nd';
    if (j === 3 && k !== 13) return day + 'rd';
    return day + 'th';
  }

  _renderRangeLabel() {
    const el = this.elements.rangeLabel;
    if (!el) return;

    const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    const cur = this.currentDate;

    if (this.activeView === 'month') {
      el.textContent = `${monthNames[cur.getMonth()]} ${cur.getFullYear()}`;
      el.title = el.textContent;
    } else if (this.activeView === 'week') {
      const mon = this._getMondayOfWeek(cur);
      const sun = new Date(mon);
      sun.setDate(mon.getDate() + 6);
      const d1Suffix = this._getOrdinalSuffix(mon.getDate());
      const d2Suffix = this._getOrdinalSuffix(sun.getDate());
      if (mon.getMonth() === sun.getMonth()) {
        el.textContent = `${d1Suffix} - ${d2Suffix} ${monthNames[mon.getMonth()]}`;
      } else {
        el.textContent = `${d1Suffix} ${monthNames[mon.getMonth()].substring(0, 3)} - ${d2Suffix} ${monthNames[sun.getMonth()].substring(0, 3)}`;
      }
      el.title = el.textContent;
    } else if (this.activeView === 'day') {
      const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
      const sel = this.selectedDate || cur;
      const dayName = dayNames[sel.getDay()];
      const daySuffix = this._getOrdinalSuffix(sel.getDate());
      const monthName = monthNames[sel.getMonth()];
      el.textContent = `${dayName} ${daySuffix} ${monthName}`;
      el.title = `${dayName} ${daySuffix} ${monthName} ${sel.getFullYear()}`;
    }
  }

  // 1. Day View (With custom visible range support, subdivision lines & dynamic current time bar)
  _renderDayView() {
    const body = this.elements.dayTimelineBody;
    if (!body) return;

    body.innerHTML = '';

    const sel = this.selectedDate || this.currentDate;
    const selStr = this._formatDateISO(sel);
    const isToday = this._isViewingToday();

    const allEvents = this._getVisibleCalendarEvents();
    const eventsForDay = allEvents.filter(e => e.date === selStr);

    const isCustom = taskStore.getCalendarCustomRangeEnabled();
    let startHour = 0;
    let endHour = 24;
    if (isCustom) {
      const startStr = taskStore.getCalendarStartTime() || '08:00';
      const endStr = taskStore.getCalendarEndTime() || '22:00';
      startHour = Math.max(0, Math.min(23, Math.floor(this._parseTimeToMinutes(startStr) / 60)));
      endHour = Math.max(startHour + 1, Math.min(24, Math.ceil(this._parseTimeToMinutes(endStr) / 60)));
    }

    const resolution = this.currentResolution || 15;
    const hourHeight = this.dayHourHeight || 56; // px per hour

    // Apply active hour height CSS variable
    if (this.elements.dayTimelineScroll) {
      this.elements.dayTimelineScroll.style.setProperty('--cal-day-hour-height', `${hourHeight}px`);
    }

    // Render hour slots from startHour to endHour (including 00:00)
    for (let h = startHour; h < endHour; h++) {
      const slot = document.createElement('div');
      slot.className = 'day-timeline-hour-slot';
      slot.setAttribute('data-hour', String(h));

      const timeLabel = document.createElement('div');
      timeLabel.className = 'day-time-label';
      timeLabel.textContent = `${String(h).padStart(2, '0')}:00`;
      slot.appendChild(timeLabel);

      const slotContent = document.createElement('div');
      slotContent.className = 'day-slot-content';

      // Render subtle dashed sub-interval lines inside slotContent so they match bold lines exactly
      if (resolution < 60) {
        const stepCount = 60 / resolution;
        for (let s = 1; s < stepCount; s++) {
          const subLine = document.createElement('div');
          subLine.className = 'day-sub-interval-line';
          const pct = (s / stepCount) * 100;
          subLine.style.top = `${pct}%`;
          slotContent.appendChild(subLine);
        }
      }

      // Clicking empty slot creates a new event starting at that hour
      slotContent.addEventListener('click', (e) => {
        if (e.target.closest('.day-event-card')) return;
        const rect = slotContent.getBoundingClientRect();
        const clickY = e.clientY - rect.top;
        const rawMin = Math.max(0, Math.min(59, (clickY / hourHeight) * 60));
        const snappedMin = Math.floor(rawMin / resolution) * resolution;

        const startTimeStr = `${String(h).padStart(2, '0')}:${String(snappedMin).padStart(2, '0')}`;
        const endTotalMin = (h * 60) + snappedMin + 60;
        const endH = Math.min(23, Math.floor(endTotalMin / 60));
        const endM = endTotalMin % 60;
        const endTimeStr = `${String(endH).padStart(2, '0')}:${String(endM).padStart(2, '0')}`;

        this.openEventInspector(null, selStr, startTimeStr, endTimeStr);
      });

      slot.appendChild(slotContent);
      body.appendChild(slot);
    }

    // Render final end-time boundary line and label (00:00 or custom end time)
    const endSlot = document.createElement('div');
    endSlot.className = 'day-timeline-hour-slot day-timeline-end-slot';
    endSlot.style.height = '0px';
    endSlot.style.minHeight = '0px';

    const endTimeLabel = document.createElement('div');
    endTimeLabel.className = 'day-time-label day-end-time-label';
    const endHDisplay = String(endHour % 24).padStart(2, '0');
    endTimeLabel.textContent = `${endHDisplay}:00`;
    endSlot.appendChild(endTimeLabel);

    const endLine = document.createElement('div');
    endLine.className = 'day-slot-content day-end-boundary-line';
    endLine.style.height = '0px';
    endSlot.appendChild(endLine);

    body.appendChild(endSlot);

    // Render Dynamic Light-Blue Current Time Line
    if (isToday) {
      this._renderCurrentTimeLine();
    }

    // Filter and sort events by start time ascending for overlap detection & indenting
    const visibleEvents = eventsForDay.filter(e => {
      const s = this._parseTimeToMinutes(e.startTime);
      const en = this._parseTimeToMinutes(e.endTime);
      return !(s >= endHour * 60 || en <= startHour * 60);
    }).sort((a, b) => {
      return this._parseTimeToMinutes(a.startTime) - this._parseTimeToMinutes(b.startTime);
    });

    // Calculate overlapping column layout (0 = left/earlier, 1 = right/indented)
    // Rule: If an event indents due to overlapping an event (col 1),
    // an event below it that also overlaps does NOT also indent (stays in col 0).
    const eventCols = [];
    const hasOverlap = [];
    for (let cIdx = 0; cIdx < visibleEvents.length; cIdx++) {
      eventCols.push(0);
      hasOverlap.push(false);
    }

    for (let cA = 0; cA < visibleEvents.length; cA++) {
      const evA = visibleEvents[cA];
      const aStart = this._parseTimeToMinutes(evA.startTime);
      const aEnd = this._parseTimeToMinutes(evA.endTime);

      for (let cB = cA + 1; cB < visibleEvents.length; cB++) {
        const evB = visibleEvents[cB];
        const bStart = this._parseTimeToMinutes(evB.startTime);
        const bEnd = this._parseTimeToMinutes(evB.endTime);

        if (aStart < bEnd && bStart < aEnd) {
          hasOverlap[cA] = true;
          hasOverlap[cB] = true;
          if (eventCols[cB - 1] === 1) {
            eventCols[cB] = 0;
          } else {
            eventCols[cB] = (eventCols[cA] === 0) ? 1 : 0;
          }
        }
      }
    }

    // Render Event Cards Absolutely Positioned with Overlap Indentation
    for (let j = 0; j < visibleEvents.length; j++) {
      const ev = visibleEvents[j];
      const startMin = this._parseTimeToMinutes(ev.startTime);
      const endMin = this._parseTimeToMinutes(ev.endTime);
      let dur = ev.plannedDuration;
      if (!dur || dur <= 0) {
        dur = endMin - startMin;
        if (dur <= 0) dur = 60;
      }

      const topPx = 14 + ((Math.max(startHour * 60, startMin) - (startHour * 60)) / 60) * hourHeight;
      const heightPx = Math.max(26, (dur / 60) * hourHeight);

      const isLaterOverlap = hasOverlap[j] && (eventCols[j] === 1);
      const isEarlierOverlap = hasOverlap[j] && (eventCols[j] === 0);

      // Check if event corresponds to completed or currently active timer task
      let isDone = false;
      let isCurrent = false;
      if (ev.isCompleted) {
        isDone = true;
      }
      if (isToday) {
        const now = new Date();
        const currentMinutes = (now.getHours() * 60) + now.getMinutes();
        const evStart = this._parseTimeToMinutes(ev.startTime);
        let evEnd = this._parseTimeToMinutes(ev.endTime);
        if (evEnd <= evStart) evEnd += 1440;

        if (currentMinutes >= evEnd) {
          isDone = true;
        } else if (currentMinutes >= evStart && currentMinutes < evEnd) {
          isCurrent = true;
        }
      }
      const rt = (typeof window !== 'undefined' && window.runtime) ? window.runtime : (this.runtime || null);
      if (isToday && rt) {
        const activeTask = (typeof rt.getActiveTask === 'function') ? rt.getActiveTask() : null;
        const isAllDone = rt.status === 'COMPLETED';

        if (isAllDone) {
          isDone = true;
        } else if (!isDone && activeTask && activeTask.id === ev.id && rt.status !== 'COMPLETED') {
          isCurrent = true;
        }
      }

      const card = document.createElement('div');
      const eventColor = ev.color || this._getCategoryColor(ev.category);
      card.className = `day-event-card ${ev.isLocked ? 'is-locked' : ''} ${isLaterOverlap ? 'is-overlapping-later' : ''} ${isEarlierOverlap ? 'is-overlapping-earlier' : ''} ${isDone ? 'is-event-completed' : ''} ${isCurrent ? 'is-event-current' : ''}`;
      card.style.top = `${topPx}px`;
      card.style.borderLeftColor = eventColor;
      card.setAttribute('data-event-id', ev.id);
      if (isDone) {
        card.style.background = 'rgba(16, 185, 129, 0.22)';
      } else if (isCurrent) {
        card.style.background = 'rgba(0, 240, 255, 0.2)';
      }
      this._applyEventCardLayout(card, heightPx);

      const catBadgeStyle = `background:${this._hexToRgba(eventColor, 0.2)};color:${eventColor};border:1px solid ${this._hexToRgba(eventColor, 0.45)};`;
      // Top line purely for task title, line below for time span and duration
      card.innerHTML = `
        <span class="day-event-emoji">${ev.emoji || '📅'}</span>
        <div class="day-event-content">
          <div class="day-event-title-line">
            <span class="day-event-title">${this._escapeHtml(ev.title)}</span>
          </div>
          <div class="day-event-meta-line">
            <span class="event-time-range">${ev.startTime} - ${ev.endTime}</span>
            <span class="event-duration-pill">(${dur}m)</span>
            <span class="event-cat-pill" style="${catBadgeStyle}">${this._escapeHtml(ev.category || 'Work')}</span>
          </div>
        </div>
        <button type="button" class="cal-event-lock-btn ${ev.isLocked ? 'is-locked' : ''}" data-action="toggle-lock" title="${ev.isLocked ? 'Fixed Schedule (Locked) - tap to unlock' : 'Flexible Schedule - tap to lock'}">
          ${ev.isLocked ? `
            <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
              <path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z"/>
            </svg>
          ` : `
            <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 17c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm6-9h-1V6c0-2.76-2.24-5-5-5-2.28 0-4.27 1.54-4.84 3.75-.14.54.18 1.08.72 1.22.53.14 1.08-.18 1.22-.72C9.46 3.86 10.63 3 12 3c1.66 0 3 1.34 3 3v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm0 12H6V10h12v10z"/>
            </svg>
          `}
        </button>
      `;

      // Padlock button toggle listener
      const lockBtn = card.querySelector('[data-action="toggle-lock"]');
      if (lockBtn) {
        const toggleLock = (e) => {
          if (e) {
            e.stopPropagation();
            if (e.cancelable) e.preventDefault();
          }
          const currentLocked = Boolean(ev.isLocked);
          const newLocked = !currentLocked;
          const fixedStart = newLocked ? (ev.startTime || null) : null;
          const updatedEv = taskStore.updateCalendarEvent(ev.id, {
            isLocked: newLocked,
            fixedStartTime: fixedStart
          });
          if (typeof calendarSyncService !== 'undefined' && calendarSyncService && typeof calendarSyncService.pushEventUpdate === 'function') {
            calendarSyncService.pushEventUpdate(updatedEv);
          }
          mobileServices.hapticTap();
          this.render();
          this._showToast(newLocked ? '🔒 Event locked to fixed schedule' : '🔓 Event unlocked (flexible)');
        };
        lockBtn.addEventListener('click', toggleLock);
        lockBtn.addEventListener('touchend', toggleLock, { passive: false });
      }

      // Hold-to-drag and tap-to-inspect setup
      this._setupDayEventDrag(card, ev);

      body.appendChild(card);
    }
  }

  // 2. Week View (7 days Mon-Sun, horizontal hour grid lines, mini lock SVG, clean clipping)
  _renderWeekView() {
    const headerRow = this.elements.weekHeader;
    const body = this.elements.weekGridBody;
    if (!headerRow || !body) return;

    headerRow.innerHTML = '';
    body.innerHTML = '';

    const monday = this._getMondayOfWeek(this.currentDate);
    const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const todayStr = this._formatDateISO(new Date());

    // Corner spacer
    const corner = document.createElement('div');
    headerRow.appendChild(corner);

    const weekDates = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      weekDates.push(d);

      const dStr = this._formatDateISO(d);
      const colHeader = document.createElement('div');
      colHeader.className = `week-col-header ${dStr === todayStr ? 'today' : ''}`;

      const name = document.createElement('span');
      name.className = 'week-col-day-name';
      name.textContent = dayNames[i];

      const num = document.createElement('span');
      num.className = 'week-col-day-num';
      num.textContent = d.getDate();

      colHeader.appendChild(name);
      colHeader.appendChild(num);

      colHeader.addEventListener('click', () => {
        this.selectedDate = d;
        this.currentDate = d;
        this.switchView('day');
      });

      headerRow.appendChild(colHeader);
    }

    const allEvents = this._getVisibleCalendarEvents();

    const isCustom = taskStore.getCalendarCustomRangeEnabled();
    let startHour = 0;
    let endHour = 24;
    if (isCustom) {
      const startStr = taskStore.getCalendarStartTime() || '08:00';
      const endStr = taskStore.getCalendarEndTime() || '22:00';
      startHour = Math.max(0, Math.min(23, Math.floor(this._parseTimeToMinutes(startStr) / 60)));
      endHour = Math.max(startHour + 1, Math.min(24, Math.ceil(this._parseTimeToMinutes(endStr) / 60)));
    }
    const hourHeight = this.weekHourHeight || 50; // dynamic px per hour

    if (this.elements.weekGridScroll) {
      this.elements.weekGridScroll.style.setProperty('--cal-week-hour-height', `${hourHeight}px`);
    }

    // Time labels column (includes final boundary endHour marker e.g. 00:00 or custom end time)
    const timeCol = document.createElement('div');
    timeCol.className = 'week-time-col';
    for (let h = startHour; h <= endHour; h++) {
      const lbl = document.createElement('div');
      lbl.className = 'week-hour-label';
      const hDisplay = String(h % 24).padStart(2, '0');
      lbl.textContent = `${hDisplay}:00`;
      lbl.style.top = `${(h - startHour) * hourHeight}px`;
      timeCol.appendChild(lbl);
    }
    body.appendChild(timeCol);

    // 7 day columns
    for (let i = 0; i < 7; i++) {
      const d = weekDates[i];
      const dStr = this._formatDateISO(d);
      const dayCol = document.createElement('div');
      dayCol.className = 'week-day-col';
      dayCol.setAttribute('data-date', dStr);
      dayCol.style.height = `${(endHour - startHour) * hourHeight}px`;

      // Render bold solid hour lines from startHour to endHour
      const resolution = this.weekResolution || 15;
      for (let h = startHour; h <= endHour; h++) {
        const line = document.createElement('div');
        line.className = 'week-hour-line';
        line.style.top = `${(h - startHour) * hourHeight}px`;
        dayCol.appendChild(line);

        // Sub-interval dashed lines only within hours (h < endHour)
        if (h < endHour && resolution < 60) {
          const stepCount = 60 / resolution;
          for (let s = 1; s < stepCount; s++) {
            const subLine = document.createElement('div');
            subLine.className = 'week-sub-interval-line';
            subLine.setAttribute('data-h-idx', String(h - startHour));
            subLine.setAttribute('data-s-ratio', String(s / stepCount));
            subLine.style.top = `${((h - startHour) + (s / stepCount)) * hourHeight}px`;
            dayCol.appendChild(subLine);
          }
        }
      }

      const eventsForDate = allEvents.filter(e => e.date === dStr);

      // Precompute overlapping column layout for week day
      const weekEventCols = [];
      const weekHasOverlap = [];
      for (let cIdx = 0; cIdx < eventsForDate.length; cIdx++) {
        weekEventCols.push(0);
        weekHasOverlap.push(false);
      }

      for (let cA = 0; cA < eventsForDate.length; cA++) {
        const evA = eventsForDate[cA];
        const aStart = this._parseTimeToMinutes(evA.startTime);
        const aEnd = this._parseTimeToMinutes(evA.endTime);

        for (let cB = cA + 1; cB < eventsForDate.length; cB++) {
          const evB = eventsForDate[cB];
          const bStart = this._parseTimeToMinutes(evB.startTime);
          const bEnd = this._parseTimeToMinutes(evB.endTime);

          if (aStart < bEnd && bStart < aEnd) {
            weekHasOverlap[cA] = true;
            weekHasOverlap[cB] = true;
            if (weekEventCols[cB - 1] === 1) {
              weekEventCols[cB] = 0;
            } else {
              weekEventCols[cB] = (weekEventCols[cA] === 0) ? 1 : 0;
            }
          }
        }
      }

      for (let j = 0; j < eventsForDate.length; j++) {
        const ev = eventsForDate[j];
        const startMin = this._parseTimeToMinutes(ev.startTime);
        const endMin = this._parseTimeToMinutes(ev.endTime);

        const cardStartHour = startMin / 60;
        const cardEndHour = endMin / 60;

        if (cardEndHour > startHour && cardStartHour < endHour) {
          const durationMin = Math.max(10, endMin - startMin);
          const top = Math.max(0, (cardStartHour - startHour) * hourHeight) + 1;
          const height = Math.max(14, ((durationMin / 60) * hourHeight) - 2);

          const isLaterOverlap = weekHasOverlap[j] && (weekEventCols[j] === 1);
          const isEarlierOverlap = weekHasOverlap[j] && (weekEventCols[j] === 0);

          const card = document.createElement('div');
          card.className = `week-event-card ${ev.isLocked ? 'is-locked' : ''} ${isLaterOverlap ? 'is-overlapping-later' : ''} ${isEarlierOverlap ? 'is-overlapping-earlier' : ''}`;
          card.style.top = `${top}px`;
          card.style.height = `${height}px`;
          card.style.backgroundColor = ev.color || this._getCategoryColor(ev.category);
          card.setAttribute('data-event-id', ev.id);

          const isCompact = height < 44;
          if (isCompact) {
            card.classList.add('is-compact-short');
          }

          // Always render timespan below task title for all durations (15m, 30m, 45m, etc.)
          card.innerHTML = `
            <div class="week-event-title">${this._escapeHtml(ev.title)}</div>
            <div class="week-event-time">${ev.startTime} - ${ev.endTime}</div>
          `;

          this._setupWeekEventDrag(card, ev);

          dayCol.appendChild(card);
        }
      }

      // Quick add on clicking empty space in week view
      dayCol.addEventListener('click', (e) => {
        if (e.target.closest('.week-event-card')) return;
        const rect = dayCol.getBoundingClientRect();
        const clickY = e.clientY - rect.top;
        const clickedHour = Math.floor(startHour + (clickY / hourHeight));
        const safeStartHour = Math.min(endHour - 1, Math.max(startHour, clickedHour));
        const startTimeStr = `${String(safeStartHour).padStart(2, '0')}:00`;
        const endTimeStr = `${String(Math.min(endHour, safeStartHour + 1)).padStart(2, '0')}:00`;

        this.openEventInspector(null, dStr, startTimeStr, endTimeStr);
      });

      body.appendChild(dayCol);
    }
  }

  // 3. Month View (solid category background pills, no emoji, no left stripe)
  _renderMonthView() {
    const container = this.elements.monthGrid;
    if (!container) return;
    container.innerHTML = '';

    const year = this.currentDate.getFullYear();
    const month = this.currentDate.getMonth();
    const todayStr = this._formatDateISO(new Date());

    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const totalDays = lastDay.getDate();

    let startDayOfWeek = firstDay.getDay() - 1;
    if (startDayOfWeek === -1) startDayOfWeek = 6;

    const prevMonthLastDay = new Date(year, month, 0).getDate();
    const allEvents = this._getVisibleCalendarEvents();

    const totalCells = (startDayOfWeek + totalDays > 35) ? 42 : 35;
    const padlockSvg = `<svg class="cal-mini-lock-svg" width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z"/></svg>`;

    for (let i = 0; i < totalCells; i++) {
      const cell = document.createElement('div');
      cell.className = 'month-day-cell';

      let cellDate = null;
      let dayNumber = 0;

      if (i < startDayOfWeek) {
        dayNumber = prevMonthLastDay - (startDayOfWeek - i - 1);
        cellDate = new Date(year, month - 1, dayNumber);
        cell.classList.add('other-month');
      } else if (i >= startDayOfWeek + totalDays) {
        dayNumber = i - (startDayOfWeek + totalDays) + 1;
        cellDate = new Date(year, month + 1, dayNumber);
        cell.classList.add('other-month');
      } else {
        dayNumber = i - startDayOfWeek + 1;
        cellDate = new Date(year, month, dayNumber);
      }

      const dateStr = this._formatDateISO(cellDate);
      cell.setAttribute('data-date', dateStr);

      if (dateStr === todayStr) {
        cell.classList.add('today');
      }

      const header = document.createElement('div');
      header.className = 'cell-header';
      const numSpan = document.createElement('span');
      numSpan.className = 'cell-day-num';
      numSpan.textContent = dayNumber;
      header.appendChild(numSpan);
      cell.appendChild(header);

      const eventsForDate = allEvents.filter(e => e.date === dateStr);
      const eventsList = document.createElement('div');
      eventsList.className = 'cell-events-list';

      const maxPills = 3;
      const displayCount = Math.min(eventsForDate.length, maxPills);

      for (let j = 0; j < displayCount; j++) {
        const ev = eventsForDate[j];
        const pill = document.createElement('div');
        pill.className = `month-event-pill ${ev.isLocked ? 'is-locked' : ''}`;
        pill.title = `${ev.title} (${ev.startTime} - ${ev.endTime})`;
        pill.style.backgroundColor = ev.color || this._getCategoryColor(ev.category);
        pill.setAttribute('data-event-id', ev.id);

        // Solid background, NO emoji, task title only (clipped without ...)
        const title = document.createElement('span');
        title.className = 'event-title';
        title.textContent = ev.title;
        pill.appendChild(title);

        // Only show padlock if title is short (<= 5 chars) so maximum task name fits on mobile
        if (ev.isLocked && ev.title && ev.title.length <= 5) {
          const lockSpan = document.createElement('span');
          lockSpan.innerHTML = padlockSvg;
          pill.appendChild(lockSpan);
        }

        this._setupMonthEventDrag(pill, ev);

        eventsList.appendChild(pill);
      }

      if (eventsForDate.length > maxPills) {
        const more = document.createElement('div');
        more.className = 'month-more-pill';
        more.textContent = `+${eventsForDate.length - maxPills} more`;
        eventsList.appendChild(more);
      }

      cell.appendChild(eventsList);

      // Cell click: select date and switch to Day view
      cell.addEventListener('click', (e) => {
        if (e.target.closest('.month-event-pill')) return;
        this.selectedDate = cellDate;
        this.currentDate = cellDate;
        this.switchView('day');
      });

      container.appendChild(cell);
    }
  }

  // ==========================================
  // Dynamic Current Time Line & Auto-Scroll (Left-Side Badge & Exact Clock Sync)
  // ==========================================

  _renderCurrentTimeLine(targetBody) {
    const body = targetBody || this.elements.dayTimelineBody;
    if (!body) return;

    let line = body.querySelector('.day-current-time-line');
    if (!line) {
      line = document.createElement('div');
      line.className = 'day-current-time-line';
      body.appendChild(line);
    }

    const now = new Date();
    const minFromMidnight = (now.getHours() * 60) + now.getMinutes();

    const isCustom = taskStore.getCalendarCustomRangeEnabled();
    let startHour = 0;
    let endHour = 24;
    if (isCustom) {
      const startStr = taskStore.getCalendarStartTime() || '08:00';
      const endStr = taskStore.getCalendarEndTime() || '22:00';
      startHour = Math.max(0, Math.min(23, Math.floor(this._parseTimeToMinutes(startStr) / 60)));
      endHour = Math.max(startHour + 1, Math.min(24, Math.ceil(this._parseTimeToMinutes(endStr) / 60)));
    }

    if (minFromMidnight < startHour * 60 || minFromMidnight > endHour * 60) {
      line.style.display = 'none';
      return;
    }
    line.style.display = '';

    const hourHeight = this.dayHourHeight || 56;
    const topPx = 14 + (((minFromMidnight - (startHour * 60)) / 60) * hourHeight);
    line.style.top = `${topPx}px`;

    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');

    let badge = line.querySelector('.day-current-time-badge');
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'day-current-time-badge';
      line.appendChild(badge);
    }
    badge.textContent = `${hh}:${mm}`;
  }

  _startTimeTicker() {
    this._stopTimeTicker();

    const update = () => {
      if (this.activeView === 'day' && this._isViewingToday()) {
        this._renderCurrentTimeLine();
      }
    };

    update();

    // Precision sync to next minute boundary
    const now = new Date();
    const msUntilNextMinute = ((60 - now.getSeconds()) * 1000) - now.getMilliseconds() + 50;

    this.currentTimeTimer = setTimeout(() => {
      update();
      this.currentTimeTimer = setInterval(update, 10000); // 10s sync
    }, Math.max(100, msUntilNextMinute));
  }

  _stopTimeTicker() {
    if (this.currentTimeTimer) {
      clearTimeout(this.currentTimeTimer);
      clearInterval(this.currentTimeTimer);
      this.currentTimeTimer = null;
    }
  }

  _scrollToCurrentTime() {
    const scrollEl = this.elements.dayTimelineScroll;
    if (!scrollEl) return;
    const now = new Date();
    const minFromMidnight = (now.getHours() * 60) + now.getMinutes();

    const isCustom = taskStore.getCalendarCustomRangeEnabled();
    let startHour = 0;
    if (isCustom) {
      const startStr = taskStore.getCalendarStartTime() || '08:00';
      startHour = Math.max(0, Math.min(23, Math.floor(this._parseTimeToMinutes(startStr) / 60)));
    }

    const hourHeight = this.dayHourHeight || 56;
    let focusMin = minFromMidnight;
    const activeCard = scrollEl.querySelector('.day-event-card.is-event-current');
    if (activeCard) {
      const cardTop = parseInt(activeCard.style.top, 10);
      if (!isNaN(cardTop)) {
        const contHeight = scrollEl.clientHeight || 500;
        scrollEl.scrollTop = Math.max(0, cardTop - (contHeight / 2) + ((parseInt(activeCard.style.height, 10) || 40) / 2));
        return;
      }
    }
    const topPx = 14 + (((Math.max(startHour * 60, focusMin) - (startHour * 60)) / 60) * hourHeight);
    const contHeight = scrollEl.clientHeight || 500;
    scrollEl.scrollTop = Math.max(0, topPx - (contHeight / 2));
  }

  _isViewingToday() {
    const sel = this.selectedDate || this.currentDate;
    return this._formatDateISO(sel) === this._formatDateISO(new Date());
  }

  // ==========================================
  // Task Duration Resize Handles (Hold-Still Gesture)
  // ==========================================

  _clearActiveResizeHandles() {
    this.isDraggingEvent = false;
    if (this.activeResizeCard) {
      this.activeResizeCard.classList.remove('has-resize-handles');
      const handles = this.activeResizeCard.querySelectorAll('.event-resize-handle');
      for (let i = 0; i < handles.length; i++) {
        const h = handles[i];
        if (h.parentNode) {
          h.parentNode.removeChild(h);
        } else if (typeof h.remove === 'function') {
          h.remove();
        }
      }
      this.activeResizeCard = null;
      this.activeResizeEvent = null;
    }
    const allHandles = document.querySelectorAll('.event-resize-handle');
    for (let i = 0; i < allHandles.length; i++) {
      const h = allHandles[i];
      if (h.parentNode) {
        h.parentNode.removeChild(h);
      } else if (typeof h.remove === 'function') {
        h.remove();
      }
    }
    const allCards = document.querySelectorAll('.has-resize-handles');
    for (let i = 0; i < allCards.length; i++) {
      allCards[i].classList.remove('has-resize-handles');
    }
  }

  _attachResizeHandles(card, ev, viewType) {
    this._clearActiveResizeHandles();
    this.activeResizeCard = card;
    this.activeResizeEvent = ev;
    card.classList.add('has-resize-handles');

    const topHandle = document.createElement('div');
    topHandle.className = 'event-resize-handle handle-top';
    topHandle.setAttribute('data-handle', 'top');
    topHandle.setAttribute('title', 'Drag to adjust start time');

    const bottomHandle = document.createElement('div');
    bottomHandle.className = 'event-resize-handle handle-bottom';
    bottomHandle.setAttribute('data-handle', 'bottom');
    bottomHandle.setAttribute('title', 'Drag to adjust end time');

    card.appendChild(topHandle);
    card.appendChild(bottomHandle);

    this._setupResizeHandleDrag(topHandle, 'top', card, ev, viewType);
    this._setupResizeHandleDrag(bottomHandle, 'bottom', card, ev, viewType);

    const outsideDismissHandler = (e) => {
      if (!card.contains(e.target)) {
        this._clearActiveResizeHandles();
        document.removeEventListener('pointerdown', outsideDismissHandler, true);
        document.removeEventListener('touchstart', outsideDismissHandler, true);
      }
    };
    setTimeout(() => {
      document.addEventListener('pointerdown', outsideDismissHandler, true);
      document.addEventListener('touchstart', outsideDismissHandler, true);
    }, 60);
  }

  _setupResizeHandleDrag(handleEl, edge, card, ev, viewType) {
    const isTop = edge === 'top';
    let isResizing = false;
    let initialStartMin = 0;
    let initialEndMin = 0;
    let currentStartMin = 0;
    let currentEndMin = 0;
    let currentDur = 0;
    const self = this;

    const resolution = viewType === 'week' ? (this.weekResolution || 15) : (this.currentResolution || 15);
    const container = viewType === 'week' ? this.elements.weekGridScroll : this.elements.dayTimelineScroll;
    const hourHeight = viewType === 'week' ? (this.weekHourHeight || 44) : (this.dayHourHeight || 56);

    const isCustom = taskStore.getCalendarCustomRangeEnabled();
    let startHour = 0;
    let endHour = 24;
    if (isCustom) {
      const startStr = taskStore.getCalendarStartTime() || '08:00';
      const endStr = taskStore.getCalendarEndTime() || '22:00';
      startHour = Math.max(0, Math.min(23, Math.floor(this._parseTimeToMinutes(startStr) / 60)));
      endHour = Math.max(startHour + 1, Math.min(24, Math.ceil(this._parseTimeToMinutes(endStr) / 60)));
    }

    const onPointerDown = (e) => {
      e.stopPropagation();
      if (e.cancelable) e.preventDefault();

      if (ev.isLocked) {
        mobileServices.hapticWarning();
        self._showToast('🔒 Unlock event before adjusting time');
        card.classList.remove('lock-pulse-glow');
        void card.offsetWidth;
        card.classList.add('lock-pulse-glow');
        setTimeout(() => {
          if (card) card.classList.remove('lock-pulse-glow');
        }, 950);
        return;
      }

      isResizing = true;
      self.isDraggingEvent = true;
      handleEl.classList.add('is-active-dragging');
      mobileServices.hapticTap();

      initialStartMin = self._parseTimeToMinutes(ev.startTime);
      initialEndMin = self._parseTimeToMinutes(ev.endTime);
      currentStartMin = initialStartMin;
      currentEndMin = initialEndMin;
      currentDur = ev.plannedDuration || (currentEndMin - currentStartMin);

      if (container) {
        container.style.overflowY = 'hidden';
      }

      const onPointerMove = (moveEv) => {
        if (!isResizing) return;
        moveEv.stopPropagation();
        if (moveEv.cancelable) moveEv.preventDefault();

        const clientY = (moveEv.touches && moveEv.touches[0]) ? moveEv.touches[0].clientY : moveEv.clientY;
        const contRect = container ? container.getBoundingClientRect() : { top: 0 };
        const relativeY = (clientY - contRect.top) + (container ? container.scrollTop : 0) - 14;
        const rawMinutes = (startHour * 60) + ((Math.max(0, relativeY) / hourHeight) * 60);
        const snappedMinutes = Math.round(rawMinutes / resolution) * resolution;
        const minDur = resolution;

        if (isTop) {
          currentStartMin = Math.max(startHour * 60, Math.min(initialEndMin - minDur, snappedMinutes));
          currentDur = initialEndMin - currentStartMin;
          const newTopPx = 14 + (((currentStartMin - (startHour * 60)) / 60) * hourHeight);
          const newHeightPx = Math.max(16, (currentDur / 60) * hourHeight);

          card.style.top = `${newTopPx}px`;
          card.style.height = `${newHeightPx}px`;

          const startStr = self._formatMinutesToTime(currentStartMin);
          const endStr = ev.endTime;

          if (viewType === 'day') {
            const timeRangeEl = card.querySelector('.event-time-range');
            const durPill = card.querySelector('.event-duration-pill');
            if (timeRangeEl) timeRangeEl.textContent = `${startStr} - ${endStr}`;
            if (durPill) durPill.textContent = `(${currentDur}m)`;
            self._applyEventCardLayout(card, newHeightPx);
          } else {
            const weekTimeEl = card.querySelector('.week-event-time');
            if (weekTimeEl) weekTimeEl.textContent = `${startStr} - ${endStr}`;
          }

          self._updateLiveOverlapIndentation(card, ev, currentStartMin, initialEndMin, viewType);
        } else {
          currentEndMin = Math.max(initialStartMin + minDur, Math.min(endHour * 60, snappedMinutes));
          currentDur = currentEndMin - initialStartMin;
          const newHeightPx = Math.max(16, (currentDur / 60) * hourHeight);

          card.style.height = `${newHeightPx}px`;

          const startStr = ev.startTime;
          const endStr = self._formatMinutesToTime(currentEndMin);

          if (viewType === 'day') {
            const timeRangeEl = card.querySelector('.event-time-range');
            const durPill = card.querySelector('.event-duration-pill');
            if (timeRangeEl) timeRangeEl.textContent = `${startStr} - ${endStr}`;
            if (durPill) durPill.textContent = `(${currentDur}m)`;
            self._applyEventCardLayout(card, newHeightPx);
          } else {
            const weekTimeEl = card.querySelector('.week-event-time');
            if (weekTimeEl) weekTimeEl.textContent = `${startStr} - ${endStr}`;
          }

          self._updateLiveOverlapIndentation(card, ev, initialStartMin, currentEndMin, viewType);
        }
      };

      const onPointerUp = (upEv) => {
        if (!isResizing) return;
        isResizing = false;
        self.isDraggingEvent = false;
        handleEl.classList.remove('is-active-dragging');

        window.removeEventListener('touchmove', onPointerMove);
        window.removeEventListener('touchend', onPointerUp);
        window.removeEventListener('touchcancel', onPointerUp);
        window.removeEventListener('mousemove', onPointerMove);
        window.removeEventListener('mouseup', onPointerUp);

        if (container) {
          container.style.removeProperty('overflow-y');
        }

        const finalStartMin = isTop ? currentStartMin : initialStartMin;
        const finalEndMin = isTop ? initialEndMin : currentEndMin;
        const finalDur = Math.max(resolution, finalEndMin - finalStartMin);
        const finalStartStr = self._formatMinutesToTime(finalStartMin);
        const finalEndStr = self._formatMinutesToTime(finalEndMin);

        const updatedEv = taskStore.updateCalendarEvent(ev.id, {
          startTime: finalStartStr,
          endTime: finalEndStr,
          plannedDuration: finalDur,
          fixedStartTime: ev.isLocked ? finalStartStr : (ev.fixedStartTime ? finalStartStr : null),
          isLocked: Boolean(ev.isLocked)
        });
        if (typeof calendarSyncService !== 'undefined' && calendarSyncService && typeof calendarSyncService.pushEventUpdate === 'function') {
          calendarSyncService.pushEventUpdate(updatedEv);
        }

        const todayStr = self._formatDateISO(new Date());
        if (ev.date === todayStr) {
          if (typeof window !== 'undefined' && window.runtime) {
            const rt = window.runtime;
            rt.initialTasks = taskStore.getTasks();
            rt.recalculate();
            if (typeof window.syncDynamicScheduleTimesToCalendar === 'function') {
              window.syncDynamicScheduleTimesToCalendar();
            }
            if (typeof window.updateActiveTaskDisplay === 'function') {
              window.updateActiveTaskDisplay();
            }
            if (typeof window.updateScheduleUI === 'function') {
              window.updateScheduleUI(rt.currentSchedule);
            }
            if (typeof window.renderTaskList === 'function') {
              window.renderTaskList(((rt.currentSchedule && rt.currentSchedule.tasks) || []) || []);
            }
            if (typeof window.renderCalendarModal === 'function') {
              window.renderCalendarModal();
            }
          }
        }

        if (typeof window !== 'undefined' && typeof window.clearDismissedOverlapPairs === 'function') {
          window.clearDismissedOverlapPairs();
        }

        mobileServices.hapticTap();
        self._showToast(`✓ Updated duration: ${finalStartStr} - ${finalEndStr} (${finalDur}m)`);
        self.render();
      };

      window.addEventListener('touchmove', onPointerMove, { passive: false });
      window.addEventListener('touchend', onPointerUp, { passive: false });
      window.addEventListener('touchcancel', onPointerUp, { passive: false });
      window.addEventListener('mousemove', onPointerMove);
      window.addEventListener('mouseup', onPointerUp);
    };

    handleEl.addEventListener('touchstart', onPointerDown, { passive: false });
    handleEl.addEventListener('mousedown', onPointerDown);
  }

  _updateLiveOverlapIndentation(card, ev, startMin, endMin, viewType) {
    const parent = card.parentNode;
    if (!parent) return;

    const selector = viewType === 'week' ? '.week-event-card' : '.day-event-card';
    const siblingCards = parent.querySelectorAll(selector);
    const allEvents = taskStore.getCalendarEvents();

    let hasOverlap = false;

    for (let i = 0; i < siblingCards.length; i++) {
      const sib = siblingCards[i];
      const sibId = sib.getAttribute('data-event-id');
      if (!sibId || sibId === ev.id) continue;

      const sibEv = allEvents.find(e => e.id === sibId);
      if (!sibEv) continue;

      const oStart = this._parseTimeToMinutes(sibEv.startTime);
      const oEnd = this._parseTimeToMinutes(sibEv.endTime);

      if (startMin < oEnd && endMin > oStart) {
        hasOverlap = true;
        if (startMin >= oStart) {
          card.classList.add('is-overlapping-later');
          card.classList.remove('is-overlapping-earlier');
          sib.classList.add('is-overlapping-earlier');
          sib.classList.remove('is-overlapping-later');
        } else {
          card.classList.add('is-overlapping-earlier');
          card.classList.remove('is-overlapping-later');
          sib.classList.add('is-overlapping-later');
          sib.classList.remove('is-overlapping-earlier');
        }
      }
    }

    if (!hasOverlap) {
      card.classList.remove('is-overlapping-later', 'is-overlapping-earlier');
    }
  }

  // ==========================================
  // Hold-to-Drag & Tap-to-Inspect Handlers
  // ==========================================

  // Day View: hold 200ms to drag up/down, snaps to currentResolution intervals, locks scroll and auto-scrolls at borders
  _setupDayEventDrag(card, ev) {
    let holdTimer = null;
    let isDragging = false;
    let startY = 0;
    let startX = 0;
    let initialTop = 0;
    let lastClientX = 0;
    let lastClientY = 0;
    let grabOffsetX = 0;
    let grabOffsetY = 0;
    let silhouette = null;
    let autoScrollRaf = null;
    let dayNavTimer = null;
    let isDayPanning = false;
    let isDayPanCooldown = false;
    const resolution = this.currentResolution || 15;
    const durMin = ev.plannedDuration || 60;
    let container = this.elements.dayTimelineScroll;

    const isCustom = taskStore.getCalendarCustomRangeEnabled();
    let startHour = 0;
    let endHour = 24;
    if (isCustom) {
      const startStr = taskStore.getCalendarStartTime() || '08:00';
      const endStr = taskStore.getCalendarEndTime() || '22:00';
      startHour = Math.max(0, Math.min(23, Math.floor(this._parseTimeToMinutes(startStr) / 60)));
      endHour = Math.max(startHour + 1, Math.min(24, Math.ceil(this._parseTimeToMinutes(endStr) / 60)));
    }

    const startAutoScrollLoop = () => {
      const step = () => {
        if (!isDragging || !container) return;
        const rect = container.getBoundingClientRect();
        const edgeThreshold = 55;
        let scrollDelta = 0;

        if (lastClientY < rect.top + edgeThreshold) {
          const intensity = Math.min(1, Math.max(0, (rect.top + edgeThreshold - lastClientY) / edgeThreshold));
          scrollDelta = -Math.round(3 + (intensity * 14));
        } else if (lastClientY > rect.bottom - edgeThreshold) {
          const intensity = Math.min(1, Math.max(0, (lastClientY - (rect.bottom - edgeThreshold)) / edgeThreshold));
          scrollDelta = Math.round(3 + (intensity * 14));
        }

        if (scrollDelta !== 0) {
          const oldScroll = container.scrollTop;
          container.scrollTop = Math.max(0, container.scrollTop + scrollDelta);
          const actualScrolled = container.scrollTop - oldScroll;
          if (actualScrolled !== 0) {
            updateDayDragPosition(lastClientX, lastClientY);
          }
        }

        autoScrollRaf = requestAnimationFrame(step);
      };
      autoScrollRaf = requestAnimationFrame(step);
    };

    const checkDayEdgePull = (clientX) => {
      const modalBody = this.elements.modalBody || document.querySelector('.full-calendar-body');
      if (!modalBody || isDayPanning || isDayPanCooldown) return;
      const modalRect = modalBody.getBoundingClientRect();
      const cardLeft = clientX - grabOffsetX;
      const cardWidth = card.offsetWidth || card.clientWidth || 300;
      const cardMidX = cardLeft + (cardWidth / 2);
      const isLeft = (cardMidX < modalRect.left + 70) || (clientX < modalRect.left + 40);
      const isRight = (cardMidX > modalRect.right - 70) || (clientX > modalRect.right - 40);

      if (isLeft || isRight) {
        if (!dayNavTimer) {
          const navDir = isRight ? 1 : -1;
          dayNavTimer = setTimeout(() => {
            dayNavTimer = null;
            if (!isDragging) return;
            panToAdjacentDay(navDir);
          }, 480);
        }
      } else {
        if (dayNavTimer) {
          clearTimeout(dayNavTimer);
          dayNavTimer = null;
        }
      }
    };

    const panToAdjacentDay = (direction) => {
      if (isDayPanning || isDayPanCooldown || !isDragging) return;
      isDayPanning = true;
      isDayPanCooldown = true;
      startX = lastClientX;

      const modalBody = this.elements.modalBody || document.querySelector('.full-calendar-body');
      if (!modalBody) {
        isDayPanning = false;
        return;
      }
      const bodyWidth = modalBody.clientWidth || 360;
      let activeContainer = this.elements.dayView || modalBody.querySelector('.calendar-view-container');
      if (!activeContainer) {
        isDayPanning = false;
        return;
      }

      // direction < 0: Dragged left -> Previous day
      // direction > 0: Dragged right -> Next day
      const nextDate = new Date(this.selectedDate || this.currentDate);
      nextDate.setDate(nextDate.getDate() + direction);

      const currentScrollTop = container ? container.scrollTop : 0;
      const adjacentSlide = this._buildAdjacentPreviewSlide(nextDate, direction, currentScrollTop);
      if (!adjacentSlide) {
        isDayPanning = false;
        return;
      }

      const startXAdj = direction < 0 ? -bodyWidth : bodyWidth;
      adjacentSlide.style.transition = 'none';
      adjacentSlide.style.transform = `translate3d(${startXAdj}px, 0, 0)`;
      modalBody.appendChild(adjacentSlide);

      const adjScroll = adjacentSlide.querySelector('.day-timeline-scroll');
      if (adjScroll) {
        adjScroll.scrollTop = currentScrollTop;
      }

      // Force reflow
      void adjacentSlide.offsetWidth;

      // Animate activeContainer and adjacentSlide smoothly over 320ms
      const exitX = direction < 0 ? bodyWidth : -bodyWidth;
      activeContainer.style.transition = 'transform 0.32s cubic-bezier(0.16, 1, 0.3, 1)';
      adjacentSlide.style.transition = 'transform 0.32s cubic-bezier(0.16, 1, 0.3, 1)';
      activeContainer.style.transform = `translate3d(${exitX}px, 0, 0)`;
      adjacentSlide.style.transform = 'translate3d(0, 0, 0)';

      setTimeout(() => {
        const savedScrollTop = container ? container.scrollTop : 0;
        this.navigate(direction, savedScrollTop);
        if (adjacentSlide && adjacentSlide.parentNode) {
          adjacentSlide.parentNode.removeChild(adjacentSlide);
        }
        if (activeContainer) {
          activeContainer.style.removeProperty('transform');
          activeContainer.style.removeProperty('transition');
        }

        container = this.elements.dayTimelineScroll;
        if (container) container.style.overflowY = 'hidden';

        isDayPanning = false;
        mobileServices.hapticBuzz();
        this._showToast(direction > 0 ? '📅 Next day' : '📅 Previous day');

        if (isDragging) {
          updateDayDragPosition(lastClientX, lastClientY);
        }

        // Allow panning again after short cooldown; if user continues holding near edge, repeat pan!
        setTimeout(() => {
          isDayPanCooldown = false;
          if (isDragging) {
            checkDayEdgePull(lastClientX);
          }
        }, 450);
      }, 320);
    };

    const updateDayDragPosition = (clientX, clientY) => {
      if (!isDragging) return;
      lastClientX = clientX;
      lastClientY = clientY;

      // Floating card stays precisely attached to the finger with ZERO relative shift
      card.style.left = `${clientX - grabOffsetX}px`;
      card.style.top = `${clientY - grabOffsetY}px`;
      card.style.transform = 'scale(1.05)';

      checkDayEdgePull(clientX);

      // Trigger day pan only when the card's midpoint or touch point is close to the far left or far right edge with resistance
      const modalBody = this.elements.modalBody || document.querySelector('.full-calendar-body');
      const modalRect = modalBody ? modalBody.getBoundingClientRect() : {
        left: 0,
        right: (typeof window !== 'undefined' && window.innerWidth) ? window.innerWidth : 360,
        width: 360
      };
      if (!isDayPanning && !isDayPanCooldown) {
        const cardLeft = clientX - grabOffsetX;
        const cardWidth = card.offsetWidth || card.clientWidth || 300;
        const cardMidX = cardLeft + (cardWidth / 2);
        const diffX = clientX - startX;

        // Transition to previous day when midpoint or touch point is at far left edge with resistance
        const isFarLeft = (cardMidX < modalRect.left + 70) || (clientX < modalRect.left + 40);
        if (diffX < -45 && isFarLeft) {
          panToAdjacentDay(-1);
        } else {
          // Transition to next day when midpoint or touch point is at far right edge with resistance
          const isFarRight = (cardMidX > modalRect.right - 70) || (clientX > modalRect.right - 40);
          if (diffX > 45 && isFarRight) {
            panToAdjacentDay(1);
          }
        }
      }

      // Update silhouette in active day timeline
      const newBody = this.elements.dayTimelineBody;
      if (silhouette && newBody && container) {
        const contRect = container.getBoundingClientRect();
        const hourHeight = this.dayHourHeight || 56;
        const cardTopY = (clientY - grabOffsetY) - contRect.top + container.scrollTop - 14;
        const rawMinutes = (startHour * 60) + ((Math.max(0, cardTopY) / hourHeight) * 60);
        const snappedMinutes = Math.max(startHour * 60, Math.min((endHour * 60) - durMin, Math.round(rawMinutes / resolution) * resolution));
        const snappedTopPx = 14 + (((snappedMinutes - (startHour * 60)) / 60) * hourHeight);
        const durHeight = Math.max(26, (durMin / 60) * hourHeight);

        if (silhouette.parentNode !== newBody) {
          newBody.appendChild(silhouette);
        }
        silhouette.style.top = `${snappedTopPx - 2}px`;
        silhouette.style.height = `${durHeight + 4}px`;
        silhouette.style.display = 'block';

        const previewStartH = Math.floor(snappedMinutes / 60);
        const previewStartM = snappedMinutes % 60;
        const previewEndTotal = snappedMinutes + durMin;
        const previewEndH = Math.min(23, Math.floor(previewEndTotal / 60));
        const previewEndM = previewEndTotal % 60;

        const timeRangeEl = card.querySelector('.event-time-range');
        if (timeRangeEl) {
          timeRangeEl.textContent = `${String(previewStartH).padStart(2, '0')}:${String(previewStartM).padStart(2, '0')} - ${String(previewEndH).padStart(2, '0')}:${String(previewEndM).padStart(2, '0')}`;
        }
      }
    };

    const onWindowTouchMove = (e) => {
      if (!isDragging || !(e.touches && e.touches.length === 1)) return;
      if (e.cancelable) e.preventDefault();
      lastClientX = e.touches[0].clientX;
      lastClientY = e.touches[0].clientY;
      updateDayDragPosition(lastClientX, lastClientY);
    };

    const onWindowTouchEnd = () => {
      finishDrag();
    };

    const onWindowTouchCancel = () => {
      finishDrag();
    };

    const cancelDrag = () => {
      if (holdTimer) {
        clearTimeout(holdTimer);
        holdTimer = null;
      }
      this._activeDragCancelHandler = null;
      if (!isDragging) return;
      isDragging = false;
      this.isDraggingEvent = false;
      this._activeDragCancelHandler = null;

      if (dayNavTimer) {
        clearTimeout(dayNavTimer);
        dayNavTimer = null;
      }
      isDayPanCooldown = false;
      window.removeEventListener('touchmove', onWindowTouchMove);
      window.removeEventListener('touchend', onWindowTouchEnd);
      window.removeEventListener('touchcancel', onWindowTouchCancel);

      if (autoScrollRaf) {
        cancelAnimationFrame(autoScrollRaf);
        autoScrollRaf = null;
      }
      if (container) {
        container.style.removeProperty('overflow-y');
      }
      card.classList.remove('is-dragging-cal-event');
      card.style.removeProperty('transform');
      card.style.removeProperty('position');
      card.style.removeProperty('left');
      card.style.removeProperty('top');
      card.style.removeProperty('width');
      card.style.removeProperty('z-index');
      card.style.removeProperty('pointer-events');
      card.style.removeProperty('transition');

      if (card.parentNode === document.body) {
        document.body.removeChild(card);
      }
      if (silhouette && silhouette.parentNode) {
        silhouette.parentNode.removeChild(silhouette);
        silhouette = null;
      }
      const savedScrollTop = container ? container.scrollTop : 0;
      this.render(savedScrollTop);
    };

    const triggerDayLockedWarning = () => {
      mobileServices.hapticWarning();
      this._showToast('🔒 Unlock event before moving');
      card.classList.remove('lock-pulse-glow');
      const lockBtn = card.querySelector('.cal-event-lock-btn');
      if (lockBtn) lockBtn.classList.remove('pulse-glow');
      void card.offsetWidth;
      card.classList.add('lock-pulse-glow');
      if (lockBtn) lockBtn.classList.add('pulse-glow');
      setTimeout(() => {
        if (card) card.classList.remove('lock-pulse-glow');
        if (lockBtn) lockBtn.classList.remove('pulse-glow');
      }, 950);
    };

    const startDragMode = () => {
      if (this.isPinching || Date.now() < this.pinchCooldownUntil) {
        if (holdTimer) clearTimeout(holdTimer);
        holdTimer = null;
        return;
      }
      if (ev.isLocked) {
        triggerDayLockedWarning();
        return;
      }
      isDragging = true;
      this.isDraggingEvent = true;
      this._activeDragCancelHandler = cancelDrag;

      const cRect = card.getBoundingClientRect();
      const curX = lastClientX || startX;
      const curY = lastClientY || startY;
      if (!grabOffsetX) grabOffsetX = curX - cRect.left;
      if (!grabOffsetY) grabOffsetY = curY - cRect.top;

      card.style.position = 'fixed';
      card.style.left = `${curX - grabOffsetX}px`;
      card.style.top = `${curY - grabOffsetY}px`;
      card.style.width = `${cRect.width}px`;
      card.style.zIndex = '99999';
      card.style.pointerEvents = 'none';
      card.style.transition = 'none';
      card.classList.add('is-dragging-cal-event');
      card.style.transform = 'scale(1.05)';
      document.body.appendChild(card);

      mobileServices.hapticBuzz();
      if (container) {
        container.style.overflowY = 'hidden';
      }
      if (!silhouette) {
        silhouette = document.createElement('div');
        silhouette.className = 'day-drop-preview-silhouette';
        silhouette.style.display = 'none';
      }
      updateDayDragPosition(curX, curY);
      startAutoScrollLoop();
      window.addEventListener('touchmove', onWindowTouchMove, { passive: false });
      window.addEventListener('touchend', onWindowTouchEnd, { passive: true });
      window.addEventListener('touchcancel', onWindowTouchCancel, { passive: true });
    };

    const finishDrag = () => {
      if (!isDragging) return;
      isDragging = false;
      this._activeDragCancelHandler = null;

      if (dayNavTimer) {
        clearTimeout(dayNavTimer);
        dayNavTimer = null;
      }
      isDayPanCooldown = false;
      window.removeEventListener('touchmove', onWindowTouchMove);
      window.removeEventListener('touchend', onWindowTouchEnd);
      window.removeEventListener('touchcancel', onWindowTouchCancel);

      if (autoScrollRaf) {
        cancelAnimationFrame(autoScrollRaf);
        autoScrollRaf = null;
      }
      if (container) {
        container.style.removeProperty('overflow-y');
      }
      card.classList.remove('is-dragging-cal-event');
      card.style.removeProperty('transform');
      card.style.removeProperty('position');
      card.style.removeProperty('left');
      card.style.removeProperty('top');
      card.style.removeProperty('width');
      card.style.removeProperty('z-index');
      card.style.removeProperty('pointer-events');
      card.style.removeProperty('transition');

      if (!hasMoved) {
        this.isDraggingEvent = false;
        if (card.parentNode && card.parentNode === document.body) {
          document.body.removeChild(card);
        }
        if (silhouette && silhouette.parentNode) {
          silhouette.parentNode.removeChild(silhouette);
          silhouette = null;
        }
        const savedScrollTop = container ? container.scrollTop : 0;
        this.render(savedScrollTop);
        const renderedCard = this.elements.dayTimelineBody ? this.elements.dayTimelineBody.querySelector(`[data-event-id="${ev.id}"]`) : null;
        if (renderedCard) {
          this._attachResizeHandles(renderedCard, ev, 'day');
        }
        mobileServices.hapticTap();
        return;
      }

      if (card.parentNode) {
        card.parentNode.removeChild(card);
      }
      if (silhouette && silhouette.parentNode) {
        silhouette.parentNode.removeChild(silhouette);
        silhouette = null;
      }

      const hourHeight = this.dayHourHeight || 56;
      let contRect = container ? container.getBoundingClientRect() : { top: 0 };
      let cardTopY = (lastClientY - grabOffsetY) - contRect.top + (container ? container.scrollTop : 0) - 14;
      const rawMinutes = (startHour * 60) + ((Math.max(0, cardTopY) / hourHeight) * 60);
      const newStartMin = Math.max(startHour * 60, Math.min((endHour * 60) - durMin, Math.round(rawMinutes / resolution) * resolution));

      const newStartH = Math.floor(newStartMin / 60);
      const newStartM = newStartMin % 60;
      const newEndTotal = newStartMin + durMin;
      const newEndH = Math.min(23, Math.floor(newEndTotal / 60));
      const newEndM = newEndTotal % 60;

      const newStartTime = `${String(newStartH).padStart(2, '0')}:${String(newStartM).padStart(2, '0')}`;
      const newEndTime = `${String(newEndH).padStart(2, '0')}:${String(newEndM).padStart(2, '0')}`;
      const targetDateStr = this._formatDateISO(this.selectedDate || this.currentDate);

      const updatedEv = taskStore.updateCalendarEvent(ev.id, {
        date: targetDateStr,
        startTime: newStartTime,
        endTime: newEndTime,
        plannedDuration: durMin,
        fixedStartTime: newStartTime,
        isLocked: Boolean(ev.isLocked)
      });
      if (typeof calendarSyncService !== 'undefined' && calendarSyncService && typeof calendarSyncService.pushEventUpdate === 'function') {
        calendarSyncService.pushEventUpdate(updatedEv);
      }

      // Check if newly placed event still overlaps with other events on targetDateStr
      let stillOverlaps = false;
      const allCalEvents = taskStore.getCalendarEvents(targetDateStr) || [];
      for (let ci = 0; ci < allCalEvents.length; ci++) {
        const other = allCalEvents[ci];
        if (other.id === ev.id) continue;
        if (!other.startTime || !other.endTime) continue;
        const oStart = this._parseTimeToMinutes(other.startTime);
        let oEnd = this._parseTimeToMinutes(other.endTime);
        if (oEnd <= oStart) oEnd += 1440;
        if (newStartMin < oEnd && newEndTotal > oStart) {
          stillOverlaps = true;
          break;
        }
      }

      if (!stillOverlaps && typeof window !== 'undefined' && typeof window.dismissOverlapForTask === 'function') {
        window.dismissOverlapForTask(ev.id);
      }

      this.isDraggingEvent = false;

      mobileServices.hapticTap();
      this._showToast(`✓ Rescheduled to ${targetDateStr} (${newStartTime} - ${newEndTime})`);
      const finalScrollTop = container ? container.scrollTop : 0;
      this.render(finalScrollTop);
    };

    // Touch events for mobile dragging
    let hasMoved = false;

    card.addEventListener('touchstart', (e) => {
      if (e.target.closest('[data-action="toggle-lock"], .event-resize-handle')) return;
      if (this.isPinching || Date.now() < this.pinchCooldownUntil || (e.touches && e.touches.length > 1)) {
        if (holdTimer) clearTimeout(holdTimer);
        holdTimer = null;
        return;
      }
      if (e.touches && e.touches.length === 1) {
        startX = e.touches[0].clientX;
        startY = e.touches[0].clientY;
        lastClientX = e.touches[0].clientX;
        lastClientY = e.touches[0].clientY;
        const cRect = card.getBoundingClientRect();
        grabOffsetX = e.touches[0].clientX - cRect.left;
        grabOffsetY = e.touches[0].clientY - cRect.top;
        initialTop = parseInt(card.style.top, 10) || 14;
        isDragging = false;
        hasMoved = false;
        this._activeDragCancelHandler = cancelDrag;

        holdTimer = setTimeout(() => {
          holdTimer = null;
          startDragMode();
        }, 200);
      }
    }, { passive: true });

    card.addEventListener('touchmove', (e) => {
      if (e.target && e.target.closest && e.target.closest('[data-action="toggle-lock"], .event-resize-handle')) return;
      if (this.isPinching || Date.now() < this.pinchCooldownUntil || (e.touches && e.touches.length > 1)) {
        cancelDrag();
        return;
      }
      if (!isDragging) {
        if (card.classList.contains('has-resize-handles')) {
          return;
        }
        if (holdTimer && e.touches && e.touches.length === 1) {
          const diffX = e.touches[0].clientX - startX;
          const diffY = e.touches[0].clientY - startY;
          if (Math.hypot(diffX, diffY) > 8) {
            hasMoved = true;
            clearTimeout(holdTimer);
            holdTimer = null;
            this._activeDragCancelHandler = null;
          }
        }
        return;
      }
      if (e.touches && e.touches.length === 1) {
        if (e.cancelable) e.preventDefault();
        lastClientX = e.touches[0].clientX;
        lastClientY = e.touches[0].clientY;
        hasMoved = true;
        updateDayDragPosition(lastClientX, lastClientY);
      }
    }, { passive: false });

    card.addEventListener('touchend', (e) => {
      if (e.target && e.target.closest && e.target.closest('[data-action="toggle-lock"], .event-resize-handle')) return;
      if (this.isPinching || Date.now() < this.pinchCooldownUntil) {
        cancelDrag();
        if (e && e.cancelable) e.preventDefault();
        return;
      }
      if (holdTimer) {
        clearTimeout(holdTimer);
        holdTimer = null;
        this._activeDragCancelHandler = null;
        if (e && e.cancelable) e.preventDefault();
        if (!card.classList.contains('has-resize-handles')) {
          this.openEventInspector(ev);
        }
        return;
      }
      if (ev.isLocked) {
        if (e && e.cancelable) e.preventDefault();
        this._activeDragCancelHandler = null;
        return;
      }
      finishDrag();
    }, { passive: false });

    card.addEventListener('touchcancel', () => {
      cancelDrag();
    }, { passive: true });

    // Mouse events for desktop dragging
    card.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      if (e.target.closest('[data-action="toggle-lock"], .event-resize-handle')) return;
      startX = e.clientX;
      startY = e.clientY;
      lastClientX = e.clientX;
      lastClientY = e.clientY;
      const cRect = card.getBoundingClientRect();
      grabOffsetX = e.clientX - cRect.left;
      grabOffsetY = e.clientY - cRect.top;
      initialTop = parseInt(card.style.top, 10) || 14;
      isDragging = false;
      hasMoved = false;

      holdTimer = setTimeout(() => {
        holdTimer = null;
        startDragMode();
      }, 200);

      const onMouseMove = (me) => {
        if (me.target && me.target.closest && me.target.closest('[data-action="toggle-lock"], .event-resize-handle')) return;
        if (!isDragging) {
          if (card.classList.contains('has-resize-handles')) return;
          if (holdTimer && Math.hypot(me.clientX - startX, me.clientY - startY) > 8) {
            hasMoved = true;
            clearTimeout(holdTimer);
            holdTimer = null;
          }
          return;
        }
        me.preventDefault();
        hasMoved = true;
        updateDayDragPosition(me.clientX, me.clientY);
      };

      const onMouseUp = (me) => {
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onMouseUp);
        if (me && me.target && me.target.closest && me.target.closest('[data-action="toggle-lock"], .event-resize-handle')) return;
        if (holdTimer) {
          clearTimeout(holdTimer);
          holdTimer = null;
          if (!card.classList.contains('has-resize-handles')) {
            this.openEventInspector(ev);
          }
          return;
        }
        if (ev.isLocked) {
          this._activeDragCancelHandler = null;
          return;
        }
        finishDrag();
      };

      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', onMouseUp);
    });
  }

  // Week View: hold 200ms to drag between days and hours (with lift effect & auto-scroll)
  _setupWeekEventDrag(card, ev) {
    let holdTimer = null;
    let isDragging = false;
    let startX = 0;
    let startY = 0;
    let lastClientX = 0;
    let lastClientY = 0;
    let grabOffsetX = 0;
    let grabOffsetY = 0;
    let silhouette = null;
    let currentSnappedTarget = null;
    let autoScrollRaf = null;
    let container = this.elements.weekGridScroll;

    const isCustom = taskStore.getCalendarCustomRangeEnabled();
    let startHour = 0;
    let endHour = 24;
    if (isCustom) {
      const startStr = taskStore.getCalendarStartTime() || '08:00';
      const endStr = taskStore.getCalendarEndTime() || '22:00';
      startHour = Math.max(0, Math.min(23, Math.floor(this._parseTimeToMinutes(startStr) / 60)));
      endHour = Math.max(startHour + 1, Math.min(24, Math.ceil(this._parseTimeToMinutes(endStr) / 60)));
    }

    const startAutoScrollLoop = () => {
      const step = () => {
        if (!isDragging || !container) return;
        const rect = container.getBoundingClientRect();
        const edgeThreshold = 55;
        let scrollDelta = 0;

        if (lastClientY < rect.top + edgeThreshold) {
          const intensity = Math.min(1, Math.max(0, (rect.top + edgeThreshold - lastClientY) / edgeThreshold));
          scrollDelta = -Math.round(3 + (intensity * 14));
        } else if (lastClientY > rect.bottom - edgeThreshold) {
          const intensity = Math.min(1, Math.max(0, (lastClientY - (rect.bottom - edgeThreshold)) / edgeThreshold));
          scrollDelta = Math.round(3 + (intensity * 14));
        }

        if (scrollDelta !== 0) {
          const oldScroll = container.scrollTop;
          container.scrollTop = Math.max(0, container.scrollTop + scrollDelta);
          const actualScrolled = container.scrollTop - oldScroll;
          if (actualScrolled !== 0) {
            startY -= actualScrolled;
          }
        }

        autoScrollRaf = requestAnimationFrame(step);
      };
      autoScrollRaf = requestAnimationFrame(step);
    };

    let currentOverCol = null;
    let weekNavTimer = null;
    let isWeekNavCooldown = false;

    const checkWeekEdgePull = (clientX) => {
      if (!container || isWeekNavCooldown) return;
      const rect = container.getBoundingClientRect();
      const isLeft = clientX < rect.left + 28;
      const isRight = clientX > rect.right - 28;

      if (isLeft || isRight) {
        if (!weekNavTimer) {
          const navDir = isRight ? 1 : -1;
          weekNavTimer = setTimeout(() => {
            weekNavTimer = null;
            if (!isDragging) return;

            isWeekNavCooldown = true;
            setTimeout(() => {
              isWeekNavCooldown = false;
              if (isDragging) {
                checkWeekEdgePull(lastClientX);
              }
            }, 650);

            const modalBody = this.elements.modalBody || document.querySelector('.full-calendar-body');
            const activeContainer = this.elements.weekView;
            const bodyWidth = modalBody ? (modalBody.clientWidth || 360) : 360;
            const currentScrollTop = container ? container.scrollTop : 0;
            const targetDate = new Date(this.currentDate);
            targetDate.setDate(targetDate.getDate() + (navDir * 7));
            const adjacentSlide = this._buildAdjacentPreviewSlide(targetDate, navDir, currentScrollTop);

            if (modalBody && adjacentSlide && activeContainer) {
              const startXAdj = navDir > 0 ? bodyWidth : -bodyWidth;
              adjacentSlide.style.transition = 'none';
              adjacentSlide.style.transform = `translate3d(${startXAdj}px, 0, 0)`;
              modalBody.appendChild(adjacentSlide);
              const adjScroll = adjacentSlide.querySelector('.week-grid-scroll');
              if (adjScroll) adjScroll.scrollTop = currentScrollTop;

              void adjacentSlide.offsetWidth;

              activeContainer.style.transition = 'transform 0.32s cubic-bezier(0.16, 1, 0.3, 1)';
              adjacentSlide.style.transition = 'transform 0.32s cubic-bezier(0.16, 1, 0.3, 1)';
              activeContainer.style.transform = `translate3d(${-startXAdj}px, 0, 0)`;
              adjacentSlide.style.transform = 'translate3d(0, 0, 0)';

              setTimeout(() => {
                this.navigate(navDir, currentScrollTop);
                if (adjacentSlide && adjacentSlide.parentNode) {
                  adjacentSlide.parentNode.removeChild(adjacentSlide);
                }
                if (activeContainer) {
                  activeContainer.style.removeProperty('transform');
                  activeContainer.style.removeProperty('transition');
                }
                container = this.elements.weekGridScroll;
                if (container) container.style.overflowY = 'hidden';
                if (isDragging) {
                  updateWeekDragPosition(lastClientX, lastClientY);
                }
              }, 320);
            } else {
              this.navigate(navDir, currentScrollTop);
              container = this.elements.weekGridScroll;
              if (isDragging) {
                updateWeekDragPosition(lastClientX, lastClientY);
              }
            }

            mobileServices.hapticBuzz();
            this._showToast(navDir > 0 ? '📅 Next week' : '📅 Previous week');
          }, 480);
        }
      } else {
        if (weekNavTimer) {
          clearTimeout(weekNavTimer);
          weekNavTimer = null;
        }
      }
    };

    const onWindowTouchMove = (e) => {
      if (this.isPinching || Date.now() < this.pinchCooldownUntil || (e.touches && e.touches.length > 1)) {
        cancelDrag();
        return;
      }
      if (!isDragging || !(e.touches && e.touches.length === 1)) return;
      if (e.cancelable) e.preventDefault();
      lastClientX = e.touches[0].clientX;
      lastClientY = e.touches[0].clientY;
      updateWeekDragPosition(lastClientX, lastClientY);
    };

    const onWindowTouchEnd = () => {
      finishDrag(lastClientX, lastClientY);
    };

    const onWindowTouchCancel = () => {
      cancelDrag();
    };

    const cancelDrag = () => {
      if (holdTimer) {
        clearTimeout(holdTimer);
        holdTimer = null;
      }
      this._activeDragCancelHandler = null;
      currentSnappedTarget = null;
      if (!isDragging) return;
      isDragging = false;
      this.isDraggingEvent = false;
      this._activeDragCancelHandler = null;

      if (silhouette && silhouette.parentNode) {
        silhouette.parentNode.removeChild(silhouette);
        silhouette = null;
      }
      if (weekNavTimer) {
        clearTimeout(weekNavTimer);
        weekNavTimer = null;
      }
      isWeekNavCooldown = false;
      window.removeEventListener('touchmove', onWindowTouchMove);
      window.removeEventListener('touchend', onWindowTouchEnd);
      window.removeEventListener('touchcancel', onWindowTouchCancel);
      if (autoScrollRaf) {
        cancelAnimationFrame(autoScrollRaf);
        autoScrollRaf = null;
      }
      if (container) {
        container.style.removeProperty('overflow-y');
      }
      if (card.parentElement) {
        card.parentElement.style.removeProperty('z-index');
      }
      card.style.removeProperty('position');
      card.style.removeProperty('left');
      card.style.removeProperty('top');
      card.style.removeProperty('width');
      card.style.removeProperty('z-index');
      card.style.removeProperty('transition');
      card.style.removeProperty('pointer-events');
      card.classList.remove('is-dragging-cal-event');
      card.style.removeProperty('transform');
      if (card.parentNode === document.body) {
        document.body.removeChild(card);
      }
      if (currentOverCol) {
        currentOverCol.classList.remove('drag-target-over');
      }
      currentOverCol = null;
      this.render();
    };

    const triggerWeekLockedWarning = () => {
      mobileServices.hapticWarning();
      this._showToast('🔒 Unlock event before moving');
      card.classList.remove('lock-pulse-glow');
      const lockSvg = card.querySelector('.cal-mini-lock-svg');
      if (lockSvg) lockSvg.classList.remove('pulse-glow');
      void card.offsetWidth;
      card.classList.add('lock-pulse-glow');
      if (lockSvg) lockSvg.classList.add('pulse-glow');
      setTimeout(() => {
        if (card) card.classList.remove('lock-pulse-glow');
        if (lockSvg) lockSvg.classList.remove('pulse-glow');
      }, 950);
    };

    const startDragMode = () => {
      if (this.isPinching || Date.now() < this.pinchCooldownUntil) {
        if (holdTimer) clearTimeout(holdTimer);
        holdTimer = null;
        return;
      }
      if (ev.isLocked) {
        triggerWeekLockedWarning();
        return;
      }
      isDragging = true;
      this.isDraggingEvent = true;
      this._activeDragCancelHandler = cancelDrag;

      const cRect = card.getBoundingClientRect();
      const curX = lastClientX || startX;
      const curY = lastClientY || startY;
      if (!grabOffsetX) grabOffsetX = curX - cRect.left;
      if (!grabOffsetY) grabOffsetY = curY - cRect.top;

      card.style.position = 'fixed';
      card.style.left = `${curX - grabOffsetX}px`;
      card.style.top = `${curY - grabOffsetY}px`;
      card.style.width = `${cRect.width}px`;
      card.style.zIndex = '99999';
      card.style.pointerEvents = 'none';
      card.style.transition = 'none';
      card.classList.add('is-dragging-cal-event');
      card.style.transform = 'scale(1.05)';
      document.body.appendChild(card);

      mobileServices.hapticBuzz();
      if (container) {
        container.style.overflowY = 'hidden';
      }
      if (!silhouette) {
        silhouette = document.createElement('div');
        silhouette.className = 'week-drop-preview-silhouette';
        silhouette.style.display = 'none';
      }
      updateWeekDragPosition(curX, curY);
      startAutoScrollLoop();
      window.addEventListener('touchmove', onWindowTouchMove, { passive: false });
      window.addEventListener('touchend', onWindowTouchEnd, { passive: true });
      window.addEventListener('touchcancel', onWindowTouchCancel, { passive: true });
    };

    const updateWeekDragPosition = (clientX, clientY) => {
      if (!isDragging) return;
      card.style.left = `${clientX - grabOffsetX}px`;
      card.style.top = `${clientY - grabOffsetY}px`;
      card.style.transform = 'scale(1.05)';
      checkWeekEdgePull(clientX);

      const cRect = card.getBoundingClientRect();
      const centerX = (clientX - grabOffsetX) + (cRect.width / 2);
      const centerY = (clientY - grabOffsetY) + (cRect.height / 2);

      card.style.pointerEvents = 'none';
      const targetEl = document.elementFromPoint(centerX, centerY);

      const targetCol = targetEl ? targetEl.closest('.week-day-col') : null;
      if (targetCol !== currentOverCol) {
        if (currentOverCol) currentOverCol.classList.remove('drag-target-over');
        currentOverCol = targetCol;
        if (currentOverCol) currentOverCol.classList.add('drag-target-over');
      }

      if (targetCol) {
        const colRect = targetCol.getBoundingClientRect();
        const cardTopY = (clientY - grabOffsetY) - colRect.top;
        const hourHeight = this.weekHourHeight || 50;
        const resolution = this.weekResolution || 15;
        const rawMinutes = (startHour * 60) + ((Math.max(0, cardTopY) / hourHeight) * 60);
        const dur = ev.plannedDuration || 60;
        const snappedStartMin = Math.max(startHour * 60, Math.min((endHour * 60) - dur, Math.round(rawMinutes / resolution) * resolution));
        const newStartH = Math.floor(snappedStartMin / 60);
        const newStartM = snappedStartMin % 60;
        const newStartTime = `${String(newStartH).padStart(2, '0')}:${String(newStartM).padStart(2, '0')}`;
        const newEndTotal = snappedStartMin + dur;
        const endH = Math.min(23, Math.floor(newEndTotal / 60));
        const endM = newEndTotal % 60;
        const newEndTime = `${String(endH).padStart(2, '0')}:${String(endM).padStart(2, '0')}`;

        if (silhouette.parentNode !== targetCol) {
          targetCol.appendChild(silhouette);
        }
        const snappedTopPx = (((snappedStartMin - (startHour * 60)) / 60) * hourHeight) + 1;
        const durHeight = Math.max(14, ((dur / 60) * hourHeight) - 2);
        silhouette.style.top = `${snappedTopPx}px`;
        silhouette.style.height = `${durHeight}px`;
        silhouette.style.display = 'block';

        currentSnappedTarget = {
          targetCol: targetCol,
          targetDateStr: targetCol.getAttribute('data-date') || ev.date,
          startTime: newStartTime,
          endTime: newEndTime,
          dur: dur
        };

        let timeEl = card.querySelector('.week-event-time');
        if (!timeEl) {
          timeEl = document.createElement('div');
          timeEl.className = 'week-event-time';
          card.appendChild(timeEl);
        }
        timeEl.textContent = `${newStartTime} - ${newEndTime}`;
      } else {
        currentSnappedTarget = null;
        if (silhouette) silhouette.style.display = 'none';
      }
    };

    const finishDrag = (clientX, clientY) => {
      if (!isDragging) return;
      isDragging = false;
      this._activeDragCancelHandler = null;

      const dropTarget = currentSnappedTarget;
      currentSnappedTarget = null;

      if (silhouette && silhouette.parentNode) {
        silhouette.parentNode.removeChild(silhouette);
        silhouette = null;
      }
      if (weekNavTimer) {
        clearTimeout(weekNavTimer);
        weekNavTimer = null;
      }
      isWeekNavCooldown = false;
      window.removeEventListener('touchmove', onWindowTouchMove);
      window.removeEventListener('touchend', onWindowTouchEnd);
      window.removeEventListener('touchcancel', onWindowTouchCancel);
      if (autoScrollRaf) {
        cancelAnimationFrame(autoScrollRaf);
        autoScrollRaf = null;
      }
      if (container) {
        container.style.removeProperty('overflow-y');
      }
      if (card.parentElement) {
        card.parentElement.style.removeProperty('z-index');
      }
      card.style.removeProperty('position');
      card.style.removeProperty('left');
      card.style.removeProperty('top');
      card.style.removeProperty('width');
      card.style.removeProperty('z-index');
      card.style.removeProperty('transition');
      card.style.removeProperty('pointer-events');
      card.classList.remove('is-dragging-cal-event');
      card.style.removeProperty('transform');
      if (card.parentNode) {
        card.parentNode.removeChild(card);
      }

      if (currentOverCol) {
        currentOverCol.classList.remove('drag-target-over');
      }
      currentOverCol = null;

      if (!hasMoved) {
        this.isDraggingEvent = false;
        if (card.parentNode && card.parentNode === document.body) {
          document.body.removeChild(card);
        }
        if (silhouette && silhouette.parentNode) {
          silhouette.parentNode.removeChild(silhouette);
          silhouette = null;
        }
        this.render();
        const weekGrid = this.elements.weekGridBody;
        const renderedCard = weekGrid ? weekGrid.querySelector(`[data-event-id="${ev.id}"]`) : null;
        if (renderedCard) {
          this._attachResizeHandles(renderedCard, ev, 'week');
        }
        mobileServices.hapticTap();
        return;
      }

      if (dropTarget && dropTarget.targetCol) {
        const targetDate = dropTarget.targetDateStr || ev.date;
        const dur = dropTarget.dur;
        const sMin = this._parseTimeToMinutes(dropTarget.startTime);
        const eMin = sMin + dur;

        const updatedEv = taskStore.updateCalendarEvent(ev.id, {
          date: targetDate,
          startTime: dropTarget.startTime,
          endTime: dropTarget.endTime,
          plannedDuration: dur,
          fixedStartTime: dropTarget.startTime,
          isLocked: Boolean(ev.isLocked)
        });
        if (typeof calendarSyncService !== 'undefined' && calendarSyncService && typeof calendarSyncService.pushEventUpdate === 'function') {
          calendarSyncService.pushEventUpdate(updatedEv);
        }

        // Check if newly placed event still overlaps with other events on targetDate
        let stillOverlaps = false;
        const allCalEvents = taskStore.getCalendarEvents(targetDate) || [];
        for (let ci = 0; ci < allCalEvents.length; ci++) {
          const other = allCalEvents[ci];
          if (other.id === ev.id) continue;
          if (!other.startTime || !other.endTime) continue;
          const oStart = this._parseTimeToMinutes(other.startTime);
          let oEnd = this._parseTimeToMinutes(other.endTime);
          if (oEnd <= oStart) oEnd += 1440;
          if (sMin < oEnd && eMin > oStart) {
            stillOverlaps = true;
            break;
          }
        }

        if (!stillOverlaps && typeof window !== 'undefined' && typeof window.dismissOverlapForTask === 'function') {
          window.dismissOverlapForTask(ev.id);
        }

        this.isDraggingEvent = false;
        mobileServices.hapticTap();
        this._showToast(`✓ Rescheduled to ${targetDate} (${dropTarget.startTime} - ${dropTarget.endTime})`);
        this.render();
      } else {
        this.isDraggingEvent = false;
        this.render();
      }
    };

    // Touch events for mobile
    let hasMoved = false;

    card.addEventListener('touchstart', (e) => {
      if (e.target.closest('[data-action="toggle-lock"], .event-resize-handle')) return;
      if (this.isPinching || Date.now() < this.pinchCooldownUntil || (e.touches && e.touches.length > 1)) {
        if (holdTimer) clearTimeout(holdTimer);
        holdTimer = null;
        return;
      }
      if (e.touches && e.touches.length === 1) {
        startX = e.touches[0].clientX;
        startY = e.touches[0].clientY;
        lastClientX = e.touches[0].clientX;
        lastClientY = e.touches[0].clientY;
        const cRect = card.getBoundingClientRect();
        grabOffsetX = e.touches[0].clientX - cRect.left;
        grabOffsetY = e.touches[0].clientY - cRect.top;
        isDragging = false;
        hasMoved = false;
        this._activeDragCancelHandler = cancelDrag;

        holdTimer = setTimeout(() => {
          holdTimer = null;
          startDragMode();
        }, 200);
      }
    }, { passive: true });

    card.addEventListener('touchmove', (e) => {
      if (e.target && e.target.closest && e.target.closest('[data-action="toggle-lock"], .event-resize-handle')) return;
      if (this.isPinching || Date.now() < this.pinchCooldownUntil || (e.touches && e.touches.length > 1)) {
        cancelDrag();
        return;
      }
      if (!isDragging) {
        if (card.classList.contains('has-resize-handles')) {
          return;
        }
        if (holdTimer && e.touches && e.touches.length === 1) {
          const diffX = e.touches[0].clientX - startX;
          const diffY = e.touches[0].clientY - startY;
          if (Math.hypot(diffX, diffY) > 8) {
            hasMoved = true;
            clearTimeout(holdTimer);
            holdTimer = null;
            this._activeDragCancelHandler = null;
          }
        }
        return;
      }
      if (e.touches && e.touches.length === 1) {
        if (e.cancelable) e.preventDefault();
        lastClientX = e.touches[0].clientX;
        lastClientY = e.touches[0].clientY;
        hasMoved = true;
        updateWeekDragPosition(lastClientX, lastClientY);
      }
    }, { passive: false });

    card.addEventListener('touchend', (e) => {
      if (e.target && e.target.closest && e.target.closest('[data-action="toggle-lock"], .event-resize-handle')) return;
      if (this.isPinching || Date.now() < this.pinchCooldownUntil) {
        cancelDrag();
        if (e && e.cancelable) e.preventDefault();
        return;
      }
      if (holdTimer) {
        clearTimeout(holdTimer);
        holdTimer = null;
        this._activeDragCancelHandler = null;
        if (e && e.cancelable) e.preventDefault();
        if (!card.classList.contains('has-resize-handles')) {
          this.openEventInspector(ev);
        }
        return;
      }
      if (ev.isLocked) {
        if (e && e.cancelable) e.preventDefault();
        this._activeDragCancelHandler = null;
        return;
      }
      finishDrag(lastClientX, lastClientY);
    }, { passive: false });

    card.addEventListener('touchcancel', () => {
      cancelDrag();
    }, { passive: true });

    // Mouse events for desktop
    card.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      if (e.target.closest('[data-action="toggle-lock"], .event-resize-handle')) return;
      startX = e.clientX;
      startY = e.clientY;
      lastClientX = e.clientX;
      lastClientY = e.clientY;
      const cRect = card.getBoundingClientRect();
      grabOffsetX = e.clientX - cRect.left;
      grabOffsetY = e.clientY - cRect.top;
      isDragging = false;
      hasMoved = false;

      holdTimer = setTimeout(() => {
        holdTimer = null;
        startDragMode();
      }, 200);

      const onMouseMove = (me) => {
        if (me.target && me.target.closest && me.target.closest('[data-action="toggle-lock"], .event-resize-handle')) return;
        if (!isDragging) {
          if (card.classList.contains('has-resize-handles')) return;
          if (holdTimer && Math.hypot(me.clientX - startX, me.clientY - startY) > 8) {
            hasMoved = true;
            clearTimeout(holdTimer);
            holdTimer = null;
            if (!ev.isLocked) {
              startDragMode();
            }
          }
          return;
        }
        me.preventDefault();
        lastClientX = me.clientX;
        lastClientY = me.clientY;
        hasMoved = true;
        updateWeekDragPosition(me.clientX, me.clientY);
      };

      const onMouseUp = (me) => {
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onMouseUp);
        if (me && me.target && me.target.closest && me.target.closest('[data-action="toggle-lock"], .event-resize-handle')) return;
        if (holdTimer) {
          clearTimeout(holdTimer);
          holdTimer = null;
          if (!card.classList.contains('has-resize-handles')) {
            this.openEventInspector(ev);
          }
          return;
        }
        if (ev.isLocked) {
          this._activeDragCancelHandler = null;
          return;
        }
        finishDrag(me.clientX, me.clientY);
      };

      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', onMouseUp);
    });
  }

  // Month View: hold 200ms to drag between day cells (lifts pill & highlights target)
  _setupMonthEventDrag(pill, ev) {
    let holdTimer = null;
    let isDragging = false;
    let startX = 0;
    let startY = 0;
    let lastClientX = 0;
    let lastClientY = 0;
    let grabOffsetX = 0;
    let grabOffsetY = 0;
    let pillWidth = 0;
    let pillHeight = 0;
    let currentOverCell = null;
    let monthNavTimer = null;
    let isMonthNavCooldown = false;

    const checkMonthEdgePull = (clientX) => {
      const container = this.elements.monthView || document.querySelector('.month-grid-cells') || this.elements.modalBody;
      if (!container || isMonthNavCooldown) return;
      const rect = container.getBoundingClientRect();
      const isLeft = clientX < rect.left + 32;
      const isRight = clientX > rect.right - 32;

      if (isLeft || isRight) {
        if (!monthNavTimer) {
          const navDir = isRight ? 1 : -1;
          monthNavTimer = setTimeout(() => {
            monthNavTimer = null;
            if (!isDragging) return;

            isMonthNavCooldown = true;
            setTimeout(() => {
              isMonthNavCooldown = false;
              if (isDragging) {
                checkMonthEdgePull(lastClientX);
              }
            }, 650);

            const modalBody = this.elements.modalBody || document.querySelector('.full-calendar-body');
            const activeContainer = this.elements.monthView || (modalBody && modalBody.querySelector('.calendar-view-container'));
            const bodyWidth = modalBody ? (modalBody.clientWidth || 360) : 360;
            const targetDate = new Date(this.currentDate);
            targetDate.setMonth(targetDate.getMonth() + navDir);
            const adjacentSlide = this._buildAdjacentPreviewSlide(targetDate, navDir);

            if (modalBody && adjacentSlide && activeContainer) {
              const startXAdj = navDir > 0 ? bodyWidth : -bodyWidth;
              adjacentSlide.style.transition = 'none';
              adjacentSlide.style.transform = `translate3d(${startXAdj}px, 0, 0)`;
              modalBody.appendChild(adjacentSlide);

              void adjacentSlide.offsetWidth;

              activeContainer.style.transition = 'transform 0.32s cubic-bezier(0.16, 1, 0.3, 1)';
              adjacentSlide.style.transition = 'transform 0.32s cubic-bezier(0.16, 1, 0.3, 1)';
              activeContainer.style.transform = `translate3d(${-startXAdj}px, 0, 0)`;
              adjacentSlide.style.transform = 'translate3d(0, 0, 0)';

              setTimeout(() => {
                this.navigate(navDir);
                if (adjacentSlide && adjacentSlide.parentNode) {
                  adjacentSlide.parentNode.removeChild(adjacentSlide);
                }
                if (activeContainer) {
                  activeContainer.style.removeProperty('transform');
                  activeContainer.style.removeProperty('transition');
                }
              }, 320);
            } else {
              this.navigate(navDir);
            }

            mobileServices.hapticBuzz();
            this._showToast(navDir > 0 ? '📅 Next month' : '📅 Previous month');
          }, 480);
        }
      } else {
        if (monthNavTimer) {
          clearTimeout(monthNavTimer);
          monthNavTimer = null;
        }
      }
    };

    const onWindowTouchMove = (e) => {
      if (this.isPinching || Date.now() < this.pinchCooldownUntil || (e.touches && e.touches.length > 1)) {
        cancelDrag();
        return;
      }
      if (!isDragging || !(e.touches && e.touches.length === 1)) return;
      if (e.cancelable) e.preventDefault();
      lastClientX = e.touches[0].clientX;
      lastClientY = e.touches[0].clientY;
      updateDragPosition(lastClientX, lastClientY);
    };

    const onWindowTouchEnd = () => {
      finishDrag(lastClientX, lastClientY);
    };

    const onWindowTouchCancel = () => {
      cancelDrag();
    };

    const cancelDrag = () => {
      if (holdTimer) {
        clearTimeout(holdTimer);
        holdTimer = null;
      }
      this._activeDragCancelHandler = null;
      if (!isDragging) return;
      isDragging = false;
      this.isDraggingEvent = false;
      this._activeDragCancelHandler = null;

      if (monthNavTimer) {
        clearTimeout(monthNavTimer);
        monthNavTimer = null;
      }
      isMonthNavCooldown = false;

      window.removeEventListener('touchmove', onWindowTouchMove);
      window.removeEventListener('touchend', onWindowTouchEnd);
      window.removeEventListener('touchcancel', onWindowTouchCancel);

      pill.classList.remove('is-dragging-cal-event');
      pill.style.removeProperty('position');
      pill.style.removeProperty('left');
      pill.style.removeProperty('top');
      pill.style.removeProperty('width');
      pill.style.removeProperty('z-index');
      pill.style.removeProperty('pointer-events');
      pill.style.removeProperty('transition');
      pill.style.removeProperty('transform');
      pill.style.removeProperty('margin');

      if (pill.parentNode === document.body) {
        document.body.removeChild(pill);
      }

      if (currentOverCell) {
        currentOverCell.classList.remove('drag-target-over');
      }
      currentOverCell = null;
      this.render();
    };

    const triggerMonthLockedWarning = () => {
      mobileServices.hapticWarning();
      this._showToast('🔒 Unlock event before moving');
      pill.classList.remove('lock-pulse-glow');
      const lockSvg = pill.querySelector('.cal-mini-lock-svg');
      if (lockSvg) lockSvg.classList.remove('pulse-glow');
      void pill.offsetWidth;
      pill.classList.add('lock-pulse-glow');
      if (lockSvg) lockSvg.classList.add('pulse-glow');
      setTimeout(() => {
        if (pill) pill.classList.remove('lock-pulse-glow');
        if (lockSvg) lockSvg.classList.remove('pulse-glow');
      }, 950);
    };

    const startDragMode = () => {
      if (this.isPinching || Date.now() < this.pinchCooldownUntil) {
        if (holdTimer) clearTimeout(holdTimer);
        holdTimer = null;
        return;
      }
      if (ev.isLocked) {
        triggerMonthLockedWarning();
        return;
      }
      isDragging = true;
      this.isDraggingEvent = true;
      this._activeDragCancelHandler = cancelDrag;

      const pRect = pill.getBoundingClientRect();
      pillWidth = pRect.width || 80;
      pillHeight = pRect.height || 22;
      const curX = lastClientX || startX;
      const curY = lastClientY || startY;
      grabOffsetX = curX - pRect.left;
      grabOffsetY = curY - pRect.top;

      pill.style.position = 'fixed';
      pill.style.left = `${curX - grabOffsetX}px`;
      pill.style.top = `${curY - grabOffsetY}px`;
      pill.style.width = `${pRect.width}px`;
      pill.style.zIndex = '99999';
      pill.style.pointerEvents = 'none';
      pill.style.margin = '0';
      pill.style.transition = 'none';
      pill.classList.add('is-dragging-cal-event');
      pill.style.transform = 'scale(1.12)';
      document.body.appendChild(pill);
      mobileServices.hapticBuzz();
      updateDragPosition(curX, curY);

      window.addEventListener('touchmove', onWindowTouchMove, { passive: false });
      window.addEventListener('touchend', onWindowTouchEnd, { passive: true });
      window.addEventListener('touchcancel', onWindowTouchCancel, { passive: true });
    };

    const updateDragPosition = (clientX, clientY) => {
      if (!isDragging) return;
      pill.style.left = `${clientX - grabOffsetX}px`;
      pill.style.top = `${clientY - grabOffsetY}px`;
      pill.style.transform = 'scale(1.12)';

      checkMonthEdgePull(clientX);

      const centerX = (clientX - grabOffsetX) + (pillWidth / 2);
      const centerY = (clientY - grabOffsetY) + (pillHeight / 2);

      pill.style.pointerEvents = 'none';
      const targetEl = document.elementFromPoint(centerX, centerY);

      const targetCell = targetEl ? targetEl.closest('.month-day-cell') : null;
      if (targetCell !== currentOverCell) {
        if (currentOverCell) currentOverCell.classList.remove('drag-target-over');
        currentOverCell = targetCell;
        if (currentOverCell) currentOverCell.classList.add('drag-target-over');
      }
    };

    const finishDrag = (clientX, clientY) => {
      if (!isDragging) return;
      isDragging = false;
      this._activeDragCancelHandler = null;

      if (monthNavTimer) {
        clearTimeout(monthNavTimer);
        monthNavTimer = null;
      }
      isMonthNavCooldown = false;

      window.removeEventListener('touchmove', onWindowTouchMove);
      window.removeEventListener('touchend', onWindowTouchEnd);
      window.removeEventListener('touchcancel', onWindowTouchCancel);

      pill.classList.remove('is-dragging-cal-event');
      pill.style.removeProperty('position');
      pill.style.removeProperty('left');
      pill.style.removeProperty('top');
      pill.style.removeProperty('width');
      pill.style.removeProperty('z-index');
      pill.style.removeProperty('pointer-events');
      pill.style.removeProperty('transition');
      pill.style.removeProperty('transform');
      pill.style.removeProperty('margin');

      if (pill.parentNode === document.body) {
        document.body.removeChild(pill);
      }

      if (currentOverCell) {
        currentOverCell.classList.remove('drag-target-over');
      }

      const centerX = (clientX - grabOffsetX) + (pillWidth / 2);
      const centerY = (clientY - grabOffsetY) + (pillHeight / 2);

      pill.style.pointerEvents = 'none';
      const targetEl = document.elementFromPoint(centerX, centerY);
      pill.style.pointerEvents = '';

      const targetCell = targetEl ? targetEl.closest('.month-day-cell') : currentOverCell;
      currentOverCell = null;

      if (targetCell) {
        const targetDateStr = targetCell.getAttribute('data-date');
        if (targetDateStr && targetDateStr !== ev.date) {
          const updatedEv = taskStore.updateCalendarEvent(ev.id, {
            date: targetDateStr,
            startTime: ev.startTime,
            endTime: ev.endTime,
            plannedDuration: ev.plannedDuration
          });
          if (typeof calendarSyncService !== 'undefined' && calendarSyncService && typeof calendarSyncService.pushEventUpdate === 'function') {
            calendarSyncService.pushEventUpdate(updatedEv);
          }
          this.isDraggingEvent = false;
          mobileServices.hapticTap();
          this._showToast(`✓ Moved to ${targetDateStr} (${ev.startTime} - ${ev.endTime})`);
          this.render();
          return;
        }
      }
      this.isDraggingEvent = false;
      this.render();
    };

    // Touch events for mobile
    pill.addEventListener('touchstart', (e) => {
      if (this.isPinching || Date.now() < this.pinchCooldownUntil || (e.touches && e.touches.length > 1)) {
        if (holdTimer) clearTimeout(holdTimer);
        holdTimer = null;
        return;
      }
      if (e.touches && e.touches.length === 1) {
        startX = e.touches[0].clientX;
        startY = e.touches[0].clientY;
        lastClientX = e.touches[0].clientX;
        lastClientY = e.touches[0].clientY;
        isDragging = false;
        this._activeDragCancelHandler = cancelDrag;

        holdTimer = setTimeout(() => {
          holdTimer = null;
          startDragMode();
        }, 200);
      }
    }, { passive: true });

    pill.addEventListener('touchmove', (e) => {
      if (this.isPinching || Date.now() < this.pinchCooldownUntil || (e.touches && e.touches.length > 1)) {
        cancelDrag();
        return;
      }
      if (!isDragging) {
        if (holdTimer && e.touches && e.touches.length === 1) {
          const diffX = e.touches[0].clientX - startX;
          const diffY = e.touches[0].clientY - startY;
          if (Math.hypot(diffX, diffY) > 8) {
            clearTimeout(holdTimer);
            holdTimer = null;
            this._activeDragCancelHandler = null;
          }
        }
        return;
      }
      if (e.touches && e.touches.length === 1) {
        if (e.cancelable) e.preventDefault();
        lastClientX = e.touches[0].clientX;
        lastClientY = e.touches[0].clientY;
        updateDragPosition(lastClientX, lastClientY);
      }
    }, { passive: false });

    pill.addEventListener('touchend', (e) => {
      if (this.isPinching || Date.now() < this.pinchCooldownUntil) {
        cancelDrag();
        if (e && e.cancelable) e.preventDefault();
        return;
      }
      if (holdTimer) {
        clearTimeout(holdTimer);
        holdTimer = null;
        this._activeDragCancelHandler = null;
        if (e && e.cancelable) e.preventDefault();
        this.openEventInspector(ev);
        return;
      }
      if (ev.isLocked) {
        if (e && e.cancelable) e.preventDefault();
        this._activeDragCancelHandler = null;
        return;
      }
      finishDrag(lastClientX, lastClientY);
    }, { passive: false });

    pill.addEventListener('touchcancel', () => {
      cancelDrag();
    }, { passive: true });

    // Mouse events for desktop
    pill.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      startX = e.clientX;
      startY = e.clientY;
      lastClientX = e.clientX;
      lastClientY = e.clientY;
      isDragging = false;

      holdTimer = setTimeout(() => {
        holdTimer = null;
        startDragMode();
      }, 200);

      const onMouseMove = (me) => {
        if (!isDragging) {
          if (holdTimer && Math.hypot(me.clientX - startX, me.clientY - startY) > 8) {
            clearTimeout(holdTimer);
            holdTimer = null;
          }
          return;
        }
        me.preventDefault();
        lastClientX = me.clientX;
        lastClientY = me.clientY;
        updateDragPosition(me.clientX, me.clientY);
      };

      const onMouseUp = (me) => {
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onMouseUp);
        if (holdTimer) {
          clearTimeout(holdTimer);
          holdTimer = null;
          this.openEventInspector(ev);
          return;
        }
        if (ev.isLocked) {
          this._activeDragCancelHandler = null;
          return;
        }
        finishDrag(me.clientX, me.clientY);
      };

      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', onMouseUp);
    });
  }

  // ==========================================
  // Event Inspector & Edit Modal
  // ==========================================

  setCalEventType(type) {
    this.currentEventType = type || 'work';
    const el = this.elements;
    const isBreak = this.currentEventType === 'break';
    if (el.calTypeSegmentWork) el.calTypeSegmentWork.classList.toggle('active', !isBreak);
    if (el.calTypeSegmentBreak) el.calTypeSegmentBreak.classList.toggle('active', isBreak);

    const titleModal = document.getElementById('calEventModalTitle');
    const isNew = !this.selectedEvent;

    if (isBreak) {
      if (titleModal && isNew) titleModal.textContent = 'Add Break';
      this.setEventEmoji('☕');
      if (el.eventTitleInput) {
        if (!el.eventTitleInput.value || el.eventTitleInput.value === 'Untitled Task') {
          el.eventTitleInput.value = 'Break';
        }
        el.eventTitleInput.placeholder = 'e.g. Coffee break, walk, stretch';
      }
      if (el.calEventTitleLabel) {
        el.calEventTitleLabel.textContent = 'Break Name';
      }
      if (isNew) {
        if (el.eventDurationInput) el.eventDurationInput.value = '10';
      }
      this.currentCategory = 'Break';
      if (el.eventCategoryInput) el.eventCategoryInput.value = 'Break';
      if (el.eventTimeBankToggle) el.eventTimeBankToggle.checked = false;
      if (el.piggyIcon) el.piggyIcon.classList.remove('active');
      if (el.btnSaveCalEvent) {
        el.btnSaveCalEvent.classList.add('is-break-btn');
        el.btnSaveCalEvent.textContent = isNew ? '+ Add Break' : 'Save Break';
      }
      this.updateEndTimeFromDuration();
    } else {
      if (titleModal && isNew) titleModal.textContent = 'Add Event';
      this.setEventEmoji('💼');
      if (el.eventTitleInput) {
        if (el.eventTitleInput.value === 'Break') {
          el.eventTitleInput.value = '';
        }
        el.eventTitleInput.placeholder = 'e.g. Project Standup';
      }
      if (el.calEventTitleLabel) {
        el.calEventTitleLabel.textContent = 'Event Name';
      }
      if (isNew) {
        if (el.eventDurationInput) el.eventDurationInput.value = '60';
      }
      this.currentCategory = 'Work';
      if (el.eventCategoryInput) el.eventCategoryInput.value = 'Work';
      if (el.eventTimeBankToggle) el.eventTimeBankToggle.checked = isNew ? false : true;
      if (el.piggyIcon) el.piggyIcon.classList.toggle('active', !isNew);
      if (el.btnSaveCalEvent) {
        el.btnSaveCalEvent.classList.remove('is-break-btn');
        el.btnSaveCalEvent.textContent = isNew ? 'Save Event' : 'Save Event';
      }
      this.updateEndTimeFromDuration();
    }
    this._highlightActiveDurationChip();
    if (this.refreshCategoryChips) this.refreshCategoryChips();
  }

  openEventInspector(eventObj, defaultDateStr, defaultStartTime, defaultEndTime) {
    if (typeof window !== 'undefined' && typeof window.ensureHistoryBuffer === 'function') {
      window.ensureHistoryBuffer();
    }
    this.selectedEvent = eventObj || null;
    this.currentEventCustomColor = (eventObj && eventObj.color) ? eventObj.color : null;
    const el = this.elements;

    const isNew = !eventObj;
    const isBreakEvent = eventObj ? (eventObj.category === 'Break' || (eventObj.title && eventObj.title.toLowerCase() === 'break')) : false;

    const titleModal = document.getElementById('calEventModalTitle');
    if (titleModal) {
      titleModal.textContent = isNew ? 'Add Event' : (isBreakEvent ? 'Break Details' : 'Event Details');
    }

    if (isNew) {
      this.setCalEventType('work');
      if (el.eventIdInput) el.eventIdInput.value = '';
      if (el.eventTitleInput) el.eventTitleInput.value = '';
      if (el.eventDateInput) {
        el.eventDateInput.value = defaultDateStr || this._formatDateISO(new Date());
      }
      if (el.eventStartTimeInput) {
        el.eventStartTimeInput.value = defaultStartTime || '';
      }
      if (el.eventEndTimeInput) {
        el.eventEndTimeInput.value = defaultEndTime || '';
      }
      if (el.eventDurationInput) el.eventDurationInput.value = '60';
      this.updateEndTimeFromDuration();
      if (el.eventToggleLock) el.eventToggleLock.checked = false;
      if (el.lockIcon) el.lockIcon.classList.remove('active');
      if (el.eventTimeBankToggle) el.eventTimeBankToggle.checked = false;
      if (el.piggyIcon) el.piggyIcon.classList.remove('active');

      this._manualCategorySelected = false;
      this._manualEmojiSelected = false;

      const gPref = (typeof taskStore.getOutboundSyncPreference === 'function') ? taskStore.getOutboundSyncPreference('google') : false;
      const msPref = (typeof taskStore.getOutboundSyncPreference === 'function') ? taskStore.getOutboundSyncPreference('microsoft') : false;
      if (el.calEventSyncGoogle) el.calEventSyncGoogle.checked = gPref;
      if (el.calEventSyncGoogleLabel) el.calEventSyncGoogleLabel.classList.toggle('is-checked', gPref);
      if (el.calEventSyncMS) el.calEventSyncMS.checked = msPref;
      if (el.calEventSyncMSLabel) el.calEventSyncMSLabel.classList.toggle('is-checked', msPref);
      this._initialGooglePaired = false;
      this._initialMSPaired = false;
    } else {
      this._manualCategorySelected = true;
      this._manualEmojiSelected = true;

      const isGoogle = Boolean(eventObj && (eventObj.googleEventId || eventObj.provider === 'google' || eventObj.source === 'google'));
      const isMS = Boolean(eventObj && (eventObj.microsoftEventId || eventObj.provider === 'microsoft' || eventObj.source === 'microsoft'));
      if (el.calEventSyncGoogle) el.calEventSyncGoogle.checked = isGoogle;
      if (el.calEventSyncGoogleLabel) el.calEventSyncGoogleLabel.classList.toggle('is-checked', isGoogle);
      if (el.calEventSyncMS) el.calEventSyncMS.checked = isMS;
      if (el.calEventSyncMSLabel) el.calEventSyncMSLabel.classList.toggle('is-checked', isMS);
      this._initialGooglePaired = isGoogle;
      this._initialMSPaired = isMS;
      this.currentEventType = isBreakEvent ? 'break' : 'work';
      if (el.calTypeSegmentWork) el.calTypeSegmentWork.classList.toggle('active', !isBreakEvent);
      if (el.calTypeSegmentBreak) el.calTypeSegmentBreak.classList.toggle('active', isBreakEvent);
      if (el.calEventTitleLabel) {
        el.calEventTitleLabel.textContent = isBreakEvent ? 'Break Name' : 'Event Name';
      }
      if (el.btnSaveCalEvent) {
        if (isBreakEvent) {
          el.btnSaveCalEvent.classList.add('is-break-btn');
          el.btnSaveCalEvent.textContent = 'Save Break';
        } else {
          el.btnSaveCalEvent.classList.remove('is-break-btn');
          el.btnSaveCalEvent.textContent = 'Save Event';
        }
      }

      if (el.eventIdInput) el.eventIdInput.value = eventObj.id || '';
      if (el.eventTitleInput) el.eventTitleInput.value = eventObj.title || '';
      if (el.eventDateInput) el.eventDateInput.value = eventObj.date || (defaultDateStr || this._formatDateISO(new Date()));
      if (el.eventStartTimeInput) el.eventStartTimeInput.value = eventObj.startTime || (defaultStartTime || '10:00');
      if (el.eventEndTimeInput) el.eventEndTimeInput.value = eventObj.endTime || (defaultEndTime || '11:00');

      const dur = eventObj.plannedDuration || 60;
      if (el.eventDurationInput) el.eventDurationInput.value = String(dur);

      this.currentEmoji = eventObj.emoji || (isBreakEvent ? '☕' : '💼');
      if (el.eventHeaderEmoji) el.eventHeaderEmoji.textContent = this.currentEmoji;

      this.currentCategory = eventObj.category || (isBreakEvent ? 'Break' : 'Work');
      if (el.eventCategoryInput) el.eventCategoryInput.value = this.currentCategory;

      const isLocked = Boolean(eventObj.isLocked);
      if (el.eventToggleLock) el.eventToggleLock.checked = isLocked;
      if (el.lockIcon) el.lockIcon.classList.toggle('active', isLocked);

      const useTimeBank = eventObj.useTimeBank !== undefined ? Boolean(eventObj.useTimeBank) : (!isBreakEvent);
      if (el.eventTimeBankToggle) el.eventTimeBankToggle.checked = useTimeBank;
      if (el.piggyIcon) el.piggyIcon.classList.toggle('active', useTimeBank);
    }

    // Refresh Category Chips
    if (this.refreshCategoryChips) {
      this.refreshCategoryChips();
    }

    // Refresh Duration Presets
    if (typeof window !== 'undefined' && typeof window.renderAllDurationPresetChips === 'function') {
      window.renderAllDurationPresetChips();
    }
    this._highlightActiveDurationChip();

    if (el.btnDeleteEvent) {
      el.btnDeleteEvent.style.display = isNew ? 'none' : 'block';
    }

    if (el.eventModalBackdrop) {
      el.eventModalBackdrop.classList.remove('hidden');
      el.eventModalBackdrop.style.pointerEvents = 'none';
      setTimeout(() => {
        if (el.eventModalBackdrop) {
          el.eventModalBackdrop.style.removeProperty('pointer-events');
        }
      }, 250);
    }
    mobileServices.hapticTap();
  }

  closeEventInspector() {
    if (this.elements.eventModalBackdrop) {
      this.elements.eventModalBackdrop.classList.add('hidden');
    }
  }

  setEventEmoji(emoji) {
    this.currentEmoji = emoji || '💼';
    if (this.elements.eventHeaderEmoji) {
      this.elements.eventHeaderEmoji.textContent = this.currentEmoji;
    }
  }

  onDurationPresetSelected(min) {
    if (this.elements.eventDurationInput) {
      this.elements.eventDurationInput.value = String(min);
    }
    this.updateEndTimeFromDuration();
    this._highlightActiveDurationChip();
  }

  updateEndTimeFromDuration() {
    const el = this.elements;
    if (!el.eventStartTimeInput || !el.eventDurationInput || !el.eventEndTimeInput) return;
    const startStr = el.eventStartTimeInput.value.trim();
    if (startStr.length !== 5) return;

    const startMin = this._parseTimeToMinutes(startStr);
    const dur = parseInt(el.eventDurationInput.value, 10) || 60;
    const endTotalMin = (startMin + dur) % 1440;
    const endH = Math.floor(endTotalMin / 60);
    const endM = endTotalMin % 60;
    el.eventEndTimeInput.value = `${String(endH).padStart(2, '0')}:${String(endM).padStart(2, '0')}`;
  }

  onStartTimeSelected() {
    this.updateEndTimeFromDuration();
  }

  onEndTimeSelected() {
    this._updateDurationFromTimeSpan();
  }

  _updateDurationFromTimeSpan() {
    const el = this.elements;
    if (!el.eventStartTimeInput || !el.eventEndTimeInput || !el.eventDurationInput) return;
    const startStr = el.eventStartTimeInput.value.trim();
    const endStr = el.eventEndTimeInput.value.trim();
    if (startStr.length !== 5 || endStr.length !== 5) return;

    const startMin = this._parseTimeToMinutes(startStr);
    const endMin = this._parseTimeToMinutes(endStr);
    let diff = endMin - startMin;
    if (diff <= 0) diff += 1440; // handle overnight wrap

    el.eventDurationInput.value = String(diff);
    this._highlightActiveDurationChip();
  }

  _highlightActiveDurationChip() {
    const el = this.elements;
    if (!el.eventDurationChips || !el.eventDurationInput) return;
    const durVal = el.eventDurationInput.value;
    const chips = el.eventDurationChips.querySelectorAll('.duration-chip');
    for (let i = 0; i < chips.length; i++) {
      chips[i].classList.toggle('active', chips[i].getAttribute('data-min') === durVal);
    }
  }

  _bindClockPicker(btn, nativeInput, textInput, onTimeSelected) {
    if (btn && nativeInput) {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        mobileServices.hapticTap();
        if (textInput && textInput.value && textInput.value.length === 5) {
          nativeInput.value = textInput.value;
        }
        if (typeof nativeInput.showPicker === 'function') {
          try {
            nativeInput.showPicker();
          } catch (_) {
            nativeInput.focus();
            nativeInput.click();
          }
        } else {
          nativeInput.focus();
          nativeInput.click();
        }
      });

      nativeInput.addEventListener('change', () => {
        if (nativeInput.value && textInput) {
          textInput.value = nativeInput.value;
          textInput.dispatchEvent(new Event('input', { bubbles: true }));
          textInput.dispatchEvent(new Event('change', { bubbles: true }));
          if (onTimeSelected) onTimeSelected();
        }
      });
    }
  }

  _saveEventFromForm() {
    const el = this.elements;
    const title = el.eventTitleInput ? el.eventTitleInput.value.trim() : '';
    if (!title) return;

    const date = el.eventDateInput ? el.eventDateInput.value : this._formatDateISO(new Date());
    const startTime = el.eventStartTimeInput ? el.eventStartTimeInput.value.trim() : '';
    const endTime = el.eventEndTimeInput ? el.eventEndTimeInput.value.trim() : '';
    const durationMin = el.eventDurationInput ? (parseInt(el.eventDurationInput.value, 10) || 60) : 60;
    const category = el.eventCategoryInput ? (el.eventCategoryInput.value.trim() || 'Work') : 'Work';
    const isLocked = el.eventToggleLock ? el.eventToggleLock.checked : false;
    const useTimeBank = el.eventTimeBankToggle ? el.eventTimeBankToggle.checked : false;
    const eventId = el.eventIdInput ? el.eventIdInput.value : '';

    if (category) {
      taskStore.addCategory(category);
    }

    const isSyncGoogle = el.calEventSyncGoogle ? Boolean(el.calEventSyncGoogle.checked) : false;
    const isSyncMS = el.calEventSyncMS ? Boolean(el.calEventSyncMS.checked) : false;

    if (eventId) {
      const isCreatedInApp = Boolean(
        this.selectedEvent && (
          (this.selectedEvent.origin === 'local' || this.selectedEvent.createdInApp === true) ||
          (this.selectedEvent.id && (this.selectedEvent.id.indexOf('cal-event-') === 0 || this.selectedEvent.id.indexOf('task-') === 0))
        )
      );
      const isExplicitlyExternal = Boolean(
        this.selectedEvent && (
          this.selectedEvent.origin === 'external' ||
          this.selectedEvent.createdInApp === false ||
          (this.selectedEvent.id && (this.selectedEvent.id.indexOf('cal-gcal-') === 0 || this.selectedEvent.id.indexOf('cal-ms-') === 0 || this.selectedEvent.id.indexOf('cal-sync-') === 0))
        )
      );

      let didUnpairExternal = false;

      // Unpair Google:
      if (this._initialGooglePaired && !isSyncGoogle) {
        if (isCreatedInApp && !isExplicitlyExternal) {
          if (typeof calendarSyncService !== 'undefined' && calendarSyncService && typeof calendarSyncService.pushEventDelete === 'function') {
            calendarSyncService.pushEventDelete(this.selectedEvent, 'google');
          }
        } else {
          // Imported Google event: NEVER delete remotely!
          didUnpairExternal = true;
          if (this.selectedEvent && this.selectedEvent.externalId && typeof taskStore.addDeletedId === 'function') {
            taskStore.addDeletedId(this.selectedEvent.externalId);
          }
        }
      }

      // Unpair Microsoft:
      if (this._initialMSPaired && !isSyncMS) {
        if (isCreatedInApp && !isExplicitlyExternal) {
          if (typeof calendarSyncService !== 'undefined' && calendarSyncService && typeof calendarSyncService.pushEventDelete === 'function') {
            calendarSyncService.pushEventDelete(this.selectedEvent, 'microsoft');
          }
        } else {
          // Imported Microsoft event: NEVER delete remotely!
          didUnpairExternal = true;
          if (this.selectedEvent && this.selectedEvent.externalId && typeof taskStore.addDeletedId === 'function') {
            taskStore.addDeletedId(this.selectedEvent.externalId);
          }
        }
      }

      let resolvedColor = this.currentEventCustomColor;
      if (!resolvedColor) {
        if (this.selectedEvent && this.selectedEvent.color && (!this._manualCategorySelected || this.selectedEvent.category === category)) {
          resolvedColor = this.selectedEvent.color;
        } else {
          resolvedColor = this._getCategoryColor(category);
        }
      }
      let resolvedColorId = (this.selectedEvent && this.selectedEvent.colorId) ? this.selectedEvent.colorId : null;
      if (this.currentEventCustomColor && (!this.selectedEvent || this.selectedEvent.color !== this.currentEventCustomColor)) {
        if (typeof googleCalendarAdapter !== 'undefined' && typeof googleCalendarAdapter.getGoogleColorId === 'function') {
          resolvedColorId = googleCalendarAdapter.getGoogleColorId(category, this.currentEventCustomColor, null);
        }
      }

      const updateData = {
        title,
        date,
        startTime,
        endTime,
        plannedDuration: durationMin,
        isLocked,
        useTimeBank,
        emoji: this.currentEmoji,
        category,
        color: resolvedColor,
        colorId: resolvedColorId,
        isDirty: true
      };

      if (!isSyncGoogle && this.selectedEvent && (this.selectedEvent.provider === 'google' || this.selectedEvent.googleEventId)) {
        updateData.googleEventId = null;
        updateData.externalId = null;
        if (this.selectedEvent.provider === 'google') updateData.provider = 'local';
        updateData.origin = 'local';
        updateData.createdInApp = true;
      }
      if (!isSyncMS && this.selectedEvent && (this.selectedEvent.provider === 'microsoft' || this.selectedEvent.microsoftEventId)) {
        updateData.microsoftEventId = null;
        updateData.externalId = null;
        if (this.selectedEvent.provider === 'microsoft') updateData.provider = 'local';
        updateData.origin = 'local';
        updateData.createdInApp = true;
      }

      const updatedEv = taskStore.updateCalendarEvent(eventId, updateData);

      // If user toggled ON pairing during edit, push create to provider
      if (!this._initialGooglePaired && isSyncGoogle) {
        if (typeof calendarSyncService !== 'undefined' && calendarSyncService && typeof calendarSyncService.createRemoteEvent === 'function') {
          calendarSyncService.createRemoteEvent('google', updatedEv).then((res) => {
            if (res && res.externalId) {
              const hash = (typeof calendarSyncService.computeSyncHash === 'function')
                ? calendarSyncService.computeSyncHash(Object.assign({}, updatedEv, { externalId: res.externalId, googleEventId: res.externalId }))
                : null;
              taskStore.updateCalendarEvent(eventId, {
                googleEventId: res.externalId,
                externalId: res.externalId,
                provider: 'google',
                syncHash: hash,
                etag: res.etag || null,
                isDirty: false
              });
              this.render();
            }
          }).catch(() => {});
        }
      }
      if (!this._initialMSPaired && isSyncMS) {
        if (typeof calendarSyncService !== 'undefined' && calendarSyncService && typeof calendarSyncService.createRemoteEvent === 'function') {
          calendarSyncService.createRemoteEvent('microsoft', updatedEv).then((res) => {
            if (res && res.externalId) {
              const hash = (typeof calendarSyncService.computeSyncHash === 'function')
                ? calendarSyncService.computeSyncHash(Object.assign({}, updatedEv, { externalId: res.externalId, microsoftEventId: res.externalId }))
                : null;
              taskStore.updateCalendarEvent(eventId, {
                microsoftEventId: res.externalId,
                externalId: res.externalId,
                provider: 'microsoft',
                syncHash: hash,
                etag: res.etag || null,
                isDirty: false
              });
              this.render();
            }
          }).catch(() => {});
        }
      }

      if (typeof calendarSyncService !== 'undefined' && calendarSyncService && typeof calendarSyncService.pushEventUpdate === 'function') {
        calendarSyncService.pushEventUpdate(updatedEv);
      }
      if (didUnpairExternal) {
        this._showToast('✓ Unpaired in Calentimer (external calendar unchanged)');
      } else {
        this._showToast('✓ Event updated');
      }
    } else {
      // Add new
      const resolvedColor = this.currentEventCustomColor || this._getCategoryColor(category);
      let resolvedColorId = null;
      if (typeof googleCalendarAdapter !== 'undefined' && typeof googleCalendarAdapter.getGoogleColorId === 'function') {
        resolvedColorId = googleCalendarAdapter.getGoogleColorId(category, resolvedColor, null);
      }
      const newEv = taskStore.addCalendarEvent({
        title,
        date,
        startTime,
        endTime,
        plannedDuration: durationMin,
        isLocked,
        useTimeBank,
        emoji: this.currentEmoji,
        category,
        color: resolvedColor,
        colorId: resolvedColorId,
        source: 'local',
        origin: 'local',
        createdInApp: true,
        isDirty: isSyncGoogle || isSyncMS,
        provider: isSyncGoogle ? 'google' : (isSyncMS ? 'microsoft' : 'local')
      });

      // Remember sticky preference
      if (typeof taskStore.setOutboundSyncPreference === 'function') {
        taskStore.setOutboundSyncPreference('google', isSyncGoogle);
        taskStore.setOutboundSyncPreference('microsoft', isSyncMS);
      }

      if (isSyncGoogle) {
        if (typeof calendarSyncService !== 'undefined' && calendarSyncService && typeof calendarSyncService.createRemoteEvent === 'function') {
          calendarSyncService.createRemoteEvent('google', newEv).then((res) => {
            if (res && res.externalId) {
              const hash = (typeof calendarSyncService.computeSyncHash === 'function')
                ? calendarSyncService.computeSyncHash(Object.assign({}, newEv, { externalId: res.externalId, googleEventId: res.externalId }))
                : null;
              taskStore.updateCalendarEvent(newEv.id, {
                googleEventId: res.externalId,
                externalId: res.externalId,
                syncHash: hash,
                etag: res.etag || null,
                isDirty: false
              });
              this.render();
            }
          }).catch(() => {});
        }
      }
      if (isSyncMS) {
        if (typeof calendarSyncService !== 'undefined' && calendarSyncService && typeof calendarSyncService.createRemoteEvent === 'function') {
          calendarSyncService.createRemoteEvent('microsoft', newEv).then((res) => {
            if (res && res.externalId) {
              const hash = (typeof calendarSyncService.computeSyncHash === 'function')
                ? calendarSyncService.computeSyncHash(Object.assign({}, newEv, { externalId: res.externalId, microsoftEventId: res.externalId }))
                : null;
              taskStore.updateCalendarEvent(newEv.id, {
                microsoftEventId: res.externalId,
                externalId: res.externalId,
                syncHash: hash,
                etag: res.etag || null,
                isDirty: false
              });
              this.render();
            }
          }).catch(() => {});
        }
      }

      this._showToast('✓ Event created');
    }

    mobileServices.hapticTap();
    this.closeEventInspector();
    this.render();
  }

  _sendCurrentEventToTodaySchedule() {
    const el = this.elements;
    const title = el.eventTitleInput ? el.eventTitleInput.value.trim() : '';
    if (!title) return;

    const startTime = el.eventStartTimeInput ? el.eventStartTimeInput.value.trim() : '';
    const endTime = el.eventEndTimeInput ? el.eventEndTimeInput.value.trim() : '';
    const durationMin = el.eventDurationInput ? (parseInt(el.eventDurationInput.value, 10) || 60) : 60;
    const category = el.eventCategoryInput ? (el.eventCategoryInput.value.trim() || 'Work') : 'Work';
    const isLocked = el.eventToggleLock ? el.eventToggleLock.checked : false;
    const useTimeBank = el.eventTimeBankToggle ? el.eventTimeBankToggle.checked : false;

    // Add task directly to Today's TaskStore
    taskStore.addTask({
      title,
      plannedDuration: durationMin,
      isLocked,
      useTimeBank,
      emoji: this.currentEmoji || '📅',
      category: category,
      fixedStartTime: isLocked ? startTime : null,
      startTime,
      endTime
    });

    mobileServices.hapticCelebration();
    this.closeEventInspector();
    this._showToast(`📅 Added "${title}" to Today's Schedule!`);
  }

  // ==========================================
  // Helper Utilities
  // ==========================================

  _hexToRgba(hex, alpha) {
    const a = typeof alpha === 'number' ? alpha : 0.15;
    if (!hex || typeof hex !== 'string' || hex.charAt(0) !== '#') {
      return 'rgba(37, 99, 235, ' + a + ')';
    }
    let h = hex.slice(1);
    if (h.length === 3) {
      h = h.charAt(0) + h.charAt(0) + h.charAt(1) + h.charAt(1) + h.charAt(2) + h.charAt(2);
    }
    const num = parseInt(h, 16);
    const r = (num >> 16) & 255;
    const g = (num >> 8) & 255;
    const b = num & 255;
    return 'rgba(' + r + ', ' + g + ', ' + b + ', ' + a + ')';
  }

  _getCategoryColor(category) {
    if (typeof getCategoryColor === 'function') {
      return getCategoryColor(category);
    }
    return '#3b82f6';
  }

  _formatDateISO(d) {
    const dateObj = d || new Date();
    const y = dateObj.getFullYear();
    const m = String(dateObj.getMonth() + 1).padStart(2, '0');
    const day = String(dateObj.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  _getMondayOfWeek(d) {
    const dateObj = new Date(d);
    const day = dateObj.getDay();
    const diff = dateObj.getDate() - day + (day === 0 ? -6 : 1);
    return new Date(dateObj.setDate(diff));
  }

  _parseTimeToMinutes(timeStr) {
    if (!timeStr) return 0;
    const parts = timeStr.split(':');
    const h = parseInt(parts[0], 10) || 0;
    const m = parseInt(parts[1], 10) || 0;
    return (h * 60) + m;
  }

  _formatMinutesToTime(totalMin) {
    const wrapped = ((Math.round(totalMin) % 1440) + 1440) % 1440;
    const h = Math.floor(wrapped / 60);
    const m = wrapped % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  _escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  _showToast(msg) {
    if (typeof window !== 'undefined' && typeof window.showToastNotification === 'function') {
      window.showToastNotification(msg);
      return;
    }
    const toast = typeof document !== 'undefined' ? document.getElementById('toastNotification') : null;
    if (!toast) return;
    toast.style.removeProperty('background');
    toast.style.removeProperty('color');
    toast.textContent = msg;
    toast.classList.remove('hidden');
    toast.style.opacity = '1';
    toast.style.transform = 'translateX(-50%) translateY(0)';
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(-50%) translateY(10px)';
      setTimeout(() => {
        toast.classList.add('hidden');
        toast.style.removeProperty('background');
        toast.style.removeProperty('color');
      }, 220);
    }, 2200);
  }
}

export const calendarView = new CalendarView();
export default calendarView;
