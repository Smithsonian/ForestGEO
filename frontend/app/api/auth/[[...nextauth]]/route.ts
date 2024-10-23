import NextAuth, { AzureADProfile } from 'next-auth';
import AzureADProvider from 'next-auth/providers/azure-ad';
import { getAllowedSchemas, getAllSchemas } from '@/components/processors/processorhelperfunctions';
import { UserAuthRoles } from '@/config/macros';
import { SitesRDS } from '@/config/sqlrdsdefinitions/zones';
import { getConn, runQuery } from '@/components/processors/processormacros';

const handler = NextAuth({
  secret: process.env.NEXTAUTH_SECRET!,
  providers: [
    AzureADProvider({
      clientId: process.env.AZURE_AD_CLIENT_ID!,
      clientSecret: process.env.AZURE_AD_CLIENT_SECRET!,
      tenantId: process.env.AZURE_AD_TENANT_ID!,
      authorization: { params: { scope: 'openid profile email user.Read' } }
    })
  ],
  session: {
    strategy: 'jwt',
    maxAge: 24 * 60 * 60 // 24 hours (you can adjust this value as needed)
  },
  callbacks: {
    async signIn({ user, profile, email: signInEmail }) {
      const azureProfile = profile as AzureADProfile;
      const userEmail = user.email || signInEmail || azureProfile.preferred_username;
      if (typeof userEmail !== 'string') {
        console.error('User email is not a string:', userEmail);
        return false; // Email is not a valid string, abort sign-in
      }
      if (userEmail) {
        let conn, emailVerified, userStatus;
        try {
          conn = await getConn();
          const query = `SELECT UserStatus FROM catalog.users WHERE Email = '${userEmail}' LIMIT 1`;
          const results = await runQuery(conn, query);

          // emailVerified is true if there is at least one result
          emailVerified = results.length > 0;
          if (!emailVerified) {
            console.error('User email not found.');
            return false;
          }
          userStatus = results[0].UserStatus;
          conn.release();
        } catch (e: any) {
          console.error('Error fetching user status:', e);
          throw new Error('Failed to fetch user status.');
        } finally {
          if (conn) conn.release();
        }
        user.userStatus = userStatus as UserAuthRoles;
        user.email = userEmail;
        // console.log('getting all sites: ');
        const allSites = await getAllSchemas();
        const allowedSites = await getAllowedSchemas(userEmail);
        if (!allowedSites || !allSites) {
          console.error('User does not have any allowed sites.');
          return false;
        }

        user.sites = allowedSites;
        user.allsites = allSites;
      }
      return true;
    },

    async jwt({ token, user }) {
      // If this is the first time the JWT is issued, persist custom properties
      if (user) {
        token.userStatus = user.userStatus;
        token.sites = user.sites;
        token.allsites = user.allsites;
      }
      return token;
    },

    async session({ session, token }) {
      if (typeof token.userStatus === 'string') {
        session.user.userStatus = token.userStatus as UserAuthRoles;
      } else {
        session.user.userStatus = 'field crew' as UserAuthRoles; // default no admin permissions
      }
      if (token && token.allsites && Array.isArray(token.allsites)) {
        session.user.allsites = token.allsites as SitesRDS[];
      }
      if (token && token.sites && Array.isArray(token.sites)) {
        session.user.sites = token.sites as SitesRDS[];
      }
      return session;
    }
  },
  pages: {
    error: '/loginfailed'
  }
});

export { handler as GET, handler as POST };
