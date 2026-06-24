import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import RebuildViewFullTableButton from './rebuildviewfulltablebutton';

vi.mock('@/ailogger', () => ({ default: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));

const SCHEMA = 'forestgeo_test';

describe('RebuildViewFullTableButton', () => {
  beforeEach(() => {
    URL.createObjectURL = vi.fn(() => 'blob:mock') as any;
    URL.revokeObjectURL = vi.fn() as any;
    global.fetch = vi.fn() as any;
  });
  afterEach(() => {
    vi.restoreAllMocks();
    cleanup();
  });

  it('renders a "Rebuild ViewFullTable" button', () => {
    render(<RebuildViewFullTableButton schema={SCHEMA} />);
    expect(screen.getByRole('button', { name: /rebuild viewfulltable/i })).toBeTruthy();
  });

  it('downloads the rebuild artifact from the schema-scoped endpoint on confirm', async () => {
    (global.fetch as any).mockResolvedValue(
      new Response(new Blob(['-- rebuild --']), {
        status: 200,
        headers: { 'Content-Disposition': 'attachment; filename=ctfs-rebuild-viewfulltable-123.sql' }
      })
    );
    render(<RebuildViewFullTableButton schema={SCHEMA} />);
    fireEvent.click(screen.getByRole('button', { name: /rebuild viewfulltable/i }));
    fireEvent.click(await screen.findByRole('button', { name: /download rebuild artifact/i }));
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    const url = (global.fetch as any).mock.calls[0][0] as string;
    expect(url).toBe(`/api/export/ctfs-rebuild-view/${SCHEMA}`);
  });

  it('surfaces an error message when the endpoint returns non-OK', async () => {
    (global.fetch as any).mockResolvedValue(
      new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403, headers: { 'Content-Type': 'application/json' } })
    );
    render(<RebuildViewFullTableButton schema={SCHEMA} />);
    fireEvent.click(screen.getByRole('button', { name: /rebuild viewfulltable/i }));
    fireEvent.click(await screen.findByRole('button', { name: /download rebuild artifact/i }));
    await waitFor(() => expect(screen.getByText(/forbidden/i)).toBeTruthy());
  });
});
