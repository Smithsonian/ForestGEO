// next-auth.d.ts
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
      userStatus: UserAuthRoles;
      name?: string;
      email?: string;
      image?: string;
      sites?: SitesRDS[];
      allsites?: SitesRDS[];
    };
  }

  interface AzureADProfile extends Profile {
    preferred_username?: string;
  }

  /**
   * Extends the built-in user types to include the userStatus property.
   */
  interface User {
    userStatus?: UserAuthRoles;
    sites?: SitesRDS[];
    allsites?: SitesRDS[];
  }

  // Extend the Token type
  interface JWT {
    userStatus?: UserAuthRoles;
    sites?: SitesRDS[];
    allsites?: SitesRDS[];
  }
}
