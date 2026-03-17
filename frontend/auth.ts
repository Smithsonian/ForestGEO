// auth.ts
import NextAuth from 'next-auth';
import authConfig from '@/auth.config';
import MapperFactory from '@/config/datamapper';
import { SitesRDS, SitesResult } from '@/config/sqlrdsdefinitions/zones';
import { submitCookie } from '@/app/actions/cookiemanager';

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

    async jwt({ token, user }) {
      if (user) {
        if (!token.email) token.email = user.email;
        // Persist userStatus from the E2E credentials provider into the JWT
        if (user.userStatus) token.userStatus = user.userStatus;
      }
      return token;
    },

    async session({ session, token }) {
      // E2E testing bypass: return test session without calling external auth API.
      // The test user's role comes from the credentials provider via the JWT token.
      if (process.env.NEXT_PUBLIC_E2E_TESTING === 'true' && process.env.NODE_ENV !== 'production') {
        session.user.userStatus = (token.userStatus as string as import('@/config/macros').UserAuthRoles) || 'global';
        // Sites are fetched from the real DB via the normal /api/fetchall/sites endpoint,
        // so we leave them empty here — the hub layout will fetch them.
        session.user.sites = session.user.sites ?? [];
        session.user.allsites = session.user.allsites ?? [];
        session.user.name = session.user.name || 'E2E Test User';
        session.user.email = session.user.email || (token.email as string);
        return session;
      }

      if (!session.user.userStatus || !session.user.sites || session.user.sites.length === 0 || !session.user.allsites || session.user.allsites.length === 0) {
        const coreURL = `${process.env.AUTH_FUNCTIONS_POLL_URL}?email=${encodeURIComponent(token.email as string)}`;
        try {
          const response = await fetch(coreURL, {
            method: 'GET'
          });
          if (!response.ok) {
            const responseText = await response.text().catch(() => '');
            console.error('auth response not okay', {
              url: coreURL,
              status: response.status,
              statusText: response.statusText,
              body: responseText.slice(0, 500)
            });
            throw new Error(`API call FAILURE! status=${response.status}`);
          }

          const data = await response.json();
          await submitCookie('user', token.email ?? ''); // save user email in server storage
          session.user.userStatus = data.userStatus;
          session.user.sites = MapperFactory.getMapper<SitesRDS, SitesResult>('sites').mapData(data.allowedSites as SitesResult[]);
          session.user.allsites = MapperFactory.getMapper<SitesRDS, SitesResult>('sites').mapData(data.allSites as SitesResult[]);
        } catch (error) {
          console.error('Error fetching user data:', {
            url: coreURL,
            email: token.email,
            error
          });
          throw error;
        }
      }
      return session;
    }
  }
});
