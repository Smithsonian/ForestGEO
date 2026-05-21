import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { DataGrid, GridColDef, GridPaginationModel } from '@mui/x-data-grid';
import CustomGridPagination from './customgridpagination';

const COLUMNS: GridColDef[] = [{ field: 'id' }];
const PAGE_SIZE_OPTIONS = [10, 25, 50];

interface HarnessProps {
  rowCount: number;
  pageSize: number;
  page: number;
  onPaginationModelChange?: (model: GridPaginationModel) => void;
}

function Harness(props: HarnessProps) {
  const [model, setModel] = React.useState<GridPaginationModel>({ page: props.page, pageSize: props.pageSize });
  return (
    <div style={{ height: 320, width: 640 }}>
      <DataGrid
        rows={[]}
        columns={COLUMNS}
        paginationMode="server"
        rowCount={props.rowCount}
        paginationModel={model}
        onPaginationModelChange={next => {
          setModel(next);
          props.onPaginationModelChange?.(next);
        }}
        pageSizeOptions={PAGE_SIZE_OPTIONS}
        slots={{ pagination: CustomGridPagination }}
      />
    </div>
  );
}

describe('CustomGridPagination', () => {
  it('disables First and Prev on the first page', () => {
    render(<Harness rowCount={100} pageSize={10} page={0} />);
    expect(screen.getByLabelText('Go to first page')).toBeDisabled();
    expect(screen.getByLabelText('Go to previous page')).toBeDisabled();
    expect(screen.getByLabelText('Go to next page')).toBeEnabled();
    expect(screen.getByLabelText('Go to last page')).toBeEnabled();
  });

  it('disables Next and Last on the last page', () => {
    render(<Harness rowCount={100} pageSize={10} page={9} />);
    expect(screen.getByLabelText('Go to first page')).toBeEnabled();
    expect(screen.getByLabelText('Go to previous page')).toBeEnabled();
    expect(screen.getByLabelText('Go to next page')).toBeDisabled();
    expect(screen.getByLabelText('Go to last page')).toBeDisabled();
  });

  it('disables every control when rowCount is zero', () => {
    render(<Harness rowCount={0} pageSize={10} page={0} />);
    expect(screen.getByLabelText('Jump to page')).toBeDisabled();
    expect(screen.getByLabelText('Go to first page')).toBeDisabled();
    expect(screen.getByLabelText('Go to next page')).toBeDisabled();
  });

  it('commits the goto value on Enter and clamps above pageCount', () => {
    const onChange = vi.fn();
    render(<Harness rowCount={100} pageSize={10} page={0} onPaginationModelChange={onChange} />);
    const input = screen.getByLabelText('Jump to page') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '999' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).toHaveBeenCalled();
    expect(onChange.mock.calls.at(-1)![0]).toMatchObject({ page: 9 });
  });

  it('commits the goto value on Enter and clamps below 1', () => {
    const onChange = vi.fn();
    render(<Harness rowCount={100} pageSize={10} page={5} onPaginationModelChange={onChange} />);
    const input = screen.getByLabelText('Jump to page') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '0' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange.mock.calls.at(-1)![0]).toMatchObject({ page: 0 });
  });

  it('commits the goto value on blur', () => {
    const onChange = vi.fn();
    render(<Harness rowCount={100} pageSize={10} page={0} onPaginationModelChange={onChange} />);
    const input = screen.getByLabelText('Jump to page') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '4' } });
    fireEvent.blur(input);
    expect(onChange.mock.calls.at(-1)![0]).toMatchObject({ page: 3 });
  });

  it('treats blank goto input as a no-op', () => {
    const onChange = vi.fn();
    render(<Harness rowCount={100} pageSize={10} page={0} onPaginationModelChange={onChange} />);
    const input = screen.getByLabelText('Jump to page');
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.blur(input);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('Last button jumps to the final page index', () => {
    const onChange = vi.fn();
    render(<Harness rowCount={100} pageSize={10} page={0} onPaginationModelChange={onChange} />);
    fireEvent.click(screen.getByLabelText('Go to last page'));
    expect(onChange.mock.calls.at(-1)![0]).toMatchObject({ page: 9 });
  });

  it('First button jumps to page 0', () => {
    const onChange = vi.fn();
    render(<Harness rowCount={100} pageSize={10} page={5} onPaginationModelChange={onChange} />);
    fireEvent.click(screen.getByLabelText('Go to first page'));
    expect(onChange.mock.calls.at(-1)![0]).toMatchObject({ page: 0 });
  });
});
