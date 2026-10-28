/**
 * microsoftCalendarAdapter.js
 * 
 * Microsoft Outlook / 365 Graph API Client-Side Adapter for Calentimer.
 * Uses MSAL / Graph REST endpoints for two-way synchronization.
 * Strictly zero optional chaining and zero nullish coalescing operators.
 */

import { taskStore } from './taskStore.js';
import { OAUTH_CONFIG } from './oauthConfig.js';
import { classifyEvent } from './eventClassifier.js';

const GRAPH_API_BASE = 'https://graph.microsoft.com/v1.0';
const DEFAULT_CLIENT_ID = '00000000-0000-0000-0000-000000000000';
const SCOPES = ['Calendars.ReadWrite', 'User.Read'];

export class MicrosoftCalendarAdapter {
  constructor(options) {
    const opts = (options && typeof options === 'object') ? options : {};
    const configId = (OAUTH_CONFIG && OAUTH_CONFIG.microsoft && OAUTH_CONFIG.microsoft.clientId) ? OAUTH_CONFIG.microsoft.clientId : DEFAULT_CLIENT_ID;
    this.clientId = opts.clientId ? String(opts.clientId) : configId;
    this.accessToken = opts.accessToken ? String(opts.accessToken) : null;
    this.tokenExpiresAt = opts.tokenExpiresAt ? Number(opts.tokenExpiresAt) : 0;
    this.msalInstance = null;
    this.mockTransport = opts.mockTransport || null;
    this.userEmail = null;
    const isMockFromConfig = Boolean(OAUTH_CONFIG && OAUTH_CONFIG.microsoft && OAUTH_CONFIG.microsoft.useMock);
    this.useMock = (typeof opts.useMock !== 'undefined') ? Boolean(opts.useMock) : isMockFromConfig;
    this._mockEvents = [];
  }

  /**
   * Initializes adapter and attempts to restore stored access token or MSAL instance.
   */
  init() {
    if (typeof sessionStorage !== 'undefined' && sessionStorage !== null) {
      try {
        const savedToken = sessionStorage.getItem('calentimer_ms_token');
        const savedExpiry = sessionStorage.getItem('calentimer_ms_expiry');
        if (savedToken && savedExpiry) {
          const exp = parseInt(savedExpiry, 10);
          if (Date.now() < exp) {
            this.accessToken = savedToken;
            this.tokenExpiresAt = exp;
          }
        }
      } catch (_) {}
    }

    this.userEmail = (typeof taskStore !== 'undefined' && typeof taskStore.getMicrosoftUserEmail === 'function')
      ? taskStore.getMicrosoftUserEmail()
      : null;
  }

  /**
   * Checks whether the user is currently authenticated with a non-expired token.
   * @returns {boolean}
   */
  isAuthenticated() {
    if (!this.accessToken) return false;
    if (this.tokenExpiresAt && Date.now() >= this.tokenExpiresAt) {
      return false;
    }
    return true;
  }

  /**
   * Saves the acquired access token in memory and session.
   * @param {string} token 
   * @param {number} expiresInSeconds 
   */
  setToken(token, expiresInSeconds) {
    this.accessToken = token;
    const expiresSec = (typeof expiresInSeconds === 'number' && expiresInSeconds > 0) ? expiresInSeconds : 3600;
    this.tokenExpiresAt = Date.now() + (expiresSec * 1000);

    if (typeof sessionStorage !== 'undefined' && sessionStorage !== null) {
      try {
        sessionStorage.setItem('calentimer_ms_token', token);
        sessionStorage.setItem('calentimer_ms_expiry', String(this.tokenExpiresAt));
      } catch (_) {}
    }

    if (typeof taskStore !== 'undefined' && typeof taskStore.setMicrosoftCalendarConnected === 'function') {
      taskStore.setMicrosoftCalendarConnected(true);
    }
  }

  /**
   * Clears token and signs out.
   */
  signOut() {
    this.accessToken = null;
    this.tokenExpiresAt = 0;
    this.userEmail = null;

    if (typeof sessionStorage !== 'undefined' && sessionStorage !== null) {
      try {
        sessionStorage.removeItem('calentimer_ms_token');
        sessionStorage.removeItem('calentimer_ms_expiry');
      } catch (_) {}
    }

    if (typeof taskStore !== 'undefined') {
      if (typeof taskStore.setMicrosoftCalendarConnected === 'function') {
        taskStore.setMicrosoftCalendarConnected(false);
      }
      if (typeof taskStore.setMicrosoftDeltaLink === 'function') {
        taskStore.setMicrosoftDeltaLink(null);
      }
      if (typeof taskStore.setMicrosoftUserEmail === 'function') {
        taskStore.setMicrosoftUserEmail(null);
      }
    }
  }

