// auth.ts
import NextAuth from 'next-auth';
import { UserAuthRoles } from '@/config/macros';
import { SitesRDS } from '@/config/sqlrdsdefinitions/zones';
import authConfig from '@/auth.config';

export const { auth, handlers, signIn, signOut } = NextAuth({
  secret: process.env.AUTH_SECRET!,
  ...authConfig,
  session: {
    strategy: 'jwt',
    maxAge: 24 * 60 * 60 // 24 hours
  },
  callbacks: {
    async signIn({}) {
      return true;
    },

    async jwt({ token, user }) {
      if (user) {
        if (!token.email) token.email = user.email;
      }
      return token;
    },

    async session({ session, token }) {
      console.log('url: ', process.env.AUTH_URL);
      const coreURL = `${process.env.AUTH_URL}/api/customsignin?email=${encodeURIComponent(token.email as string)}`;
      console.log('extracted core url: ', coreURL);
      try {
        const response = await fetch(coreURL, {
          method: 'GET'
        });
        console.log('response: ', response);
        if (!response.ok) {
          console.log('response not okay');
          throw new Error('API call FAILURE!');
        }

        const data = await response.json();
        console.log('signin api returned data: ', data);
        session.user.userStatus = data.userStatus;
        session.user.sites = data.allowedSites;
        session.user.allsites = data.allSites;
      } catch (error) {
        console.error('Error fetching user data:', error);
      }
      return session;
    }
  }
});
