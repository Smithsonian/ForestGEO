import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import RebuildViewFullTableModal from './rebuildviewfulltablemodal';

vi.mock('@/ailogger', () => ({ default: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));

const SCHEMA = 'forestgeo_test';
const REBUILD_ENDPOINT = `/api/export/ctfs-rebuild-view/${SCHEMA}`;
const DOWNLOAD_BUTTON_NAME = /download rebuild artifact/i;
const CLOSE_BUTTON_NAME = /^close$/i;
const DIALOG_TITLE = 'Rebuild ViewFullTable';
const SERVER_ERROR_MESSAGE = 'Destination schema is not configured';
const HTTP_OK = 200;
const HTTP_SERVER_ERROR = 500;

describe('RebuildViewFullTableModal', () => {
  beforeEach(() => {
    URL.createObjectURL = vi.fn(() => 'blob:mock') as unknown as typeof URL.createObjectURL;
    URL.revokeObjectURL = vi.fn() as unknown as typeof URL.revokeObjectURL;
    global.fetch = vi.fn() as unknown as typeof fetch;
  });
  afterEach(() => {
    vi.restoreAllMocks();
    cleanup();
  });

  it('renders nothing while closed', () => {
    render(<RebuildViewFullTableModal schema={SCHEMA} open={false} onClose={vi.fn()} />);
    expect(screen.queryByText(DIALOG_TITLE)).toBeNull();
  });

  it('downloads the rebuild artifact from the schema-scoped endpoint', async () => {
    vi.mocked(global.fetch).mockResolvedValue(
      new Response(new Blob(['-- rebuild --']), {
        status: HTTP_OK,
        headers: { 'Content-Disposition': 'attachment; filename=smithsonian-rebuild-viewfulltable-123.sql' }
      })
    );
    render(<RebuildViewFullTableModal schema={SCHEMA} open onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: DOWNLOAD_BUTTON_NAME }));
    await waitFor(() => expect(URL.createObjectURL).toHaveBeenCalled());
    const requestedUrl = String(vi.mocked(global.fetch).mock.calls[0][0]);
    console.log(`[option A rebuild] requested ${requestedUrl}`);
    expect(requestedUrl).toBe(REBUILD_ENDPOINT);
  });

  it("shows the server's error text when the endpoint refuses", async () => {
    vi.mocked(global.fetch).mockResolvedValue(new Response(JSON.stringify({ error: SERVER_ERROR_MESSAGE }), { status: HTTP_SERVER_ERROR }));
    render(<RebuildViewFullTableModal schema={SCHEMA} open onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: DOWNLOAD_BUTTON_NAME }));
    expect(await screen.findByText(SERVER_ERROR_MESSAGE)).toBeInTheDocument();
  });

  it('calls onClose and forgets the previous error, so reopening starts clean', async () => {
    const onClose = vi.fn();
    vi.mocked(global.fetch).mockResolvedValue(new Response(JSON.stringify({ error: SERVER_ERROR_MESSAGE }), { status: HTTP_SERVER_ERROR }));
    const { rerender } = render(<RebuildViewFullTableModal schema={SCHEMA} open onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: DOWNLOAD_BUTTON_NAME }));
    await screen.findByText(SERVER_ERROR_MESSAGE);

    fireEvent.click(screen.getByRole('button', { name: CLOSE_BUTTON_NAME }));
    expect(onClose).toHaveBeenCalledTimes(1);

    rerender(<RebuildViewFullTableModal schema={SCHEMA} open={false} onClose={onClose} />);
    rerender(<RebuildViewFullTableModal schema={SCHEMA} open onClose={onClose} />);
    expect(screen.queryByText(SERVER_ERROR_MESSAGE)).toBeNull();
  });

  it('ignores a close while the download is still pending', async () => {
    const onClose = vi.fn();
    vi.mocked(global.fetch).mockReturnValue(new Promise<Response>(() => {}));
    render(<RebuildViewFullTableModal schema={SCHEMA} open onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: DOWNLOAD_BUTTON_NAME }));
    await waitFor(() => expect(screen.getByRole('button', { name: CLOSE_BUTTON_NAME })).toBeDisabled());
    expect(onClose).not.toHaveBeenCalled();
  });
});
