/**
 * microsoftCalendarAdapter.js
 * 
 * Microsoft Outlook / 365 Graph API Client-Side Adapter for Calentimer.
 * Uses MSAL Browser SDK and Microsoft Graph REST endpoints for two-way synchronization.
 * Supports multi-calendar retrieval, delta pagination, rich color matching,
 * intelligent semantic classification (emojis & categories), and Wall-Clock schedule locks.
 * Strictly zero optional chaining and zero nullish coalescing operators.
 */

import { taskStore } from './taskStore.js';
import { OAUTH_CONFIG } from './oauthConfig.js';
import { classifyEvent } from './eventClassifier.js';

const GRAPH_API_BASE = 'https://graph.microsoft.com/v1.0';
const DEFAULT_CLIENT_ID = '00000000-0000-0000-0000-000000000000';
const SCOPES = ['Calendars.ReadWrite', 'User.Read'];

// Microsoft Outlook / 365 Preset 0-24 Category Palette Colors
export const MICROSOFT_CATEGORY_COLORS = {
  'preset0': '#d13438',  // Red
  'preset1': '#ff8c00',  // Orange
  'preset2': '#f7630c',  // Peach
  'preset3': '#ffb900',  // Yellow
  'preset4': '#107c41',  // Green
  'preset5': '#008272',  // Teal
  'preset6': '#004b50',  // Olive
  'preset7': '#0078d4',  // Blue
  'preset8': '#5c2d91',  // Purple
  'preset9': '#b4009e',  // Cranberry
  'preset10': '#5c5b5d', // Steel
  'preset11': '#323130', // Dark Steel
  'preset12': '#737373', // Gray
  'preset13': '#484644', // Dark Gray
  'preset14': '#201f1e', // Black
  'preset15': '#750b1c', // Dark Red
  'preset16': '#a4373a', // Dark Orange
  'preset17': '#8e562e', // Dark Peach
  'preset18': '#8f7015', // Dark Yellow
  'preset19': '#0e4e10', // Dark Green
  'preset20': '#004b42', // Dark Teal
  'preset21': '#012b2e', // Dark Olive
  'preset22': '#004e8c', // Dark Blue
  'preset23': '#3b1a5c', // Dark Purple
  'preset24': '#5c004f'  // Dark Cranberry
};

// Common Outlook standard category names mapped to standard hex colors
export const MICROSOFT_CATEGORY_NAME_MAP = {
  'red category': '#d13438',
  'orange category': '#ff8c00',
  'peach category': '#f7630c',
  'yellow category': '#ffb900',
  'green category': '#107c41',
  'teal category': '#008272',
  'olive category': '#004b50',
  'blue category': '#0078d4',
  'purple category': '#5c2d91',
  'cranberry category': '#b4009e',
  'steel category': '#5c5b5d',
  'gray category': '#737373'
};

// Microsoft Outlook Calendar theme color mappings
export const MICROSOFT_CALENDAR_COLORS = {
  'auto': '#0078d4',
  'lightBlue': '#0078d4',
  'lightGreen': '#107c41',
  'lightOrange': '#ff8c00',
  'lightGray': '#737373',
  'lightYellow': '#ffb900',
  'lightTeal': '#008272',
  'lightPink': '#b4009e',
  'lightBrown': '#8e562e',
  'lightRed': '#d13438',
  'maxColor': '#5c2d91'
};

