import React from 'react';
import { mount } from '@cypress/react';
import { LoginLogout } from '@/components/loginlogout';
import { SessionProvider, setMockSession } from 'next-auth/react';

describe('<LoginLogout />', () => {
  beforeEach(() => {
    // No need for mocking at this level since it's handled by webpack config
  });

  context('when not signed in', () => {
    beforeEach(() => {
      // Set the mock session to unauthenticated
      setMockSession({
        data: null,
        status: 'unauthenticated'
      });

      mount(
        <SessionProvider session={null}>
          <LoginLogout />
        </SessionProvider>
      );
    });

    it('shows the "Login to access" prompt', () => {
      cy.get('[data-testid="login-logout-component"]').within(() => {
        cy.contains('Login to access');
        cy.contains('your information');
      });
    });

    it('shows login button that can be clicked', () => {
      cy.get('button[aria-label="Login button"]').should('be.visible').and('not.be.disabled');
    });
  });

  context('when signed in', () => {
    const fakeSession = {
      user: {
        name: 'Jane Q. Public',
        email: 'jane.public@example.com',
        userStatus: 'global'
      },
      expires: new Date(Date.now() + 60 * 60 * 1000).toISOString()
    };

    beforeEach(() => {
      // Set the mock session to authenticated
      setMockSession({
        data: fakeSession,
        status: 'authenticated'
      });

      mount(
        <SessionProvider session={fakeSession as unknown as any}>
          <LoginLogout />
        </SessionProvider>
      );
    });

    it('displays the user name, email, and initials avatar', () => {
      cy.contains('Jane Q. Public');
      cy.contains('jane.public@example.com');
      // avatar shows initials "JQP"
      cy.get('button').first().should('contain', 'JQP');
    });

    it('shows disabled settings button (settings menu functionality is disabled)', () => {
      // The settings button is disabled in the component
      cy.get('button').eq(1).should('be.disabled');
    });

    it('shows logout button that can be clicked', () => {
      cy.get('button[aria-label="Logout button"]').should('be.visible').and('not.be.disabled');
    });
  });
});
