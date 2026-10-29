/**
 * googleCalendarAdapter.js
 * 
 * Google Calendar API v3 Client-Side Adapter for Calentimer.
 * Uses Google Identity Services (GIS) for token management and REST endpoints for two-way sync.
 * Strictly zero optional chaining and zero nullish coalescing operators.
 */

import { taskStore } from './taskStore.js';
import { OAUTH_CONFIG } from './oauthConfig.js';
import { classifyEvent } from './eventClassifier.js';

const GOOGLE_CALENDAR_API_BASE = 'https://www.googleapis.com/calendar/v3';
const GOOGLE_USERINFO_URL = 'https://www.googleapis.com/oauth2/v2/userinfo';
const DEFAULT_CLIENT_ID = '938174201948-mock-client-id.apps.googleusercontent.com';
const SCOPES = 'https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/userinfo.email';

export const GOOGLE_EVENT_COLORS = {
  '1': '#7986cb',  // Lavender (Soft Blue)
  '2': '#33b679',  // Sage (Soft Green)
  '3': '#8e24aa',  // Grape (Purple)
  '4': '#e67c73',  // Flamingo (Coral / Pink)
  '5': '#f6bf26',  // Banana (Yellow)
  '6': '#f4511e',  // Tangerine (Orange)
  '7': '#039be5',  // Peacock (Cyan / Light Blue)
  '8': '#616161',  // Graphite (Gray)
  '9': '#3f51b5',  // Blueberry (Dark Blue)
  '10': '#0b8043', // Basil (Dark Green)
  '11': '#d50000'  // Tomato (Red)
};

export function hexToRgb(hex) {
  if (!hex || typeof hex !== 'string') return null;
  const clean = hex.replace('#', '').trim();
  if (clean.length === 3) {
    return {
      r: parseInt(clean.charAt(0) + clean.charAt(0), 16),
      g: parseInt(clean.charAt(1) + clean.charAt(1), 16),
      b: parseInt(clean.charAt(2) + clean.charAt(2), 16)
    };
  }
  if (clean.length === 6) {
    return {
      r: parseInt(clean.substring(0, 2), 16),
      g: parseInt(clean.substring(2, 4), 16),
      b: parseInt(clean.substring(4, 6), 16)
    };
  }
  return null;
}

export function areColorsSimilar(hex1, hex2, threshold) {
  const c1 = hexToRgb(hex1);
  const c2 = hexToRgb(hex2);
  if (!c1 || !c2) return false;
  const t = (typeof threshold === 'number') ? threshold : 75;
  const dist = Math.hypot(c1.r - c2.r, c1.g - c2.g, c1.b - c2.b);
  return dist < t;
}

export class GoogleCalendarAdapter {
  constructor(options) {
    const opts = (options && typeof options === 'object') ? options : {};
    const configId = (OAUTH_CONFIG && OAUTH_CONFIG.google && OAUTH_CONFIG.google.clientId) ? OAUTH_CONFIG.google.clientId : DEFAULT_CLIENT_ID;
    this.clientId = opts.clientId ? String(opts.clientId) : configId;
    this.accessToken = opts.accessToken ? String(opts.accessToken) : null;
    this.tokenExpiresAt = opts.tokenExpiresAt ? Number(opts.tokenExpiresAt) : 0;
    this.tokenClient = null;
    this.mockTransport = opts.mockTransport || null;
    this.userEmail = null;
  }

