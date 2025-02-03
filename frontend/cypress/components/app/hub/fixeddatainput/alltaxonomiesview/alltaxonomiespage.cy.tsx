import React from 'react';
import AllTaxonomiesPage from '@/app/(hub)/fixeddatainput/alltaxonomies/page';

describe('App --> Hub --> FixedDataInput --> AllTaxonomiesView --> Page --> <AllTaxonomiesPage />', () => {
  it('renders', () => {
    cy.mount(<AllTaxonomiesPage />);
  });
});
