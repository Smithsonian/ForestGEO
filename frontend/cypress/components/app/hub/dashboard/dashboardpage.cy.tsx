import React from 'react';
import DashboardPage from '@/app/(hub)/dashboard/page';

describe('App --> Hub --> Dashboard --> Page --> <DashboardPage />', () => {
  it('renders', () => {
    cy.mount(<DashboardPage />);
  });
});
