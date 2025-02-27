import type { NextAuthConfig } from 'next-auth';
import MicrosoftEntraID from '@auth/core/providers/microsoft-entra-id';

// Notice this is only an object, not a full Auth.js instance
export default {
  providers: [
    MicrosoftEntraID({
      clientId: process.env.AZURE_AD_CLIENT_ID,
      clientSecret: process.env.AZURE_AD_CLIENT_SECRET,
      issuer: `https://login.microsoftonline.com/${process.env.AZURE_AD_TENANT_ID}/v2.0`
    })
  ]
} satisfies NextAuthConfig;
