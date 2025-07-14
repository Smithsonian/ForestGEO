import React from 'react';
import { mount } from '@cypress/react';
import { LoginLogout } from '@/components/loginlogout';
import * as NextAuth from 'next-auth/react';
import { SessionProvider } from 'next-auth/react';
import * as NextNav from 'next/navigation';
import Sinon, { SinonStub } from 'cypress/types/sinon';

describe('<LoginLogout />', () => {
  let signInStub: Sinon.SinonStub;
  let signOutStub: Sinon.SinonStub;
  let pushStub: Cypress.Agent<SinonStub>;

  beforeEach(() => {
    // stub signIn / signOut
    signInStub = cy.stub().resolves();
    signOutStub = cy.stub().resolves();
    cy.stub(NextAuth, 'signIn').callsFake(signInStub);
    cy.stub(NextAuth, 'signOut').callsFake(signOutStub);

    // stub useRouter().push
    pushStub = cy.stub();
    cy.stub(NextNav, 'useRouter').returns({ push: pushStub });
  });

  context('when not signed in', () => {
    beforeEach(() => {
      // make useSession() report unauthenticated
      cy.stub(NextAuth, 'useSession').returns({
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

    it('calls signIn with the right provider on click', () => {
      cy.get('button[aria-label="Login button"]')
        .click()
        .then(() => {
          expect(signInStub).to.have.been.calledWith('microsoft-entra-id', { redirectTo: '/dashboard' });
        });
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
      cy.stub(NextAuth, 'useSession').returns({
        data: fakeSession,
        status: 'authenticated'
      });
      mount(
        <SessionProvider session={fakeSession as unknown as any}>
          <LoginLogout />
        </SessionProvider>
      );
    });

    it('displays the user’s name, email, and initials avatar', () => {
      cy.contains('Jane Q. Public');
      cy.contains('jane.public@example.com');
      // avatar shows initials "JQP"
      cy.get('button')
        .first()
        .within(() => {
          cy.get('span').contains('JQP');
        });
    });

    it('opens the settings menu and navigates on item click', () => {
      // open menu
      cy.get('button').first().click();
      cy.get('[role="menu"]').should('be.visible');

      // click "User Settings"
      cy.contains('User Settings')
        .click()
        .then(() => {
          expect(pushStub).to.have.been.calledWith('/admin/users');
        });

      // reopen and click "Site Settings"
      cy.get('button').first().click();
      cy.contains('Site Settings')
        .click()
        .then(() => {
          expect(pushStub).to.have.been.calledWith('/admin/sites');
        });

      // reopen and click "User-Site Assignments"
      cy.get('button').first().click();
      cy.contains('User-Site Assignments')
        .click()
        .then(() => {
          expect(pushStub).to.have.been.calledWith('/admin/userstosites');
        });
    });

    it('calls signOut with the right redirect on logout click', () => {
      cy.get('button[aria-label="Logout button"]')
        .click()
        .then(() => {
          expect(signOutStub).to.have.been.calledWith({
            redirectTo: '/login'
          });
        });
    });
  });
});
