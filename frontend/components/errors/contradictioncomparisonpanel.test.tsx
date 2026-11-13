import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { DETAILS_SHEET_TEXT, EDIT_LOCK_TOOLTIPS, type ErrorExplorerRow, type RelatedContradictionRow } from '@/config/errorsexplorer';
import ContradictionComparisonPanel from './contradictioncomparisonpanel';

const SELECTED = {
  coreMeasurementID: 302,
  treeTag: 'SB-1',
  stemTag: '1',
  speciesCode: 'BBB',
  quadratName: 'Q1',
  measurementDate: '2024-06-01',
  measuredDBH: 10,
  measuredHOM: 1.3,
  stemLocalX: 1,
  stemLocalY: 2,
  hasContradiction: true,
  contradictionType: 'same_batch_conflict',
  contradictionTypes: ['same_batch_conflict'],
  errorMessages: ['Same-batch species conflict'],
  errorCount: 1
} as unknown as ErrorExplorerRow;
const OUTSIDE: RelatedContradictionRow = {
  ...SELECTED,
  coreMeasurementID: 301,
  speciesCode: 'AAA',
  errorCount: 0,
  errorMessages: [],
  inErrorSet: false
} as RelatedContradictionRow;
const INSIDE: RelatedContradictionRow = { ...OUTSIDE, coreMeasurementID: 303, errorCount: 1, errorMessages: ['Same-batch species conflict'], inErrorSet: true };

describe('ContradictionComparisonPanel', () => {
  it('is titled for comparison and counts the differing fields', () => {
    render(<ContradictionComparisonPanel selectedRow={SELECTED} relatedRows={[OUTSIDE]} onInspectRow={vi.fn()} />);
    expect(screen.getByText(DETAILS_SHEET_TEXT.compareTitle)).toBeInTheDocument();
    console.log('[view-errors compare]', screen.getByTestId('comparison-differing-fields').textContent);
    expect(screen.getByTestId('comparison-differing-fields')).toHaveTextContent(/^1 of \d+ fields differ$/);
  });

  it('shows a row outside the error set without errors and without inspect', () => {
    render(<ContradictionComparisonPanel selectedRow={SELECTED} relatedRows={[OUTSIDE]} onInspectRow={vi.fn()} canInspectRow={row => row.inErrorSet} />);
    expect(screen.getByText(DETAILS_SHEET_TEXT.noUnresolvedErrors)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: DETAILS_SHEET_TEXT.inspectRow })).toBeNull();
  });

  it('inspects a row in the error set, and shows the lock reason when inspect is locked', async () => {
    const onInspectRow = vi.fn();
    const { rerender } = render(<ContradictionComparisonPanel selectedRow={SELECTED} relatedRows={[INSIDE]} onInspectRow={onInspectRow} />);
    await userEvent.click(screen.getByRole('button', { name: DETAILS_SHEET_TEXT.inspectRow }));
    expect(onInspectRow).toHaveBeenCalledWith(303);
    rerender(
      <ContradictionComparisonPanel
        selectedRow={SELECTED}
        relatedRows={[INSIDE]}
        onInspectRow={onInspectRow}
        inspectDisabledReason={EDIT_LOCK_TOOLTIPS.editing}
      />
    );
    expect(screen.getByRole('button', { name: DETAILS_SHEET_TEXT.inspectRow })).toBeDisabled();
  });
});
