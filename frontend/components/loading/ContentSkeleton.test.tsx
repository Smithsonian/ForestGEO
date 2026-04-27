import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ContentSkeleton } from './ContentSkeleton';

describe('ContentSkeleton', () => {
  it('grid-rows renders N row placeholders inside an aria-busy container', () => {
    const { container } = render(<ContentSkeleton kind="grid-rows" count={5} />);
    const root = container.firstChild as HTMLElement;
    expect(root).toHaveAttribute('aria-busy', 'true');
    expect(container.querySelectorAll('[data-testid="skeleton-grid-row"]')).toHaveLength(5);
  });

  it('grid-rows defaults count to 8', () => {
    const { container } = render(<ContentSkeleton kind="grid-rows" />);
    expect(container.querySelectorAll('[data-testid="skeleton-grid-row"]')).toHaveLength(8);
  });

  it('grid-rows row placeholders are aria-hidden so screen readers do not announce them as content', () => {
    const { container } = render(<ContentSkeleton kind="grid-rows" count={2} />);
    const rows = container.querySelectorAll('[data-testid="skeleton-grid-row"]');
    rows.forEach(r => expect(r).toHaveAttribute('aria-hidden', 'true'));
  });

  it('dashboard-card renders a single card with the shimmer test id', () => {
    render(<ContentSkeleton kind="dashboard-card" />);
    const card = screen.getByTestId('skeleton-dashboard-card');
    expect(card).toHaveAttribute('aria-busy', 'true');
  });

  it('autocomplete renders a disabled input', () => {
    render(<ContentSkeleton kind="autocomplete" />);
    const input = screen.getByTestId('skeleton-autocomplete-input');
    // MUI Joy Input wraps the underlying <input>; the disabled attribute lands on the inner element.
    const inner = input.querySelector('input') ?? input;
    expect(inner).toBeDisabled();
  });

  it('form-row renders a single row skeleton', () => {
    render(<ContentSkeleton kind="form-row" />);
    expect(screen.getByTestId('skeleton-form-row')).toBeInTheDocument();
  });
});
