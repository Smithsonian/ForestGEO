/**
 * Unit tests for PublishCensusButton.
 *
 * The button is the operator-facing surface for /api/export/ctfs-sql.
 * Tests use fetch mocks rather than spinning up a real route so the
 * UI behavior is exercised in isolation.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';
import PublishCensusButton from './publishcensusbutton';

vi.mock('@/ailogger', () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn() }
}));

const SCHEMA = 'forestgeo_test';
const APP_PLOT_ID = 7;
const APP_CENSUS_ID = 42;
const PLOT_CENSUS_NUMBER = '2024';

interface RenderOpts {
  canReload?: boolean;
  disabled?: boolean;
}

function renderButton(opts: RenderOpts = {}) {
  return render(
    <PublishCensusButton
      schema={SCHEMA}
      appPlotId={APP_PLOT_ID}
      appCensusId={APP_CENSUS_ID}
      plotCensusNumber={PLOT_CENSUS_NUMBER}
      canReload={opts.canReload ?? false}
      disabled={opts.disabled}
    />
  );
}

describe('PublishCensusButton', () => {
  let originalCreateObjectURL: typeof URL.createObjectURL;
  let originalRevokeObjectURL: typeof URL.revokeObjectURL;
  let createObjectUrlSpy: ReturnType<typeof vi.fn>;
  let revokeObjectUrlSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    originalCreateObjectURL = URL.createObjectURL;
    originalRevokeObjectURL = URL.revokeObjectURL;
    createObjectUrlSpy = vi.fn(() => 'blob:mock');
    revokeObjectUrlSpy = vi.fn();
    URL.createObjectURL = createObjectUrlSpy as any;
    URL.revokeObjectURL = revokeObjectUrlSpy as any;
    global.fetch = vi.fn() as any;
  });

  afterEach(() => {
    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
    vi.restoreAllMocks();
    cleanup();
  });

  it('renders a button labeled "Publish census"', () => {
    renderButton();
    expect(screen.getByRole('button', { name: /publish census/i })).toBeTruthy();
  });

  it('opens the dialog and shows context for the current census', async () => {
    renderButton();
    fireEvent.click(screen.getByRole('button', { name: /publish census/i }));
    expect(await screen.findByText(/Publish census to CTFS/i)).toBeTruthy();
    expect(screen.getByText(SCHEMA)).toBeTruthy();
    expect(screen.getByText(String(APP_PLOT_ID))).toBeTruthy();
    expect(screen.getByText(String(APP_CENSUS_ID))).toBeTruthy();
  });

  it('defaults destinationPlotID to "1" (most CTFS sites use 1)', async () => {
    renderButton();
    fireEvent.click(screen.getByRole('button', { name: /publish census/i }));
    const input = (await screen.findByPlaceholderText('1')) as HTMLInputElement;
    expect(input.value).toBe('1');
  });

  it('hides reload checkboxes when canReload is false', async () => {
    renderButton({ canReload: false });
    fireEvent.click(screen.getByRole('button', { name: /publish census/i }));
    await screen.findByText(/Publish census to CTFS/i);
    expect(screen.queryByLabelText(/Allow reload/i)).toBeNull();
    expect(screen.queryByLabelText(/Dry run/i)).toBeNull();
  });

  it('shows reload checkboxes when canReload is true', async () => {
    renderButton({ canReload: true });
    fireEvent.click(screen.getByRole('button', { name: /publish census/i }));
    await screen.findByText(/Publish census to CTFS/i);
    expect(screen.getByLabelText(/Allow reload/i)).toBeTruthy();
    expect(screen.getByLabelText(/Dry run/i)).toBeTruthy();
  });

  it('issues GET /api/export/ctfs-sql/... with destinationPlotID query param', async () => {
    const blob = new Blob(['-- generated sql --'], { type: 'application/sql' });
    (global.fetch as any).mockResolvedValue(
      new Response(blob, {
        status: 200,
        headers: { 'Content-Disposition': 'attachment; filename=ctfs-export-1-2024-12345.sql' }
      })
    );

    renderButton();
    fireEvent.click(screen.getByRole('button', { name: /publish census/i }));
    fireEvent.click(await screen.findByRole('button', { name: /Download SQL artifact/i }));

    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    const url = (global.fetch as any).mock.calls[0][0] as string;
    expect(url).toContain(`/api/export/ctfs-sql/${SCHEMA}/${APP_PLOT_ID}/${APP_CENSUS_ID}`);
    expect(url).toContain('destinationPlotID=1');
    expect(url).not.toContain('allowReload=');
    expect(url).not.toContain('reloadDryRun=');
  });

  it('appends allowReload=true to the URL when the operator opts in and has permission', async () => {
    (global.fetch as any).mockResolvedValue(
      new Response(new Blob(['-- sql --']), { status: 200, headers: { 'Content-Disposition': 'attachment; filename=x.sql' } })
    );
    renderButton({ canReload: true });
    fireEvent.click(screen.getByRole('button', { name: /publish census/i }));
    fireEvent.click(await screen.findByLabelText(/Allow reload/i));
    fireEvent.click(screen.getByRole('button', { name: /Download SQL artifact/i }));

    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    const url = (global.fetch as any).mock.calls[0][0] as string;
    expect(url).toContain('allowReload=true');
  });

  it('renders precondition failure reasons including CoreMeasurementID lists', async () => {
    const errorBody = {
      error: 'Census is not finished',
      reasons: [
        { kind: 'not-validated', message: '2 rows not yet validated', coreMeasurementIds: [10, 11] },
        { kind: 'no-stem-guid', message: '1 row lacks StemGUID', coreMeasurementIds: [50] }
      ]
    };
    (global.fetch as any).mockResolvedValue(new Response(JSON.stringify(errorBody), { status: 400, headers: { 'Content-Type': 'application/json' } }));

    renderButton();
    fireEvent.click(screen.getByRole('button', { name: /publish census/i }));
    fireEvent.click(await screen.findByRole('button', { name: /Download SQL artifact/i }));

    await screen.findByText(/Census is not finished/i);
    expect(screen.getByText(/not-validated/)).toBeTruthy();
    expect(screen.getByText(/no-stem-guid/)).toBeTruthy();
    expect(screen.getByText(/CoreMeasurementIDs: 10, 11/)).toBeTruthy();
    expect(screen.getByText(/CoreMeasurementIDs: 50/)).toBeTruthy();
  });

  it('rejects a non-numeric destination plot id without calling fetch', async () => {
    renderButton();
    fireEvent.click(screen.getByRole('button', { name: /publish census/i }));
    const input = (await screen.findByPlaceholderText('1')) as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'abc' } });
    fireEvent.click(screen.getByRole('button', { name: /Download SQL artifact/i }));

    await screen.findByText(/non-negative integer/i);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('triggers a blob download via a synthesized anchor on success', async () => {
    (global.fetch as any).mockResolvedValue(
      new Response(new Blob(['-- sql --']), {
        status: 200,
        headers: { 'Content-Disposition': 'attachment; filename=download.sql' }
      })
    );

    renderButton();
    fireEvent.click(screen.getByRole('button', { name: /publish census/i }));
    fireEvent.click(await screen.findByRole('button', { name: /Download SQL artifact/i }));

    await waitFor(() => expect(createObjectUrlSpy).toHaveBeenCalled());
    expect(revokeObjectUrlSpy).toHaveBeenCalledWith('blob:mock');
    expect(await screen.findByText(/Artifact downloaded/i)).toBeTruthy();
  });
});
