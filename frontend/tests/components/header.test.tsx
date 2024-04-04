// Header.test.tsx
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import Header from '@/components/header';
import * as configUtils from '@/config/utils';

jest.mock('@/config/utils', () => ({
  toggleSidebar: jest.fn(),
}));

describe('Header Component', () => {
  it('renders the header', () => {
    render(<Header />);
    const headerElement = screen.getByRole('banner');
    expect(headerElement).toBeInTheDocument();
  });

  it('calls toggleSidebar function on menu button click', () => {
    render(<Header />);
    const menuButton = screen.getByRole('button');
    fireEvent.click(menuButton);
    expect(configUtils.toggleSidebar).toHaveBeenCalled();
  });

  // Additional tests can be added to cover other aspects or scenarios
});
