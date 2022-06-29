import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import '@testing-library/jest-dom';

import App from '../renderer/App';
import Nav from '../renderer/Nav';

describe('Nav', () => {
  const leftClick = { button: 0 };

  it('should render', () => {
    expect(render(<Nav />, { wrapper: MemoryRouter })).toBeTruthy();
  });

  it('should switch to Data Entry', () => {
    render(<App />, { wrapper: MemoryRouter });

    userEvent.click(screen.getByText(/data entry/i), leftClick);

    expect(screen.getByTestId('data-entry')).toBeTruthy();
  });

  it('should switch to Data Reports', () => {
    render(<App />, { wrapper: MemoryRouter });

    userEvent.click(screen.getByText(/data reports/i), leftClick);

    expect(screen.getByTestId('data-reports')).toBeTruthy();
  });

  it('should switch to Field Forms', () => {
    render(<App />, { wrapper: MemoryRouter });

    userEvent.click(screen.getByText(/field forms/i), leftClick);

    expect(screen.getByTestId('field-forms')).toBeTruthy();
  });
});
