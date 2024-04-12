import React from 'react';
import {render, fireEvent, screen} from '@testing-library/react';
import DataGridCommons from '@/components/datagridcommons'; // Update the import path as needed
import * as DataGridHelpers from '@/config/datagridhelpers'; // Update the import path as needed

describe('DataGridCommons Component', () => {
  const defaultProps = {
    gridType: 'coreMeasurements',
    gridColumns: [],
    rows: [],
    setRows: jest.fn(),
    rowCount: 0,
    setRowCount: jest.fn(),
    rowModesModel: {},
    setRowModesModel: jest.fn(),
    snackbar: null,
    setSnackbar: jest.fn(),
    refresh: false,
    setRefresh: jest.fn(),
    paginationModel: {pageSize: 10, page: 0},
    setPaginationModel: jest.fn(),
    isNewRowAdded: false,
    setIsNewRowAdded: jest.fn(),
    shouldAddRowAfterFetch: false,
    setShouldAddRowAfterFetch: jest.fn(),
    currentPlot: null,
    addNewRowToGrid: jest.fn()
  };

  // Rendering Tests
  it('renders without crashing', () => {
    render(<DataGridCommons {...defaultProps} />);
    expect(screen.getByText('You must select a site to continue!')).toBeInTheDocument();
  });

  // Functionality Tests
  it('renders the correct message when no current plot is selected', () => {
    render(<DataGridCommons {...defaultProps} />);
    expect(screen.getByText('You must select a plot to continue!')).toBeInTheDocument();
  });

  // Event Handling Tests
  it('calls handleAddNewRow when add new row button is clicked', () => {
    const handleAddNewRow = jest.fn();
    render(<DataGridCommons {...defaultProps} />);
    fireEvent.click(screen.getByText('Add Row'));
    expect(handleAddNewRow).toHaveBeenCalledTimes(1);
  });

  // State and Props Tests
  it('renders custom toolbar when locked prop is true', () => {
    const lockedProps = {...defaultProps, locked: true};
    render(<DataGridCommons {...lockedProps} />);
    expect(screen.queryByText('Add Row')).not.toBeInTheDocument();
  });

  // Integration with datagridhelpers Tests
  it('calls validateRowStructure from datagridhelpers', () => {
    const row = {id: '1', isNew: true};
    const result = DataGridHelpers.validateRowStructure('coreMeasurements', row);
    expect(result).toBe(false); // Assuming the row does not meet the structure requirements
  });

  // Error Handling and Validation Tests
  it('displays error snackbar when data fetch fails', async () => {
    // Mock a failing fetch function or API response
    global.fetch = jest.fn(() =>
      Promise.resolve({
        ok: false,
        json: () => Promise.resolve({message: 'Network response was not ok'}),
      })
    ) as jest.Mock;

    render(<DataGridCommons {...defaultProps} />);
    await screen.findByText('Error fetching data');
  });

  // More tests...
});
