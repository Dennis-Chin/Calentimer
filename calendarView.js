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

export class CalendarView {
  constructor() {
    this.activeView = 'day'; // 'day' | 'week' | 'month' (default is 'day')
    this.currentDate = new Date();
    this.selectedDate = new Date();
    this.selectedEvent = null;
    this.currentEmoji = '💼';
    this.currentCategory = 'Work';
    this.currentResolution = 15; // default 15 minutes
    this.dayHourHeight = 56; // dynamic hour height for day view (px)
    this.weekHourHeight = 50; // dynamic hour height for week view (px)
    this.currentTimeTimer = null;
    this.refreshCategoryChips = null;

    // DOM Elements (bound on init)
    this.elements = {};
  }

  init() {
    // Cache DOM Elements
    this.elements = {
      backdrop: document.getElementById('fullCalendarModalBackdrop'),
      modal: document.getElementById('fullCalendarModal'),
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

      // Event Inspector Modal
      eventModalBackdrop: document.getElementById('calendarEventModalBackdrop'),
      eventModal: document.getElementById('calendarEventModal'),
      btnCloseEventModal: document.getElementById('btnCloseCalEventModal'),
      btnCancelEvent: document.getElementById('btnCancelCalEvent'),
      formEvent: document.getElementById('formCalEvent'),
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
      btnDeleteEvent: document.getElementById('btnDeleteCalEvent')
    };

    this._bindEvents();
    this._setupHeaderSwipeDown();
    this._setupHorizontalSwipeNavigation();
    this._setupPinchZoom(this.elements.dayTimelineScroll, true);
    this._setupPinchZoom(this.elements.weekGridScroll, false);
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
      el.viewSelect.addEventListener('change', (e) => {
        this.switchView(e.target.value);
      });
    }

    // Time Interval Resolution Selector (Day View)
    if (el.resolutionSelect) {
      el.resolutionSelect.value = String(this.currentResolution);
      el.resolutionSelect.addEventListener('change', (e) => {
        this.currentResolution = parseInt(e.target.value, 10) || 15;
        mobileServices.hapticTick();
        if (this.activeView === 'day') {
          this._renderDayView();
        }
      });
    }

