import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import ViewDataFilterBar, { type ViewDataFilterBarProps } from './viewdatafilterbar';
import { VIEW_DATA_TEXT, type ViewDataStateCounts } from '@/config/viewdata';
import { ERRORS_PAGE_PATH } from '@/config/errorsexplorer';

const COUNTS: ViewDataStateCounts = {
  unresolvedLogged: 7,
  failedNoLog: 2,
  pending: 30,
  valid: 61,
  overridable: 9,
  revalidatable: 4,
  firstMeasurementDate: null,
  lastMeasurementDate: null
};

function props(overrides: Partial<ViewDataFilterBarProps> = {}): ViewDataFilterBarProps {
  return {
    stateCounts: COUNTS,
    showOption: 'all',
    onShowOptionChange: vi.fn(),
    searchText: '',
    appliedSearchText: '',
    onSearchTextChange: vi.fn(),
    onSearchApply: vi.fn(),
    onSearchClear: vi.fn(),
    ...overrides
  };
}

describe('ViewDataFilterBar', () => {
  it('labels the Show group, shows census-total counts and marks the selected option pressed', async () => {
    const user = userEvent.setup();
    const p = props();
    render(<ViewDataFilterBar {...p} />);
    const group = screen.getByRole('group', { name: VIEW_DATA_TEXT.showLabel });
    const buttons = Array.from(group.querySelectorAll('button')).map(button => ({ text: button.textContent, pressed: button.getAttribute('aria-pressed') }));
    console.log('[filter bar] show buttons', JSON.stringify(buttons));
    expect(buttons).toEqual([
      { text: 'All 100', pressed: 'true' },
      { text: 'Passed 61', pressed: 'false' },
      { text: 'Pending 30', pressed: 'false' },
      { text: 'With errors 9', pressed: 'false' }
    ]);
    await user.click(screen.getByRole('button', { name: 'With errors 9' }));
    expect(p.onShowOptionChange).toHaveBeenCalledWith('withErrors');
    await user.click(screen.getByRole('button', { name: 'All 100' }));
    expect(p.onShowOptionChange).toHaveBeenCalledTimes(1);
  });

  it('shows labels without counts while counts load', () => {
    render(<ViewDataFilterBar {...props({ stateCounts: null })} />);
    expect(screen.getByRole('button', { name: 'All' })).toBeInTheDocument();
    expect(screen.queryByText(/ 0$/)).not.toBeInTheDocument();
  });

  it('labels Search, applies on Enter, clears, and hints until the text is applied', async () => {
    const user = userEvent.setup();
    const p = props({ searchText: '010203', appliedSearchText: '' });
    render(<ViewDataFilterBar {...p} />);
    const search = screen.getByRole('textbox', { name: VIEW_DATA_TEXT.searchLabel });
    expect(search).toHaveAttribute('placeholder', VIEW_DATA_TEXT.searchPlaceholder);
    expect(screen.getByText(VIEW_DATA_TEXT.searchApplyHint)).toBeInTheDocument();
    await user.type(search, '4');
    expect(p.onSearchTextChange).toHaveBeenLastCalledWith('0102034');
    await user.type(search, '{Enter}');
    expect(p.onSearchApply).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: VIEW_DATA_TEXT.clearSearch }));
    expect(p.onSearchClear).toHaveBeenCalledTimes(1);
  });

  it('hides the apply hint once the text is applied', () => {
    render(<ViewDataFilterBar {...props({ searchText: '010203', appliedSearchText: '010203' })} />);
    expect(screen.queryByText(VIEW_DATA_TEXT.searchApplyHint)).not.toBeInTheDocument();
  });

  it('shows the hint line and View Errors link only for With errors', () => {
    const { unmount } = render(<ViewDataFilterBar {...props()} />);
    expect(screen.queryByTestId('view-data-with-errors-hint')).not.toBeInTheDocument();
    unmount();
    render(<ViewDataFilterBar {...props({ showOption: 'withErrors' })} />);
    const hint = screen.getByTestId('view-data-with-errors-hint');
    console.log('[filter bar] hint', hint.textContent);
    expect(hint).toHaveTextContent(VIEW_DATA_TEXT.withErrorsHint(9));
    expect(screen.getByRole('link', { name: VIEW_DATA_TEXT.openViewErrors })).toHaveAttribute('href', ERRORS_PAGE_PATH);
  });
});
