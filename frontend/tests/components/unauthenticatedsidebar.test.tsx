// UnauthenticatedSidebar.test.tsx
import React from 'react';
import {render, screen} from '@testing-library/react';
import '@testing-library/jest-dom';
import UnauthenticatedSidebar from '@/components/unauthenticatedsidebar';

describe('UnauthenticatedSidebar', () => {
  it('renders the sidebar', () => {
    render(<UnauthenticatedSidebar/>);
    const sidebarElement = screen.getByTestId('sidebar');
    expect(sidebarElement).toBeInTheDocument();
  });

  it('includes the LoginLogout component', () => {
    render(<UnauthenticatedSidebar/>);
    const loginLogoutComponent = screen.getByTestId('login-logout');
    expect(loginLogoutComponent).toBeInTheDocument();
  });

  it('applies the correct style properties', () => {
    render(<UnauthenticatedSidebar/>);
    const sidebarElement = screen.getByTestId('sidebar');
    expect(sidebarElement).toHaveStyle({position: 'sticky', top: 0});
  });
});

