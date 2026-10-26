import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { DropzoneCompact } from './dropzonecompact';
import { SourceFormat } from '@/config/macros/formdetails';

// Drives react-dropzone through its hidden file input: the same onDrop pipeline (accept filtering,
// accepted/rejected split) runs, without depending on jsdom's DataTransfer.
async function dropFiles(container: HTMLElement, files: File[]) {
  const input = container.querySelector('input[type="file"]') as HTMLInputElement;
  await act(async () => {
    fireEvent.change(input, { target: { files } });
  });
}

// The global test setup replaces react-dropzone with a stub; this suite needs the real accept/reject logic.
vi.unmock('react-dropzone');

describe('DropzoneCompact rejection feedback', () => {
  it('shows an on-screen message with filename, reason and accepted formats for unsupported files', async () => {
    const onChange = vi.fn();
    const { container } = render(<DropzoneCompact onChange={onChange} />);

    await dropFiles(container, [new File(['%PDF'], 'report.pdf', { type: 'application/pdf' })]);

    const alert = await screen.findByTestId('dropzone-rejections');
    expect(alert.textContent).toContain('report.pdf');
    expect(alert.textContent).toContain('unsupported file type');
    expect(alert.textContent).toContain('.csv, .txt, .tsv');
  });

  it('lets accepted files proceed in a mixed drop while listing the rejected ones', async () => {
    const onChange = vi.fn();
    const { container } = render(<DropzoneCompact onChange={onChange} />);

    await dropFiles(container, [
      new File(['a,b\n1,2\n'], 'good.csv', { type: 'text/csv' }),
      new File(['PK'], 'book.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
      new File(['%PDF'], 'scan.pdf', { type: 'application/pdf' })
    ]);

    const alert = await screen.findByTestId('dropzone-rejections');
    expect(alert.textContent).toContain('book.xlsx');
    expect(alert.textContent).toContain('scan.pdf');
    expect(alert.textContent).not.toContain('good.csv');

    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const [accepted, rejected] = onChange.mock.calls[0];
    expect(accepted.map((f: File) => f.name)).toEqual(['good.csv']);
    expect(rejected.map((r: { file: File }) => r.file.name).sort()).toEqual(['book.xlsx', 'scan.pdf']);
  });

  it('shows no alert when every file is accepted', async () => {
    const onChange = vi.fn();
    const { container } = render(<DropzoneCompact onChange={onChange} />);

    await dropFiles(container, [new File(['a,b\n1,2\n'], 'good.csv', { type: 'text/csv' })]);

    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(screen.queryByTestId('dropzone-rejections')).toBeNull();
  });

  it('keeps accepting an .xlsx workbook on the ArcGIS form and rejects CSV there', async () => {
    const onChange = vi.fn();
    const { container } = render(<DropzoneCompact onChange={onChange} sourceFormat={SourceFormat.arcgis_xlsx} />);

    await dropFiles(container, [new File(['PK'], 'book.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })]);
    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
    expect(onChange.mock.calls[0][0].map((f: File) => f.name)).toEqual(['book.xlsx']);
    expect(screen.queryByTestId('dropzone-rejections')).toBeNull();

    await dropFiles(container, [new File(['a,b\n'], 'data.csv', { type: 'text/csv' })]);
    const alert = await screen.findByTestId('dropzone-rejections');
    expect(alert.textContent).toContain('data.csv');
    expect(alert.textContent).toContain('.xlsx (ArcGIS workbook)');
  });
});
