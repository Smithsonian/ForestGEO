import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { DataGrid, type GridFilterModel } from '@mui/x-data-grid';
import ViewDataGridToolbar, { nextViewDataDensity, type ViewDataGridToolbarSettings } from './viewdatagridtoolbar';
import { VIEW_DATA_TEXT } from '@/config/viewdata';

const CAPTION = VIEW_DATA_TEXT.captionEditor;
const GRID_SIZE = { width: 800, height: 320 };

function Harness({ settings, filterModel }: { settings?: ViewDataGridToolbarSettings; filterModel?: GridFilterModel }) {
  return (
    <div style={GRID_SIZE}>
      <DataGrid
        rows={[{ id: 1, treeTag: '010203' }]}
        columns={[{ field: 'treeTag', headerName: 'Tree Tag' }]}
        showToolbar
        slots={{ toolbar: ViewDataGridToolbar }}
        slotProps={{ toolbar: { viewDataToolbar: settings } }}
        filterModel={filterModel}
      />
    </div>
  );
}

function settings(overrides: Partial<ViewDataGridToolbarSettings> = {}): ViewDataGridToolbarSettings {
  return { density: 'standard', onCycleDensity: vi.fn(), hidingEmpty: true, onToggleHidingEmpty: vi.fn(), caption: CAPTION, ...overrides };
}

describe('ViewDataGridToolbar', () => {
  it('renders Columns, Filters, Density, Hide empty columns and the caption, and opens the columns panel', async () => {
    const user = userEvent.setup();
    render(<Harness settings={settings()} />);
    expect(screen.getByText(CAPTION)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: VIEW_DATA_TEXT.filtersButton })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: VIEW_DATA_TEXT.densityButton })).toHaveAttribute('data-density', 'standard');
    await user.click(screen.getByRole('button', { name: VIEW_DATA_TEXT.columnsButton }));
    expect(await screen.findByText('Show/Hide All')).toBeInTheDocument();
  });

  it('shows a filter count only while a filter is active', () => {
    const { unmount } = render(<Harness settings={settings()} filterModel={{ items: [] }} />);
    expect(screen.queryByTestId('view-data-filter-count')).not.toBeInTheDocument();
    unmount();
    render(<Harness settings={settings()} filterModel={{ items: [{ id: 1, field: 'treeTag', operator: 'contains', value: '01' }] }} />);
    console.log('[grid toolbar] filter count', screen.getByTestId('view-data-filter-count').textContent);
    expect(screen.getByTestId('view-data-filter-count')).toHaveTextContent('1');
  });

  it('cycles density and toggles hide-empty with aria-pressed', async () => {
    const user = userEvent.setup();
    const s = settings({ hidingEmpty: false });
    render(<Harness settings={s} />);
    await user.click(screen.getByRole('button', { name: VIEW_DATA_TEXT.densityButton }));
    const hide = screen.getByRole('button', { name: VIEW_DATA_TEXT.hideEmptyColumns });
    expect(hide).toHaveAttribute('aria-pressed', 'false');
    await user.click(hide);
    expect(s.onCycleDensity).toHaveBeenCalledTimes(1);
    expect(s.onToggleHidingEmpty).toHaveBeenCalledTimes(1);
    expect([nextViewDataDensity('standard'), nextViewDataDensity('compact'), nextViewDataDensity('comfortable')]).toEqual([
      'compact',
      'comfortable',
      'standard'
    ]);
  });

  it('renders nothing without settings', () => {
    render(<Harness />);
    expect(screen.queryByRole('button', { name: VIEW_DATA_TEXT.columnsButton })).not.toBeInTheDocument();
  });
});
