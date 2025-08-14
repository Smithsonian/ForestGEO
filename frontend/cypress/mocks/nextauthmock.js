import React from 'react';

export function SessionProvider({ children, session }) {
  // simply render the children
  return React.createElement(React.Fragment, null, children);
}

// Allow this to be overridden by tests
let mockSessionData = { data: null, status: 'unauthenticated' };

export function useSession() {
  return mockSessionData;
}

// Function to set session data from tests
export function setMockSession(session) {
  mockSessionData = session;
}

export function signIn(provider, options) {
  return Promise.resolve();
}

export function signOut(options) {
  return Promise.resolve();
}
