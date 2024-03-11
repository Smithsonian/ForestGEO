// NEXTAUTH ROUTE HANDLERS
import NextAuth, {AzureADProfile} from "next-auth";
import AzureADProvider from "next-auth/providers/azure-ad";
import {verifyEmail, verifyLastName} from "@/components/processors/processorhelperfunctions";

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
    async signIn({user, account, profile, email: signInEmail, credentials}) {
      console.log('User object:', user); // Debugging
      console.log('Profile object:', profile); // Debugging
      console.log('Account object: ', account); // Debugging
      // Now using the extended AzureADProfile
      const azureProfile = profile as AzureADProfile;
      const userEmail = user.email || signInEmail || azureProfile.preferred_username;
      if (typeof userEmail !== 'string') {
        console.error('User email is not a string:', userEmail);
        return false; // Email is not a valid string, abort sign-in
      }
      if (user.name && userEmail) {
        const lastName = user.name.split(' ').slice(-1).join(''); // Gets the last word from the name
        const {verified, isAdmin} = await verifyLastName(lastName);
        if (!verified) {
          return false;
        }
        const {emailVerified} = await verifyEmail(userEmail);
        if (!emailVerified) {
          return false;
        }
        user.isAdmin = isAdmin; // Add isAdmin property to the user object
        user.email = userEmail;
      }
      return true;
    },

    async jwt({token, user}) {
      if (user?.isAdmin !== undefined) {
        token.isAdmin = user.isAdmin; // Persist admin status in the JWT token
      }
      return token;
    },

    async session({session, token}) {
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