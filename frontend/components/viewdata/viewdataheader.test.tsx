import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import ViewDataHeader, { type ViewDataHeaderProps } from './viewdataheader';
import { VIEW_DATA_TEXT, type ViewDataStateCounts } from '@/config/viewdata';

const COUNTS: ViewDataStateCounts = {
  unresolvedLogged: 7,
  failedNoLog: 2,
  pending: 30,
  valid: 61,
  overridable: 9,
  revalidatable: 4,
  firstMeasurementDate: '2024-06-03',
  lastMeasurementDate: '2024-09-14'
};
const FAILED_UPLOADS = 12;

function renderHeader(overrides: Partial<ViewDataHeaderProps> = {}) {
  const props: ViewDataHeaderProps = {
    scopeLine: 'Luquillo · Luquillo Main Plot · Census 5',
    stateCounts: COUNTS,
    isReadOnly: false,
    showActions: true,
    failedUploadCount: FAILED_UPLOADS,
    canFixFailedUploads: true,
    onFixFailedUploads: vi.fn(),
    onExportCsv: vi.fn(),
    onRunValidations: vi.fn(),
    onOverrideValidations: vi.fn(),
    onResetValidations: vi.fn(),
    onRefreshView: vi.fn(),
    onOpenHeaderReference: vi.fn(),
    onManualEntry: vi.fn(),
    onUploadCsv: vi.fn(),
    onImportArcgis: vi.fn(),
    ...overrides
  };
  render(<ViewDataHeader {...props} />);
  return props;
}

