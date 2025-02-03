import React from 'react';
import ErrorPage from '@/app/error';

describe('App --> Page --> <ErrorPage />', () => {
  it('renders', () => {
    cy.mount(<ErrorPage error={new Error('Test Error')} reset={function (): void {}} />);
  });
});
