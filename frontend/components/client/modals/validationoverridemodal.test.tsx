import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ValidationOverrideModal from './validationoverridemodal';

vi.mock('@/app/contexts/compat-hooks', () => ({
  useSiteContext: () => ({ schemaName: 'forestgeo_testing' }),
  usePlotContext: () => ({ plotID: 7 }),
  // The grid selects the newest date range, not the logical census number or
  // the first ID in the unsorted censusIDs list.
  useOrgCensusContext: () => ({ plotCensusNumber: 2, censusIDs: [11, 19], dateRanges: [{ censusID: 19 }, { censusID: 11 }] })
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it('sends one override request for the census selected by the measurement grid', async () => {
  const fetch = vi.fn().mockResolvedValue({ ok: true });
  vi.stubGlobal('fetch', fetch);
  const user = userEvent.setup();
  render(<ValidationOverrideModal isValidationOverrideModalOpen handleValidationOverrideModalClose={vi.fn().mockResolvedValue(undefined)} />);
  await user.click(screen.getByRole('button', { name: 'Confirm' }));
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
  expect(fetch).toHaveBeenCalledWith('/api/validations/override', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ schema: 'forestgeo_testing', plotID: 7, censusID: 19 })
  });
});

it('shows a failed override without reporting success or sending follow-up writes', async () => {
  const fetch = vi.fn().mockResolvedValue({ ok: false, status: 409 });
  vi.stubGlobal('fetch', fetch);
  const close = vi.fn().mockResolvedValue(undefined);
  const user = userEvent.setup();
  render(<ValidationOverrideModal isValidationOverrideModalOpen handleValidationOverrideModalClose={close} />);
  await user.click(screen.getByRole('button', { name: 'Confirm' }));
  expect(await screen.findByText(/Override could not be confirmed/)).toBeInTheDocument();
  expect(close).not.toHaveBeenCalled();
  expect(fetch).toHaveBeenCalledTimes(1);
});
