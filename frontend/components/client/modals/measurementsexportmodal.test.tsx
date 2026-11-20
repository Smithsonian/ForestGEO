import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import MeasurementsExportModal from './measurementsexportmodal';

const CSV_BODY = 'TreeTag,StemTag\n010203,1\n';
const BLOB_URL = 'blob:measurements-export';
const ALL_VISIBLE = ['errors', 'valid', 'pending'] as const;

describe('MeasurementsExportModal', () => {
  const downloads: string[] = [];

  beforeEach(() => {
    downloads.length = 0;
    vi.stubGlobal('URL', { ...URL, createObjectURL: () => BLOB_URL, revokeObjectURL: () => undefined });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      downloads.push(this.download);
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function renderModal(handleExport: (visibility: string[], type: 'csv' | 'form') => Promise<string>, onClose = vi.fn()) {
    render(
      <MeasurementsExportModal
        open
        onClose={onClose}
        handleExport={handleExport as never}
        initialVisibility={[...ALL_VISIBLE]}
        csvHeaders={['treeTag', 'stemTag']}
        formHeaders={['tag', 'stemtag']}
        fileNameParts={{ schemaName: 'forestgeo_testing', plotName: 'Main', plotCensusNumber: 5 }}
      />
    );
    return onClose;
  }

  it('exports the chosen visibility as table CSV, names the file from the scope and closes', async () => {
    const user = userEvent.setup();
    const handleExport = vi.fn(async () => CSV_BODY);
    const onClose = renderModal(handleExport);
    await user.click(screen.getByRole('button', { name: 'Rows pending validation' }));
    await user.click(screen.getByRole('button', { name: 'Export selected data/visibility and close the modal' }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    console.log('[export modal]', JSON.stringify({ calls: handleExport.mock.calls, downloads }));
    expect(handleExport).toHaveBeenCalledWith(['errors', 'valid'], 'csv');
    expect(downloads).toEqual(['measurements_csv_forestgeo_testing_Main_5.csv']);
  });

  it('switches to the form export', async () => {
    const user = userEvent.setup();
    const handleExport = vi.fn(async () => CSV_BODY);
    renderModal(handleExport);
    await user.click(screen.getByRole('switch'));
    await user.click(screen.getByRole('button', { name: 'Export selected data/visibility and close the modal' }));
    await waitFor(() => expect(handleExport).toHaveBeenCalledWith([...ALL_VISIBLE], 'form'));
  });
});
