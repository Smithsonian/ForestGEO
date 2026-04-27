import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

const preloadSpy = vi.fn();
vi.mock('@/lib/query/preload', () => ({
  preloadKey: (...args: unknown[]) => preloadSpy(...args)
}));

vi.mock('next/link', () => ({
  default: ({ children, ...p }: { children: React.ReactNode; [k: string]: unknown }) => (
    <a {...(p as Record<string, unknown>)}>{children}</a>
  )
}));

import { PrefetchLink } from './PrefetchLink';
import { queryKey } from '@/lib/query/queryKey';

describe('PrefetchLink', () => {
  beforeEach(() => preloadSpy.mockReset());

  it('preloads on mouseenter when prefetchKey + prefetchURL provided', () => {
    render(
      <PrefetchLink href="/x" prefetchKey={queryKey('grid:measurements', { siteSchema: 's' })} prefetchURL="/api/x">
        go
      </PrefetchLink>
    );
    fireEvent.mouseEnter(screen.getByText('go'));
    expect(preloadSpy).toHaveBeenCalledTimes(1);
  });

  it('preloads on focus', () => {
    render(
      <PrefetchLink href="/x" prefetchKey={queryKey('grid:measurements', { siteSchema: 's' })} prefetchURL="/api/x">
        go
      </PrefetchLink>
    );
    fireEvent.focus(screen.getByText('go'));
    expect(preloadSpy).toHaveBeenCalledTimes(1);
  });

  it('is a no-op when prefetchKey is omitted', () => {
    render(<PrefetchLink href="/x">go</PrefetchLink>);
    fireEvent.mouseEnter(screen.getByText('go'));
    fireEvent.focus(screen.getByText('go'));
    expect(preloadSpy).not.toHaveBeenCalled();
  });

  it('is a no-op when only prefetchURL is provided without prefetchKey', () => {
    render(<PrefetchLink href="/x" prefetchURL="/api/x">go</PrefetchLink>);
    fireEvent.mouseEnter(screen.getByText('go'));
    expect(preloadSpy).not.toHaveBeenCalled();
  });
});
