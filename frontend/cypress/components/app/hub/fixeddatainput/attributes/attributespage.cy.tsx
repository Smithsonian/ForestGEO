import React from 'react';
import AttributesPage from '@/app/(hub)/fixeddatainput/attributes/page';

describe('App --> Hub --> FixedDataInput --> Attributes --> Page --> <AttributesPage />', () => {
  it('renders', () => {
    cy.mount(<AttributesPage />);
  });
});
