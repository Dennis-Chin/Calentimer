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
    this.currentResolution = 15; // default 15 minutes for day view
    this.weekResolution = 15; // default 15 minutes for week view
    this.dayHourHeight = 56; // dynamic hour height for day view (px)
    this.weekHourHeight = 50; // dynamic hour height for week view (px)
    this.currentTimeTimer = null;
    this.refreshCategoryChips = null;
    this.isDraggingEvent = false; // Prevents page swipe when holding/dragging an event

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
    this._setupPullToDismiss();
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

    const onTouchStart = (e) => {
      if (e.target.closest('button, select, input, .cal-event-lock-btn, .time-clock-addon-btn')) return;
      if (!e.touches || e.touches.length !== 1) return;

      const activeScroll = (this.activeView === 'day' && this.elements.dayTimelineScroll)
        ? this.elements.dayTimelineScroll
        : ((this.activeView === 'week' && this.elements.weekGridScroll) ? this.elements.weekGridScroll : null);

      const isAtTop = !activeScroll || activeScroll.scrollTop <= 0;
      const isHeaderTouch = Boolean(e.target.closest('.full-calendar-header, .cal-drag-handle-bar, .cal-sub-toolbar'));

      if (isAtTop || isHeaderTouch) {
        touchStartY = e.touches[0].clientY;
        touchStartX = e.touches[0].clientX;
        touchStartTime = Date.now();
        isPullingDown = false;
      }
    };

    const onTouchMove = (e) => {
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
        const isHeaderTouch = Boolean(e.target.closest('.full-calendar-header, .cal-drag-handle-bar, .cal-sub-toolbar'));

        if (isAtTop || isHeaderTouch) {
          isPullingDown = true;
          // Apply 0.35 resistance damping for firm pull feeling
          const rubberbandY = Math.min(deltaY * 0.35, 180);
          modal.style.transition = 'none';
          modal.style.transform = `translate3d(0, ${rubberbandY}px, 0)`;
        }
      }
    };

    const onTouchEnd = (e) => {
      if (!isPullingDown) {
        touchStartY = 0;
        touchStartX = 0;
        return;
      }
      isPullingDown = false;
      const currentY = (e.changedTouches && e.changedTouches[0]) ? e.changedTouches[0].clientY : 0;
      const deltaY = currentY - touchStartY;
      const elapsed = Math.max(1, Date.now() - touchStartTime);
      const velocity = deltaY / elapsed;

      touchStartY = 0;
      touchStartX = 0;

      // Higher resistance: requires a deliberate pull (deltaY > 140px or fast flick deltaY > 90px with high velocity)
      if (deltaY > 140 || (deltaY > 90 && velocity > 0.65)) {
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
        // Did not pull far enough: smoothly springs back up
        modal.style.transition = 'transform 0.25s cubic-bezier(0.16, 1, 0.3, 1)';
        modal.style.transform = 'translate3d(0, 0, 0)';
        setTimeout(() => {
          modal.style.removeProperty('transform');
          modal.style.removeProperty('transition');
        }, 250);
      }
    };

    modal.addEventListener('touchstart', onTouchStart, { passive: true });
    modal.addEventListener('touchmove', onTouchMove, { passive: true });
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
    let swipeStartTime = 0;
    let isSwipingHorizontal = false;
    let activeContainer = null;
    let adjacentSlide = null;
    let currentSlideDirection = 0; // -1 for prev, 1 for next

    const getActiveContainer = () => {
      if (this.activeView === 'day') return this.elements.dayView;
      if (this.activeView === 'week') return this.elements.weekView;
      return this.elements.monthView;
    };

    modalBody.addEventListener('touchstart', (e) => {
      if (this.isDraggingEvent) return;
      if (e.touches && e.touches.length === 1) {
        // Allow touches on event cards so swiping over tasks changes days; ignore only clickable buttons/inputs
        if (e.target.closest('button, select, input, .cal-event-lock-btn, .time-clock-addon-btn')) {
          return;
        }
        touchStartX = e.touches[0].clientX;
        touchStartY = e.touches[0].clientY;
        swipeStartTime = Date.now();
        isSwipingHorizontal = false;
        activeContainer = getActiveContainer();
        currentSlideDirection = 0;
        if (adjacentSlide && adjacentSlide.parentNode) {
          adjacentSlide.parentNode.removeChild(adjacentSlide);
          adjacentSlide = null;
        }
      }
    }, { passive: true });

    modalBody.addEventListener('touchmove', (e) => {
      if (this.isDraggingEvent) {
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
      if (!touchStartX || !touchStartY || !activeContainer) return;
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
        if (Math.abs(diffX) > 12 && Math.abs(diffX) > Math.abs(diffY) * 1.4) {
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

          const currentScrollEl = activeContainer.querySelector('.day-timeline-scroll, .week-grid-scroll');
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

      if (Math.abs(diffX) > 50 || (Math.abs(diffX) > 20 && velocity > 0.3)) {
        const isNext = diffX < 0;
        const exitX = isNext ? -bodyWidth : bodyWidth;
        const currentScrollEl = activeContainer.querySelector('.day-timeline-scroll, .week-grid-scroll');
        const savedScrollTop = currentScrollEl ? currentScrollEl.scrollTop : 0;

        activeContainer.style.transition = 'transform 0.22s cubic-bezier(0.16, 1, 0.3, 1)';
        activeContainer.style.transform = `translate3d(${exitX}px, 0, 0)`;

        if (adjacentSlide) {
          adjacentSlide.style.transition = 'transform 0.22s cubic-bezier(0.16, 1, 0.3, 1)';
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
        }, 220);
      } else {
        activeContainer.style.transition = 'transform 0.2s cubic-bezier(0.16, 1, 0.3, 1)';
        activeContainer.style.transform = 'translate3d(0, 0, 0)';
        if (adjacentSlide) {
          adjacentSlide.style.transition = 'transform 0.2s cubic-bezier(0.16, 1, 0.3, 1)';
          const returnX = currentSlideDirection > 0 ? bodyWidth : -bodyWidth;
          adjacentSlide.style.transform = `translate3d(${returnX}px, 0, 0)`;
          setTimeout(() => {
            if (adjacentSlide && adjacentSlide.parentNode) {
              adjacentSlide.parentNode.removeChild(adjacentSlide);
              adjacentSlide = null;
            }
          }, 200);
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

    const allEvents = taskStore.getCalendarEvents();

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

      for (let h = startHour; h < endHour; h++) {
        const slot = document.createElement('div');
        slot.className = 'day-timeline-hour-slot';
        const timeLabel = document.createElement('div');
        timeLabel.className = 'day-time-label';
        timeLabel.textContent = `${String(h).padStart(2, '0')}:00`;
        slot.appendChild(timeLabel);
        const slotContent = document.createElement('div');
        slotContent.className = 'day-slot-content';
        slot.appendChild(slotContent);
        body.appendChild(slot);
      }

      for (let j = 0; j < eventsForDay.length; j++) {
        const ev = eventsForDay[j];
        const startMin = this._parseTimeToMinutes(ev.startTime);
        const endMin = this._parseTimeToMinutes(ev.endTime);
        let dur = ev.plannedDuration;
        if (!dur || dur <= 0) {
          dur = endMin - startMin;
          if (dur <= 0) dur = 60;
        }
        const topPx = 14 + (Math.max(0, startMin - (startHour * 60)) / 60) * hourHeight;
        const heightPx = Math.max(26, (dur / 60) * hourHeight);
        const card = document.createElement('div');
        card.className = `day-event-card ${ev.isLocked ? 'is-locked' : ''}`;
        card.style.top = `${topPx}px`;
        card.style.borderLeftColor = this._getCategoryColor(ev.category);
        this._applyEventCardLayout(card, heightPx);
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
          ${ev.isLocked ? `
            <div class="cal-event-lock-btn is-locked" style="pointer-events:none;">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
                <path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z"/>
              </svg>
            </div>
          ` : ''}
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
      let startHour = 7;
      let endHour = 22;
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
      for (let h = startHour; h < endHour; h++) {
        const lbl = document.createElement('div');
        lbl.className = 'week-hour-label';
        lbl.textContent = `${String(h).padStart(2, '0')}:00`;
        lbl.style.top = `${14 + ((h - startHour) * hourHeight)}px`;
        timeCol.appendChild(lbl);
      }
      body.appendChild(timeCol);

      const padlockSvg = `<svg class="cal-mini-lock-svg" width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z"/></svg>`;

      for (let i = 0; i < 7; i++) {
        const d = weekDates[i];
        const dStr = this._formatDateISO(d);
        const dayCol = document.createElement('div');
        dayCol.className = 'week-day-col';
        dayCol.style.height = `${(endHour - startHour) * hourHeight}px`;

        const resolution = this.weekResolution || 15;
        for (let h = startHour; h < endHour; h++) {
          const hourTop = 14 + ((h - startHour) * hourHeight);
          const line = document.createElement('div');
          line.className = 'week-hour-line';
          line.style.top = `${hourTop}px`;
          dayCol.appendChild(line);

          if (resolution < 60) {
            const stepCount = 60 / resolution;
            for (let s = 1; s < stepCount; s++) {
              const subLine = document.createElement('div');
              subLine.className = 'week-sub-interval-line';
              subLine.setAttribute('data-h-idx', String(h - startHour));
              subLine.setAttribute('data-s-ratio', String(s / stepCount));
              subLine.style.top = `${hourTop + ((s / stepCount) * hourHeight)}px`;
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
            const top = 14 + Math.max(0, (cardStartHour - startHour) * hourHeight);
            const durationHrs = Math.max(0.4, (endMin - startMin) / 60);
            const height = durationHrs * hourHeight;
            const card = document.createElement('div');
            card.className = `week-event-card ${ev.isLocked ? 'is-locked' : ''}`;
            card.style.top = `${top}px`;
            card.style.height = `${height}px`;
            card.style.backgroundColor = this._getCategoryColor(ev.category);
            const isShort = height < 44;
            card.innerHTML = `
              <div class="week-event-title">${this._escapeHtml(ev.title)} ${isShort && ev.isLocked ? padlockSvg : ''}</div>
              ${!isShort ? `<div class="week-event-time">${ev.startTime} ${ev.isLocked ? padlockSvg : ''}</div>` : ''}
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
          pill.style.backgroundColor = this._getCategoryColor(ev.category);
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
    let startHour = 7;
    let endHour = 22;
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
      labels[i].style.top = `${14 + (i * hourHeight)}px`;
    }

    // Update day columns height and horizontal lines
    const dayCols = body.querySelectorAll('.week-day-col');
    for (let i = 0; i < dayCols.length; i++) {
      dayCols[i].style.height = `${(endHour - startHour) * hourHeight}px`;
      const lines = dayCols[i].querySelectorAll('.week-hour-line');
      for (let j = 0; j < lines.length; j++) {
        lines[j].style.top = `${14 + (j * hourHeight)}px`;
      }
      const subLines = dayCols[i].querySelectorAll('.week-sub-interval-line');
      for (let s = 0; s < subLines.length; s++) {
        const sub = subLines[s];
        const hIdx = parseFloat(sub.getAttribute('data-h-idx') || '0');
        const ratio = parseFloat(sub.getAttribute('data-s-ratio') || '0');
        sub.style.top = `${14 + (hIdx * hourHeight) + (ratio * hourHeight)}px`;
      }
    }

    // Update event cards positions and heights
    const cards = body.querySelectorAll('.week-event-card');
    const allEvents = taskStore.getCalendarEvents();
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
        const topPx = 14 + (((startMin - (startHour * 60)) / 60) * hourHeight);
        const hPx = Math.max(20, (dur / 60) * hourHeight);
        card.style.top = `${topPx}px`;
        card.style.height = `${hPx}px`;
      }
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
      setTimeout(() => this._scrollToCurrentTime(), 60);
    }
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
    this._renderRangeLabel();

    if (this.activeView === 'day') {
      this._renderDayView();
      if (typeof preserveScrollTop === 'number' && preserveScrollTop > 0 && this.elements.dayTimelineScroll) {
        this.elements.dayTimelineScroll.scrollTop = preserveScrollTop;
      }
    } else if (this.activeView === 'week') {
      this._renderWeekView();
      if (typeof preserveScrollTop === 'number' && preserveScrollTop > 0 && this.elements.weekGridScroll) {
        this.elements.weekGridScroll.scrollTop = preserveScrollTop;
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

    const allEvents = taskStore.getCalendarEvents();
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

      // Check if overlapping with any earlier-starting event
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

      const card = document.createElement('div');
      card.className = `day-event-card ${ev.isLocked ? 'is-locked' : ''} ${isLaterOverlap ? 'is-overlapping-later' : ''}`;
      card.style.top = `${topPx}px`;
      card.style.borderLeftColor = this._getCategoryColor(ev.category);
      card.setAttribute('data-event-id', ev.id);
      this._applyEventCardLayout(card, heightPx);

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

    const isCustom = taskStore.getCalendarCustomRangeEnabled();
    let startHour = 7;
    let endHour = 22;
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

    // Time labels column
    const timeCol = document.createElement('div');
    timeCol.className = 'week-time-col';
    for (let h = startHour; h < endHour; h++) {
      const lbl = document.createElement('div');
      lbl.className = 'week-hour-label';
      lbl.textContent = `${String(h).padStart(2, '0')}:00`;
      lbl.style.top = `${14 + ((h - startHour) * hourHeight)}px`;
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
      dayCol.style.height = `${(endHour - startHour) * hourHeight}px`;

      // Render bold solid hour lines and subtle dashed interval lines matching Day view
      const resolution = this.weekResolution || 15;
      for (let h = startHour; h < endHour; h++) {
        const hourTop = 14 + ((h - startHour) * hourHeight);
        const line = document.createElement('div');
        line.className = 'week-hour-line';
        line.style.top = `${hourTop}px`;
        dayCol.appendChild(line);

        // Sub-interval dashed lines (only intervals have dashed lines)
        if (resolution < 60) {
          const stepCount = 60 / resolution;
          for (let s = 1; s < stepCount; s++) {
            const subLine = document.createElement('div');
            subLine.className = 'week-sub-interval-line';
            subLine.setAttribute('data-h-idx', String(h - startHour));
            subLine.setAttribute('data-s-ratio', String(s / stepCount));
            const subTop = hourTop + ((s / stepCount) * hourHeight);
            subLine.style.top = `${subTop}px`;
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
          const top = 14 + Math.max(0, (cardStartHour - startHour) * hourHeight);
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
        const clickY = e.clientY - rect.top - 14;
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
    const topPx = 14 + (((Math.max(startHour * 60, minFromMidnight) - (startHour * 60)) / 60) * hourHeight);
    scrollEl.scrollTop = Math.max(0, topPx - 100);
  }

  _isViewingToday() {
    const sel = this.selectedDate || this.currentDate;
    return this._formatDateISO(sel) === this._formatDateISO(new Date());
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
    let lastClientY = 0;
    let autoScrollRaf = null;
    const resolution = this.currentResolution || 15;
    const durMin = ev.plannedDuration || 60;
    const container = this.elements.dayTimelineScroll;

    const isCustom = taskStore.getCalendarCustomRangeEnabled();
    let startHour = 0;
    let endHour = 24;
    if (isCustom) {
      const startStr = taskStore.getCalendarStartTime() || '08:00';
      const endStr = taskStore.getCalendarEndTime() || '22:00';
      startHour = Math.max(0, Math.min(23, Math.floor(this._parseTimeToMinutes(startStr) / 60)));
      endHour = Math.max(startHour + 1, Math.min(24, Math.ceil(this._parseTimeToMinutes(endStr) / 60)));
    }

    const applySnappedPosition = (clientY) => {
      const hourHeight = this.dayHourHeight || 56;
      const deltaY = clientY - startY;
      const rawTop = Math.max(0, (initialTop - 14) + deltaY);
      const rawMinutes = (startHour * 60) + ((rawTop / hourHeight) * 60);
      const snappedMinutes = Math.max(startHour * 60, Math.min((endHour * 60) - durMin, Math.round(rawMinutes / resolution) * resolution));
      const snappedTopPx = 14 + (((snappedMinutes - (startHour * 60)) / 60) * hourHeight);
      card.style.top = `${snappedTopPx}px`;

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
            applySnappedPosition(lastClientY);
          }
        }

        autoScrollRaf = requestAnimationFrame(step);
      };
      autoScrollRaf = requestAnimationFrame(step);
    };

    let hasJumpedDay = false;
    let adjacentSlide = null;
    let targetDir = 0;
    let activeContainer = null;

    const jumpToAdjacentDay = (direction) => {
      if (hasJumpedDay && isDragging) return;
      hasJumpedDay = true;
      isDragging = false;
      this.isDraggingEvent = false;
      if (autoScrollRaf) {
        cancelAnimationFrame(autoScrollRaf);
        autoScrollRaf = null;
      }
      if (container) {
        container.style.removeProperty('overflow-y');
      }
      card.classList.remove('is-dragging-cal-event');
      card.style.removeProperty('transform');

      const currentTop = Math.max(0, (parseInt(card.style.top, 10) || 14) - 14);
      const hourHeight = this.dayHourHeight || 56;
      const rawMinutes = (startHour * 60) + ((currentTop / hourHeight) * 60);
      const newStartMin = Math.max(startHour * 60, Math.min((endHour * 60) - durMin, Math.round(rawMinutes / resolution) * resolution));

      const newStartH = Math.floor(newStartMin / 60);
      const newStartM = newStartMin % 60;
      const newEndTotal = newStartMin + durMin;
      const newEndH = Math.min(23, Math.floor(newEndTotal / 60));
      const newEndM = newEndTotal % 60;

      const newStartTime = `${String(newStartH).padStart(2, '0')}:${String(newStartM).padStart(2, '0')}`;
      const newEndTime = `${String(newEndH).padStart(2, '0')}:${String(newEndM).padStart(2, '0')}`;

      // Calculate target date (direction: -1 = yesterday, 1 = tomorrow)
      const currentActiveDate = new Date(this.selectedDate || this.currentDate);
      currentActiveDate.setDate(currentActiveDate.getDate() + direction);
      const targetDateStr = this._formatDateISO(currentActiveDate);

      // Reschedule task to target day and new time
      taskStore.updateCalendarEvent(ev.id, {
        date: targetDateStr,
        startTime: newStartTime,
        endTime: newEndTime,
        plannedDuration: durMin
      });

      mobileServices.hapticBuzz();
      this._showToast(`📅 Moved to ${direction > 0 ? 'tomorrow' : 'yesterday'} (${newStartTime} - ${newEndTime})`);

      // Slide transition to adjacent day
      this.navigate(direction);
    };

    const triggerDaySlideJump = (direction, diffX, bodyWidth) => {
      if (hasJumpedDay) return;
      hasJumpedDay = true;
      isDragging = false;
      this.isDraggingEvent = false;
      if (autoScrollRaf) {
        cancelAnimationFrame(autoScrollRaf);
        autoScrollRaf = null;
      }
      if (container) {
        container.style.removeProperty('overflow-y');
      }

      const exitX = diffX < 0 ? -bodyWidth : bodyWidth;
      if (activeContainer) {
        activeContainer.style.transition = 'transform 0.22s cubic-bezier(0.16, 1, 0.3, 1)';
        activeContainer.style.transform = `translate3d(${exitX}px, 0, 0)`;
      }
      if (adjacentSlide) {
        adjacentSlide.style.transition = 'transform 0.22s cubic-bezier(0.16, 1, 0.3, 1)';
        adjacentSlide.style.transform = 'translate3d(0, 0, 0)';
      }

      setTimeout(() => {
        if (adjacentSlide && adjacentSlide.parentNode) {
          adjacentSlide.parentNode.removeChild(adjacentSlide);
          adjacentSlide = null;
        }
        if (activeContainer) {
          activeContainer.style.removeProperty('transform');
          activeContainer.style.removeProperty('transition');
        }
        jumpToAdjacentDay(direction);
      }, 220);
    };

    const handleDragMove = (clientX, clientY) => {
      lastClientY = clientY;
      applySnappedPosition(clientY);

      const diffX = clientX - startX;
      // Task floats freely horizontally with the finger
      card.style.transform = `translate3d(${diffX}px, 0, 0) scale(1.05)`;

      const modalBody = this.elements.modalBody;
      const bodyWidth = modalBody ? (modalBody.clientWidth || 360) : 360;

      if (!activeContainer && modalBody) {
        activeContainer = modalBody.querySelector('.calendar-view-container');
      }

      // Drag left (diffX < 0) -> previous day (-1)
      // Drag right (diffX > 0) -> next day (+1)
      const currentDir = diffX < 0 ? -1 : 1;

      if (Math.abs(diffX) > 15) {
        if (targetDir !== currentDir) {
          targetDir = currentDir;
          if (adjacentSlide && adjacentSlide.parentNode) {
            adjacentSlide.parentNode.removeChild(adjacentSlide);
            adjacentSlide = null;
          }
          const targetDate = new Date(this.selectedDate || this.currentDate);
          targetDate.setDate(targetDate.getDate() + targetDir);
          const currentScrollTop = container ? container.scrollTop : 0;
          adjacentSlide = this._buildAdjacentPreviewSlide(targetDate, targetDir, currentScrollTop);
          if (modalBody) {
            modalBody.appendChild(adjacentSlide);
            const adjScroll = adjacentSlide.querySelector('.day-timeline-scroll');
            if (adjScroll) {
              adjScroll.scrollTop = currentScrollTop;
            }
          }
        }

        if (activeContainer) {
          activeContainer.style.transition = 'none';
          activeContainer.style.transform = `translate3d(${diffX}px, 0, 0)`;
        }
        if (adjacentSlide) {
          adjacentSlide.style.transition = 'none';
          const adjX = targetDir === -1 ? (bodyWidth + diffX) : (-bodyWidth + diffX);
          adjacentSlide.style.transform = `translate3d(${adjX}px, 0, 0)`;
        }
      } else {
        if (adjacentSlide && adjacentSlide.parentNode) {
          adjacentSlide.parentNode.removeChild(adjacentSlide);
          adjacentSlide = null;
          targetDir = 0;
        }
        if (activeContainer) {
          activeContainer.style.transition = 'none';
          activeContainer.style.transform = 'translate3d(0, 0, 0)';
        }
      }

      if (Math.abs(diffX) > 85) {
        triggerDaySlideJump(currentDir, diffX, bodyWidth);
      }
    };

    const startDragMode = () => {
      if (ev.isLocked) {
        mobileServices.hapticWarning();
        this._showToast('🔒 Disable padlock to move this event');
        const lockBtn = card.querySelector('.cal-event-lock-btn');
        if (lockBtn) {
          lockBtn.classList.remove('pulse-glow');
          void lockBtn.offsetWidth;
          lockBtn.classList.add('pulse-glow');
          setTimeout(() => {
            if (lockBtn) lockBtn.classList.remove('pulse-glow');
          }, 1100);
        }
        return;
      }
      isDragging = true;
      this.isDraggingEvent = true;
      hasJumpedDay = false;
      card.classList.add('is-dragging-cal-event');
      mobileServices.hapticBuzz();
      if (container) {
        container.style.overflowY = 'hidden';
      }
      startAutoScrollLoop();
    };

    const finishDrag = () => {
      if (!isDragging || hasJumpedDay) return;
      isDragging = false;
      this.isDraggingEvent = false;
      if (autoScrollRaf) {
        cancelAnimationFrame(autoScrollRaf);
        autoScrollRaf = null;
      }
      if (container) {
        container.style.removeProperty('overflow-y');
      }
      card.classList.remove('is-dragging-cal-event');
      card.style.removeProperty('transform');

      // Spring activeContainer back and remove adjacentSlide if any
      const modalBody = this.elements.modalBody;
      const bodyWidth = modalBody ? (modalBody.clientWidth || 360) : 360;
      if (activeContainer) {
        activeContainer.style.transition = 'transform 0.2s cubic-bezier(0.16, 1, 0.3, 1)';
        activeContainer.style.transform = 'translate3d(0, 0, 0)';
        setTimeout(() => {
          if (activeContainer) {
            activeContainer.style.removeProperty('transform');
            activeContainer.style.removeProperty('transition');
          }
        }, 200);
      }
      if (adjacentSlide) {
        adjacentSlide.style.transition = 'transform 0.2s cubic-bezier(0.16, 1, 0.3, 1)';
        const returnX = targetDir === -1 ? bodyWidth : -bodyWidth;
        adjacentSlide.style.transform = `translate3d(${returnX}px, 0, 0)`;
        setTimeout(() => {
          if (adjacentSlide && adjacentSlide.parentNode) {
            adjacentSlide.parentNode.removeChild(adjacentSlide);
            adjacentSlide = null;
          }
        }, 200);
      }

      const currentTop = Math.max(0, (parseInt(card.style.top, 10) || 14) - 14);
      const hourHeight = this.dayHourHeight || 56;
      const rawMinutes = (startHour * 60) + ((currentTop / hourHeight) * 60);
      const newStartMin = Math.max(startHour * 60, Math.min((endHour * 60) - durMin, Math.round(rawMinutes / resolution) * resolution));

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
    };

    // Touch events for mobile dragging
    card.addEventListener('touchstart', (e) => {
      if (e.target.closest('[data-action="toggle-lock"]')) return;
      if (e.touches && e.touches.length === 1) {
        startX = e.touches[0].clientX;
        startY = e.touches[0].clientY;
        lastClientY = e.touches[0].clientY;
        initialTop = parseInt(card.style.top, 10) || 14;
        isDragging = false;

        holdTimer = setTimeout(() => {
          holdTimer = null;
          startDragMode();
        }, 200);
      }
    }, { passive: true });

    card.addEventListener('touchmove', (e) => {
      if (!isDragging) {
        if (holdTimer && e.touches && e.touches.length === 1) {
          const diffX = e.touches[0].clientX - startX;
          const diffY = e.touches[0].clientY - startY;
          if (Math.hypot(diffX, diffY) > 8) {
            clearTimeout(holdTimer);
            holdTimer = null;
          }
        }
        return;
      }
      if (e.touches && e.touches.length === 1) {
        if (e.cancelable) e.preventDefault();
        handleDragMove(e.touches[0].clientX, e.touches[0].clientY);
      }
    }, { passive: false });

    card.addEventListener('touchend', (e) => {
      if (holdTimer) {
        clearTimeout(holdTimer);
        holdTimer = null;
        this.openEventInspector(ev);
        return;
      }
      finishDrag();
    }, { passive: true });

    card.addEventListener('touchcancel', () => {
      if (holdTimer) {
        clearTimeout(holdTimer);
        holdTimer = null;
      }
      if (isDragging) {
        finishDrag();
      }
    }, { passive: true });

    // Mouse events for desktop dragging
    card.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      if (e.target.closest('[data-action="toggle-lock"]')) return;
      startX = e.clientX;
      startY = e.clientY;
      lastClientY = e.clientY;
      initialTop = parseInt(card.style.top, 10) || 14;
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
        handleDragMove(me.clientX, me.clientY);
      };

      const onMouseUp = () => {
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onMouseUp);
        if (holdTimer) {
          clearTimeout(holdTimer);
          holdTimer = null;
          this.openEventInspector(ev);
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
    let autoScrollRaf = null;
    const container = this.elements.weekGridScroll;

    const isCustom = taskStore.getCalendarCustomRangeEnabled();
    let startHour = 7;
    let endHour = 22;
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
            setTimeout(() => { isWeekNavCooldown = false; }, 650);

            // Temporarily move card to container so render doesn't delete it
            const cardRect = card.getBoundingClientRect();
            const contRect = container.getBoundingClientRect();
            const curLeft = cardRect.left - contRect.left + container.scrollLeft;
            const curTop = cardRect.top - contRect.top + container.scrollTop;

            card.style.position = 'absolute';
            card.style.left = `${curLeft}px`;
            card.style.top = `${curTop}px`;
            card.style.width = `${cardRect.width}px`;
            card.style.zIndex = '99999';
            card.style.transform = 'scale(1.08)';
            container.appendChild(card);

            startX = clientX;
            startY = lastClientY;

            mobileServices.hapticBuzz();
            this._showToast(navDir > 0 ? '📅 Next week' : '📅 Previous week');

            // Switch week
            this.navigate(navDir);

            // Re-append card to container on top of newly rendered week grid
            container.appendChild(card);
          }, 400);
        }
      } else {
        if (weekNavTimer) {
          clearTimeout(weekNavTimer);
          weekNavTimer = null;
        }
      }
    };

    const onWindowTouchMove = (e) => {
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
      finishDrag(lastClientX, lastClientY);
    };

    const startDragMode = () => {
      if (ev.isLocked) {
        mobileServices.hapticWarning();
        this._showToast('🔒 Disable padlock to move this event');
        const lockEl = card.querySelector('.cal-mini-lock-svg') || card;
        lockEl.classList.remove('pulse-glow');
        void lockEl.offsetWidth;
        lockEl.classList.add('pulse-glow');
        setTimeout(() => {
          if (lockEl) lockEl.classList.remove('pulse-glow');
        }, 1100);
        return;
      }
      isDragging = true;
      this.isDraggingEvent = true;
      card.classList.add('is-dragging-cal-event');
      mobileServices.hapticBuzz();
      if (container) {
        container.style.overflowY = 'hidden';
      }
      startAutoScrollLoop();
      window.addEventListener('touchmove', onWindowTouchMove, { passive: false });
      window.addEventListener('touchend', onWindowTouchEnd, { passive: true });
      window.addEventListener('touchcancel', onWindowTouchCancel, { passive: true });
    };

    const updateWeekDragPosition = (clientX, clientY) => {
      card.style.transform = `translate3d(${clientX - startX}px, ${clientY - startY}px, 0) scale(1.08)`;
      checkWeekEdgePull(clientX);

      card.style.pointerEvents = 'none';
      const targetEl = document.elementFromPoint(clientX, clientY);
      card.style.pointerEvents = '';

      const targetCol = targetEl ? targetEl.closest('.week-day-col') : null;
      if (targetCol !== currentOverCol) {
        if (currentOverCol) currentOverCol.classList.remove('drag-target-over');
        currentOverCol = targetCol;
        if (currentOverCol) currentOverCol.classList.add('drag-target-over');
      }

      if (targetCol) {
        const colRect = targetCol.getBoundingClientRect();
        const clickY = clientY - colRect.top - 14;
        const hourHeight = this.weekHourHeight || 50;
        const resolution = this.weekResolution || 15;
        const rawMinutes = (startHour * 60) + ((clickY / hourHeight) * 60);
        const dur = ev.plannedDuration || 60;
        const snappedStartMin = Math.max(startHour * 60, Math.min((endHour * 60) - dur, Math.round(rawMinutes / resolution) * resolution));
        const newStartH = Math.floor(snappedStartMin / 60);
        const newStartM = snappedStartMin % 60;
        const newStartTime = `${String(newStartH).padStart(2, '0')}:${String(newStartM).padStart(2, '0')}`;
        const newEndTotal = snappedStartMin + dur;
        const endH = Math.min(23, Math.floor(newEndTotal / 60));
        const endM = newEndTotal % 60;
        const newEndTime = `${String(endH).padStart(2, '0')}:${String(endM).padStart(2, '0')}`;

        let timeEl = card.querySelector('.week-event-time');
        if (!timeEl) {
          timeEl = document.createElement('div');
          timeEl.className = 'week-event-time';
          card.appendChild(timeEl);
        }
        timeEl.textContent = `${newStartTime} - ${newEndTime}`;
      }
    };

    const finishDrag = (clientX, clientY) => {
      if (!isDragging) return;
      isDragging = false;
      this.isDraggingEvent = false;
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
      card.classList.remove('is-dragging-cal-event');
      card.style.removeProperty('transform');
      if (card.parentNode === container) {
        container.removeChild(card);
      }

      if (currentOverCol) {
        currentOverCol.classList.remove('drag-target-over');
      }

      card.style.pointerEvents = 'none';
      const targetEl = document.elementFromPoint(clientX, clientY);
      card.style.pointerEvents = '';

      const targetCol = targetEl ? targetEl.closest('.week-day-col') : currentOverCol;
      currentOverCol = null;

      if (targetCol) {
        const targetDateStr = targetCol.getAttribute('data-date');
        const colRect = targetCol.getBoundingClientRect();
        const clickY = clientY - colRect.top - 14;
        const hourHeight = this.weekHourHeight || 50;
        const resolution = this.weekResolution || 15;
        const rawMinutes = (startHour * 60) + ((clickY / hourHeight) * 60);
        const dur = ev.plannedDuration || 60;
        const snappedStartMin = Math.max(startHour * 60, Math.min((endHour * 60) - dur, Math.round(rawMinutes / resolution) * resolution));
        const newStartH = Math.floor(snappedStartMin / 60);
        const newStartM = snappedStartMin % 60;
        const newStartTime = `${String(newStartH).padStart(2, '0')}:${String(newStartM).padStart(2, '0')}`;
        const newEndTotal = snappedStartMin + dur;
        const endH = Math.min(23, Math.floor(newEndTotal / 60));
        const endM = newEndTotal % 60;
        const newEndTime = `${String(endH).padStart(2, '0')}:${String(endM).padStart(2, '0')}`;

        taskStore.updateCalendarEvent(ev.id, {
          date: targetDateStr || ev.date,
          startTime: newStartTime,
          endTime: newEndTime,
          plannedDuration: dur
        });

        mobileServices.hapticTap();
        this._showToast(`✓ Rescheduled to ${targetDateStr} (${newStartTime} - ${newEndTime})`);
        this.render();
      } else {
        this.render();
      }
    };

    // Touch events for mobile
    card.addEventListener('touchstart', (e) => {
      if (e.touches && e.touches.length === 1) {
        startX = e.touches[0].clientX;
        startY = e.touches[0].clientY;
        lastClientX = e.touches[0].clientX;
        lastClientY = e.touches[0].clientY;
        isDragging = false;

        holdTimer = setTimeout(() => {
          holdTimer = null;
          startDragMode();
        }, 200);
      }
    }, { passive: true });

    card.addEventListener('touchmove', (e) => {
      if (!isDragging) {
        if (holdTimer && e.touches && e.touches.length === 1) {
          const diffX = e.touches[0].clientX - startX;
          const diffY = e.touches[0].clientY - startY;
          if (Math.hypot(diffX, diffY) > 8) {
            clearTimeout(holdTimer);
            holdTimer = null;
          }
        }
        return;
      }
      if (e.touches && e.touches.length === 1) {
        if (e.cancelable) e.preventDefault();
        lastClientX = e.touches[0].clientX;
        lastClientY = e.touches[0].clientY;
        updateWeekDragPosition(lastClientX, lastClientY);
      }
    }, { passive: false });

    card.addEventListener('touchend', (e) => {
      if (holdTimer) {
        clearTimeout(holdTimer);
        holdTimer = null;
        this.openEventInspector(ev);
        return;
      }
      finishDrag(lastClientX, lastClientY);
    }, { passive: true });

    card.addEventListener('touchcancel', () => {
      if (holdTimer) {
        clearTimeout(holdTimer);
        holdTimer = null;
      }
      if (isDragging) {
        finishDrag(lastClientX, lastClientY);
      }
    }, { passive: true });

    // Mouse events for desktop
    card.addEventListener('mousedown', (e) => {
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
        updateWeekDragPosition(me.clientX, me.clientY);
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
    let currentOverCell = null;

    const startDragMode = () => {
      if (ev.isLocked) {
        mobileServices.hapticWarning();
        this._showToast('🔒 Disable padlock to move this event');
        return;
      }
      isDragging = true;
      this.isDraggingEvent = true;
      pill.classList.add('is-dragging-cal-event');
      mobileServices.hapticBuzz();
    };

    const updateDragPosition = (clientX, clientY) => {
      pill.style.transform = `translate3d(${clientX - startX}px, ${clientY - startY}px, 0) scale(1.12)`;

      pill.style.pointerEvents = 'none';
      const targetEl = document.elementFromPoint(clientX, clientY);
      pill.style.pointerEvents = '';

      const targetCell = targetEl ? targetEl.closest('.month-day-cell') : null;
      if (targetCell !== currentOverCell) {
        if (currentOverCell) currentOverCell.classList.remove('drag-target-over');
        currentOverCell = targetCell;
        if (currentOverCell) currentOverCell.classList.add('drag-target-over');
      }
    };

    const finishDrag = () => {
      if (!isDragging) return;
      isDragging = false;
      this.isDraggingEvent = false;
      pill.classList.remove('is-dragging-cal-event');
      pill.style.removeProperty('transform');

      if (currentOverCell) {
        currentOverCell.classList.remove('drag-target-over');
        const targetDateStr = currentOverCell.getAttribute('data-date');
        currentOverCell = null;

        if (targetDateStr && targetDateStr !== ev.date) {
          taskStore.updateCalendarEvent(ev.id, {
            date: targetDateStr,
            startTime: ev.startTime,
            endTime: ev.endTime,
            plannedDuration: ev.plannedDuration
          });
          mobileServices.hapticTap();
          this._showToast(`✓ Moved to ${targetDateStr} (${ev.startTime} - ${ev.endTime})`);
          this.render();
          return;
        }
      }
      this.render();
    };

    // Touch events for mobile
    pill.addEventListener('touchstart', (e) => {
      if (e.touches && e.touches.length === 1) {
        startX = e.touches[0].clientX;
        startY = e.touches[0].clientY;
        lastClientX = e.touches[0].clientX;
        lastClientY = e.touches[0].clientY;
        isDragging = false;

        holdTimer = setTimeout(() => {
          holdTimer = null;
          startDragMode();
        }, 200);
      }
    }, { passive: true });

    pill.addEventListener('touchmove', (e) => {
      if (!isDragging) {
        if (holdTimer && e.touches && e.touches.length === 1) {
          const diffX = e.touches[0].clientX - startX;
          const diffY = e.touches[0].clientY - startY;
          if (Math.hypot(diffX, diffY) > 8) {
            clearTimeout(holdTimer);
            holdTimer = null;
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

    pill.addEventListener('touchend', () => {
      if (holdTimer) {
        clearTimeout(holdTimer);
        holdTimer = null;
        this.openEventInspector(ev);
        return;
      }
      finishDrag();
    }, { passive: true });

    pill.addEventListener('touchcancel', () => {
      if (holdTimer) {
        clearTimeout(holdTimer);
        holdTimer = null;
      }
      if (isDragging) {
        finishDrag();
      }
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

      const onMouseUp = () => {
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onMouseUp);
        if (holdTimer) {
          clearTimeout(holdTimer);
          holdTimer = null;
          this.openEventInspector(ev);
          return;
        }
        finishDrag();
      };

      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', onMouseUp);
    });
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
      titleModal.textContent = isNew ? 'Add Event' : 'Event Details';
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
