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
      }
      return token;
    },

    async session({ session, token }) {
      if (!session.user.userStatus || !session.user.sites || session.user.sites.length === 0 || !session.user.allsites || session.user.allsites.length === 0) {
        const coreURL = `${process.env.AUTH_FUNCTIONS_POLL_URL}?email=${encodeURIComponent(token.email as string)}`;
        try {
          const response = await fetch(coreURL, {
            method: 'GET'
          });
          if (!response.ok) {
            // Log the error but don't throw - allow session to continue with defaults
            // This handles guest users who may not be in the authorization database yet
            console.error(`Auth API returned ${response.status} for ${token.email} - user may be a guest or not yet registered`);
            const errorText = await response.text().catch(() => 'Unable to read error response');
            console.error('Auth API error details:', errorText);

            // Set default values so the session can continue
            // User will have limited access until properly registered
            session.user.userStatus = 'pending';
            session.user.sites = [];
            session.user.allsites = [];
            await submitCookie('user', token.email ?? '');
            return session;
          }

          const data = await response.json();
          await submitCookie('user', token.email ?? ''); // save user email in server storage
          session.user.userStatus = data.userStatus;
          session.user.sites = MapperFactory.getMapper<SitesRDS, SitesResult>('sites').mapData(data.allowedSites as SitesResult[]);
          session.user.allsites = MapperFactory.getMapper<SitesRDS, SitesResult>('sites').mapData(data.allSites as SitesResult[]);
        } catch (error) {
          // Network errors or other failures - don't block the session
          // Allow user to authenticate with limited access
          console.error('Error fetching user data (allowing session with defaults):', error);
          session.user.userStatus = 'pending';
          session.user.sites = [];
          session.user.allsites = [];
          await submitCookie('user', token.email ?? '').catch(() => {});
        }
      }
      return session;
    }
  }
});
