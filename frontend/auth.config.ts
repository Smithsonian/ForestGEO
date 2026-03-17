import type { NextAuthConfig } from 'next-auth';
import MicrosoftEntraID from '@auth/core/providers/microsoft-entra-id';
import Credentials from 'next-auth/providers/credentials';

const isE2ETesting = process.env.NEXT_PUBLIC_E2E_TESTING === 'true';

if (isE2ETesting && process.env.NODE_ENV === 'production') {
  throw new Error('NEXT_PUBLIC_E2E_TESTING must not be enabled in production. Aborting to prevent auth bypass.');
}

// E2E test credentials provider — only active when NEXT_PUBLIC_E2E_TESTING=true.
// Allows Cypress to obtain a real JWT session without Azure AD.
const e2eCredentialsProvider = Credentials({
  id: 'e2e-credentials',
  name: 'E2E Test Login',
  credentials: {
    email: { label: 'Email', type: 'text' },
    userStatus: { label: 'Role', type: 'text' }
  },
  async authorize(credentials) {
    if (!isE2ETesting) return null;
    const email = credentials?.email as string | undefined;
    if (!email) return null;
    return {
      id: 'e2e-test-user',
      email,
      name: 'E2E Test User',
      userStatus: (credentials?.userStatus as string) || 'global',
      sites: [],
      allsites: []
    };
  }
});

const providers: NextAuthConfig['providers'] = [
  MicrosoftEntraID({
    authorization: {
      params: {
        scope: 'openid profile email User.Read'
      }
    }
  }),
  ...(isE2ETesting ? [e2eCredentialsProvider] : [])
];

// Notice this is only an object, not a full Auth.js instance
export default {
  providers
} satisfies NextAuthConfig;
