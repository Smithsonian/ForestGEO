import React from 'react';
import ErrorPage from '@/app/(hub)/dashboard/error';

describe('App --> Hub --> Dashboard --> Page --> <ErrorPage />', () => {
  it('renders', () => {
    cy.mount(<ErrorPage error={new Error('Test Error - Dashboard')} reset={function (): void {}} />);
  });
});
