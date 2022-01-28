import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

import '@testing-library/jest-dom';

import App from '../renderer/App';
import Nav from '../renderer/Nav';

describe('App', () => {
  it('should render', () => {
    expect(render(<App />, { wrapper: MemoryRouter })).toBeTruthy();
  });
});

describe('Nav', () => {
  it('should render', () => {
    expect(render(<Nav />, { wrapper: MemoryRouter })).toBeTruthy();
  });

  it('should switch to Data Entry', () => {
    render(<App />, { wrapper: MemoryRouter });

    const leftClick = { button: 0 };
    userEvent.click(screen.getByText(/data entry/i), leftClick);

    expect(screen.getByText(/you are in data entry mode/i)).toBeInTheDocument();
  });

  it('should switch to Data Reports', () => {
    render(<App />, { wrapper: MemoryRouter });

    const leftClick = { button: 0 };
    userEvent.click(screen.getByText(/data reports/i), leftClick);

    expect(
      screen.getByText(/you are in data reports mode/i)
    ).toBeInTheDocument();
  });

  it('should switch to Field Forms', () => {
    render(<App />, { wrapper: MemoryRouter });

    const leftClick = { button: 0 };
    userEvent.click(screen.getByText(/field forms/i), leftClick);

    expect(
      screen.getByText(/you are in field forms mode/i)
    ).toBeInTheDocument();
  });
});
