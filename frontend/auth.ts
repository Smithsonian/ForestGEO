// auth.ts
import NextAuth from 'next-auth';
import authConfig from '@/auth.config';
import MapperFactory from '@/config/datamapper';
import { SitesRDS, SitesResult } from '@/config/sqlrdsdefinitions/zones';

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
      if (!session.user.userStatus || !session.user.sites || session.user.allsites) {
        const coreURL = `${process.env.AUTH_FUNCTIONS_POLL_URL}?email=${encodeURIComponent(token.email as string)}`;
        console.log('extracted core url: ', coreURL);
        try {
          const response = await fetch(coreURL, {
            method: 'GET'
          });
          // console.log('response: ', response);
          if (!response.ok) {
            console.log('response not okay');
            throw new Error('API call FAILURE!');
          }

          const data = await response.json();
          session.user.userStatus = data.userStatus;
          session.user.sites = MapperFactory.getMapper<SitesRDS, SitesResult>('sites').mapData(data.allowedSites as SitesResult[]);
          session.user.allsites = MapperFactory.getMapper<SitesRDS, SitesResult>('sites').mapData(data.allSites as SitesResult[]);
        } catch (error) {
          console.error('Error fetching user data:', error);
          throw error;
        }
      }
      return session;
    }
  }
});
