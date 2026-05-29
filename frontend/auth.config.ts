import type { NextAuthConfig } from 'next-auth';
import MicrosoftEntraID from '@auth/core/providers/microsoft-entra-id';
import Credentials from 'next-auth/providers/credentials';
import type { UserAuthRoles } from '@/config/macros';

// Two-layer guard for the E2E credentials provider:
// (1) NEXT_PUBLIC_E2E_TESTING must be set, AND
// (2) NODE_ENV must NOT be 'production'.
// Both layers must agree at provider construction AND at authorize() call
// time. This means a leaked env var alone (e.g., misconfigured App Service
// slot) cannot register the provider, and a stray dev build cannot ship
// the bypass. NEXT_PUBLIC_E2E_TESTING must only be set in local .env.local
// and Cypress CI jobs.
const isE2ETesting = process.env.NEXT_PUBLIC_E2E_TESTING === 'true' && process.env.NODE_ENV !== 'production';

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
    if (process.env.NEXT_PUBLIC_E2E_TESTING !== 'true' || process.env.NODE_ENV === 'production') {
      return null;
    }
    const email = credentials?.email as string | undefined;
    if (!email) return null;
    return {
      id: 'e2e-test-user',
      email,
      name: 'E2E Test User',
      userStatus: ((credentials?.userStatus as string) || 'global') as UserAuthRoles,
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
