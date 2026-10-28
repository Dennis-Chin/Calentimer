/**
 * oauthConfig.js
 * 
 * Centralized Developer OAuth 2.0 Configuration for Calentimer.
 * Pre-configured for development on http://localhost:3000.
 * End users never have to configure or see these credentials.
 * Strictly zero optional chaining and zero nullish coalescing operators.
 */

export const OAUTH_CONFIG = {
  google: {
    // Google OAuth 2.0 Web Client ID (Public client identifier constrained to authorized JS origins)
    clientId: '1035094963980-d0r9um6iitp41m8jdnr0usnvp8vepc19.apps.googleusercontent.com',
    scopes: 'https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/userinfo.email'
  },
  microsoft: {
    // Microsoft Application (client) ID configured for two-way sync
    clientId: '15001074-5d3f-42d1-97fd-f61ea17c5be9',
    scopes: ['Calendars.ReadWrite', 'User.Read'],
    redirectUri: 'http://localhost:3000',
    useMock: false
  }
};

export default OAUTH_CONFIG;
