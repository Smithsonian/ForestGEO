import type { NextAuthConfig } from 'next-auth';
import MicrosoftEntraID from '@auth/core/providers/microsoft-entra-id';

// Notice this is only an object, not a full Auth.js instance
export default {
  providers: [MicrosoftEntraID]
} satisfies NextAuthConfig;
