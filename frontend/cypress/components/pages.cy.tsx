import React from 'react';
import HomePage from '@/app/page';
import LoginFailedPage from '@/app/loginfailed/page';
import * as nextAuthReact from 'next-auth/react';
import * as nextNavigation from 'next/navigation';

describe('Mounting Home Page', () => {
  it('renders', () => {
    cy.mount(<HomePage />);
  });
});

describe('Login failure page test', () => {
  beforeEach(() => {
    cy.stub(window.sessionStorage, 'clear').as('sessionStorageClear');
    cy.stub(window.localStorage, 'clear').as('localStorageClear');

    cy.stub(nextAuthReact, 'signOut').resolves();

    cy.stub(nextNavigation, 'useSearchParams').returns(() => new URLSearchParams('?reason=Invalid Credentials'));
  });

  it('renders the login failure message', () => {
    cy.mount(<LoginFailedPage />);
    cy.contains('Oops! Login Failed').should('be.visible');
  });

  it('displays a default failure reason if none is provided', () => {
    cy.mount(<LoginFailedPage />);
    cy.contains('Failure caused due to Login failure triggered without reason. Please speak to an administrator').should('be.visible');
  });
});