  /**
   * Initiates authentication with Microsoft Identity / Graph API.
   * Resolves with access token on success.
   * @returns {Promise<string>}
   */
  requestAccessToken() {
    return new Promise((resolve, reject) => {
      // 1. Mock Transport Support for automated testing
      if (this.mockTransport && typeof this.mockTransport.requestAccessToken === 'function') {
        this.mockTransport.requestAccessToken().then((res) => {
          this.setToken(res.token, res.expiresIn || 3600);
          if (res.email) {
            this.userEmail = res.email;
            if (typeof taskStore !== 'undefined' && typeof taskStore.setMicrosoftUserEmail === 'function') {
              taskStore.setMicrosoftUserEmail(res.email);
            }
          }
          resolve(res.token);
        }).catch(reject);
        return;
      }

      // 2. Built-in Sandbox Mock Mode (for personal accounts without Azure AD tenant)
      if (this.useMock) {
        const mockToken = 'mock-ms-token-' + Date.now();
        const mockEmail = 'sandbox.user@outlook.com';
        this.setToken(mockToken, 3600);
        this.userEmail = mockEmail;
        if (typeof taskStore !== 'undefined' && typeof taskStore.setMicrosoftUserEmail === 'function') {
          taskStore.setMicrosoftUserEmail(mockEmail);
        }
        resolve(mockToken);
        return;
      }

      // 3. Protocol Check
      if (typeof window !== 'undefined' && window.location && window.location.protocol === 'file:') {
        reject(new Error('Microsoft Sign-In requires serving Calentimer over HTTP/HTTPS (e.g. http://localhost:3000), not file://.'));
        return;
      }

      // 4. Client ID Configuration Check
      if (!this.clientId || this.clientId === DEFAULT_CLIENT_ID || this.clientId.indexOf('YOUR_MICROSOFT_CLIENT_ID') !== -1) {
        reject(new Error('Please set your Microsoft Application (client) ID in oauthConfig.js before connecting.'));
        return;
      }

      // 4. Browser MSAL Browser Client Check
      const hasMsal = typeof window !== 'undefined' && window !== null && window.msal && window.msal.PublicClientApplication;
      if (!hasMsal) {
        if (typeof window === 'undefined') {
          // Node.js test environment fallback
          const demoToken = 'mock-ms-token-' + Date.now();
          const demoEmail = 'user@outlook.com';
          this.setToken(demoToken, 3600);
          this.userEmail = demoEmail;
          if (typeof taskStore !== 'undefined' && typeof taskStore.setMicrosoftUserEmail === 'function') {
            taskStore.setMicrosoftUserEmail(demoEmail);
          }
          resolve(demoToken);
          return;
        }
        reject(new Error('Microsoft Authentication Library (MSAL) is not loaded. Ensure you are connected to the internet and serving over http://localhost:3000.'));
        return;
      }

      try {
        const configRedirectUri = (OAUTH_CONFIG && OAUTH_CONFIG.microsoft && OAUTH_CONFIG.microsoft.redirectUri)
          ? OAUTH_CONFIG.microsoft.redirectUri
          : ((typeof window !== 'undefined' && window.location) ? window.location.origin : 'http://localhost:3000');

        if (!this.msalInstance) {
          this.msalInstance = new window.msal.PublicClientApplication({
            auth: {
              clientId: this.clientId,
              authority: 'https://login.microsoftonline.com/common',
              redirectUri: configRedirectUri
            },
            cache: {
              cacheLocation: 'sessionStorage',
              storeAuthStateInCookie: false
            }
          });
        }

        const loginScopes = (OAUTH_CONFIG && OAUTH_CONFIG.microsoft && Array.isArray(OAUTH_CONFIG.microsoft.scopes))
          ? OAUTH_CONFIG.microsoft.scopes
          : SCOPES;

        const loginRequest = {
          scopes: loginScopes,
          prompt: 'select_account'
        };

        const doLogin = () => {
          this.msalInstance.loginPopup(loginRequest).then((response) => {
            if (response && response.accessToken) {
              const expiresIn = (response.expiresOn && response.expiresOn instanceof Date)
                ? Math.max(60, Math.floor((response.expiresOn.getTime() - Date.now()) / 1000))
                : 3600;
              this.setToken(response.accessToken, expiresIn);
              if (response.account && response.account.username) {
                this.userEmail = response.account.username;
                if (typeof taskStore !== 'undefined' && typeof taskStore.setMicrosoftUserEmail === 'function') {
                  taskStore.setMicrosoftUserEmail(response.account.username);
                }
              } else {
                this.fetchUserEmail().catch(() => {});
              }
              resolve(response.accessToken);
            } else {
              reject(new Error('Failed to acquire Microsoft access token.'));
            }
          }).catch(reject);
        };

        // MSAL v3 requires initialize() before loginPopup()
        if (typeof this.msalInstance.initialize === 'function') {
          this.msalInstance.initialize().then(doLogin).catch(reject);
        } else {
          doLogin();
        }
      } catch (e) {
        reject(e);
      }
    });
  }

