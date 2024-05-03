import 'next-auth';
import {SitesRDS} from '@/config/sqlrdsdefinitions/tables/sitesrds';
import {Profile} from "next-auth";

declare module 'next-auth' {
  /**
   * Extends the built-in session types to include the isAdmin property.
   */
  interface Session {
    user: {
      isAdmin: boolean;
      name?: string;
      email?: string;
      image?: string;
      sites: SitesRDS[];
      allsites: SitesRDS[];
    }
  }

  interface AzureADProfile extends Profile {
    preferred_username?: string;
  }

  /**
   * Extends the built-in user types to include the isAdmin property.
   */
  interface User {
    isAdmin: boolean;
    sites: SitesRDS[];
    allsites: SitesRDS[];
  }

  // Extend the Token type
  interface Token {
    isAdmin: boolean;
    sites: SitesRDS[];
    allsites: SitesRDS[];
  }
}
