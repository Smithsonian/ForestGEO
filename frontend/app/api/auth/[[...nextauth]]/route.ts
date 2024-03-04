// NEXTAUTH ROUTE HANDLERS
import NextAuth from "next-auth";
import AzureADProvider from "next-auth/providers/azure-ad";
import {verifyLastName} from "@/components/processors/processorhelperfunctions";

const handler = NextAuth({
  secret: process.env.NEXTAUTH_SECRET as string,
  providers: [
    AzureADProvider({
      clientId: process.env.AZURE_AD_CLIENT_ID!,
      clientSecret: process.env.AZURE_AD_CLIENT_SECRET!,
      tenantId: process.env.AZURE_AD_TENANT_ID!,
      authorization: {params: {scope: "openid profile user.Read email"}},
    }),
  ],
  session: {
    strategy: "jwt"
  },
  callbacks: {
    async signIn({ user, account, profile, email, credentials }) {
      if (user.name) {
        const lastName = user.name.split(' ').slice(-1).join(''); // Gets the last word from the name
        const { verified, isAdmin } = await verifyLastName(lastName);
        if (!verified) {
          return false;
        }
        user.isAdmin = isAdmin; // Add isAdmin property to the user object
      }
      return true;
    },

    async jwt({ token, user }) {
      if (user?.isAdmin !== undefined) {
        token.isAdmin = user.isAdmin; // Persist admin status in the JWT token
      }
      return token;
    },

    async session({ session, token }) {
      if (typeof token.isAdmin === 'boolean') {
        session.user.isAdmin = token.isAdmin; // Include admin status in the session
      } else {
        session.user.isAdmin = false; // Default value if not set
      }
      return session;
    },
  },
});

export {handler as GET, handler as POST};