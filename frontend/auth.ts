// auth.ts
import NextAuth from 'next-auth';
import authConfig from '@/auth.config';

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
      console.log('SIGNINCALLBACK profile: ', profile);
      console.log('SIGNINCALLBACK account: ', account);
      if (!user.email) user.email = userEmail;
      console.log('SIGNIN CALLBACK USER: ', user);
      return true;
    },

    async jwt({ token, user }) {
      if (user) {
        console.log('JWT CALLBACK USER: ', user);
        console.log('JWT CALLBACK TOKEN: ', token);
        if (!token.email) token.email = user.email;
      }
      return token;
    },

    async session({ session, token }) {
      console.log('url: ', process.env.AUTH_FUNCTIONS_POLL_URL);
      const coreURL = `${process.env.AUTH_FUNCTIONS_POLL_URL}/api/polluserstate?email=${encodeURIComponent(token.email as string)}`;
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
        console.log('signin api returned data: ', data);
        session.user.userStatus = data.userStatus;
        session.user.sites = data.allowedSites;
        session.user.allsites = data.allSites;
      } catch (error) {
        console.error('Error fetching user data:', error);
        throw error;
      }
      return session;
    }
  }
});