    // Navigation Buttons
    if (el.btnPrev) {
      el.btnPrev.addEventListener('click', () => this.navigate(-1));
    }
    if (el.btnNext) {
      el.btnNext.addEventListener('click', () => this.navigate(1));
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

    // Event Inspector Handlers
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
        if (typeof window !== 'undefined' && typeof window.openEmojiPicker === 'function') {
          window.openEmojiPicker('CAL_EVENT');
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

    // Auto-update duration calculation when Start or End time changes
    if (el.eventStartTimeInput) {
      el.eventStartTimeInput.addEventListener('input', () => {
        if (el.eventStartTimeInput.value.length === 5) {
          if (el.eventEndTimeInput && el.eventEndTimeInput.value.length === 5) {
            this._updateDurationFromTimeSpan();
          } else {
            this.updateEndTimeFromDuration();
          }
        }
      });
      el.eventStartTimeInput.addEventListener('change', () => {
        if (el.eventEndTimeInput && el.eventEndTimeInput.value.length === 5) {
          this._updateDurationFromTimeSpan();
        } else {
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
          taskStore.deleteCalendarEvent(this.selectedEvent.id);
          mobileServices.hapticTap();
          this.closeEventInspector();
          this.render();
          this._showToast('🗑️ Event deleted');
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
  // Header Swipe Down to Close Calendar
  // ==========================================

  _setupHeaderSwipeDown() {
    const header = this.elements.header;
    const modal = this.elements.modal;
    if (!header || !modal) return;

    let touchStartY = 0;
    let touchStartTime = 0;
    let isSwipingDown = false;

    header.addEventListener('touchstart', (e) => {
      if (e.target.closest('button, select, input')) return;
      touchStartY = (e.touches && e.touches[0]) ? e.touches[0].clientY : 0;
      touchStartTime = Date.now();
      isSwipingDown = false;
    }, { passive: true });

    header.addEventListener('touchmove', (e) => {
      if (e.target.closest('button, select, input')) return;
      const currentY = (e.touches && e.touches[0]) ? e.touches[0].clientY : 0;
      const deltaY = currentY - touchStartY;
      if (deltaY > 0) {
        isSwipingDown = true;
        const rubberbandY = Math.min(deltaY * 0.45, 120);
        modal.style.transition = 'none';
        modal.style.transform = `translateY(${rubberbandY}px)`;
      }
    }, { passive: true });

    const onTouchEnd = (e) => {
      if (!isSwipingDown) return;
      isSwipingDown = false;
      const currentY = (e.changedTouches && e.changedTouches[0]) ? e.changedTouches[0].clientY : 0;
      const deltaY = currentY - touchStartY;
      const elapsed = Math.max(1, Date.now() - touchStartTime);
      const velocity = deltaY / elapsed;

      modal.style.transition = 'transform 0.24s cubic-bezier(0.16, 1, 0.3, 1)';
      if (deltaY > 60 || (deltaY > 28 && velocity > 0.35)) {
        modal.style.transform = 'translateY(100vh)';
        mobileServices.hapticBuzz();
        setTimeout(() => {
          modal.style.removeProperty('transform');
          modal.style.removeProperty('transition');
          this.close();
        }, 220);
      } else {
        modal.style.removeProperty('transform');
      }
    };

    header.addEventListener('touchend', onTouchEnd, { passive: true });
    header.addEventListener('touchcancel', onTouchEnd, { passive: true });
  }

  // ==========================================
  // Progressive Smooth Horizontal Swipe Navigation
  // ==========================================

  _setupHorizontalSwipeNavigation() {
    const modalBody = document.querySelector('.full-calendar-body');
    if (!modalBody) return;

    let touchStartX = 0;
    let touchStartY = 0;
    let swipeStartTime = 0;
    let isSwipingHorizontal = false;
    let activeContainer = null;

    const getActiveContainer = () => {
      if (this.activeView === 'day') return this.elements.dayView;
      if (this.activeView === 'week') return this.elements.weekView;
      return this.elements.monthView;
    };

    modalBody.addEventListener('touchstart', (e) => {
      if (e.touches && e.touches.length === 1) {
        touchStartX = e.touches[0].clientX;
        touchStartY = e.touches[0].clientY;
        swipeStartTime = Date.now();
        isSwipingHorizontal = false;
        activeContainer = getActiveContainer();
      }
    }, { passive: true });

    modalBody.addEventListener('touchmove', (e) => {
      if (!touchStartX || !touchStartY || !activeContainer) return;
      if (e.touches && e.touches.length > 1) {
        if (isSwipingHorizontal) {
          isSwipingHorizontal = false;
          activeContainer.style.removeProperty('transform');
          activeContainer.style.removeProperty('opacity');
        }
        return;
      }

      const currentX = e.touches[0].clientX;
      const currentY = e.touches[0].clientY;
      const diffX = currentX - touchStartX;
      const diffY = currentY - touchStartY;

      if (!isSwipingHorizontal) {
        if (Math.abs(diffX) > 12 && Math.abs(diffX) > Math.abs(diffY) * 1.5) {
          isSwipingHorizontal = true;
        }
      }

      if (isSwipingHorizontal) {
        activeContainer.style.transition = 'none';
        activeContainer.style.transform = `translateX(${diffX}px)`;
        const progress = Math.max(0.4, 1 - (Math.abs(diffX) / 500));
        activeContainer.style.opacity = progress.toString();
      }
    }, { passive: true });

    const onTouchEnd = (e) => {
      if (!isSwipingHorizontal || !activeContainer) {
        touchStartX = 0;
        touchStartY = 0;
        return;
      }
      isSwipingHorizontal = false;

      const touch = (e.changedTouches && e.changedTouches[0]) ? e.changedTouches[0] : null;
      const currentX = touch ? touch.clientX : touchStartX;
      const diffX = currentX - touchStartX;
      const elapsed = Math.max(1, Date.now() - swipeStartTime);
      const velocity = Math.abs(diffX) / elapsed;

      touchStartX = 0;
      touchStartY = 0;

      if (Math.abs(diffX) > 55 || (Math.abs(diffX) > 25 && velocity > 0.35)) {
        const isNext = diffX < 0;
        const exitX = isNext ? '-100%' : '100%';
        const enterX = isNext ? '100%' : '-100%';

        activeContainer.style.transition = 'transform 0.16s ease-out, opacity 0.16s ease-out';
        activeContainer.style.transform = `translateX(${exitX})`;
        activeContainer.style.opacity = '0';

        setTimeout(() => {
          this.navigate(isNext ? 1 : -1);
          activeContainer = getActiveContainer();
          if (activeContainer) {
            activeContainer.style.transition = 'none';
            activeContainer.style.transform = `translateX(${enterX})`;
            activeContainer.style.opacity = '0';

            requestAnimationFrame(() => {
              activeContainer.style.transition = 'transform 0.22s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.22s ease-out';
              activeContainer.style.transform = 'translateX(0)';
              activeContainer.style.opacity = '1';
            });
          }
        }, 160);
      } else {
        activeContainer.style.transition = 'transform 0.2s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.2s ease-out';
        activeContainer.style.transform = 'translateX(0)';
        activeContainer.style.opacity = '1';
      }
    };

    modalBody.addEventListener('touchend', onTouchEnd, { passive: true });
    modalBody.addEventListener('touchcancel', onTouchEnd, { passive: true });
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
      if (e.touches && e.touches.length === 2) {
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
        const newHeight = Math.round(Math.max(30, Math.min(110, initialHourHeight * scale)));
        if (newHeight !== this.weekHourHeight) {
          this.weekHourHeight = newHeight;
          container.style.setProperty('--cal-week-hour-height', newHeight + 'px');
          this._renderWeekView();

          const newCenterTimelineY = ((centerMinutes - (7 * 60)) / 60) * newHeight;
          container.scrollTop = Math.max(0, newCenterTimelineY - offsetFromTop);
        }
      }
    }, { passive: true });

    const endPinch = () => {
      if (isPinching) {
        isPinching = false;
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
          const mins = (currentTimelineY / oldH) * 60;
          const newH = Math.max(30, Math.min(110, oldH + delta));
          this.weekHourHeight = newH;
          container.style.setProperty('--cal-week-hour-height', newH + 'px');
          this._renderWeekView();
          container.scrollTop = Math.max(0, (mins / 60) * newH - pointerOffset);
        }
      }
    }, { passive: false });
  }

  // Smoothly reposition day event cards and current time line when hour height changes
  _updateDayViewPositions() {
    const body = this.elements.dayTimelineBody;
    if (!body) return;

    const hourHeight = this.dayHourHeight || 56;
    const cards = body.querySelectorAll('.day-event-card');
    const allEvents = taskStore.getCalendarEvents();

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
        const topPx = (startMin / 60) * hourHeight;
        const heightPx = Math.max(26, (dur / 60) * hourHeight);
        card.style.top = `${topPx}px`;
        card.style.height = `${heightPx}px`;
        card.classList.toggle('is-compact', heightPx < 44);
      }
    }

    if (this._isViewingToday()) {
      this._renderCurrentTimeLine();
    }
  }

