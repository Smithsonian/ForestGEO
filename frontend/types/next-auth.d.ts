import 'next-auth';
import { Profile } from 'next-auth';
import { UserAuthRoles } from '@/config/macros';
import { SitesRDS } from '@/config/sqlrdsdefinitions/zones';

declare module 'next-auth' {
  /**
   * Extends the built-in session types to include the userStatus property.
   */
  interface Session {
    user: {
      userStatus?: UserAuthRoles;
      name?: string;
      email?: string;
      image?: string;
      sites: SitesRDS[];
      allsites: SitesRDS[];
      /** Set to true when the session callback could not resolve permissions
       *  from the auth function (transient failure). The hub layout treats
       *  this as fail-closed and redirects instead of rendering a broken UI. */
      permissionsUnavailable?: boolean;
    };
  }

  interface AzureADProfile extends Profile {
    preferred_username?: string;
  }

  /**
   * Extends the built-in user types to include the userStatus property.
   */
  interface User {
    userStatus: UserAuthRoles;
    sites: SitesRDS[];
    allsites: SitesRDS[];
  }

  // Extend the Token type
  interface JWT {
    userStatus: UserAuthRoles;
    sites: SitesRDS[];
    allsites: SitesRDS[];
    isE2ETestUser?: boolean;
  }
}
