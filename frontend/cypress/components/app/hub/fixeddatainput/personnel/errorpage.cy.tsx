import ErrorPage from '@/app/(hub)/fixeddatainput/personnel/error';
import React from 'react';

describe('App --> Hub --> FixedDataInput --> Personnel --> Page --> <ErrorPage />', () => {
  it('renders', () => {
    cy.mount(<ErrorPage error={new Error('Test Error - Personnel')} reset={function (): void {}} />);
  });
});
