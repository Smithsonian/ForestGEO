import React from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import {
  EDIT_LOCK_TOOLTIPS,
  MAX_ERROR_EXPLORER_QUICK_SEARCH_LENGTH,
  SHOW_INGESTION_TOOLTIP,
  VIEW_ERRORS_TEXT,
  type ErrorCensusTotals
} from '@/config/errorsexplorer';
import ErrorsExplorerToolbar, { type ErrorsExplorerToolbarProps } from './errorsexplorertoolbar';

const TOTALS = { affectedMeasurements: 21, validation: 12, ingestion: 9, contradictions: 3 } as ErrorCensusTotals;

function renderToolbar(overrides: Partial<ErrorsExplorerToolbarProps> = {}) {
  const props: ErrorsExplorerToolbarProps = {
    showValue: 'all',
    onShowChange: vi.fn(),
    totals: TOTALS,
    totalsLoading: false,
    quickSearch: '',
    onQuickSearchChange: vi.fn(),
    groupMode: 'byType',
    onGroupModeChange: vi.fn(),
    lockReason: null,
    ...overrides
  };
  render(<ErrorsExplorerToolbar {...props} />);
  return props;
}

describe('ErrorsExplorerToolbar', () => {
  it('offers the four Show options with census counts and maps a click to its value', async () => {
    const props = renderToolbar();
    const show = screen.getByRole('group', { name: VIEW_ERRORS_TEXT.showLabel });
    const labels = within(show)
      .getAllByRole('button')
      .map(button => button.textContent);
    console.log('[view-errors toolbar show]', JSON.stringify(labels));
    expect(labels).toEqual(['All · 21', 'Validation · 12', 'Ingestion · 9', 'Contradictions · 3']);
    await userEvent.click(within(show).getByRole('button', { name: /^Validation/ }));
    expect(props.onShowChange).toHaveBeenCalledWith('validation');
  });

  it('explains the Ingestion count in its tooltip (D-d)', async () => {
    renderToolbar();
    await userEvent.hover(screen.getByRole('button', { name: /^Ingestion/ }));
    expect(await screen.findByRole('tooltip')).toHaveTextContent(SHOW_INGESTION_TOOLTIP);
  });

  it('shows "—" for unavailable counts and a spinner while loading', () => {
    renderToolbar({ totals: null });
    expect(screen.getByRole('button', { name: /^All/ })).toHaveTextContent(`All · ${VIEW_ERRORS_TEXT.unavailable}`);
  });

  it('bounds Search and reports typing', async () => {
    const props = renderToolbar();
    const search = screen.getByRole('textbox', { name: VIEW_ERRORS_TEXT.searchLabel });
    expect(search).toHaveAttribute('maxlength', String(MAX_ERROR_EXPLORER_QUICK_SEARCH_LENGTH));
    expect(search).toHaveAttribute('placeholder', VIEW_ERRORS_TEXT.searchPlaceholder);
    await userEvent.type(search, 'T');
    expect(props.onQuickSearchChange).toHaveBeenCalledWith('T');
  });

  it('disables Show, Search and Group rows with the lock tooltip (D-g)', async () => {
    renderToolbar({ lockReason: EDIT_LOCK_TOOLTIPS.editing });
    for (const button of within(screen.getByRole('group', { name: VIEW_ERRORS_TEXT.showLabel })).getAllByRole('button')) expect(button).toBeDisabled();
    expect(screen.getByRole('textbox', { name: VIEW_ERRORS_TEXT.searchLabel })).toBeDisabled();
    expect(screen.getByRole('combobox', { name: VIEW_ERRORS_TEXT.groupRowsLabel })).toBeDisabled();
    await userEvent.hover(screen.getByTestId('errors-toolbar-show-lock'));
    expect(await screen.findByRole('tooltip')).toHaveTextContent(EDIT_LOCK_TOOLTIPS.editing);
  });
});