export class MicrosoftCalendarAdapter {
  constructor(options) {
    const opts = (options && typeof options === 'object') ? options : {};
    const configId = (OAUTH_CONFIG && OAUTH_CONFIG.microsoft && OAUTH_CONFIG.microsoft.clientId)
      ? OAUTH_CONFIG.microsoft.clientId
      : DEFAULT_CLIENT_ID;
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
    if (OAUTH_CONFIG && OAUTH_CONFIG.microsoft && OAUTH_CONFIG.microsoft.clientId && OAUTH_CONFIG.microsoft.clientId !== DEFAULT_CLIENT_ID) {
      this.clientId = OAUTH_CONFIG.microsoft.clientId;
    }

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
   * Uses silent token acquisition when possible, falling back to MSAL popup.
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

      // 2. Built-in Sandbox Mock Mode (if explicitly toggled in config for test sandboxes)
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
      const effectiveClientId = (OAUTH_CONFIG && OAUTH_CONFIG.microsoft && OAUTH_CONFIG.microsoft.clientId)
        ? OAUTH_CONFIG.microsoft.clientId
        : this.clientId;
      if (!effectiveClientId || effectiveClientId === DEFAULT_CLIENT_ID || effectiveClientId.indexOf('YOUR_MICROSOFT_CLIENT_ID') !== -1) {
        reject(new Error('Please set your Microsoft Application (client) ID in oauthConfig.js before connecting.'));
        return;
      }
      this.clientId = effectiveClientId;

      // 5. Browser MSAL SDK Check
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
              redirectUri: configRedirectUri,
              navigateToLoginRequestUrl: false
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

        const handleAuthSuccess = (response) => {
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
        };

        const doPopupLogin = () => {
          this.msalInstance.loginPopup(loginRequest)
            .then(handleAuthSuccess)
            .catch(reject);
        };

        const trySilentOrPopup = () => {
          const accounts = (typeof this.msalInstance.getAllAccounts === 'function')
            ? this.msalInstance.getAllAccounts()
            : [];
          if (accounts && accounts.length > 0) {
            this.msalInstance.acquireTokenSilent({
              scopes: loginScopes,
              account: accounts[0]
            }).then(handleAuthSuccess).catch(() => {
              doPopupLogin();
            });
          } else {
            doPopupLogin();
          }
        };

        // MSAL v3 requires initialize() before any calls
        if (typeof this.msalInstance.initialize === 'function') {
          this.msalInstance.initialize().then(trySilentOrPopup).catch(reject);
        } else {
          trySilentOrPopup();
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
   * Fetches the user's active Microsoft Calendars list (default calendar and secondary calendars).
   * @returns {Promise<Array<{id: string, name: string, summary: string, primary: boolean, isDefaultCalendar: boolean, hexColor: string, backgroundColor: string}>>}
   */
  async fetchCalendarList() {
    if (!this.isAuthenticated() || this.useMock) {
      return [{
        id: 'primary',
        name: 'Calendar',
        summary: 'Calendar',
        primary: true,
        isDefaultCalendar: true,
        hexColor: '#0078d4',
        backgroundColor: '#0078d4'
      }];
    }

    try {
      const resp = await fetch(`${GRAPH_API_BASE}/me/calendars`, {
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
          'Accept': 'application/json'
        }
      });
      if (resp.ok) {
        const data = await resp.json();
        if (data && Array.isArray(data.value) && data.value.length > 0) {
          const cals = [];
          for (let i = 0; i < data.value.length; i++) {
            const c = data.value[i];
            if (!c || !c.id) continue;
            const hex = c.hexColor || (c.color && MICROSOFT_CALENDAR_COLORS[c.color]) || '#0078d4';
            cals.push({
              id: c.id,
              name: c.name || 'Calendar',
              summary: c.name || 'Calendar',
              primary: Boolean(c.isDefaultCalendar),
              isDefaultCalendar: Boolean(c.isDefaultCalendar),
              color: c.color || 'auto',
              hexColor: hex,
              backgroundColor: hex
            });
          }
          if (cals.length > 0) {
            return cals;
          }
        }
      }
    } catch (_) {}

    return [{
      id: 'primary',
      name: 'Calendar',
      summary: 'Calendar',
      primary: true,
      isDefaultCalendar: true,
      hexColor: '#0078d4',
      backgroundColor: '#0078d4'
    }];
  }

  /**
   * Fetches calendar events via Microsoft Graph Delta API with full pagination,
   * comprehensive term date-window coverage, and color matching.
   * Matches Google Calendar window defaults (past 60 days to next 180 days).
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

    // Window defaults: past 60 days to next 180 days (matches Google Calendar full schedule coverage)
    const start = startDateTime || new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
    const end = endDateTime || new Date(Date.now() + 180 * 24 * 60 * 60 * 1000).toISOString();

    const calendars = await this.fetchCalendarList();
    const primaryCal = calendars.find(c => c && c.primary) || calendars[0] || { id: 'primary', hexColor: '#0078d4' };
    const defaultCalColor = primaryCal.hexColor || '#0078d4';

    const allEvents = [];
    const seenExternalIds = new Set();
    let finalDeltaLink = null;
    let anyExpired = false;

    // 1. Fetch Primary Calendar using Delta Query with full @odata.nextLink pagination
    let currentUrl = deltaLink;
    if (!currentUrl) {
      currentUrl = `${GRAPH_API_BASE}/me/calendarView/delta?startDateTime=${encodeURIComponent(start)}&endDateTime=${encodeURIComponent(end)}`;
    }

    let pageCount = 0;
    while (currentUrl && pageCount < 50) {
      pageCount++;
      const resp = await fetch(currentUrl, {
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
          'Prefer': 'outlook.timezone="UTC"',
          'Accept': 'application/json'
        }
      });

      if (resp.status === 401) {
        this.signOut();
        throw new Error('Microsoft Calendar session expired. Please tap Connect to renew.');
      }

      if (resp.status === 410) {
        // Delta token expired: clear token and signal full resync
        anyExpired = true;
        break;
      }

      if (!resp.ok) {
        const errText = await resp.text();
        throw new Error(`Microsoft Graph API error (${resp.status}): ${errText}`);
      }

      const data = await resp.json();
      const rawItems = (data && Array.isArray(data.value)) ? data.value : [];

      for (let i = 0; i < rawItems.length; i++) {
        const raw = rawItems[i];
        if (!raw || !raw.id) continue;
        if (seenExternalIds.has(raw.id)) continue;
        seenExternalIds.add(raw.id);

        const ev = this.mapToCalentimerEvent(raw, defaultCalColor);
        if (ev) {
          ev.externalCalendarId = primaryCal.id || 'primary';
          allEvents.push(ev);
        }
      }

      if (data && data['@odata.deltaLink']) {
        finalDeltaLink = data['@odata.deltaLink'];
      }
      currentUrl = (data && data['@odata.nextLink']) ? data['@odata.nextLink'] : null;
    }

    if (anyExpired) {
      return {
        events: [],
        nextDeltaLink: null,
        deltaLinkExpired: true
      };
    }

    // 2. Fetch Secondary Calendars (if user has multiple calendars and this is a full sync)
    if (!deltaLink && calendars.length > 1) {
      for (let cIdx = 0; cIdx < calendars.length; cIdx++) {
        const secCal = calendars[cIdx];
        if (secCal.primary || secCal.isDefaultCalendar || secCal.id === 'primary') continue;

        try {
          let secUrl = `${GRAPH_API_BASE}/me/calendars/${encodeURIComponent(secCal.id)}/calendarView?startDateTime=${encodeURIComponent(start)}&endDateTime=${encodeURIComponent(end)}&$top=100`;
          let secPages = 0;
          while (secUrl && secPages < 20) {
            secPages++;
            const secResp = await fetch(secUrl, {
              headers: {
                'Authorization': `Bearer ${this.accessToken}`,
                'Prefer': 'outlook.timezone="UTC"',
                'Accept': 'application/json'
              }
            });
            if (secResp.status === 401) {
              this.signOut();
              throw new Error('Microsoft Calendar session expired. Please tap Connect to renew.');
            }
            if (!secResp.ok) break;

            const secData = await secResp.json();
            const secItems = (secData && Array.isArray(secData.value)) ? secData.value : [];
            for (let j = 0; j < secItems.length; j++) {
              const raw = secItems[j];
              if (!raw || !raw.id || seenExternalIds.has(raw.id)) continue;
              seenExternalIds.add(raw.id);

              const ev = this.mapToCalentimerEvent(raw, secCal.hexColor);
              if (ev) {
                ev.externalCalendarId = secCal.id;
                allEvents.push(ev);
              }
            }
            secUrl = (secData && secData['@odata.nextLink']) ? secData['@odata.nextLink'] : null;
          }
        } catch (secErr) {
          console.warn(`CalendarSync: Failed to fetch secondary calendar "${secCal.name}":`, secErr);
        }
      }
    }

    return {
      events: allEvents,
      nextDeltaLink: finalDeltaLink,
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
    const timeZone = (typeof Intl !== 'undefined' && Intl.DateTimeFormat)
      ? Intl.DateTimeFormat().resolvedOptions().timeZone
      : 'UTC';

    const resp = await fetch(`${GRAPH_API_BASE}/me/events`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
        'Prefer': `outlook.timezone="${timeZone}"`
      },
      body: JSON.stringify(payload)
    });

    if (resp.status === 401) {
      this.signOut();
      throw new Error('Microsoft Calendar session expired. Please tap Connect to renew.');
    }

    if (!resp.ok) {
      const errText = await resp.text();
      throw new Error(`Failed to create Microsoft event (${resp.status}): ${errText}`);
    }

    const created = await resp.json();
    return this.mapToCalentimerEvent(created, calentimerEvent.color);
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
    const timeZone = (typeof Intl !== 'undefined' && Intl.DateTimeFormat)
      ? Intl.DateTimeFormat().resolvedOptions().timeZone
      : 'UTC';

    const resp = await fetch(`${GRAPH_API_BASE}/me/events/${eventId}`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
        'Prefer': `outlook.timezone="${timeZone}"`
      },
      body: JSON.stringify(payload)
    });

    if (resp.status === 401) {
      this.signOut();
      throw new Error('Microsoft Calendar session expired. Please tap Connect to renew.');
    }

    if (!resp.ok) {
      const errText = await resp.text();
      throw new Error(`Failed to update Microsoft event (${resp.status}): ${errText}`);
    }

    const updated = await resp.json();
    return this.mapToCalentimerEvent(updated, calentimerEvent.color);
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

    if (resp.status === 401) {
      this.signOut();
      throw new Error('Microsoft Calendar session expired. Please tap Connect to renew.');
    }

    if (resp.status === 404 || resp.status === 410) {
      return true; // Already deleted
    }

    if (!resp.ok) {
      const errText = await resp.text();
      throw new Error(`Failed to delete Microsoft event (${resp.status}): ${errText}`);
    }

    return true;
  }

  /**
   * Resolves the theme color for a Microsoft Graph event item.
   * Checks explicit hexColor, category colors (preset 0-24 and standard names),
   * calendar color mapping, and parent calendar defaultColor.
   * @param {object} item 
   * @param {string} [defaultColor] 
   * @returns {string|null}
   */
  _resolveEventColor(item, defaultColor) {
    if (!item) return defaultColor || null;

    // 1. Explicit hex color if provided
    if (item.hexColor && typeof item.hexColor === 'string' && item.hexColor.charAt(0) === '#') {
      return item.hexColor;
    }

    // 2. Outlook Category Color mapping
    if (item.categories && Array.isArray(item.categories) && item.categories.length > 0) {
      for (let i = 0; i < item.categories.length; i++) {
        const rawCat = String(item.categories[i]).trim().toLowerCase();
        if (MICROSOFT_CATEGORY_NAME_MAP[rawCat]) {
          return MICROSOFT_CATEGORY_NAME_MAP[rawCat];
        }
        if (MICROSOFT_CATEGORY_COLORS[rawCat]) {
          return MICROSOFT_CATEGORY_COLORS[rawCat];
        }
      }
    }

    // 3. Outlook Calendar color token mapping
    if (item.color && MICROSOFT_CALENDAR_COLORS[item.color]) {
      return MICROSOFT_CALENDAR_COLORS[item.color];
    }

    // 4. Default calendar color or null
    return defaultColor || null;
  }

  /**
   * Helper to parse ISO datetime strings into user's local browser date and time.
   * Prevents UTC offsets from shifting event times and dates.
   * @param {string} dateTimeStr 
   * @param {string} [fallbackDateStr] 
   * @returns {{date: string, time: string}}
   */
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
   * Converts Microsoft Graph event item to Calentimer schema with timezone accuracy,
   * deterministic semantic word classification (emoji & category), and color matching.
   * @param {object} item 
   * @param {string} [defaultColor]
   * @returns {object|null}
   */
  mapToCalentimerEvent(item, defaultColor) {
    if (!item || !item.id) return null;

    const isRemoved = Boolean(item['@removed']);
    const title = item.subject ? String(item.subject).trim() : 'Microsoft Meeting';
    const description = item.bodyPreview || (item.body && item.body.content) || '';

    let dateStr = '';
    let startTime = '09:00';
    let endTime = '10:00';

    if (item.start && item.start.dateTime) {
      const parsedStart = this._parseDateTimeString(item.start.dateTime);
      dateStr = parsedStart.date;
      startTime = parsedStart.time;
    } else if (item.start && item.start.date) {
      dateStr = item.start.date;
      startTime = '09:00';
      endTime = '17:00';
    }

    if (item.end && item.end.dateTime) {
      const parsedEnd = this._parseDateTimeString(item.end.dateTime);
      endTime = parsedEnd.time;
    } else if (item.end && item.end.date && !item.end.dateTime) {
      endTime = '17:00';
    }

    // All-day event coverage
    if (item.isAllDay) {
      startTime = '09:00';
      endTime = '17:00';
    }

    // Calculate duration in minutes
    const sMin = this._parseTimeToMinutes(startTime);
    let eMin = this._parseTimeToMinutes(endTime);
    if (eMin <= sMin) eMin += 1440;
    const plannedDuration = Math.max(15, eMin - sMin);

    // Color resolution
    const eventColor = this._resolveEventColor(item, defaultColor);

    // Intelligent semantic word classification (deterministic emoji & category)
    const classification = classifyEvent(title, description, eventColor);
    const resolvedEmoji = classification.emoji;

    // Check if user set a custom domain category in Outlook categories (e.g. "Study", "Coding", "Marketing")
    let resolvedCategory = classification.category;
    if (item.categories && Array.isArray(item.categories) && item.categories.length > 0) {
      for (let c = 0; c < item.categories.length; c++) {
        const catCandidate = String(item.categories[c]).trim();
        const lowerCandidate = catCandidate.toLowerCase();
        // Skip default Outlook generic names like "Red category", "Blue category"
        if (lowerCandidate.indexOf('category') === -1 && lowerCandidate.indexOf('preset') === -1) {
          resolvedCategory = catCandidate;
          break;
        }
      }
    }

    const resolvedColor = eventColor || classification.color;

    if (resolvedCategory && typeof taskStore !== 'undefined' && typeof taskStore.addCategory === 'function') {
      taskStore.addCategory(resolvedCategory);
    }

    return {
      id: `cal-ms-${item.id}`,
      externalId: item.id,
      externalCalendarId: item.calendarId || 'primary',
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
      colorId: (item.categories && item.categories[0]) || item.color || null,
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

    const categories = [];
    if (event.category) {
      categories.push(event.category);
    }

    return {
      subject: event.title || 'Calentimer Task',
      categories: categories,
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