  /**
   * Fetches user profile / email from Microsoft Graph /me.
   * @returns {Promise<string|null>}
   */
  async fetchUserEmail() {
    if (this.mockTransport && typeof this.mockTransport.fetchUserEmail === 'function') {
      const email = await this.mockTransport.fetchUserEmail();
      this.userEmail = email;
      if (typeof taskStore !== 'undefined' && typeof taskStore.setMicrosoftUserEmail === 'function') {
        taskStore.setMicrosoftUserEmail(email);
      }
      return email;
    }

    if (this.useMock) {
      const mockEmail = this.userEmail || 'sandbox.user@outlook.com';
      if (typeof taskStore !== 'undefined' && typeof taskStore.setMicrosoftUserEmail === 'function') {
        taskStore.setMicrosoftUserEmail(mockEmail);
      }
      return mockEmail;
    }

    if (!this.accessToken) return null;

    try {
      const resp = await fetch(`${GRAPH_API_BASE}/me`, {
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
          'Accept': 'application/json'
        }
      });
      if (resp.ok) {
        const data = await resp.json();
        const email = (data && (data.mail || data.userPrincipalName)) ? (data.mail || data.userPrincipalName) : null;
        if (email) {
          this.userEmail = email;
          if (typeof taskStore !== 'undefined' && typeof taskStore.setMicrosoftUserEmail === 'function') {
            taskStore.setMicrosoftUserEmail(email);
          }
          return email;
        }
      }
    } catch (_) {}
    return null;
  }

  /**
   * Fetches calendar events via Microsoft Graph Delta API.
   * @param {string} [startDateTime] ISO string
   * @param {string} [endDateTime] ISO string
   * @param {string} [deltaLink]
   * @returns {Promise<{events: Array<object>, nextDeltaLink: string|null, deltaLinkExpired: boolean}>}
   */
  async fetchEvents(startDateTime, endDateTime, deltaLink) {
    if (this.mockTransport && typeof this.mockTransport.fetchEvents === 'function') {
      return this.mockTransport.fetchEvents(startDateTime, endDateTime, deltaLink);
    }

    if (this.useMock) {
      if (!this.isAuthenticated()) {
        throw new Error('Not authenticated with Microsoft Calendar');
      }
      return {
        events: (this._mockEvents && Array.isArray(this._mockEvents)) ? this._mockEvents.slice() : [],
        nextDeltaLink: 'mock-ms-delta-link',
        deltaLinkExpired: false
      };
    }

    if (!this.isAuthenticated()) {
      throw new Error('Not authenticated with Microsoft Calendar');
    }

    let url = deltaLink;
    if (!url) {
      const start = startDateTime || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const end = endDateTime || new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString();
      url = `${GRAPH_API_BASE}/me/calendarView/delta?startDateTime=${encodeURIComponent(start)}&endDateTime=${encodeURIComponent(end)}`;
    }

    const resp = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${this.accessToken}`,
        'Prefer': 'outlook.timezone="UTC"',
        'Accept': 'application/json'
      }
    });

    if (resp.status === 410) {
      // 410 Gone: Delta token expired
      return {
        events: [],
        nextDeltaLink: null,
        deltaLinkExpired: true
      };
    }

    if (!resp.ok) {
      const errText = await resp.text();
      throw new Error(`Microsoft Graph API error (${resp.status}): ${errText}`);
    }

    const data = await resp.json();
    const rawItems = (data && Array.isArray(data.value)) ? data.value : [];
    const mapped = [];

    for (let i = 0; i < rawItems.length; i++) {
      const ev = this.mapToCalentimerEvent(rawItems[i]);
      if (ev) mapped.push(ev);
    }

    const nextLink = (data && (data['@odata.deltaLink'] || data['@odata.nextLink']))
      ? (data['@odata.deltaLink'] || data['@odata.nextLink'])
      : null;

    return {
      events: mapped,
      nextDeltaLink: nextLink,
      deltaLinkExpired: false
    };
  }

  /**
   * Pushes a new event create to Microsoft Graph.
   * @param {object} calentimerEvent 
   * @returns {Promise<object>}
   */
  async createEvent(calentimerEvent) {
    if (this.mockTransport && typeof this.mockTransport.createEvent === 'function') {
      return this.mockTransport.createEvent(calentimerEvent);
    }

    if (this.useMock) {
      if (!this.isAuthenticated()) {
        throw new Error('Not authenticated with Microsoft Calendar');
      }
      if (!this._mockEvents) this._mockEvents = [];
      const extId = 'ms-mock-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6);
      const created = Object.assign({}, calentimerEvent, {
        externalId: extId,
        provider: 'microsoft',
        etag: 'etag-ms-' + Date.now()
      });
      this._mockEvents.push(created);
      return created;
    }

    if (!this.isAuthenticated()) {
      throw new Error('Not authenticated with Microsoft Calendar');
    }

    const payload = this.mapToMicrosoftPayload(calentimerEvent);
    const resp = await fetch(`${GRAPH_API_BASE}/me/events`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (!resp.ok) {
      const errText = await resp.text();
      throw new Error(`Failed to create Microsoft event (${resp.status}): ${errText}`);
    }

    const created = await resp.json();
    return this.mapToCalentimerEvent(created);
  }

  /**
   * Pushes an event update to Microsoft Graph.
   * @param {object} calentimerEvent 
   * @returns {Promise<object>}
   */
  async updateEvent(calentimerEvent) {
    if (!calentimerEvent || !calentimerEvent.externalId) {
      throw new Error('Cannot update Microsoft event without externalId');
    }

    if (this.mockTransport && typeof this.mockTransport.updateEvent === 'function') {
      return this.mockTransport.updateEvent(calentimerEvent);
    }

    if (this.useMock) {
      if (!this.isAuthenticated()) {
        throw new Error('Not authenticated with Microsoft Calendar');
      }
      if (!this._mockEvents) this._mockEvents = [];
      const idx = this._mockEvents.findIndex(e => e.externalId === calentimerEvent.externalId);
      const updated = Object.assign({}, calentimerEvent, { etag: 'etag-ms-upd-' + Date.now() });
      if (idx !== -1) {
        this._mockEvents[idx] = updated;
      } else {
        this._mockEvents.push(updated);
      }
      return updated;
    }

    if (!this.isAuthenticated()) {
      throw new Error('Not authenticated with Microsoft Calendar');
    }

    const payload = this.mapToMicrosoftPayload(calentimerEvent);
    const eventId = encodeURIComponent(calentimerEvent.externalId);
    const resp = await fetch(`${GRAPH_API_BASE}/me/events/${eventId}`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (!resp.ok) {
      const errText = await resp.text();
      throw new Error(`Failed to update Microsoft event (${resp.status}): ${errText}`);
    }

    const updated = await resp.json();
    return this.mapToCalentimerEvent(updated);
  }

  /**
   * Deletes an event from Microsoft Calendar.
   * @param {string} externalId 
   * @returns {Promise<boolean>}
   */
  async deleteEvent(externalId) {
    if (!externalId) return false;

    if (this.mockTransport && typeof this.mockTransport.deleteEvent === 'function') {
      return this.mockTransport.deleteEvent(externalId);
    }

    if (this.useMock) {
      if (!this.isAuthenticated()) {
        throw new Error('Not authenticated with Microsoft Calendar');
      }
      if (this._mockEvents) {
        this._mockEvents = this._mockEvents.filter(e => e.externalId !== externalId);
      }
      return true;
    }

    if (!this.isAuthenticated()) {
      throw new Error('Not authenticated with Microsoft Calendar');
    }

    const eventId = encodeURIComponent(externalId);
    const resp = await fetch(`${GRAPH_API_BASE}/me/events/${eventId}`, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${this.accessToken}`
      }
    });

    if (resp.status === 404 || resp.status === 410) {
      return true; // Already deleted
    }

    if (!resp.ok) {
      const errText = await resp.text();
      throw new Error(`Failed to delete Microsoft event (${resp.status}): ${errText}`);
    }

    return true;
  }

  _parseDateTimeString(dateTimeStr, fallbackDateStr) {
    if (dateTimeStr) {
      const d = new Date(dateTimeStr);
      if (!isNaN(d.getTime())) {
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        const hh = String(d.getHours()).padStart(2, '0');
        const mm = String(d.getMinutes()).padStart(2, '0');
        return {
          date: `${y}-${m}-${day}`,
          time: `${hh}:${mm}`
        };
      }
    }
    return {
      date: fallbackDateStr || '',
      time: '09:00'
    };
  }

  /**
   * Converts Microsoft Graph event item to Calentimer schema.
   * @param {object} item 
   * @returns {object|null}
   */
  mapToCalentimerEvent(item) {
    if (!item || !item.id) return null;

    const isRemoved = Boolean(item['@removed']);
    const title = item.subject ? String(item.subject).trim() : 'Microsoft Meeting';

    let dateStr = '';
    let startTime = '09:00';
    let endTime = '10:00';

    if (item.start && item.start.dateTime) {
      const parsedStart = this._parseDateTimeString(item.start.dateTime);
      dateStr = parsedStart.date;
      startTime = parsedStart.time;
    }

    if (item.end && item.end.dateTime) {
      const parsedEnd = this._parseDateTimeString(item.end.dateTime);
      endTime = parsedEnd.time;
    }

    const sMin = this._parseTimeToMinutes(startTime);
    let eMin = this._parseTimeToMinutes(endTime);
    if (eMin <= sMin) eMin += 1440;
    const plannedDuration = Math.max(15, eMin - sMin);

    const classification = classifyEvent(title, item.bodyPreview || (item.body && item.body.content) || '', null);
    const resolvedEmoji = classification.emoji;
    const resolvedCategory = classification.category;
    const resolvedColor = classification.color;

    if (resolvedCategory && typeof taskStore !== 'undefined' && typeof taskStore.addCategory === 'function') {
      taskStore.addCategory(resolvedCategory);
    }

    return {
      id: `cal-ms-${item.id}`,
      externalId: item.id,
      externalCalendarId: 'primary',
      provider: 'microsoft',
      source: 'microsoft',
      title: title,
      date: dateStr,
      startTime: startTime,
      endTime: endTime,
      plannedDuration: plannedDuration,
      isLocked: true, // External calendar meetings default to locked wall-clock time
      useTimeBank: false,
      emoji: resolvedEmoji,
      category: resolvedCategory,
      color: resolvedColor,
      etag: item['@odata.etag'] || null,
      status: isRemoved ? 'cancelled' : 'confirmed',
      isCancelled: isRemoved,
      lastSyncedAt: Date.now()
    };
  }

  /**
   * Converts Calentimer event to Microsoft Graph JSON payload.
   * @param {object} event 
   * @returns {object}
   */
  mapToMicrosoftPayload(event) {
    const timeZone = (typeof Intl !== 'undefined' && Intl.DateTimeFormat)
      ? Intl.DateTimeFormat().resolvedOptions().timeZone
      : 'UTC';

    const date = event.date || this._formatDateISO(new Date());
    const startTime = event.startTime || '09:00';
    const endTime = event.endTime || '10:00';

    const startDateTime = `${date}T${startTime}:00`;
    const endDateTime = `${date}T${endTime}:00`;

    return {
      subject: event.title || 'Calentimer Task',
      body: {
        contentType: 'text',
        content: `Managed by Calentimer${event.category ? ' • Category: ' + event.category : ''}`
      },
      start: {
        dateTime: startDateTime,
        timeZone: timeZone
      },
      end: {
        dateTime: endDateTime,
        timeZone: timeZone
      }
    };
  }

  _parseTimeToMinutes(timeStr) {
    if (!timeStr) return 0;
    const parts = timeStr.split(':');
    const h = parseInt(parts[0], 10) || 0;
    const m = parseInt(parts[1], 10) || 0;
    return (h * 60) + m;
  }

  _formatDateISO(d) {
    const dateObj = d || new Date();
    const y = dateObj.getFullYear();
    const m = String(dateObj.getMonth() + 1).padStart(2, '0');
    const day = String(dateObj.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }
}

export const microsoftCalendarAdapter = new MicrosoftCalendarAdapter();
export default microsoftCalendarAdapter;
