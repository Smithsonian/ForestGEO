// auth.ts
import NextAuth from 'next-auth';
import authConfig from '@/auth.config';
import { prisma } from '@/prisma';
import { UserAuthRoles } from '@/config/macros';
import { SitesRDS } from '@/config/sqlrdsdefinitions/zones';
import { PrismaAdapter } from '@auth/prisma-adapter';

export const { auth, handlers, signIn, signOut } = NextAuth({
  secret: process.env.AUTH_SECRET!,
  adapter: PrismaAdapter(prisma),
  ...authConfig,
  session: {
    strategy: 'jwt',
    maxAge: 24 * 60 * 60 // 24 hours
  },
  callbacks: {
    authorized: async ({ auth }) => {
      return !!auth;
    },
    async signIn() {
      // With the adapter handling data merging, we just return true here.
      return true;
    },
    async jwt({ token, user }) {
      if (user) {
        token.userStatus = user.userStatus;
        token.sites = user.sites;
        token.allsites = user.allsites;
        console.log('JWT callback - user extra fields:', {
          userStatus: user.userStatus,
          sites: user.sites,
          allsites: user.allsites
        });
      }
      return token;
    },
    async session({ session, token }) {
      session.user.userStatus = token.userStatus as UserAuthRoles;
      session.user.sites = token.sites as SitesRDS[];
      session.user.allsites = token.allsites as SitesRDS[];
      console.log('Session callback - session user:', session.user);
      return session;
    }
  }
});
