import 'next-auth';

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
    }
  }

  /**
   * Extends the built-in user types to include the isAdmin property.
   */
  interface User {
    isAdmin: boolean;
  }

  // Extend the Token type
  interface Token {
    isAdmin: boolean;
  }
}
