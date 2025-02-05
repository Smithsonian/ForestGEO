// auth.ts
import NextAuth from 'next-auth';
import { UserAuthRoles } from '@/config/macros';
import { SitesRDS } from '@/config/sqlrdsdefinitions/zones';
import MicrosoftEntraID from '@auth/core/providers/microsoft-entra-id';

export const { auth, handlers, signIn, signOut } = NextAuth({
  secret: process.env.AUTH_SECRET!,
  providers: [
    MicrosoftEntraID({
      clientId: process.env.AZURE_AD_CLIENT_ID,
      clientSecret: process.env.AZURE_AD_CLIENT_SECRET,
      issuer: `https://login.microsoftonline.com/${process.env.AZURE_AD_TENANT_ID}/v2.0`
    })
  ],
  session: {
    strategy: 'jwt',
    maxAge: 24 * 60 * 60 // 24 hours
  },
  callbacks: {
    async signIn({ user, profile, email: signInEmail }) {
      console.log('url: ', process.env.AUTH_URL);
      const userEmail = user.email || signInEmail || profile?.preferred_username;
      if (!userEmail) {
        return false; // No email, reject sign-in
      }
      try {
        const response = await fetch(`${process.env.NEXTAUTH_URL ?? 'http://localhost:3000'}/api/customsignin`, {
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
