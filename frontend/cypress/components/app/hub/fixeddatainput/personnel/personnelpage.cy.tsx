import React from 'react';
import PersonnelPage from '@/app/(hub)/fixeddatainput/personnel/page';

describe('App --> Hub --> FixedDataInput --> Personnel --> Page --> <PersonnelPage />', () => {
  it('renders', () => {
    cy.mount(<PersonnelPage />);
  });
});
