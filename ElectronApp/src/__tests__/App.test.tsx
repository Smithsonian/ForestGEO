import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import App from '../renderer/App';

test('full app rendering/navigating', () => {
  render(<App />, { wrapper: MemoryRouter });

  // verify access to route links
  expect(screen.getByRole('link', {name: /admin/i})).toBeInTheDocument();

  expect(screen.getByRole('link', {name: /form configuration/i})).toBeInTheDocument();

  expect(screen.getByRole('link', {name: /field forms/i})).toBeInTheDocument();

  expect(screen.getByRole('link', {name: /data entry/i})).toBeInTheDocument();

  expect(screen.getByRole('link', {name: /data reports/i})).toBeInTheDocument();

});
