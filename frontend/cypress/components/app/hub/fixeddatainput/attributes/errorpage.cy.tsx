import React from 'react';
import ErrorPage from '@/app/(hub)/fixeddatainput/attributes/error';

describe('App --> Hub --> FixedDataInput --> Attributes --> Page --> <ErrorPage />', () => {
  it('renders', () => {
    cy.mount(<ErrorPage error={new Error('Test Error - Attributes')} reset={function (): void {}} />);
  });
});
