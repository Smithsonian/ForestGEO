import NextAuth from "next-auth";
import AzureADProvider from "next-auth/providers/azure-ad";

const handler = NextAuth({
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
    async jwt({token, account}) {
      if (account) {
        token.idtoken = account.id_token;
      }
      return token;
    },
  },
});

export {handler as GET, handler as POST};