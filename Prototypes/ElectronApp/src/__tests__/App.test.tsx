import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import '@testing-library/jest-dom';
import App from '../renderer/App';

describe('App', () => {
  it('should render', () => {
    expect(render(<App />, { wrapper: MemoryRouter })).toBeTruthy();
  });
});
