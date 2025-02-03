import React from 'react';
import LoginFailedPage from '../../app/loginfailed/page';

describe('<LoginFailedPage />', () => {
  it('renders', () => {
    // see: https://on.cypress.io/mounting-react
    cy.mount(<LoginFailedPage />);
  });
});
