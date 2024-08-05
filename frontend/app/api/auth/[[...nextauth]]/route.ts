import NextAuth, { AzureADProfile } from "next-auth";
import AzureADProvider from "next-auth/providers/azure-ad";
import { getAllowedSchemas, getAllSchemas, verifyEmail } from "@/components/processors/processorhelperfunctions";
import { SitesRDS } from "@/config/sqlrdsdefinitions/tables/sitesrds";

const handler = NextAuth({
  secret: process.env.NEXTAUTH_SECRET as string,
  providers: [
    AzureADProvider({
      clientId: process.env.AZURE_AD_CLIENT_ID!,
      clientSecret: process.env.AZURE_AD_CLIENT_SECRET!,
      tenantId: process.env.AZURE_AD_TENANT_ID!,
      authorization: { params: { scope: "openid profile email user.Read" } }
    })
  ],
  session: {
    strategy: "jwt",
    maxAge: 24 * 60 * 60 // 24 hours (you can adjust this value as needed)
  },
  callbacks: {
    async signIn({ user, account, profile, email: signInEmail, credentials }) {
      const azureProfile = profile as AzureADProfile;
      const userEmail = user.email || signInEmail || azureProfile.preferred_username;
      if (typeof userEmail !== "string") {
        console.error("User email is not a string:", userEmail);
        return false; // Email is not a valid string, abort sign-in
      }
      if (userEmail) {
        const { emailVerified, userStatus } = await verifyEmail(userEmail);
        if (!emailVerified) {
          throw new Error("User email not found.");
        }
        user.userStatus = userStatus; // Add userStatus property to the user object
        user.email = userEmail;
        // console.log('getting all sites: ');
        const allSites = await getAllSchemas();
        const allowedSites = await getAllowedSchemas(userEmail);
        if (!allowedSites || !allSites) {
          throw new Error("User does not have any allowed sites.");
        }

        user.sites = allowedSites;
        user.allsites = allSites;
        // console.log('all sites: ', user.allsites);
      }
      return true;
    },

    async jwt({ token, user }) {
      if (user?.userStatus !== undefined) token.userStatus = user.userStatus; // Persist admin status in the JWT token
      if (user?.sites !== undefined) token.sites = user.sites; // persist allowed sites in JWT token
      if (user?.allsites !== undefined) token.allsites = user.allsites;
      return token;
    },

    async session({ session, token }) {
      if (typeof token.userStatus === "string") {
        session.user.userStatus = token.userStatus;
      } else {
        session.user.userStatus = "fieldcrew"; // default no admin permissions
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
    error: "/loginfailed"
  }
});

export { handler as GET, handler as POST };
