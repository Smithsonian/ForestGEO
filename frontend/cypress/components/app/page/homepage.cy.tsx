import React from 'react';
import HomePage from '../../../../app/page';

describe('App --> Page --> <HomePage />', () => {
  it('renders', () => {
    // see: https://on.cypress.io/mounting-react
    cy.mount(<HomePage />);
  });
});
