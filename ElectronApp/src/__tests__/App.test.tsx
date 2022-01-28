import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

import '@testing-library/jest-dom';

import App from '../renderer/App';

describe('App', () => {
  it('should render', () => {
    expect(render(<App />, { wrapper: MemoryRouter })).toBeTruthy();
  });
});

describe('Data Entry', () => {
  it('should render on click', () => {
    render(<App />, { wrapper: MemoryRouter });

    const leftClick = { button: 0 };
    userEvent.click(screen.getByText(/data entry/i), leftClick);

    expect(screen.getByText(/you are in data entry mode/i)).toBeInTheDocument();
  });
});

describe('Data Reports', () => {
  it('should render on click', () => {
    render(<App />, { wrapper: MemoryRouter });

    const leftClick = { button: 0 };
    userEvent.click(screen.getByText(/data report/i), leftClick);

    expect(
      screen.getByText(/you are in data reports mode/i)
    ).toBeInTheDocument();
  });
});

describe('Field Forms', () => {
  it('should render on click', () => {
    render(<App />, { wrapper: MemoryRouter });

    const leftClick = { button: 0 };
    userEvent.click(screen.getByText(/field forms/i), leftClick);

    expect(
      screen.getByText(/you are in field forms mode/i)
    ).toBeInTheDocument();
  });
});
