import React from 'react';
import Header from '../../components/header';

describe('<Header />', () => {
  it('renders', () => {
    // see: https://on.cypress.io/mounting-react
    cy.mount(<Header />);
  });
});
