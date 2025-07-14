// cypress/stubs/next-auth-react.js
export const SessionProvider = ({ children }) => children;
export const useSession = () => ({ data: null, status: 'unauthenticated' });
export const signIn = () => Promise.resolve();
export const signOut = () => Promise.resolve();
