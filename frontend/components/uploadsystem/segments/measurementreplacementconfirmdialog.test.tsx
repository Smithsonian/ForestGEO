import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import MeasurementReplacementConfirmDialog from './measurementreplacementconfirmdialog';

function renderDialog(overrides: Partial<Parameters<typeof MeasurementReplacementConfirmDialog>[0]> = {}) {
  const onCancel = vi.fn();
  const onConfirm = vi.fn();
  render(<MeasurementReplacementConfirmDialog open censusLabel="Census 3" existingRowCount={20} onCancel={onCancel} onConfirm={onConfirm} {...overrides} />);
  return { onCancel, onConfirm };
}

describe('MeasurementReplacementConfirmDialog (issue #504)', () => {
  it('names the census and the existing row count with honest deletion wording', () => {
    renderDialog({ censusLabel: 'Census 3', existingRowCount: 20 });

    expect(screen.getByText('Confirm measurement replacement')).toBeInTheDocument();
    expect(screen.getByText(/Census 3/)).toBeInTheDocument();
    expect(screen.getByText('20')).toBeInTheDocument();
    expect(screen.getByText(/permanently delete all of them/i)).toBeInTheDocument();
  });

  it('keeps Confirm disabled until the exact phrase is typed', async () => {
    const user = userEvent.setup();
    const { onConfirm } = renderDialog({ existingRowCount: 20 });

    const confirmButton = screen.getByTestId('measurement-replacement-confirm');
    const input = screen.getByTestId('measurement-replacement-typed-confirm-input');

    expect(confirmButton).toBeDisabled();

    await user.type(input, 'DELETE 2');
    expect(confirmButton).toBeDisabled();

    await user.type(input, '0');
    expect(confirmButton).not.toBeDisabled();

    await user.click(confirmButton);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('does not accept a phrase with the wrong count', async () => {
    const user = userEvent.setup();
    renderDialog({ existingRowCount: 20 });

    const confirmButton = screen.getByTestId('measurement-replacement-confirm');
    const input = screen.getByTestId('measurement-replacement-typed-confirm-input');

    await user.type(input, 'DELETE 21');
    expect(confirmButton).toBeDisabled();
  });

  it('Cancel calls onCancel without ever calling onConfirm', async () => {
    const user = userEvent.setup();
    const { onCancel, onConfirm } = renderDialog();

    await user.click(screen.getByTestId('measurement-replacement-cancel'));

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('resets the typed text when a new existingRowCount is delivered (stale phrase cannot satisfy a new count)', () => {
    const onCancel = vi.fn();
    const onConfirm = vi.fn();
    const { rerender } = render(
      <MeasurementReplacementConfirmDialog open censusLabel="Census 3" existingRowCount={20} onCancel={onCancel} onConfirm={onConfirm} />
    );

    const input = screen.getByTestId('measurement-replacement-typed-confirm-input') as HTMLInputElement;
    input.focus();

    rerender(<MeasurementReplacementConfirmDialog open censusLabel="Census 3" existingRowCount={5} onCancel={onCancel} onConfirm={onConfirm} />);

    const confirmButton = screen.getByTestId('measurement-replacement-confirm');
    expect(confirmButton).toBeDisabled();
    expect(screen.getByTestId('measurement-replacement-typed-confirm-input')).toHaveValue('');
  });
});
