import React from 'react';
import ErrorPage from '@/app/error';

describe('Error Pages', () => {
  it('renders', () => {
    cy.mount(<ErrorPage error={new Error('Test Error')} reset={function (): void {}} />);
  });
});
