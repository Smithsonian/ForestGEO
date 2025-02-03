import React from 'react';
import ErrorPage from '@/app/(hub)/fixeddatainput/alltaxonomies/error';

describe('App --> Hub --> FixedDataInput --> AllTaxonomiesView --> Page --> <ErrorPage />', () => {
  it('renders', () => {
    cy.mount(<ErrorPage error={new Error('Test Error - AllTaxonomiesView')} reset={function (): void {}} />);
  });
});
