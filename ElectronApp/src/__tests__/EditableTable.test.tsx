import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import '@testing-library/jest-dom';

import App from '../renderer/App';

describe('Editable Table', () => {
  const leftClick = { button: 0 };

  it('should be in document', () => {
    render(<App />, { wrapper: MemoryRouter });

    userEvent.click(screen.getByText(/data entry/i), leftClick);

    expect(screen.getByText(/tree tag/i)).toBeInTheDocument();
  });
});
