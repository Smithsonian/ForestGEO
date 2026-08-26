import React from 'react';
import HomePage from '@/app/page';
import LoginFailedPage from '@/app/loginfailed/page';

describe('Mounting Home Page', () => {
  it('renders', () => {
    cy.mount(<HomePage />);
  });
});

describe('Login failure page test', () => {
  beforeEach(() => {
    cy.stub(window.sessionStorage, 'clear').as('sessionStorageClear');
    cy.stub(window.localStorage, 'clear').as('localStorageClear');
  });

  it('renders the login failure message', () => {
    cy.mount(<LoginFailedPage />);
    cy.contains('Oops! Login Failed').should('be.visible');
  });

  it('displays the default failure reason when no reason is provided', () => {
    cy.mount(<LoginFailedPage />);
    // Asserted literally, not imported from the component: this is the user-visible
    // contract, and importing the rendered value would make the test tautological.
    cy.contains('Login failure triggered without reason. Please speak to an administrator.').should('be.visible');
  });
});
