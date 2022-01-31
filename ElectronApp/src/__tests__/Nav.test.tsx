import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

import '@testing-library/jest-dom';
import App from '../renderer/App';
import Nav from '../renderer/Nav';
import DataEntry from '../renderer/routes/data-entry';
import DataReports from '../renderer/routes/data-reports';
import FieldForms from '../renderer/routes/field-forms';

describe('Nav', () => {
  const leftClick = { button: 0 };

  it('should render', () => {
    expect(render(<Nav />, { wrapper: MemoryRouter })).toBeTruthy();
  });

  it('should switch to Data Entry', () => {
    render(<App />, { wrapper: MemoryRouter });

    userEvent.click(screen.getByText(/data entry/i), leftClick);

    expect(render(<DataEntry />, { wrapper: MemoryRouter })).toBeTruthy();
  });

  it('should switch to Data Reports', () => {
    render(<App />, { wrapper: MemoryRouter });

    userEvent.click(screen.getByText(/data reports/i), leftClick);

    expect(render(<DataReports />, { wrapper: MemoryRouter })).toBeTruthy();
  });

  it('should switch to Field Forms', () => {
    render(<App />, { wrapper: MemoryRouter });

    userEvent.click(screen.getByText(/field forms/i), leftClick);

    expect(render(<FieldForms />, { wrapper: MemoryRouter })).toBeTruthy();
  });
});