  /**
   * Initializes adapter and attempts to restore stored access token or GIS client.
   */
  init() {
    // Check if token exists in session
    if (typeof sessionStorage !== 'undefined' && sessionStorage !== null) {
      try {
        const savedToken = sessionStorage.getItem('calentimer_gcal_token');
        const savedExpiry = sessionStorage.getItem('calentimer_gcal_expiry');
        if (savedToken && savedExpiry) {
          const exp = parseInt(savedExpiry, 10);
          if (Date.now() < exp) {
            this.accessToken = savedToken;
            this.tokenExpiresAt = exp;
          }
        }
      } catch (_) {}
    }

    this.userEmail = (typeof taskStore !== 'undefined' && typeof taskStore.getGoogleUserEmail === 'function')
      ? taskStore.getGoogleUserEmail()
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
        sessionStorage.setItem('calentimer_gcal_token', token);
        sessionStorage.setItem('calentimer_gcal_expiry', String(this.tokenExpiresAt));
      } catch (_) {}
    }

    if (typeof taskStore !== 'undefined' && typeof taskStore.setGoogleCalendarConnected === 'function') {
      taskStore.setGoogleCalendarConnected(true);
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
        sessionStorage.removeItem('calentimer_gcal_token');
        sessionStorage.removeItem('calentimer_gcal_expiry');
      } catch (_) {}
    }

    if (typeof taskStore !== 'undefined') {
      if (typeof taskStore.setGoogleCalendarConnected === 'function') {
        taskStore.setGoogleCalendarConnected(false);
      }
      if (typeof taskStore.setGoogleSyncToken === 'function') {
        taskStore.setGoogleSyncToken(null);
      }
      if (typeof taskStore.setGoogleUserEmail === 'function') {
        taskStore.setGoogleUserEmail(null);
      }
    }
  }

  /**
   * Silently refreshes or verifies Google OAuth access token if nearing expiration.
   * @returns {Promise<string|null>}
   */
  async ensureValidToken() {
    if (this.mockTransport) return this.accessToken;

    // If token exists and is valid for more than 2 minutes, return immediately
    if (this.accessToken && (!this.tokenExpiresAt || Date.now() < this.tokenExpiresAt - 120000)) {
      return this.accessToken;
    }

    const hasGoogle = typeof window !== 'undefined' && window !== null && window.google && window.google.accounts && window.google.accounts.oauth2;
    if (!hasGoogle) {
      return this.accessToken;
    }

    const effectiveClientId = (OAUTH_CONFIG && OAUTH_CONFIG.google && OAUTH_CONFIG.google.clientId)
      ? OAUTH_CONFIG.google.clientId
      : this.clientId;
    if (!effectiveClientId || effectiveClientId === DEFAULT_CLIENT_ID || effectiveClientId.indexOf('YOUR_GOOGLE_CLIENT_ID') !== -1) {
      return this.accessToken;
    }

    return new Promise((resolve) => {
      let settled = false;
      const timeoutId = setTimeout(() => {
        if (!settled) {
          settled = true;
          resolve(this.accessToken);
        }
      }, 3500);

      try {
        if (!this.tokenClient) {
          this.tokenClient = window.google.accounts.oauth2.initTokenClient({
            client_id: effectiveClientId,
            scope: SCOPES,
            callback: () => {}
          });
        }

        this.tokenClient.callback = (tokenResponse) => {
          if (!settled) {
            settled = true;
            clearTimeout(timeoutId);
            if (tokenResponse && tokenResponse.access_token) {
              const expiresIn = tokenResponse.expires_in ? parseInt(tokenResponse.expires_in, 10) : 3600;
              this.setToken(tokenResponse.access_token, expiresIn);
              resolve(tokenResponse.access_token);
            } else {
              resolve(this.accessToken);
            }
          }
        };

        this.tokenClient.error_callback = () => {
          if (!settled) {
            settled = true;
            clearTimeout(timeoutId);
            resolve(this.accessToken);
          }
        };

        this.tokenClient.requestAccessToken({ prompt: '' });
      } catch (_) {
        if (!settled) {
          settled = true;
          clearTimeout(timeoutId);
          resolve(this.accessToken);
        }
      }
    });
  }

  /**
   * Discovers or creates the dedicated secondary "Calentimer" calendar in Google Calendar.
   * Applies the Neon Light Blue -> Neon Light Green -> Standout Fallback color collision cascade.
   * @returns {Promise<string>} calendarId
   */
  async getOrCreateCalentimerCalendar() {
    if (this.mockTransport && typeof this.mockTransport.getOrCreateCalentimerCalendar === 'function') {
      return this.mockTransport.getOrCreateCalentimerCalendar();
    }

    let cachedId = (typeof taskStore !== 'undefined' && typeof taskStore.getGoogleCalentimerCalendarId === 'function')
      ? taskStore.getGoogleCalentimerCalendarId()
      : null;

    await this.ensureValidToken();
    if (!this.isAuthenticated()) {
      return cachedId || 'primary';
    }

    let allCals = [];
    try {
      const resp = await fetch(`${GOOGLE_CALENDAR_API_BASE}/users/me/calendarList`, {
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
          'Accept': 'application/json'
        }
      });
      if (resp.ok) {
        const data = await resp.json();
        if (data && Array.isArray(data.items)) {
          allCals = data.items;
        }
      }
    } catch (_) {}

    // Check if "Calentimer" calendar already exists in user's account
    let existing = null;
    for (let i = 0; i < allCals.length; i++) {
      const c = allCals[i];
      if (c && c.summary && c.summary.trim().toLowerCase() === 'calentimer') {
        existing = c;
        break;
      }
    }

    if (existing) {
      if (typeof taskStore !== 'undefined') {
        if (typeof taskStore.setGoogleCalentimerCalendarId === 'function') {
          taskStore.setGoogleCalentimerCalendarId(existing.id);
        }
        if (typeof taskStore.setCalentimerCalendarColor === 'function' && existing.backgroundColor) {
          taskStore.setCalentimerCalendarColor('google', existing.backgroundColor);
        }
      }
      return existing.id;
    }

    // Color collision cascade:
    // 1. Neon light blue (#00d2ff / Peacock #039be5)
    // 2. Neon light green (#00e676 / Sage #33b679)
    // 3. Standout vibrant fallback (#8e24aa Grape or #f4511e Tangerine)
    const existingColors = allCals.map(c => c.backgroundColor).filter(Boolean);
    const NEON_BLUE = '#00d2ff';
    const PEACOCK_BLUE = '#039be5';
    const NEON_GREEN = '#00e676';
    const SAGE_GREEN = '#33b679';

    let chosenColorId = '7';
    let chosenHex = '#00d2ff';

    const hasBlueConflict = existingColors.some(c => areColorsSimilar(c, NEON_BLUE) || areColorsSimilar(c, PEACOCK_BLUE));
    if (!hasBlueConflict) {
      chosenColorId = '7';
      chosenHex = '#00d2ff';
    } else {
      const hasGreenConflict = existingColors.some(c => areColorsSimilar(c, NEON_GREEN) || areColorsSimilar(c, SAGE_GREEN));
      if (!hasGreenConflict) {
        chosenColorId = '2';
        chosenHex = '#00e676';
      } else {
        const hasPurpleConflict = existingColors.some(c => areColorsSimilar(c, '#8e24aa'));
        if (!hasPurpleConflict) {
          chosenColorId = '3';
          chosenHex = '#8e24aa';
        } else {
          chosenColorId = '6';
          chosenHex = '#f4511e';
        }
      }
    }

    try {
      const timeZone = (typeof Intl !== 'undefined' && Intl.DateTimeFormat)
        ? Intl.DateTimeFormat().resolvedOptions().timeZone
        : 'UTC';
      const createResp = await fetch(`${GOOGLE_CALENDAR_API_BASE}/calendars`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          summary: 'Calentimer',
          description: 'Mirrored tasks and live schedule events from Calentimer',
          timeZone: timeZone
        })
      });

      if (createResp.ok) {
        const createdCal = await createResp.json();
        const calId = createdCal.id;

        try {
          await fetch(`${GOOGLE_CALENDAR_API_BASE}/users/me/calendarList/${encodeURIComponent(calId)}`, {
            method: 'PATCH',
            headers: {
              'Authorization': `Bearer ${this.accessToken}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              colorId: chosenColorId
            })
          });
        } catch (_) {}

        if (typeof taskStore !== 'undefined') {
          if (typeof taskStore.setGoogleCalentimerCalendarId === 'function') {
            taskStore.setGoogleCalentimerCalendarId(calId);
          }
          if (typeof taskStore.setCalentimerCalendarColor === 'function') {
            taskStore.setCalentimerCalendarColor('google', chosenHex);
          }
        }
        return calId;
      }
    } catch (e) {
      console.warn('Could not create Calentimer secondary Google calendar:', e);
    }

    return cachedId || 'primary';
  }

  /**
   * Initiates Google Identity Services (GIS) token client request.
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
            if (typeof taskStore !== 'undefined' && typeof taskStore.setGoogleUserEmail === 'function') {
              taskStore.setGoogleUserEmail(res.email);
            }
          }
          resolve(res.token);
        }).catch(reject);
        return;
      }

      // 2. Protocol Check
      if (typeof window !== 'undefined' && window.location && window.location.protocol === 'file:') {
        reject(new Error('Google Sign-In requires serving Calentimer over HTTP/HTTPS (e.g. http://localhost:3000), not file://.'));
        return;
      }

      // 3. Client ID Configuration Check
      const effectiveClientId = (OAUTH_CONFIG && OAUTH_CONFIG.google && OAUTH_CONFIG.google.clientId)
        ? OAUTH_CONFIG.google.clientId
        : this.clientId;
      if (!effectiveClientId || effectiveClientId === DEFAULT_CLIENT_ID || effectiveClientId.indexOf('YOUR_GOOGLE_CLIENT_ID') !== -1) {
        reject(new Error('Please set your Google OAuth Client ID in oauthConfig.js before connecting.'));
        return;
      }
      this.clientId = effectiveClientId;

      // 4. Browser GIS Client Check
      const hasGoogle = typeof window !== 'undefined' && window !== null && window.google && window.google.accounts && window.google.accounts.oauth2;
      if (!hasGoogle) {
        if (typeof window === 'undefined') {
          const demoToken = 'mock-google-token-' + Date.now();
          resolve(demoToken);
          return;
        }
        reject(new Error('Google Identity Services SDK is not loaded. Ensure you are connected to the internet and serving over http://localhost:3000.'));
        return;
      }

      try {
        this.tokenClient = window.google.accounts.oauth2.initTokenClient({
          client_id: this.clientId,
          scope: SCOPES,
          callback: (tokenResponse) => {
            if (tokenResponse && tokenResponse.access_token) {
              const expiresIn = tokenResponse.expires_in ? parseInt(tokenResponse.expires_in, 10) : 3600;
              this.setToken(tokenResponse.access_token, expiresIn);
              this.fetchUserEmail().catch(() => {});
              resolve(tokenResponse.access_token);
            } else {
              const err = (tokenResponse && tokenResponse.error) ? tokenResponse.error : 'Failed to obtain access token';
              reject(new Error(err));
            }
          },
          error_callback: (err) => {
            reject(new Error(err && err.message ? err.message : 'GIS token error'));
          }
        });

        this.tokenClient.requestAccessToken({ prompt: 'select_account' });
      } catch (e) {
        reject(e);
      }
    });
  }

  /**
   * Fetches user email via userinfo endpoint.
   * @returns {Promise<string|null>}
   */
  async fetchUserEmail() {
    if (this.mockTransport && typeof this.mockTransport.fetchUserEmail === 'function') {
      const email = await this.mockTransport.fetchUserEmail();
      this.userEmail = email;
      if (typeof taskStore !== 'undefined' && typeof taskStore.setGoogleUserEmail === 'function') {
        taskStore.setGoogleUserEmail(email);
      }
      return email;
    }

    if (!this.accessToken) return null;

    try {
      const resp = await fetch(GOOGLE_USERINFO_URL, {
        headers: {
          'Authorization': `Bearer ${this.accessToken}`
        }
      });
      if (resp.ok) {
        const data = await resp.json();
        if (data && data.email) {
          this.userEmail = data.email;
          if (typeof taskStore !== 'undefined' && typeof taskStore.setGoogleUserEmail === 'function') {
            taskStore.setGoogleUserEmail(data.email);
          }
          return data.email;
        }
      }
    } catch (_) {}
    return null;
  }

  /**
   * Fetches calendar events. Supports full window range or incremental syncToken fetch.
   * @param {string} [timeMin] ISO string
   * @param {string} [timeMax] ISO string
   * @param {string} [syncToken]
   * @returns {Promise<{events: Array<object>, nextSyncToken: string|null, syncTokenExpired: boolean}>}
   */
  /**
   * Fetches the user's active Google Calendar list (primary and secondary calendars).
   * @returns {Promise<Array<{id: string, summary: string, backgroundColor?: string, primary?: boolean}>>}
   */
  async fetchCalendarList() {
    await this.ensureValidToken();
    if (!this.isAuthenticated()) {
      return [{ id: 'primary', summary: 'Primary', primary: true, backgroundColor: '#4285F4' }];
    }

    try {
      const resp = await fetch(`${GOOGLE_CALENDAR_API_BASE}/users/me/calendarList`, {
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
          'Accept': 'application/json'
        }
      });
      if (resp.ok) {
        const data = await resp.json();
        if (data && Array.isArray(data.items) && data.items.length > 0) {
          const activeCals = data.items.filter(c => c && c.selected !== false && !c.hidden);

          // Check for "Calentimer" calendar and dynamically acknowledge color changes made externally
          for (let i = 0; i < data.items.length; i++) {
            const item = data.items[i];
            if (item && item.summary && item.summary.trim().toLowerCase() === 'calentimer') {
              if (typeof taskStore !== 'undefined') {
                if (typeof taskStore.setGoogleCalentimerCalendarId === 'function') {
                  taskStore.setGoogleCalentimerCalendarId(item.id);
                }
                if (typeof taskStore.setCalentimerCalendarColor === 'function' && item.backgroundColor) {
                  taskStore.setCalentimerCalendarColor('google', item.backgroundColor);
                }
              }
              break;
            }
          }

          if (activeCals.length > 0) {
            return activeCals;
          }
        }
      }
    } catch (_) {}

    return [{ id: 'primary', summary: 'Primary', primary: true, backgroundColor: '#4285F4' }];
  }

  /**
   * Fetches calendar events across all active Google Calendars with full pagination and color matching.
   * @param {string} [timeMin] ISO string
   * @param {string} [timeMax] ISO string
   * @param {string} [syncToken]
   * @returns {Promise<{events: Array<object>, nextSyncToken: string|null, syncTokenExpired: boolean}>}
   */
  async fetchEvents(timeMin, timeMax, syncToken) {
    if (this.mockTransport && typeof this.mockTransport.fetchEvents === 'function') {
      return this.mockTransport.fetchEvents(timeMin, timeMax, syncToken);
    }

    await this.ensureValidToken();
    if (!this.isAuthenticated()) {
      throw new Error('Not authenticated with Google Calendar');
    }

    let calendars = await this.fetchCalendarList();
    const selectedIds = (typeof taskStore !== 'undefined' && typeof taskStore.getGoogleSelectedCalendarIds === 'function')
      ? taskStore.getGoogleSelectedCalendarIds()
      : null;
    if (selectedIds && Array.isArray(selectedIds) && selectedIds.length > 0) {
      calendars = calendars.filter(c => selectedIds.indexOf(c.id) !== -1 || (c.primary && selectedIds.indexOf('primary') !== -1));
    }
    const allEvents = [];
    const seenExternalIds = new Set();
    let primarySyncToken = null;
    let anyExpired = false;

    const calentimerCalId = (typeof taskStore !== 'undefined' && typeof taskStore.getGoogleCalentimerCalendarId === 'function')
      ? taskStore.getGoogleCalentimerCalendarId()
      : null;

    // Window defaults: past 60 days to next 180 days (covers entire study term / schedule)
    const min = timeMin || new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
    const max = timeMax || new Date(Date.now() + 180 * 24 * 60 * 60 * 1000).toISOString();

    for (let i = 0; i < calendars.length; i++) {
      const cal = calendars[i];
      const calId = cal.id || 'primary';
      const calColor = cal.backgroundColor || null;
      const isPrimary = calId === 'primary' || Boolean(cal.primary);
      const isCalentimerMirror = Boolean(
        (calentimerCalId && calId === calentimerCalId) ||
        (cal.summary && cal.summary.trim().toLowerCase() === 'calentimer')
      );

      try {
        let pageToken = null;
        let calSyncTokenExpired = false;

        do {
          let url = `${GOOGLE_CALENDAR_API_BASE}/calendars/${encodeURIComponent(calId)}/events?singleEvents=true&maxResults=250`;
          if (isPrimary && syncToken) {
            url += `&syncToken=${encodeURIComponent(syncToken)}`;
          } else {
            url += `&timeMin=${encodeURIComponent(min)}&timeMax=${encodeURIComponent(max)}`;
          }
          if (pageToken) {
            url += `&pageToken=${encodeURIComponent(pageToken)}`;
          }

          const resp = await fetch(url, {
            headers: {
              'Authorization': `Bearer ${this.accessToken}`,
              'Accept': 'application/json'
            }
          });

          if (resp.status === 401) {
            this.signOut();
            throw new Error('Google Calendar session expired. Please tap Connect to renew.');
          }

          if (resp.status === 410) {
            calSyncTokenExpired = true;
            anyExpired = true;
            break;
          }

          if (!resp.ok) {
            const errText = await resp.text();
            throw new Error(`Google Calendar API error (${resp.status}): ${errText}`);
          }

          const data = await resp.json();
          const rawItems = (data && Array.isArray(data.items)) ? data.items : [];

          for (let j = 0; j < rawItems.length; j++) {
            const raw = rawItems[j];
            if (!raw || !raw.id) continue;
            if (seenExternalIds.has(raw.id)) continue;
            seenExternalIds.add(raw.id);

            const ev = this.mapToCalentimerEvent(raw, calColor);
            if (ev) {
              ev.externalCalendarId = calId;
              ev.isCalentimerMirror = isCalentimerMirror;
              allEvents.push(ev);
            }
          }

          pageToken = (data && data.nextPageToken) ? data.nextPageToken : null;
          if (isPrimary && data && data.nextSyncToken) {
            primarySyncToken = data.nextSyncToken;
          }
        } while (pageToken);

        if (calSyncTokenExpired && isPrimary) {
          // If primary sync token was 410 Gone, return expired flag so caller can refetch without token
          return {
            events: [],
            nextSyncToken: null,
            syncTokenExpired: true
          };
        }
      } catch (calErr) {
        if (calErr && calErr.message && calErr.message.indexOf('session expired') !== -1) {
          throw calErr;
        }
        console.warn(`CalendarSync: Failed to fetch calendar "${cal.summary || calId}":`, calErr);
      }
    }

    return {
      events: allEvents,
      nextSyncToken: primarySyncToken,
      syncTokenExpired: anyExpired
    };
  }

  /**
   * Pushes a new event create to Google Calendar targeting the dedicated "Calentimer" calendar.
   * @param {object} calentimerEvent 
   * @returns {Promise<object>}
   */
  async createEvent(calentimerEvent) {
    if (this.mockTransport && typeof this.mockTransport.createEvent === 'function') {
      return this.mockTransport.createEvent(calentimerEvent);
    }

    await this.ensureValidToken();
    if (!this.isAuthenticated()) {
      throw new Error('Not authenticated with Google Calendar');
    }

    const targetCalId = await this.getOrCreateCalentimerCalendar();
    const calIdParam = encodeURIComponent(targetCalId || 'primary');

    const payload = this.mapToGooglePayload(calentimerEvent);
    const resp = await fetch(`${GOOGLE_CALENDAR_API_BASE}/calendars/${calIdParam}/events`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (resp.status === 401) {
      this.signOut();
      throw new Error('Google Calendar session expired. Please tap Connect to renew.');
    }

    if (!resp.ok) {
      const errText = await resp.text();
      throw new Error(`Failed to create Google event (${resp.status}): ${errText}`);
    }

    const created = await resp.json();
    const mapped = this.mapToCalentimerEvent(created);
    if (mapped) {
      mapped.externalCalendarId = targetCalId;
      mapped.isCalentimerMirror = true;
    }
    return mapped;
  }

  /**
   * Pushes an event update to Google Calendar.
   * @param {object} calentimerEvent 
   * @returns {Promise<object>}
   */
  async updateEvent(calentimerEvent) {
    if (!calentimerEvent || !calentimerEvent.externalId) {
      throw new Error('Cannot update Google event without externalId');
    }

    if (this.mockTransport && typeof this.mockTransport.updateEvent === 'function') {
      return this.mockTransport.updateEvent(calentimerEvent);
    }

    await this.ensureValidToken();
    if (!this.isAuthenticated()) {
      throw new Error('Not authenticated with Google Calendar');
    }

    const targetCalId = (calentimerEvent && calentimerEvent.externalCalendarId)
      ? calentimerEvent.externalCalendarId
      : (await this.getOrCreateCalentimerCalendar());
    const calIdParam = encodeURIComponent(targetCalId || 'primary');

    const payload = this.mapToGooglePayload(calentimerEvent);
    const eventId = encodeURIComponent(calentimerEvent.externalId);
    const resp = await fetch(`${GOOGLE_CALENDAR_API_BASE}/calendars/${calIdParam}/events/${eventId}`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (resp.status === 401) {
      this.signOut();
      throw new Error('Google Calendar session expired. Please tap Connect to renew.');
    }

    if (!resp.ok) {
      const errText = await resp.text();
      throw new Error(`Failed to update Google event (${resp.status}): ${errText}`);
    }

    const updated = await resp.json();
    const mapped = this.mapToCalentimerEvent(updated);
    if (mapped) {
      mapped.externalCalendarId = targetCalId;
      mapped.isCalentimerMirror = true;
    }
    return mapped;
  }

  /**
   * Deletes an event from Google Calendar.
   * @param {string} externalId 
   * @param {string} [externalCalendarId]
   * @returns {Promise<boolean>}
   */
  async deleteEvent(externalId, externalCalendarId) {
    if (!externalId) return false;

    if (this.mockTransport && typeof this.mockTransport.deleteEvent === 'function') {
      return this.mockTransport.deleteEvent(externalId, externalCalendarId);
    }

    await this.ensureValidToken();
    if (!this.isAuthenticated()) {
      throw new Error('Not authenticated with Google Calendar');
    }

    const targetCalId = externalCalendarId || (await this.getOrCreateCalentimerCalendar());
    const calIdParam = encodeURIComponent(targetCalId || 'primary');

    const eventId = encodeURIComponent(externalId);
    const resp = await fetch(`${GOOGLE_CALENDAR_API_BASE}/calendars/${calIdParam}/events/${eventId}`, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${this.accessToken}`
      }
    });

    if (resp.status === 401) {
      this.signOut();
      throw new Error('Google Calendar session expired. Please tap Connect to renew.');
    }

    if (resp.status === 404 || resp.status === 410) {
      return true; // Already gone
    }

    if (!resp.ok) {
      const errText = await resp.text();
      throw new Error(`Failed to delete Google event (${resp.status}): ${errText}`);
    }

    return true;
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
   * Converts Google Calendar API event item to Calentimer schema with timezone accuracy and color matching.
   * @param {object} item 
   * @param {string} [defaultColor]
   * @returns {object|null}
   */
  mapToCalentimerEvent(item, defaultColor) {
    if (!item || !item.id) return null;

    const isCancelled = item.status === 'cancelled';
    const title = item.summary ? String(item.summary).trim() : 'Google Meeting';

    // Parse start and end using Date object for local timezone accuracy
    let dateStr = '';
    let startTime = '09:00';
    let endTime = '10:00';

    if (item.start && item.start.dateTime) {
      const parsedStart = this._parseDateTimeString(item.start.dateTime);
      dateStr = parsedStart.date;
      startTime = parsedStart.time;
    } else if (item.start && item.start.date) {
      // All-day event (format: "YYYY-MM-DD")
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

    // Calculate duration in minutes
    const sMin = this._parseTimeToMinutes(startTime);
    let eMin = this._parseTimeToMinutes(endTime);
    if (eMin <= sMin) eMin += 1440;
    const plannedDuration = Math.max(15, eMin - sMin);

    // Resolve color: event colorId -> item.backgroundColor -> defaultColor
    let eventColor = null;
    if (item.colorId && GOOGLE_EVENT_COLORS[String(item.colorId)]) {
      eventColor = GOOGLE_EVENT_COLORS[String(item.colorId)];
    } else if (item.backgroundColor) {
      eventColor = item.backgroundColor;
    } else if (defaultColor) {
      eventColor = defaultColor;
    }

    // Intelligent semantic word classification (deterministic emoji & category)
    const classification = classifyEvent(title, item.description, eventColor);
    const resolvedEmoji = classification.emoji;
    const resolvedCategory = classification.category;
    const resolvedColor = eventColor || classification.color;

    if (resolvedCategory && typeof taskStore !== 'undefined' && typeof taskStore.addCategory === 'function') {
      taskStore.addCategory(resolvedCategory);
    }

    return {
      id: `cal-gcal-${item.id}`,
      externalId: item.id,
      externalCalendarId: item.calendarId || 'primary',
      provider: 'google',
      source: 'google',
      origin: 'external',
      createdInApp: false,
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
      colorId: item.colorId || null,
      etag: item.etag || null,
      status: item.status || 'confirmed',
      isCancelled: isCancelled,
      lastSyncedAt: Date.now()
    };
  }

  /**
   * Maps Calentimer category, hex color, and/or existing external colorId to the best Google Calendar colorId ("1" to "11").
   * Prioritizes preserving existing Google colorId and matching user-selected hex color before category fallback.
   * @param {string} [category]
   * @param {string} [colorHex]
   * @param {string|number} [existingColorId]
   * @returns {string} Google Calendar colorId ("1" to "11")
   */
  getGoogleColorId(category, colorHex, existingColorId) {
    // 1. If explicit existing Google colorId provided and valid, preserve it if colorHex is unchanged
    if (existingColorId !== undefined && existingColorId !== null) {
      const strId = String(existingColorId);
      if (GOOGLE_EVENT_COLORS[strId]) {
        if (!colorHex || areColorsSimilar(colorHex, GOOGLE_EVENT_COLORS[strId], 25)) {
          return strId;
        }
      }
    }

    // 2. If explicit hex provided (e.g. user chose in app or imported event has hex), match closest Google color via Euclidean RGB distance
    const hex = colorHex || null;
    if (hex && typeof hex === 'string' && hex.charAt(0) === '#') {
      let h = hex.slice(1);
      if (h.length === 3) {
        h = h.charAt(0) + h.charAt(0) + h.charAt(1) + h.charAt(1) + h.charAt(2) + h.charAt(2);
      }
      const targetR = parseInt(h.slice(0, 2), 16) || 0;
      const targetG = parseInt(h.slice(2, 4), 16) || 0;
      const targetB = parseInt(h.slice(4, 6), 16) || 0;

      let closestId = '9';
      let minDistance = Infinity;

      const colorIds = Object.keys(GOOGLE_EVENT_COLORS);
      for (let i = 0; i < colorIds.length; i++) {
        const id = colorIds[i];
        const gHex = GOOGLE_EVENT_COLORS[id].slice(1);
        const gr = parseInt(gHex.slice(0, 2), 16) || 0;
        const gg = parseInt(gHex.slice(2, 4), 16) || 0;
        const gb = parseInt(gHex.slice(4, 6), 16) || 0;

        const dist = Math.pow(targetR - gr, 2) + Math.pow(targetG - gg, 2) + Math.pow(targetB - gb, 2);
        if (dist < minDistance) {
          minDistance = dist;
          closestId = id;
        }
      }
      return closestId;
    }

    // 3. If user has a remembered custom category color in taskStore, match closest Google color to it
    if (category && typeof taskStore !== 'undefined' && typeof taskStore.getCategoryColor === 'function') {
      const customHex = taskStore.getCategoryColor(category);
      if (customHex) {
        return this.getGoogleColorId(null, customHex, null);
      }
    }

    const cleanCat = category ? String(category).trim().toLowerCase() : '';
    const CATEGORY_COLOR_MAP = {
      'work': '9',       // Blueberry (Dark Blue)
      'study': '3',      // Grape (Purple)
      'break': '6',      // Tangerine (Orange)
      'coding': '9',     // Blueberry
      'dev': '9',        // Blueberry
      'programming': '9',// Blueberry
      'meeting': '3',    // Grape
      'fitness': '11',   // Tomato (Red)
      'exercise': '11',  // Tomato
      'gym': '11',       // Tomato
      'workout': '11',   // Tomato
      'health': '11',    // Tomato (Red)
      'medical': '11',   // Tomato
      'personal': '6',   // Tangerine (Sunset Orange)
      'errand': '6',     // Tangerine
      'social': '4',     // Flamingo (Coral / Pink)
      'food': '6',       // Tangerine
      'dining': '6',     // Tangerine
      'reading': '9',    // Blueberry
      'travel': '3',     // Grape
      'finance': '10',   // Basil (Dark Green)
      'general': '8'     // Graphite (Gray)
    };

    if (cleanCat && CATEGORY_COLOR_MAP[cleanCat]) {
      return CATEGORY_COLOR_MAP[cleanCat];
    }

    return '9'; // Default Blueberry
  }

  /**
   * Converts Calentimer event to Google Calendar API JSON payload.
   * @param {object} event 
   * @returns {object}
   */
  mapToGooglePayload(event) {
    const timeZone = (typeof Intl !== 'undefined' && Intl.DateTimeFormat)
      ? Intl.DateTimeFormat().resolvedOptions().timeZone
      : 'UTC';

    const date = event.date || this._formatDateISO(new Date());
    const startTime = event.startTime || '09:00';
    const endTime = event.endTime || '10:00';

    const startDateTime = `${date}T${startTime}:00`;
    const endDateTime = `${date}T${endTime}:00`;

    const colorId = this.getGoogleColorId(event.category, event.color, event.colorId);

    const payload = {
      summary: event.title || 'Calentimer Task',
      description: `Managed by Calentimer${event.category ? ' • Category: ' + event.category : ''}`,
      start: {
        dateTime: startDateTime,
        timeZone: timeZone
      },
      end: {
        dateTime: endDateTime,
        timeZone: timeZone
      }
    };

    if (colorId) {
      payload.colorId = String(colorId);
    }

    return payload;
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

export const googleCalendarAdapter = new GoogleCalendarAdapter();
export default googleCalendarAdapter;
