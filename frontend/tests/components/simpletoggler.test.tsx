import React from 'react';
import {render, screen} from '@testing-library/react';
import '@testing-library/jest-dom';
import {SimpleToggler} from '@/components/sidebar';

describe('SimpleToggler', () => {
  const mockRenderToggle = <button>Toggle</button>;

  it('renders children when open', () => {
    render(
      <SimpleToggler isOpen={true} renderToggle={mockRenderToggle}>
        <div data-testid="child">Child</div>
      </SimpleToggler>
    );
    const childElement = screen.getByTestId('child');
    expect(childElement).toBeInTheDocument();
  });

  it('does not render children when closed', () => {
    render(
      <SimpleToggler isOpen={false} renderToggle={mockRenderToggle}>
        <div data-testid="child">Child</div>
      </SimpleToggler>
    );
    expect(screen.queryByTestId('child')).toBeNull();
  });

it('renders the toggle button', () => {
render(<SimpleToggler isOpen={false} renderToggle={mockRenderToggle}>
<div>Toggle</div>
</SimpleToggler>);
const toggleButton = screen.getByText('Toggle');
expect(toggleButton).toBeInTheDocument();
});

  it('applies correct styles when open', () => {
    render(
      <SimpleToggler isOpen={true} renderToggle={mockRenderToggle}>
        <div data-testid="child">Child</div>
      </SimpleToggler>
    );
    const childElement = screen.getByTestId('child');
    expect(childElement.parentElement).toHaveStyle({
      display: 'grid',
      gridTemplateRows: '1fr',
      transition: '0.2s ease',
    });
  });

  it('applies correct styles when closed', () => {
    render(
      <SimpleToggler isOpen={false} renderToggle={mockRenderToggle}>
        <div data-testid="child">Child</div>
      </SimpleToggler>
    );
    const childElement = screen.queryByTestId('child');
    expect(childElement?.parentElement).toHaveStyle({
      display: 'grid',
      gridTemplateRows: '0fr',
      transition: '0.2s ease',
    });
  });
});
