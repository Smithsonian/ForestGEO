import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent, { PointerEventsCheckLevel } from '@testing-library/user-event';
import CensusDatesModal from './censusdatesmodal';
import { CENSUS_END_BEFORE_START_MESSAGE, CENSUS_START_DATE_REQUIRED_MESSAGE } from '@/config/censuswindow';

// Joy appends a required-field asterisk to the start label, so match its prefix.
const START_LABEL = /^Start date/;
const END_LABEL = 'End date (optional)';
const SAVE_BUTTON = 'Save Dates';
const CANCEL_BUTTON = 'Cancel';
const SAVE_ERROR = 'Failed to save the census dates. Please try again.';

function renderModal(overrides: Partial<React.ComponentProps<typeof CensusDatesModal>> = {}) {
  const onSave = vi.fn();
  const onClose = vi.fn();
  render(
    <CensusDatesModal
      open
      censusNumber={3}
      initialStartDate="2024-01-01"
      initialEndDate="2024-12-31"
      isSaving={false}
      errorMessage={null}
      onClose={onClose}
      onSave={onSave}
      {...overrides}
    />
  );
  return { onSave, onClose };
}

function dateInput(label: string | RegExp): HTMLInputElement {
  return screen.getByLabelText(label) as HTMLInputElement;
}

describe('CensusDatesModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('opens prefilled with the census window and names the census', () => {
    renderModal();
    console.log(`[census dates modal] start="${dateInput(START_LABEL).value}" end="${dateInput(END_LABEL).value}"`);
    expect(screen.getByText('Edit Census 3 Dates')).toBeInTheDocument();
    expect(dateInput(START_LABEL).value).toBe('2024-01-01');
    expect(dateInput(END_LABEL).value).toBe('2024-12-31');
  });

  it('shows an empty end date for an open-ended census', () => {
    renderModal({ initialEndDate: null });
    expect(dateInput(END_LABEL).value).toBe('');
  });

  it('saves the edited days as YYYY-MM-DD strings', async () => {
    const user = userEvent.setup();
    const { onSave } = renderModal();
    fireEvent.change(dateInput(START_LABEL), { target: { value: '2024-02-01' } });
    fireEvent.change(dateInput(END_LABEL), { target: { value: '2025-01-31' } });
    await user.click(screen.getByRole('button', { name: SAVE_BUTTON }));
    console.log(`[census dates modal] onSave calls: ${JSON.stringify(onSave.mock.calls)}`);
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith({ startDate: '2024-02-01', endDate: '2025-01-31' });
  });

  it('sends a cleared end date as null', async () => {
    const user = userEvent.setup();
    const { onSave } = renderModal();
    fireEvent.change(dateInput(END_LABEL), { target: { value: '' } });
    await user.click(screen.getByRole('button', { name: SAVE_BUTTON }));
    expect(onSave).toHaveBeenCalledWith({ startDate: '2024-01-01', endDate: null });
  });

  it('blocks saving an end date before the start date and says why', async () => {
    // Joy gives a disabled button pointer-events: none; force the click so the test proves it does nothing.
    const user = userEvent.setup({ pointerEventsCheck: PointerEventsCheckLevel.Never });
    const { onSave } = renderModal();
    fireEvent.change(dateInput(END_LABEL), { target: { value: '2023-12-31' } });
    expect(screen.getByText(CENSUS_END_BEFORE_START_MESSAGE)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: SAVE_BUTTON })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: SAVE_BUTTON }));
    expect(onSave).not.toHaveBeenCalled();
  });

  it('blocks saving without a start date and says why', () => {
    renderModal();
    fireEvent.change(dateInput(START_LABEL), { target: { value: '' } });
    expect(screen.getByText(CENSUS_START_DATE_REQUIRED_MESSAGE)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: SAVE_BUTTON })).toBeDisabled();
  });

  it('shows the save error it is given', () => {
    renderModal({ errorMessage: SAVE_ERROR });
    expect(screen.getByText(SAVE_ERROR)).toBeInTheDocument();
  });

  it('locks the form and cannot be dismissed while saving', async () => {
    const user = userEvent.setup();
    const { onClose } = renderModal({ isSaving: true });
    expect(dateInput(START_LABEL)).toBeDisabled();
    expect(dateInput(END_LABEL)).toBeDisabled();
    expect(screen.getByRole('button', { name: CANCEL_BUTTON })).toBeDisabled();
    await user.keyboard('{Escape}');
    expect(onClose).not.toHaveBeenCalled();
  });
});
