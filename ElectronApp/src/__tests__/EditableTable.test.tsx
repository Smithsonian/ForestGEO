import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import '@testing-library/jest-dom';

import EditableTable from 'renderer/components/EditableTable';
import App from '../renderer/App';

describe('Editable Table', () => {
  const leftClick = { button: 0 };

  it('should switch to Data Entry', () => {
    render(<App />, { wrapper: MemoryRouter });

    userEvent.click(screen.getByText(/data entry/i), leftClick);

    expect(EditableTable).toBeInTheDocument();
  });
});
