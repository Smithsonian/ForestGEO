import type { NextAuthConfig } from 'next-auth';
import MicrosoftEntraID from '@auth/core/providers/microsoft-entra-id';
import Credentials from 'next-auth/providers/credentials';
import type { UserAuthRoles } from '@/config/macros';

// NEXT_PUBLIC_E2E_TESTING must only be set in local .env.local and Cypress CI jobs.
// It must NOT be set in Azure App Service (dev/staging/prod) — doing so would
// expose the E2E credentials provider, bypassing Azure AD auth.
// `next build` sets NODE_ENV=production, so a top-level guard here would also
// break local production builds. The env var's absence in deployed environments
// is the safety mechanism; see Option 2 in the build-fix discussion.
const isE2ETesting = process.env.NEXT_PUBLIC_E2E_TESTING === 'true';

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
