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
    this.activeView = 'month'; // 'month' | 'week' | 'day'
    this.currentDate = new Date();
    this.selectedDate = new Date();
    this.selectedEvent = null;
    this.currentEmoji = '💼';
    this.currentCategory = 'Work';

    // DOM Elements (bound on init)
    this.elements = {};
  }

  init() {
    // Cache DOM Elements
    this.elements = {
      backdrop: document.getElementById('fullCalendarModalBackdrop'),
      modal: document.getElementById('fullCalendarModal'),
      btnClose: document.getElementById('btnCloseFullCalendar'),
      btnAddEvent: document.getElementById('btnFullCalAddEvent'),
      viewSwitcher: document.getElementById('calendarViewSwitcher'),
      btnViewMonth: document.getElementById('btnCalViewMonth'),
      btnViewWeek: document.getElementById('btnCalViewWeek'),
      btnViewDay: document.getElementById('btnCalViewDay'),
      btnPrev: document.getElementById('btnCalPrev'),
      btnNext: document.getElementById('btnCalNext'),
      btnToday: document.getElementById('btnCalToday'),
      rangeLabel: document.getElementById('calCurrentRangeLabel'),
      monthView: document.getElementById('calendarMonthView'),
      monthGrid: document.getElementById('monthGridCells'),
      weekView: document.getElementById('calendarWeekView'),
      weekHeader: document.getElementById('weekHeaderRow'),
      weekGridBody: document.getElementById('weekGridBody'),
      dayView: document.getElementById('calendarDayView'),
      dayHeaderTitle: document.getElementById('dayViewHeaderTitle'),
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
      eventStartTimeInput: document.getElementById('calEventStartTime'),
      eventEndTimeInput: document.getElementById('calEventEndTime'),
      eventDurationDisplay: document.getElementById('calEventDurationDisplay'),
      eventHeaderEmoji: document.getElementById('calEventHeaderEmoji'),
      btnEventEmoji: document.getElementById('btnCalEventEmoji'),
      eventToggleLock: document.getElementById('calEventToggleLock'),
      padlockIcon: document.getElementById('calPadlockIcon'),
      categoryChipsContainer: document.getElementById('calCategoryChips'),
      btnSendToToday: document.getElementById('btnSendCalEventToToday'),
      btnDeleteEvent: document.getElementById('btnDeleteCalEvent')
    };

    this._bindEvents();
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

    // View Switcher Buttons
    const viewBtns = [el.btnViewMonth, el.btnViewWeek, el.btnViewDay].filter(Boolean);
    for (let i = 0; i < viewBtns.length; i++) {
      const btn = viewBtns[i];
      btn.addEventListener('click', () => {
        const view = btn.getAttribute('data-view');
        this.switchView(view);
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

    // Auto-update duration calculation on start/end time change
    if (el.eventStartTimeInput && el.eventEndTimeInput) {
      const updateDur = () => this._updateDurationCalculation();
      el.eventStartTimeInput.addEventListener('change', updateDur);
      el.eventEndTimeInput.addEventListener('change', updateDur);
      el.eventStartTimeInput.addEventListener('input', updateDur);
      el.eventEndTimeInput.addEventListener('input', updateDur);
    }

    // Padlock toggle icon update
    if (el.eventToggleLock && el.padlockIcon) {
      el.eventToggleLock.addEventListener('change', () => {
        el.padlockIcon.textContent = el.eventToggleLock.checked ? '🔒' : '🔓';
      });
    }

    // Category chips
    if (el.categoryChipsContainer) {
      el.categoryChipsContainer.addEventListener('click', (e) => {
        const chip = e.target.closest('.cal-cat-chip');
        if (!chip) return;
        const allChips = el.categoryChipsContainer.querySelectorAll('.cal-cat-chip');
        for (let i = 0; i < allChips.length; i++) allChips[i].classList.remove('active');
        chip.classList.add('active');
        this.currentCategory = chip.getAttribute('data-category') || 'General';
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
  // Public Display API
  // ==========================================

  open() {
    if (this.elements.backdrop) {
      this.elements.backdrop.classList.remove('hidden');
    }
    analytics.trackInteraction('tab_switch', 'full_calendar');
    mobileServices.hapticTap();
    this.render();
  }

  close() {
    if (this.elements.backdrop) {
      this.elements.backdrop.classList.add('hidden');
    }
  }

  switchView(viewName) {
    if (!viewName) return;
    this.activeView = viewName;

    const el = this.elements;
    const viewBtns = [el.btnViewMonth, el.btnViewWeek, el.btnViewDay].filter(Boolean);
    for (let i = 0; i < viewBtns.length; i++) {
      const btn = viewBtns[i];
      if (btn.getAttribute('data-view') === viewName) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    }

    if (el.monthView) el.monthView.classList.toggle('hidden', viewName !== 'month');
    if (el.weekView) el.weekView.classList.toggle('hidden', viewName !== 'week');
    if (el.dayView) el.dayView.classList.toggle('hidden', viewName !== 'day');

    analytics.trackInteraction('cal_view_switch', viewName);
    mobileServices.hapticTap();
    this.render();
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
  }

  goToToday() {
    this.currentDate = new Date();
    this.selectedDate = new Date();
    mobileServices.hapticTap();
    this.render();
  }

  render() {
    this._renderRangeLabel();

    if (this.activeView === 'month') {
      this._renderMonthView();
    } else if (this.activeView === 'week') {
      this._renderWeekView();
    } else if (this.activeView === 'day') {
      this._renderDayView();
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
    } else if (this.activeView === 'day') {
      const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
      const sel = this.selectedDate || cur;
      el.textContent = `${dayNames[sel.getDay()]}, ${monthNames[sel.getMonth()].substring(0, 3)} ${sel.getDate()}`;
    }
  }

  _renderMonthView() {
    const container = this.elements.monthGrid;
    if (!container) return;
    container.innerHTML = '';

    const year = this.currentDate.getFullYear();
    const month = this.currentDate.getMonth();
    const todayStr = this._formatDateISO(new Date());

    // First day of month & days count
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const totalDays = lastDay.getDate();

    // Day of week for 1st of month (0=Sun, 1=Mon... adjust to 0=Mon)
    let startDayOfWeek = firstDay.getDay() - 1;
    if (startDayOfWeek === -1) startDayOfWeek = 6;

    // Previous month filler days
    const prevMonthLastDay = new Date(year, month, 0).getDate();

    const allEvents = taskStore.getCalendarEvents();

    // Render cells (up to 42 cells = 6 weeks)
    const totalCells = (startDayOfWeek + totalDays > 35) ? 42 : 35;

    for (let i = 0; i < totalCells; i++) {
      const cell = document.createElement('div');
      cell.className = 'month-day-cell';

      let cellDate = null;
      let dayNumber = 0;
      let isCurrentMonth = true;

      if (i < startDayOfWeek) {
        // Prev month day
        isCurrentMonth = false;
        dayNumber = prevMonthLastDay - (startDayOfWeek - i - 1);
        cellDate = new Date(year, month - 1, dayNumber);
        cell.classList.add('other-month');
      } else if (i >= startDayOfWeek + totalDays) {
        // Next month day
        isCurrentMonth = false;
        dayNumber = i - (startDayOfWeek + totalDays) + 1;
        cellDate = new Date(year, month + 1, dayNumber);
        cell.classList.add('other-month');
      } else {
        // Current month day
        dayNumber = i - startDayOfWeek + 1;
        cellDate = new Date(year, month, dayNumber);
      }

      const dateStr = this._formatDateISO(cellDate);
      if (dateStr === todayStr) {
        cell.classList.add('today');
      }

      // Header with day number
      const header = document.createElement('div');
      header.className = 'cell-header';
      const numSpan = document.createElement('span');
      numSpan.className = 'cell-day-num';
      numSpan.textContent = dayNumber;
      header.appendChild(numSpan);
      cell.appendChild(header);

      // Event pills for this date
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

        const emoji = document.createElement('span');
        emoji.textContent = ev.emoji || '📅';

        const title = document.createElement('span');
        title.className = 'event-title';
        title.textContent = ev.title;

        pill.appendChild(emoji);
        pill.appendChild(title);

        pill.addEventListener('click', (event) => {
          event.stopPropagation();
          this.openEventInspector(ev);
        });

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
      cell.addEventListener('click', () => {
        this.selectedDate = cellDate;
        this.currentDate = cellDate;
        this.switchView('day');
      });

      container.appendChild(cell);
    }
  }

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
    const hourHeight = 50; // px per hour

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

    // 7 day columns
    for (let i = 0; i < 7; i++) {
      const d = weekDates[i];
      const dStr = this._formatDateISO(d);
      const dayCol = document.createElement('div');
      dayCol.className = 'week-day-col';
      dayCol.style.height = `${(endHour - startHour + 1) * hourHeight}px`;

      const eventsForDate = allEvents.filter(e => e.date === dStr);

      for (let j = 0; j < eventsForDate.length; j++) {
        const ev = eventsForDate[j];
        const startMin = this._parseTimeToMinutes(ev.startTime);
        const endMin = this._parseTimeToMinutes(ev.endTime);

        const cardStartHour = startMin / 60;
        const cardEndHour = endMin / 60;

        if (cardEndHour > startHour && cardStartHour < endHour + 1) {
          const top = Math.max(0, (cardStartHour - startHour) * hourHeight);
          const durationHrs = Math.max(0.5, (endMin - startMin) / 60);
          const height = durationHrs * hourHeight;

          const card = document.createElement('div');
          card.className = `week-event-card ${ev.isLocked ? 'is-locked' : ''}`;
          card.style.top = `${top}px`;
          card.style.height = `${height}px`;

          card.innerHTML = `
            <div style="font-weight: 800; font-size: 0.68rem; display: flex; align-items: center; gap: 3px;">
              <span>${ev.emoji || '📅'}</span>
              <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${ev.title}</span>
            </div>
            <div style="font-size: 0.62rem; color: var(--text-dim); margin-top: 1px;">
              ${ev.startTime} ${ev.isLocked ? '🔒' : ''}
            </div>
          `;

          card.addEventListener('click', (e) => {
            e.stopPropagation();
            this.openEventInspector(ev);
          });

          dayCol.appendChild(card);
        }
      }

      // Quick add on clicking empty space in week view
      dayCol.addEventListener('click', (e) => {
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

  _renderDayView() {
    const headerTitle = this.elements.dayHeaderTitle;
    const body = this.elements.dayTimelineBody;
    if (!headerTitle || !body) return;

    body.innerHTML = '';

    const sel = this.selectedDate || this.currentDate;
    const selStr = this._formatDateISO(sel);
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    headerTitle.textContent = `${dayNames[sel.getDay()]}, ${monthNames[sel.getMonth()]} ${sel.getDate()}, ${sel.getFullYear()}`;

    const allEvents = taskStore.getCalendarEvents();
    const eventsForDay = allEvents.filter(e => e.date === selStr);

    // Sort chronologically
    eventsForDay.sort((a, b) => this._parseTimeToMinutes(a.startTime) - this._parseTimeToMinutes(b.startTime));

    // Render 24 hour slots (06:00 to 23:00)
    for (let h = 6; h <= 23; h++) {
      const slot = document.createElement('div');
      slot.className = 'day-timeline-hour-slot';

      const timeLabel = document.createElement('div');
      timeLabel.className = 'day-time-label';
      timeLabel.textContent = `${String(h).padStart(2, '0')}:00`;
      slot.appendChild(timeLabel);

      const slotContent = document.createElement('div');
      slotContent.className = 'day-slot-content';

      // Find events starting in this hour
      const matchingEvents = eventsForDay.filter(e => {
        const startH = parseInt(e.startTime.split(':')[0], 10);
        return startH === h;
      });

      for (let j = 0; j < matchingEvents.length; j++) {
        const ev = matchingEvents[j];
        const card = document.createElement('div');
        card.className = `day-event-card ${ev.isLocked ? 'is-locked' : ''}`;

        card.innerHTML = `
          <span style="font-size: 1.25rem;">${ev.emoji || '📅'}</span>
          <div style="flex: 1; min-width: 0;">
            <div style="display: flex; align-items: center; gap: 8px;">
              <span class="event-title">${ev.title}</span>
              ${ev.isLocked ? '<span class="event-padlock">🔒 Fixed</span>' : '<span style="font-size: 0.72rem; color: var(--text-dim);">🔓 Flexible</span>'}
            </div>
            <div style="font-size: 0.75rem; color: var(--text-muted); margin-top: 2px;">
              <span class="event-time-range">${ev.startTime} - ${ev.endTime}</span>
              <span>• ${ev.plannedDuration}m</span>
              <span style="margin-left: 6px; padding: 1px 6px; border-radius: 4px; background: rgba(255,255,255,0.08); font-size: 0.7rem;">${ev.category || 'Work'}</span>
            </div>
          </div>
        `;

        card.addEventListener('click', (e) => {
          e.stopPropagation();
          this.openEventInspector(ev);
        });

        slotContent.appendChild(card);
      }

      // Clicking an empty slot creates a new event at this hour
      slot.addEventListener('click', () => {
        const startTimeStr = `${String(h).padStart(2, '0')}:00`;
        const endTimeStr = `${String(Math.min(23, h + 1)).padStart(2, '0')}:00`;
        this.openEventInspector(null, selStr, startTimeStr, endTimeStr);
      });

      slot.appendChild(slotContent);
      body.appendChild(slot);
    }
  }

  // ==========================================
  // Event Inspector & Edit Modal
  // ==========================================

  openEventInspector(eventObj, defaultDateStr, defaultStartTime, defaultEndTime) {
    this.selectedEvent = eventObj || null;
    const el = this.elements;

    const isNew = !eventObj;
    document.getElementById('calEventModalTitle').textContent = isNew ? 'New Calendar Event' : 'Event Details';

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

    this.currentEmoji = eventObj ? (eventObj.emoji || '💼') : '💼';
    if (el.eventHeaderEmoji) el.eventHeaderEmoji.textContent = this.currentEmoji;

    this.currentCategory = eventObj ? (eventObj.category || 'Work') : 'Work';
    if (el.categoryChipsContainer) {
      const chips = el.categoryChipsContainer.querySelectorAll('.cal-cat-chip');
      for (let i = 0; i < chips.length; i++) {
        if (chips[i].getAttribute('data-category') === this.currentCategory) {
          chips[i].classList.add('active');
        } else {
          chips[i].classList.remove('active');
        }
      }
    }

    const isLocked = eventObj ? Boolean(eventObj.isLocked) : true;
    if (el.eventToggleLock) el.eventToggleLock.checked = isLocked;
    if (el.padlockIcon) el.padlockIcon.textContent = isLocked ? '🔒' : '🔓';

    if (el.btnDeleteEvent) {
      el.btnDeleteEvent.style.display = isNew ? 'none' : 'block';
    }

    this._updateDurationCalculation();

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

  _updateDurationCalculation() {
    const el = this.elements;
    if (!el.eventStartTimeInput || !el.eventEndTimeInput || !el.eventDurationDisplay) return;

    const startMin = this._parseTimeToMinutes(el.eventStartTimeInput.value || '10:00');
    const endMin = this._parseTimeToMinutes(el.eventEndTimeInput.value || '11:00');

    let durationMin = endMin - startMin;
    if (durationMin <= 0) durationMin += 1440; // handle overnight crossover

    el.eventDurationDisplay.innerHTML = `⏱️ Duration: <strong>${durationMin} min</strong> (${(durationMin / 60).toFixed(1)} hrs)`;
  }

  _saveEventFromForm() {
    const el = this.elements;
    const title = el.eventTitleInput ? el.eventTitleInput.value.trim() : '';
    if (!title) return;

    const date = el.eventDateInput ? el.eventDateInput.value : this._formatDateISO(new Date());
    const startTime = el.eventStartTimeInput ? el.eventStartTimeInput.value : '10:00';
    const endTime = el.eventEndTimeInput ? el.eventEndTimeInput.value : '11:00';

    const startMin = this._parseTimeToMinutes(startTime);
    const endMin = this._parseTimeToMinutes(endTime);
    let durationMin = endMin - startMin;
    if (durationMin <= 0) durationMin += 1440;

    const isLocked = el.eventToggleLock ? el.eventToggleLock.checked : true;
    const eventId = el.eventIdInput ? el.eventIdInput.value : '';

    if (eventId) {
      // Update existing
      taskStore.updateCalendarEvent(eventId, {
        title,
        date,
        startTime,
        endTime,
        plannedDuration: durationMin,
        isLocked,
        emoji: this.currentEmoji,
        category: this.currentCategory
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
        emoji: this.currentEmoji,
        category: this.currentCategory
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
    const startMin = this._parseTimeToMinutes(startTime);
    const endMin = this._parseTimeToMinutes(endTime);
    let durationMin = endMin - startMin;
    if (durationMin <= 0) durationMin += 1440;

    const isLocked = el.eventToggleLock ? el.eventToggleLock.checked : true;

    // Add task directly to Today's TaskStore
    taskStore.addTask({
      title,
      plannedDuration: durationMin,
      isLocked,
      emoji: this.currentEmoji || '📅',
      category: this.currentCategory || 'Work',
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
    const diff = dateObj.getDate() - day + (day === 0 ? -6 : 1); // adjust when day is sunday
    return new Date(dateObj.setDate(diff));
  }

  _parseTimeToMinutes(timeStr) {
    if (!timeStr) return 0;
    const parts = timeStr.split(':');
    const h = parseInt(parts[0], 10) || 0;
    const m = parseInt(parts[1], 10) || 0;
    return (h * 60) + m;
  }

  _showToast(msg) {
    if (typeof window !== 'undefined' && typeof window.showToastNotification === 'function') {
      window.showToastNotification(msg);
    }
  }
}

export const calendarView = new CalendarView();
