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
    // Microsoft Application (client) ID placeholder
    // Flag useMock: true provides fully functional mock sync while personal account developer sandboxes are restricted
    clientId: 'YOUR_MICROSOFT_CLIENT_ID',
    scopes: ['Calendars.ReadWrite', 'User.Read'],
    redirectUri: 'http://localhost:3000',
    useMock: true
  }
};

export default OAUTH_CONFIG;
