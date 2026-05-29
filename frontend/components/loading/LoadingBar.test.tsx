import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { LoadingBar } from './LoadingBar';

describe('LoadingBar', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('renders nothing when inactive', () => {
    render(<LoadingBar active={false} />);
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  it('renders nothing before the 150ms debounce elapses', () => {
    render(<LoadingBar active={true} />);
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(screen.queryByRole('progressbar')).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('renders the progress bar after 150ms with a default sr-only label', () => {
    render(<LoadingBar active={true} />);
    act(() => {
      vi.advanceTimersByTime(160);
    });
    expect(screen.getByRole('progressbar')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Refreshing data');
  });

  it('cancels the pending render if active flips false before 150ms', () => {
    const { rerender } = render(<LoadingBar active={true} />);
    act(() => {
      vi.advanceTimersByTime(100);
    });
    rerender(<LoadingBar active={false} />);
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  it('unmounts the bar immediately when active goes false after rendering', () => {
    const { rerender } = render(<LoadingBar active={true} />);
    act(() => {
      vi.advanceTimersByTime(160);
    });
    expect(screen.getByRole('progressbar')).toBeInTheDocument();
    rerender(<LoadingBar active={false} />);
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  it('honors a custom label', () => {
    render(<LoadingBar active={true} label="Loading species" />);
    act(() => {
      vi.advanceTimersByTime(160);
    });
    expect(screen.getByRole('status')).toHaveTextContent('Loading species');
  });
});
