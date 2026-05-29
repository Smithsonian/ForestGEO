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
  pageSizeOptions?: Array<number | { value: number; label: string }>;
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
        pageSizeOptions={props.pageSizeOptions ?? PAGE_SIZE_OPTIONS}
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

  it('supports labeled pageSizeOptions objects', async () => {
    const onChange = vi.fn();
    render(<Harness rowCount={100} pageSize={25} page={0} pageSizeOptions={[{ value: 25, label: 'Twenty five' }, 50]} onPaginationModelChange={onChange} />);

    fireEvent.click(screen.getByLabelText('Rows per page'));
    fireEvent.click(await screen.findByRole('option', { name: '50' }));
    expect(onChange.mock.calls.at(-1)![0]).toMatchObject({ page: 0, pageSize: 50 });
  });

  describe('infinite-scroll integration via the rows-per-page selector', () => {
    function InfiniteHarness({ enabled, onToggle }: { enabled: boolean; onToggle: (next: boolean) => void }) {
      const [model, setModel] = React.useState<GridPaginationModel>({ page: 0, pageSize: 10 });
      const PaginationSlot = React.useMemo(() => {
        const Slot = () => (
          <CustomGridPagination
            infiniteScroll={{
              enabled,
              onToggle,
              loadedCount: enabled ? 50 : 0,
              totalRows: enabled ? 250 : 0,
              isLoadingMore: false,
              hasMore: enabled,
              error: null,
              softCapExceeded: false,
              onRetry: () => {}
            }}
          />
        );
        Slot.displayName = 'TestPaginationSlot';
        return Slot;
      }, [enabled, onToggle]);
      return (
        <div style={{ height: 480, width: 800 }}>
          <DataGrid
            rows={[]}
            columns={COLUMNS}
            paginationMode="server"
            rowCount={100}
            paginationModel={model}
            onPaginationModelChange={setModel}
            pageSizeOptions={[10, 25, 50]}
            slots={{ pagination: PaginationSlot }}
          />
        </div>
      );
    }

    function openSizeSelect() {
      const buttons = screen.getAllByLabelText('Rows per page');
      // CustomGridPagination's Select button is the last "Rows per page" labeled element.
      const button = buttons[buttons.length - 1];
      fireEvent.mouseDown(button);
      fireEvent.click(button);
    }

    async function findInfiniteOption() {
      const options = await screen.findAllByRole('option');
      const infinityOption = options.find(opt => opt.textContent?.includes('∞'));
      if (!infinityOption) throw new Error(`No ∞ option found. Options: ${options.map(o => o.textContent).join(', ')}`);
      return infinityOption;
    }

    it('renders the ∞ option when an infiniteScroll descriptor is provided', async () => {
      render(<InfiniteHarness enabled={false} onToggle={() => {}} />);
      openSizeSelect();
      expect(await findInfiniteOption()).toBeInTheDocument();
    });

    it('selecting ∞ calls onToggle(true)', async () => {
      const onToggle = vi.fn();
      render(<InfiniteHarness enabled={false} onToggle={onToggle} />);
      openSizeSelect();
      fireEvent.click(await findInfiniteOption());
      expect(onToggle).toHaveBeenCalledWith(true);
    });

    it('when infinite is on, the goto controls are hidden and a status line is shown', () => {
      render(<InfiniteHarness enabled={true} onToggle={() => {}} />);
      expect(screen.queryByLabelText('Jump to page')).not.toBeInTheDocument();
      expect(screen.queryByLabelText('Go to first page')).not.toBeInTheDocument();
      expect(screen.getByTestId('infinite-status').textContent).toContain('Loaded 50 of 250');
    });

    it('when infinite is on, picking a numeric page-size calls onToggle(false)', async () => {
      const onToggle = vi.fn();
      render(<InfiniteHarness enabled={true} onToggle={onToggle} />);
      openSizeSelect();
      fireEvent.click(await screen.findByRole('option', { name: '25' }));
      expect(onToggle).toHaveBeenCalledWith(false);
    });
  });
});
