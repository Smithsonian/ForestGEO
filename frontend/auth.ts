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
    async signIn({ user, profile, email: signInEmail }) {
      console.log('url: ', process.env.AUTH_URL);
      const userEmail = user.email || profile?.preferred_username;
      if (!userEmail) {
        return false; // No email, reject sign-in
      }
      const coreURL = `${process.env.AUTH_URL}/api/customsignin?email=${encodeURIComponent(userEmail)}`;
      console.log('extracted core url: ', coreURL);
      try {
        const response = await fetch(coreURL, {
          method: 'GET'
        });
        console.log('response: ', response);
        if (!response.ok) {
          console.log('response not okay');
          return false;
        }

        const data = await response.json();
        console.log('signin api returned data: ', data);
        user.userStatus = data.userStatus;
        user.sites = data.allowedSites;
        user.allsites = data.allSites;
      } catch (error) {
        console.error('Error fetching user data:', error);
        return false;
      }

      return true;
    },

    async jwt({ token, user }) {
      if (user) {
        token.userStatus = user.userStatus;
        token.sites = user.sites;
        token.allsites = user.allsites;
      }
      return token;
    },

    async session({ session, token }) {
      session.user.userStatus = token.userStatus as UserAuthRoles;
      session.user.sites = token.sites as SitesRDS[];
      session.user.allsites = token.allsites as SitesRDS[];
      return session;
    }
  }
});