  // ==========================================
  // Public Display API
  // ==========================================

  open() {
    if (this.elements.backdrop) {
      this.elements.backdrop.classList.remove('hidden');
    }
    analytics.trackInteraction('tab_switch', 'full_calendar');
    mobileServices.hapticTap();
    this.render();

    // Start dynamic current time ticker
    this._startTimeTicker();

    // If day view and viewing today, auto-scroll to current hour
    if (this.activeView === 'day' && this._isViewingToday()) {
      setTimeout(() => this._scrollToCurrentTime(), 60);
    }
  }

  close() {
    if (this.elements.backdrop) {
      this.elements.backdrop.classList.add('hidden');
    }
    this._stopTimeTicker();
  }

  switchView(viewName) {
    if (!viewName) return;
    this.activeView = viewName;

    const el = this.elements;
    if (el.viewSelect) {
      el.viewSelect.value = viewName;
    }

    if (el.dayView) el.dayView.classList.toggle('hidden', viewName !== 'day');
    if (el.weekView) el.weekView.classList.toggle('hidden', viewName !== 'week');
    if (el.monthView) el.monthView.classList.toggle('hidden', viewName !== 'month');

    // Show resolution selector toggle only in Day view
    if (el.resolutionWrapper) {
      el.resolutionWrapper.style.display = viewName === 'day' ? 'inline-flex' : 'none';
    }

    analytics.trackInteraction('cal_view_switch', viewName);
    mobileServices.hapticTap();
    this.render();

    if (viewName === 'day' && this._isViewingToday()) {
      setTimeout(() => this._scrollToCurrentTime(), 60);
    }
  }

  navigate(direction) {
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
    this.render();

    if (this.activeView === 'day' && this._isViewingToday()) {
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

  render() {
    this._renderRangeLabel();

    if (this.activeView === 'day') {
      this._renderDayView();
    } else if (this.activeView === 'week') {
      this._renderWeekView();
    } else if (this.activeView === 'month') {
      this._renderMonthView();
    }
  }

  // ==========================================
  // Render View Implementations
  // ==========================================

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
      const m1 = monthNames[mon.getMonth()].substring(0, 3);
      const m2 = monthNames[sun.getMonth()].substring(0, 3);
      if (mon.getMonth() === sun.getMonth()) {
        el.textContent = `${m1} ${mon.getDate()} - ${sun.getDate()}, ${cur.getFullYear()}`;
      } else {
        el.textContent = `${m1} ${mon.getDate()} - ${m2} ${sun.getDate()}, ${cur.getFullYear()}`;
      }
      el.title = el.textContent;
    } else if (this.activeView === 'day') {
      const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
      const sel = this.selectedDate || cur;
      el.textContent = `${dayNames[sel.getDay()].substring(0, 3)}, ${monthNames[sel.getMonth()].substring(0, 3)} ${sel.getDate()}`;
      el.title = `${dayNames[sel.getDay()]}, ${monthNames[sel.getMonth()]} ${sel.getDate()}, ${sel.getFullYear()}`;
    }
  }

