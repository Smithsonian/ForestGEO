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
      console.log('nextauth url: ', process.env.NEXTAUTH_URL);
      const userEmail = user.email || signInEmail || profile?.preferred_username;
      if (!userEmail) {
        return false; // No email, reject sign-in
      }
      const coreURL = (process.env.NEXTAUTH_URL || process.env.AUTH_URL) + `/api/customsignin`;
      try {
        const response = await fetch(coreURL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: userEmail })
        });

        if (!response.ok) {
          return false;
        }

        const data = await response.json();
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
