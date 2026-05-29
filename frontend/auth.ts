// auth.ts
import NextAuth from 'next-auth';
import authConfig from '@/auth.config';
import { getOrFetchPermissions } from '@/lib/permissionscache';

export const { auth, handlers, signIn, signOut } = NextAuth({
  secret: process.env.AUTH_SECRET!,
  ...authConfig,
  session: {
    strategy: 'jwt',
    maxAge: 24 * 60 * 60 // 24 hours
  },
  callbacks: {
    async signIn({ user, profile, account }) {
      const userEmail = user.email || profile?.email || profile?.preferred_username;
      if (!user.email) user.email = userEmail;
      return true;
    },

    async jwt({ token, user, account }) {
      if (user) {
        if (!token.email) token.email = user.email;
        token.isE2ETestUser = account?.provider === 'e2e-credentials' || user.id === 'e2e-test-user';
        // Persist userStatus from the E2E credentials provider into the JWT
        if (user.userStatus) token.userStatus = user.userStatus;
      }
      return token;
    },

    async session({ session, token }) {
      // E2E testing bypass: return test session without calling external auth API.
      // The test user's role comes from the credentials provider via the JWT token.
      if (process.env.NEXT_PUBLIC_E2E_TESTING === 'true' && process.env.NODE_ENV !== 'production' && token.isE2ETestUser === true) {
        session.user.userStatus = (token.userStatus as string as import('@/config/macros').UserAuthRoles) || 'global';
        // Sites are fetched from the real DB via the normal /api/fetchall/sites endpoint,
        // so we leave them empty here — the hub layout will fetch them.
        session.user.sites = session.user.sites ?? [];
        session.user.allsites = session.user.allsites ?? [];
        session.user.name = session.user.name || 'E2E Test User';
        session.user.email = session.user.email || (token.email as string);
        return session;
      }

      // Permissions are sourced from AUTH_FUNCTIONS_POLL_URL via an in-process
      // cache (see lib/permissionscache.ts). The cache amortizes the auth-fetch
      // cost across all requests within the TTL window — without this, the
      // session callback ran the fetch on every authenticated API call because
      // sites/allsites are not persisted on the JWT.
      const email = token.email as string | undefined;
      if (!email) {
        // Hard fail: a JWT without email indicates a malformed or tampered
        // token, not a transient external problem.
        throw new Error('JWT has no email — cannot resolve permissions');
      }
      try {
        const permissions = await getOrFetchPermissions(email);
        session.user.userStatus = permissions.userStatus;
        session.user.sites = permissions.sites;
        session.user.allsites = permissions.allsites;
      } catch (error) {
        // Soft fail: the auth Azure Function rejected or timed out. Return
        // a session marked permissionsUnavailable so the hub layout can fail
        // closed (redirect to /loginfailed) instead of 500ing every protected
        // page through the duration of the outage.
        console.error('permissions fetch failed; returning empty-permission session', { email, error });
        delete (session.user as Partial<typeof session.user>).userStatus;
        // Also clear the JWT-side snapshot. Today only the E2E branch reads
        // token.userStatus, but leaving a stale role on the token would let a
        // future non-E2E reader silently see a role we just decided we cannot
        // verify.
        delete (token as Partial<typeof token>).userStatus;
        session.user.sites = [];
        session.user.allsites = [];
        session.user.permissionsUnavailable = true;
      }
      return session;
    }
  }
});