describe('ViewDataHeader', () => {
  it('renders the scope line, the h1 and the facts line', () => {
    renderHeader();
    const observed = {
      scope: screen.getByTestId('view-data-scope-line').textContent,
      heading: screen.getByRole('heading', { level: 1 }).textContent,
      facts: screen.getByTestId('view-data-facts-line').textContent
    };
    console.log('[header]', JSON.stringify(observed));
    expect(observed).toEqual({
      scope: 'Luquillo · Luquillo Main Plot · Census 5',
      heading: 'View Data',
      facts: '100 active measurements · measured Jun 3 – Sep 14, 2024'
    });
  });

  it('appends the read-only line for pending users and never shows 0 before counts load', () => {
    const { unmount } = render(<ViewDataHeader {...renderProps({ isReadOnly: true })} />);
    expect(screen.getByTestId('view-data-facts-line')).toHaveTextContent(VIEW_DATA_TEXT.readOnly);
    unmount();
    render(<ViewDataHeader {...renderProps({ stateCounts: null })} />);
    expect(screen.queryByTestId('view-data-facts-line')).not.toBeInTheDocument();
    expect(screen.queryByText(/^0 active/)).not.toBeInTheDocument();
  });

  it('orders the header actions Fix, Export CSV, More actions, Add measurements', () => {
    renderHeader();
    const names = within(screen.getByTestId('view-data-header-actions'))
      .getAllByRole('button')
      .map(button => button.textContent?.trim());
    console.log('[header] action order', JSON.stringify(names));
    expect(names).toEqual([
      VIEW_DATA_TEXT.fixFailedUploads(FAILED_UPLOADS),
      VIEW_DATA_TEXT.exportCsv,
      VIEW_DATA_TEXT.moreActions,
      VIEW_DATA_TEXT.addMeasurements
    ]);
    expect(screen.getByRole('button', { name: VIEW_DATA_TEXT.exportCsv })).not.toHaveAttribute('aria-label');
  });

  it.each([[{ failedUploadCount: 0 }], [{ canFixFailedUploads: false }]])('hides Fix failed uploads for %j', overrides => {
    renderHeader(overrides);
    expect(screen.queryByRole('button', { name: /^Fix / })).not.toBeInTheDocument();
  });

  it('calls the Fix and Export handlers', async () => {
    const user = userEvent.setup();
    const props = renderHeader();
    await user.click(screen.getByRole('button', { name: VIEW_DATA_TEXT.fixFailedUploads(FAILED_UPLOADS) }));
    await user.click(screen.getByRole('button', { name: VIEW_DATA_TEXT.exportCsv }));
    expect(props.onFixFailedUploads).toHaveBeenCalledTimes(1);
    expect(props.onExportCsv).toHaveBeenCalledTimes(1);
  });

  it('lists the Validation and View groups with descriptions, and wires each enabled item', async () => {
    const user = userEvent.setup();
    const props = renderHeader();
    await user.click(screen.getByRole('button', { name: VIEW_DATA_TEXT.moreActions }));
    const items = screen.getAllByRole('menuitem').map(item => item.textContent);
    console.log('[header] more actions', JSON.stringify(items));
    expect(items).toEqual([
      'Run validationsValidate 30 pending rows',
      'Override validationsForce 9 eligible failed or not-yet-validated rows to pass',
      'Reset all validation statesClear all errors and set rows to pending',
      `${VIEW_DATA_TEXT.refreshView}${VIEW_DATA_TEXT.refreshViewDescription}`,
      `${VIEW_DATA_TEXT.headerReference}${VIEW_DATA_TEXT.headerReferenceDescription}`
    ]);
    await user.click(screen.getByRole('menuitem', { name: /Run validations/ }));
    expect(props.onRunValidations).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: VIEW_DATA_TEXT.moreActions }));
    await user.click(screen.getByRole('menuitem', { name: new RegExp(VIEW_DATA_TEXT.refreshView) }));
    expect(props.onRefreshView).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: VIEW_DATA_TEXT.moreActions }));
    await user.click(screen.getByRole('menuitem', { name: new RegExp(VIEW_DATA_TEXT.headerReference) }));
    expect(props.onOpenHeaderReference).toHaveBeenCalledTimes(1);
  });

  it('keeps a disabled validation item from calling its handler (ported gating)', async () => {
    const user = userEvent.setup();
    const props = renderHeader({ stateCounts: { ...COUNTS, pending: 0, revalidatable: 0, overridable: 4 } });
    await user.click(screen.getByRole('button', { name: VIEW_DATA_TEXT.moreActions }));
    const run = screen.getByRole('menuitem', { name: /Run validations/ });
    expect(run).toHaveAttribute('aria-disabled', 'true');
    expect(run).toHaveTextContent('No rows to validate');
    fireEvent.click(run);
    expect(props.onRunValidations).not.toHaveBeenCalled();
  });

  it('lists the three Add measurements items with their descriptions and calls each handler', async () => {
    const user = userEvent.setup();
    const props = renderHeader();
    for (const [label, handler] of [
      [VIEW_DATA_TEXT.manualEntry, props.onManualEntry],
      [VIEW_DATA_TEXT.uploadCsv, props.onUploadCsv],
      [VIEW_DATA_TEXT.importArcgis, props.onImportArcgis]
    ] as const) {
      await user.click(screen.getByRole('button', { name: VIEW_DATA_TEXT.addMeasurements }));
      await user.click(screen.getByRole('menuitem', { name: new RegExp(label) }));
      expect(handler).toHaveBeenCalledTimes(1);
    }
    await user.click(screen.getByRole('button', { name: VIEW_DATA_TEXT.addMeasurements }));
    expect(screen.getByRole('menuitem', { name: new RegExp(VIEW_DATA_TEXT.uploadCsv) })).toHaveTextContent(VIEW_DATA_TEXT.uploadCsvDescription);
  });

  it('hides every action when showActions is false', () => {
    renderHeader({ showActions: false });
    expect(screen.queryByTestId('view-data-header-actions')).not.toBeInTheDocument();
  });
});

function renderProps(overrides: Partial<ViewDataHeaderProps>): ViewDataHeaderProps {
  return {
    scopeLine: 'Luquillo · Luquillo Main Plot · Census 5',
    stateCounts: COUNTS,
    isReadOnly: false,
    showActions: true,
    failedUploadCount: FAILED_UPLOADS,
    canFixFailedUploads: true,
    onFixFailedUploads: vi.fn(),
    onExportCsv: vi.fn(),
    onRunValidations: vi.fn(),
    onOverrideValidations: vi.fn(),
    onResetValidations: vi.fn(),
    onRefreshView: vi.fn(),
    onOpenHeaderReference: vi.fn(),
    onManualEntry: vi.fn(),
    onUploadCsv: vi.fn(),
    onImportArcgis: vi.fn(),
    ...overrides
  };
}