  // 1. Day View (00:00 to 23:00, 24 hours with subdivision lines & dynamic current time bar)
  _renderDayView() {
    const body = this.elements.dayTimelineBody;
    if (!body) return;

    body.innerHTML = '';

    const sel = this.selectedDate || this.currentDate;
    const selStr = this._formatDateISO(sel);
    const isToday = this._isViewingToday();

    const allEvents = taskStore.getCalendarEvents();
    const eventsForDay = allEvents.filter(e => e.date === selStr);

    const resolution = this.currentResolution || 15;
    const hourHeight = this.dayHourHeight || 56; // px per hour

    // Apply active hour height CSS variable
    if (this.elements.dayTimelineScroll) {
      this.elements.dayTimelineScroll.style.setProperty('--cal-day-hour-height', `${hourHeight}px`);
    }

    // Render 24 hour slots (00:00 to 23:00)
    for (let h = 0; h < 24; h++) {
      const slot = document.createElement('div');
      slot.className = 'day-timeline-hour-slot';
      slot.setAttribute('data-hour', String(h));

      const timeLabel = document.createElement('div');
      timeLabel.className = 'day-time-label';
      timeLabel.textContent = `${String(h).padStart(2, '0')}:00`;
      slot.appendChild(timeLabel);

      const slotContent = document.createElement('div');
      slotContent.className = 'day-slot-content';

      // Render subtle dashed sub-interval lines based on current resolution
      if (resolution < 60) {
        const stepCount = 60 / resolution;
        for (let s = 1; s < stepCount; s++) {
          const subLine = document.createElement('div');
          subLine.className = 'day-sub-interval-line';
          const pct = (s / stepCount) * 100;
          subLine.style.top = `${pct}%`;
          slot.appendChild(subLine);
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

    // Render Dynamic Light-Blue Current Time Line
    if (isToday) {
      this._renderCurrentTimeLine();
    }

    // Render Event Cards Absolutely Positioned on the Day Timeline
    for (let j = 0; j < eventsForDay.length; j++) {
      const ev = eventsForDay[j];
      const startMin = this._parseTimeToMinutes(ev.startTime);
      const endMin = this._parseTimeToMinutes(ev.endTime);
      let dur = ev.plannedDuration;
      if (!dur || dur <= 0) {
        dur = endMin - startMin;
        if (dur <= 0) dur = 60;
      }

      const topPx = (startMin / 60) * hourHeight;
      const heightPx = Math.max(26, (dur / 60) * hourHeight);

      const card = document.createElement('div');
      card.className = `day-event-card ${ev.isLocked ? 'is-locked' : ''}`;
      card.style.top = `${topPx}px`;
      card.style.height = `${heightPx}px`;
      card.style.borderLeftColor = this._getCategoryColor(ev.category);
      card.setAttribute('data-event-id', ev.id);

      const isCompact = heightPx < 44;
      if (isCompact) card.classList.add('is-compact');

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
            <span class="event-cat-pill">${this._escapeHtml(ev.category || 'Work')}</span>
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
        lockBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          const newLocked = !ev.isLocked;
          taskStore.updateCalendarEvent(ev.id, { isLocked: newLocked });
          mobileServices.hapticTap();
          this.render();
          this._showToast(newLocked ? '🔒 Event locked to fixed schedule' : '🔓 Event unlocked (flexible)');
        });
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

    const allEvents = taskStore.getCalendarEvents();

    // 16 Hours (07:00 to 22:00)
    const startHour = 7;
    const endHour = 22;
    const hourHeight = this.weekHourHeight || 50; // dynamic px per hour

    if (this.elements.weekGridScroll) {
      this.elements.weekGridScroll.style.setProperty('--cal-week-hour-height', `${hourHeight}px`);
    }

    // Time labels column
    const timeCol = document.createElement('div');
    timeCol.className = 'week-time-col';
    for (let h = startHour; h <= endHour; h++) {
      const lbl = document.createElement('div');
      lbl.className = 'week-hour-label';
      lbl.textContent = `${String(h).padStart(2, '0')}:00`;
      timeCol.appendChild(lbl);
    }
    body.appendChild(timeCol);

    const padlockSvg = `<svg class="cal-mini-lock-svg" width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z"/></svg>`;

    // 7 day columns
    for (let i = 0; i < 7; i++) {
      const d = weekDates[i];
      const dStr = this._formatDateISO(d);
      const dayCol = document.createElement('div');
      dayCol.className = 'week-day-col';
      dayCol.setAttribute('data-date', dStr);
      dayCol.style.height = `${(endHour - startHour + 1) * hourHeight}px`;

      // Render horizontal lines at the hours in each day column
      for (let h = startHour; h <= endHour; h++) {
        const line = document.createElement('div');
        line.className = 'week-hour-line';
        line.style.top = `${(h - startHour) * hourHeight}px`;
        dayCol.appendChild(line);
      }

      const eventsForDate = allEvents.filter(e => e.date === dStr);

      for (let j = 0; j < eventsForDate.length; j++) {
        const ev = eventsForDate[j];
        const startMin = this._parseTimeToMinutes(ev.startTime);
        const endMin = this._parseTimeToMinutes(ev.endTime);

        const cardStartHour = startMin / 60;
        const cardEndHour = endMin / 60;

        if (cardEndHour > startHour && cardStartHour < endHour + 1) {
          const top = Math.max(0, (cardStartHour - startHour) * hourHeight);
          const durationHrs = Math.max(0.4, (endMin - startMin) / 60);
          const height = durationHrs * hourHeight;

          const card = document.createElement('div');
          card.className = `week-event-card ${ev.isLocked ? 'is-locked' : ''}`;
          card.style.top = `${top}px`;
          card.style.height = `${height}px`;
          card.style.backgroundColor = this._getCategoryColor(ev.category);
          card.setAttribute('data-event-id', ev.id);

          const isShort = height < 44;

          // If short height, show only title (and lock icon). If taller, show time span too.
          card.innerHTML = `
            <div class="week-event-title">${this._escapeHtml(ev.title)} ${isShort && ev.isLocked ? padlockSvg : ''}</div>
            ${!isShort ? `<div class="week-event-time">${ev.startTime} ${ev.isLocked ? padlockSvg : ''}</div>` : ''}
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
        const startTimeStr = `${String(Math.min(23, Math.max(0, clickedHour))).padStart(2, '0')}:00`;
        const endTimeStr = `${String(Math.min(23, Math.max(1, clickedHour + 1))).padStart(2, '0')}:00`;

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
    const allEvents = taskStore.getCalendarEvents();

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
        pill.style.backgroundColor = this._getCategoryColor(ev.category);
        pill.setAttribute('data-event-id', ev.id);

        // Solid background, NO emoji, task title only (clipped without ...)
        const title = document.createElement('span');
        title.className = 'event-title';
        title.textContent = ev.title;
        pill.appendChild(title);

        if (ev.isLocked) {
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

  _renderCurrentTimeLine() {
    const body = this.elements.dayTimelineBody;
    if (!body) return;

    let line = body.querySelector('.day-current-time-line');
    if (!line) {
      line = document.createElement('div');
      line.className = 'day-current-time-line';
      body.appendChild(line);
    }

    const now = new Date();
    const minFromMidnight = (now.getHours() * 60) + now.getMinutes();
    const hourHeight = this.dayHourHeight || 56;
    const topPx = (minFromMidnight / 60) * hourHeight;
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
    const hourHeight = this.dayHourHeight || 56;
    const topPx = (minFromMidnight / 60) * hourHeight;
    scrollEl.scrollTop = Math.max(0, topPx - 100);
  }

  _isViewingToday() {
    const sel = this.selectedDate || this.currentDate;
    return this._formatDateISO(sel) === this._formatDateISO(new Date());
  }

  // ==========================================
  // Hold-to-Drag & Tap-to-Inspect Handlers
  // ==========================================

  // Day View: hold 200ms to drag up/down, snaps to currentResolution intervals
  _setupDayEventDrag(card, ev) {
    let holdTimer = null;
    let isDragging = false;
    let startY = 0;
    let initialTop = 0;
    const resolution = this.currentResolution || 15;
    const durMin = ev.plannedDuration || 60;

    const onPointerDown = (e) => {
      if (e.button !== undefined && e.button !== 0) return;
      if (e.target.closest('[data-action="toggle-lock"]')) return;

      startY = e.clientY;
      initialTop = parseInt(card.style.top, 10) || 0;
      isDragging = false;

      holdTimer = setTimeout(() => {
        holdTimer = null;
        isDragging = true;
        card.classList.add('is-dragging-cal-event');
        mobileServices.hapticBuzz();
        try {
          card.setPointerCapture(e.pointerId);
        } catch (_) {}
      }, 200);
    };

    const onPointerMove = (e) => {
      if (!isDragging) {
        const delta = Math.hypot(e.clientY - startY);
        if (delta > 8 && holdTimer) {
          clearTimeout(holdTimer);
          holdTimer = null;
        }
        return;
      }

      if (e.cancelable) e.preventDefault();
      const deltaY = e.clientY - startY;
      const rawTop = initialTop + deltaY;
      const hourHeight = this.dayHourHeight || 56;

      // Snap to active resolution based on current hourHeight
      const rawMinutes = (rawTop / hourHeight) * 60;
      const snappedMinutes = Math.max(0, Math.min(1440 - durMin, Math.round(rawMinutes / resolution) * resolution));
      const snappedTopPx = (snappedMinutes / 60) * hourHeight;
      card.style.top = `${snappedTopPx}px`;

      // Live time range badge preview
      const previewStartH = Math.floor(snappedMinutes / 60);
      const previewStartM = snappedMinutes % 60;
      const previewEndTotal = snappedMinutes + durMin;
      const previewEndH = Math.min(23, Math.floor(previewEndTotal / 60));
      const previewEndM = previewEndTotal % 60;

      const timeRangeEl = card.querySelector('.event-time-range');
      if (timeRangeEl) {
        timeRangeEl.textContent = `${String(previewStartH).padStart(2, '0')}:${String(previewStartM).padStart(2, '0')} - ${String(previewEndH).padStart(2, '0')}:${String(previewEndM).padStart(2, '0')}`;
      }
    };

    const onPointerUp = (e) => {
      if (holdTimer) {
        clearTimeout(holdTimer);
        holdTimer = null;
        // Released before hold threshold -> Tap to open inspector
        this.openEventInspector(ev);
        return;
      }

      if (isDragging) {
        isDragging = false;
        card.classList.remove('is-dragging-cal-event');

        const currentTop = parseInt(card.style.top, 10) || 0;
        const hourHeight = this.dayHourHeight || 56;
        const rawMinutes = (currentTop / hourHeight) * 60;
        const newStartMin = Math.max(0, Math.min(1440 - durMin, Math.round(rawMinutes / resolution) * resolution));

        const newStartH = Math.floor(newStartMin / 60);
        const newStartM = newStartMin % 60;
        const newEndTotal = newStartMin + durMin;
        const newEndH = Math.min(23, Math.floor(newEndTotal / 60));
        const newEndM = newEndTotal % 60;

        const newStartTime = `${String(newStartH).padStart(2, '0')}:${String(newStartM).padStart(2, '0')}`;
        const newEndTime = `${String(newEndH).padStart(2, '0')}:${String(newEndM).padStart(2, '0')}`;

        taskStore.updateCalendarEvent(ev.id, {
          startTime: newStartTime,
          endTime: newEndTime,
          plannedDuration: durMin
        });

        mobileServices.hapticTap();
        this._showToast(`✓ Rescheduled to ${newStartTime} - ${newEndTime}`);
        this.render();
      }
    };

    card.addEventListener('pointerdown', onPointerDown);
    card.addEventListener('pointermove', onPointerMove);
    card.addEventListener('pointerup', onPointerUp);
    card.addEventListener('pointercancel', onPointerUp);
  }

  // Week View: hold 200ms to drag between days and hours
  _setupWeekEventDrag(card, ev) {
    let holdTimer = null;
    let isDragging = false;
    let startX = 0;
    let startY = 0;

    const onPointerDown = (e) => {
      if (e.button !== undefined && e.button !== 0) return;
      startX = e.clientX;
      startY = e.clientY;
      isDragging = false;

      holdTimer = setTimeout(() => {
        holdTimer = null;
        isDragging = true;
        card.classList.add('is-dragging-cal-event');
        mobileServices.hapticBuzz();
        try {
          card.setPointerCapture(e.pointerId);
        } catch (_) {}
      }, 200);
    };

    const onPointerMove = (e) => {
      if (!isDragging) {
        const delta = Math.hypot(e.clientX - startX, e.clientY - startY);
        if (delta > 8 && holdTimer) {
          clearTimeout(holdTimer);
          holdTimer = null;
        }
        return;
      }
      if (e.cancelable) e.preventDefault();
      card.style.transform = `translate3d(${e.clientX - startX}px, ${e.clientY - startY}px, 0)`;
    };

    const onPointerUp = (e) => {
      if (holdTimer) {
        clearTimeout(holdTimer);
        holdTimer = null;
        this.openEventInspector(ev);
        return;
      }

      if (isDragging) {
        isDragging = false;
        card.classList.remove('is-dragging-cal-event');
        card.style.removeProperty('transform');

        card.style.display = 'none';
        const targetEl = document.elementFromPoint(e.clientX, e.clientY);
        card.style.display = '';

        const targetCol = targetEl ? targetEl.closest('.week-day-col') : null;
        if (targetCol) {
          const targetDateStr = targetCol.getAttribute('data-date');
          const colRect = targetCol.getBoundingClientRect();
          const clickY = e.clientY - colRect.top;
          const hourHeight = this.weekHourHeight || 50;
          const clickedHour = Math.max(7, Math.min(22, Math.floor(7 + (clickY / hourHeight))));
          const newStartTime = `${String(clickedHour).padStart(2, '0')}:00`;
          const dur = ev.plannedDuration || 60;
          const newEndTotal = (clickedHour * 60) + dur;
          const endH = Math.min(23, Math.floor(newEndTotal / 60));
          const endM = newEndTotal % 60;
          const newEndTime = `${String(endH).padStart(2, '0')}:${String(endM).padStart(2, '0')}`;

          taskStore.updateCalendarEvent(ev.id, {
            date: targetDateStr || ev.date,
            startTime: newStartTime,
            endTime: newEndTime
          });

          mobileServices.hapticTap();
          this._showToast(`✓ Moved to ${targetDateStr} at ${newStartTime}`);
          this.render();
        } else {
          this.render();
        }
      }
    };

    card.addEventListener('pointerdown', onPointerDown);
    card.addEventListener('pointermove', onPointerMove);
    card.addEventListener('pointerup', onPointerUp);
    card.addEventListener('pointercancel', onPointerUp);
  }

  // Month View: hold 200ms to drag between day cells
  _setupMonthEventDrag(pill, ev) {
    let holdTimer = null;
    let isDragging = false;
    let startX = 0;
    let startY = 0;
    let currentOverCell = null;

    const onPointerDown = (e) => {
      if (e.button !== undefined && e.button !== 0) return;
      startX = e.clientX;
      startY = e.clientY;
      isDragging = false;

      holdTimer = setTimeout(() => {
        holdTimer = null;
        isDragging = true;
        pill.classList.add('is-dragging-cal-event');
        mobileServices.hapticBuzz();
        try {
          pill.setPointerCapture(e.pointerId);
        } catch (_) {}
      }, 200);
    };

    const onPointerMove = (e) => {
      if (!isDragging) {
        const delta = Math.hypot(e.clientX - startX, e.clientY - startY);
        if (delta > 8 && holdTimer) {
          clearTimeout(holdTimer);
          holdTimer = null;
        }
        return;
      }
      if (e.cancelable) e.preventDefault();
      pill.style.transform = `translate3d(${e.clientX - startX}px, ${e.clientY - startY}px, 0)`;

      pill.style.display = 'none';
      const targetEl = document.elementFromPoint(e.clientX, e.clientY);
      pill.style.display = '';

      const targetCell = targetEl ? targetEl.closest('.month-day-cell') : null;
      if (targetCell !== currentOverCell) {
        if (currentOverCell) currentOverCell.classList.remove('drag-target-over');
        currentOverCell = targetCell;
        if (currentOverCell) currentOverCell.classList.add('drag-target-over');
      }
    };

    const onPointerUp = (e) => {
      if (holdTimer) {
        clearTimeout(holdTimer);
        holdTimer = null;
        this.openEventInspector(ev);
        return;
      }

      if (isDragging) {
        isDragging = false;
        pill.classList.remove('is-dragging-cal-event');
        pill.style.removeProperty('transform');

        if (currentOverCell) {
          currentOverCell.classList.remove('drag-target-over');
          const targetDateStr = currentOverCell.getAttribute('data-date');
          currentOverCell = null;

          if (targetDateStr && targetDateStr !== ev.date) {
            taskStore.updateCalendarEvent(ev.id, { date: targetDateStr });
            mobileServices.hapticTap();
            this._showToast(`✓ Moved to ${targetDateStr}`);
            this.render();
            return;
          }
        }
        this.render();
      }
    };

    pill.addEventListener('pointerdown', onPointerDown);
    pill.addEventListener('pointermove', onPointerMove);
    pill.addEventListener('pointerup', onPointerUp);
    pill.addEventListener('pointercancel', onPointerUp);
  }

  // ==========================================
  // Event Inspector & Edit Modal
  // ==========================================

  openEventInspector(eventObj, defaultDateStr, defaultStartTime, defaultEndTime) {
    this.selectedEvent = eventObj || null;
    const el = this.elements;

    const isNew = !eventObj;
    const titleModal = document.getElementById('calEventModalTitle');
    if (titleModal) {
      titleModal.textContent = isNew ? 'New Calendar Event' : 'Event Details';
    }

    if (el.eventIdInput) el.eventIdInput.value = eventObj ? eventObj.id : '';
    if (el.eventTitleInput) el.eventTitleInput.value = eventObj ? eventObj.title : '';
    if (el.eventDateInput) {
      el.eventDateInput.value = eventObj ? eventObj.date : (defaultDateStr || this._formatDateISO(new Date()));
    }
    if (el.eventStartTimeInput) {
      el.eventStartTimeInput.value = eventObj ? eventObj.startTime : (defaultStartTime || '10:00');
    }
    if (el.eventEndTimeInput) {
      el.eventEndTimeInput.value = eventObj ? eventObj.endTime : (defaultEndTime || '11:00');
    }

    const dur = eventObj && eventObj.plannedDuration ? eventObj.plannedDuration : 60;
    if (el.eventDurationInput) el.eventDurationInput.value = String(dur);

    this.currentEmoji = eventObj ? (eventObj.emoji || '💼') : '💼';
    if (el.eventHeaderEmoji) el.eventHeaderEmoji.textContent = this.currentEmoji;

    this.currentCategory = eventObj ? (eventObj.category || 'Work') : 'Work';
    if (el.eventCategoryInput) el.eventCategoryInput.value = this.currentCategory;

    // Refresh Category Chips
    if (this.refreshCategoryChips) {
      this.refreshCategoryChips();
    }

    // Refresh Duration Presets
    if (typeof window !== 'undefined' && typeof window.renderAllDurationPresetChips === 'function') {
      window.renderAllDurationPresetChips();
    }
    this._highlightActiveDurationChip();

    const isLocked = eventObj ? Boolean(eventObj.isLocked) : true;
    if (el.eventToggleLock) el.eventToggleLock.checked = isLocked;
    if (el.lockIcon) el.lockIcon.classList.toggle('active', isLocked);

    const useTimeBank = eventObj && eventObj.useTimeBank !== undefined ? Boolean(eventObj.useTimeBank) : true;
    if (el.eventTimeBankToggle) el.eventTimeBankToggle.checked = useTimeBank;
    if (el.piggyIcon) el.piggyIcon.classList.toggle('active', useTimeBank);

    if (el.btnDeleteEvent) {
      el.btnDeleteEvent.style.display = isNew ? 'none' : 'block';
    }

    if (el.eventModalBackdrop) {
      el.eventModalBackdrop.classList.remove('hidden');
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
    if (this.elements.eventEndTimeInput && this.elements.eventEndTimeInput.value.length === 5) {
      this._updateDurationFromTimeSpan();
    } else {
      this.updateEndTimeFromDuration();
    }
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
    const startTime = el.eventStartTimeInput ? el.eventStartTimeInput.value : '10:00';
    const endTime = el.eventEndTimeInput ? el.eventEndTimeInput.value : '11:00';
    const durationMin = el.eventDurationInput ? (parseInt(el.eventDurationInput.value, 10) || 60) : 60;
    const category = el.eventCategoryInput ? (el.eventCategoryInput.value.trim() || 'Work') : 'Work';
    const isLocked = el.eventToggleLock ? el.eventToggleLock.checked : true;
    const useTimeBank = el.eventTimeBankToggle ? el.eventTimeBankToggle.checked : true;
    const eventId = el.eventIdInput ? el.eventIdInput.value : '';

    if (category) {
      taskStore.addCategory(category);
    }

    if (eventId) {
      // Update existing
      taskStore.updateCalendarEvent(eventId, {
        title,
        date,
        startTime,
        endTime,
        plannedDuration: durationMin,
        isLocked,
        useTimeBank,
        emoji: this.currentEmoji,
        category
      });
      this._showToast('✓ Event updated');
    } else {
      // Add new
      taskStore.addCalendarEvent({
        title,
        date,
        startTime,
        endTime,
        plannedDuration: durationMin,
        isLocked,
        useTimeBank,
        emoji: this.currentEmoji,
        category
      });
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

    const startTime = el.eventStartTimeInput ? el.eventStartTimeInput.value : '10:00';
    const endTime = el.eventEndTimeInput ? el.eventEndTimeInput.value : '11:00';
    const durationMin = el.eventDurationInput ? (parseInt(el.eventDurationInput.value, 10) || 60) : 60;
    const category = el.eventCategoryInput ? (el.eventCategoryInput.value.trim() || 'Work') : 'Work';
    const isLocked = el.eventToggleLock ? el.eventToggleLock.checked : true;
    const useTimeBank = el.eventTimeBankToggle ? el.eventTimeBankToggle.checked : true;

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

  _getCategoryColor(category) {
    const cat = (category || 'general').trim().toLowerCase();
    switch (cat) {
      case 'work': return '#2563eb'; // Royal Blue
      case 'study': return '#7c3aed'; // Vibrant Purple
      case 'break': return '#d97706'; // Amber
      case 'personal': return '#059669'; // Emerald Green
      case 'exercise':
      case 'fitness': return '#dc2626'; // Red
      case 'reading': return '#0891b2'; // Cyan
      case 'coding':
      case 'dev': return '#4f46e5'; // Indigo
      default: {
        const colors = ['#2563eb', '#7c3aed', '#059669', '#d97706', '#0891b2', '#4f46e5', '#db2777', '#0284c7'];
        let hash = 0;
        for (let i = 0; i < cat.length; i++) {
          hash = cat.charCodeAt(i) + ((hash << 5) - hash);
        }
        const idx = Math.abs(hash) % colors.length;
        return colors[idx];
      }
    }
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

  _escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  _showToast(msg) {
    if (typeof window !== 'undefined' && typeof window.showToastNotification === 'function') {
      window.showToastNotification(msg);
    }
  }
}

export const calendarView = new CalendarView();
export default calendarView;
