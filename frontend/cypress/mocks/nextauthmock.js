export function SessionProvider({ children, session }) {
  // simply render the children
  return <>{children}</>;
}

export function useSession() {
  return { data: null, status: 'unauthenticated' };
}

export const signIn = () => Promise.resolve();
export const signOut = () => Promise.resolve();
