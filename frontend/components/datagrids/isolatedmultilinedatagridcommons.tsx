'use client';

import React, { Dispatch, SetStateAction, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DataGridProps, GridActionsCellItem, gridClasses, GridColDef, GridRowId, GridRowsProp, GridValidRowModel, useGridApiRef } from '@mui/x-data-grid';
import { Box, Button } from '@mui/joy';
import SaveIcon from '@mui/icons-material/Save';
import RestoreIcon from '@mui/icons-material/Restore';
import { randomId } from '@mui/x-data-grid-generator';
import DeleteIcon from '@mui/icons-material/DeleteOutlined';
import { darken } from '@mui/system';
import { StyledDataGrid } from '@/config/styleddatagrid';
import { Add } from '@mui/icons-material';
import { getColumnVisibilityModel } from '@/config/datagridhelpers';
import { useOrgCensusContext, usePlotContext, useSiteContext } from '@/app/contexts/userselectionprovider';
import { FileRow, FileRowSet } from '@/config/macros/formdetails';
import { AttributeStatusOptions } from '@/config/sqlrdsdefinitions/core';
import { renderDatePicker, renderEditDatePicker } from '@/components/client/formcolumns';

export interface IsolatedDataGridCommonProps {
  gridType: string;
  gridColumns: GridColDef[];
  refresh: boolean;
  setRefresh: (refresh: boolean) => void;
  setChangesSubmitted: Dispatch<SetStateAction<boolean>>;
  initialRow?: GridValidRowModel;
  locked?: boolean;
  clusters?: Record<string, string[]>;
}

export default function IsolatedMultilineDataGridCommons(props: Readonly<IsolatedDataGridCommonProps>) {
  const { gridColumns, gridType, refresh, setRefresh, initialRow, setChangesSubmitted } = props;
  const apiRef = useGridApiRef();

  const [rows, setRows] = useState<GridRowsProp>([]);
  const [hasUnsavedRows, setHasUnsavedRows] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const currentSite = useSiteContext();
  const currentPlot = usePlotContext();
  const currentCensus = useOrgCensusContext();

  const unsavedChangesRef = useRef<{
    unsavedRows: Record<GridRowId, GridValidRowModel>;
    rowsBeforeChange: Record<GridRowId, GridValidRowModel>;
  }>({
    unsavedRows: {},
    rowsBeforeChange: {}
  });

  const columns = useMemo<GridColDef[]>(() => {
    let baseColumns: GridColDef[] = [
      {
        field: 'actions',
        headerName: 'Actions',
        type: 'actions',
        getActions: ({ id, row }) => {
          return [
            <GridActionsCellItem
              icon={<RestoreIcon />}
              label="Discard changes"
              key={'discard'}
              disabled={unsavedChangesRef.current.unsavedRows[id] === undefined}
              onClick={() => {
                apiRef.current.updateRows([unsavedChangesRef.current.rowsBeforeChange[id]]);
                delete unsavedChangesRef.current.rowsBeforeChange[id];
                delete unsavedChangesRef.current.unsavedRows[id];
                setHasUnsavedRows(Object.keys(unsavedChangesRef.current.unsavedRows).length > 0);
              }}
            />,
            <GridActionsCellItem
              icon={<DeleteIcon />}
              label="Delete"
              key={'delete'}
              onClick={() => {
                unsavedChangesRef.current.unsavedRows[id] = {
                  ...row,
                  _action: 'delete'
                };
                if (!unsavedChangesRef.current.rowsBeforeChange[id]) {
                  unsavedChangesRef.current.rowsBeforeChange[id] = row;
                }
                setHasUnsavedRows(true);
                apiRef.current.updateRows([row]);
              }}
            />
          ];
        }
      },
      ...gridColumns
    ];

    if (gridType === 'measurements') {
      baseColumns = [
        ...baseColumns,
        {
          field: 'date',
          headerName: 'Date',
          headerClassName: 'header',
          flex: 1,
          editable: true,
          renderCell: renderDatePicker,
          renderEditCell: renderEditDatePicker
        },
        {
          field: 'codes',
          headerName: 'Codes',
          headerClassName: 'header',
          flex: 1,
          align: 'center',
          editable: true
        }
      ];
    }

    return baseColumns;
  }, [gridColumns, gridType, unsavedChangesRef, apiRef, setHasUnsavedRows]);

  const processRowUpdate = useCallback<NonNullable<DataGridProps['processRowUpdate']>>((newRow, oldRow) => {
    const rowId = newRow.id;

    newRow._error = false;
    unsavedChangesRef.current.unsavedRows[rowId] = newRow;

    if (!unsavedChangesRef.current.rowsBeforeChange[rowId]) {
      unsavedChangesRef.current.rowsBeforeChange[rowId] = oldRow;
    }
    setHasUnsavedRows(true);

    return newRow;
  }, []);

  const discardChanges = useCallback(() => {
    setHasUnsavedRows(false);
    Object.values(unsavedChangesRef.current.rowsBeforeChange).forEach(row => {
      apiRef.current.updateRows([row]);
    });
    unsavedChangesRef.current = {
      unsavedRows: {},
      rowsBeforeChange: {}
    };
  }, [apiRef]);

  const saveChanges = useCallback(async () => {
    try {
      setIsSaving(true);

      const rowsToDelete = Object.values(unsavedChangesRef.current.unsavedRows).filter(row => row._action === 'delete');
      const rowsToSave = Object.values(unsavedChangesRef.current.unsavedRows).filter(row => row._action !== 'delete');

      // Remove rows that were marked for deletion
      setRows(prevRows => {
        const filteredRows = prevRows.filter(row => !rowsToDelete.some(deletedRow => deletedRow.id === row.id));

        // Update rows that were edited
        return filteredRows.map(row => {
          const updatedRow = rowsToSave.find(editedRow => editedRow.id === row.id);
          return updatedRow ? { ...row, ...updatedRow } : row;
        });
      });

      unsavedChangesRef.current.unsavedRows = {};
      unsavedChangesRef.current.rowsBeforeChange = {};

      setHasUnsavedRows(false);
      setIsSaving(false);
    } catch (error) {
      setIsSaving(false);
    }
  }, [apiRef, setRows]);

  const getRowClassName = useCallback<NonNullable<DataGridProps['getRowClassName']>>(({ id, row }) => {
    const unsavedRow = unsavedChangesRef.current.unsavedRows[id];

    if (unsavedRow) {
      if (unsavedRow._action === 'delete') {
        return 'row--removed';
      }
      if (unsavedRow._error) {
        return 'row--invalid';
      }
      return 'row--edited';
    }

    if (row._error) {
      return 'row--invalid';
    }

    return '';
  }, []);

  const handleAddNewRow = useCallback(() => {
    const newId = randomId();

    setRows(prevRows => {
      return [...prevRows, { ...initialRow, id: newId, isNew: true }];
    });
  }, [initialRow]);

  useEffect(() => {
    if (refresh) {
      setRefresh(false);
    }
  }, [refresh, setRefresh]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.altKey) && event.key.toLowerCase() === 'n') {
        event.preventDefault();
        handleAddNewRow();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleAddNewRow]);

  function convertRowsToFileRowSet(rows: GridRowsProp): FileRowSet {
    const fileRowSet: FileRowSet = {};

    rows.forEach(row => {
      const fileRow: FileRow = {};

      // Iterate over each field in the row and map it to the FileRow, ignoring the 'id' field
      Object.keys(row).forEach(header => {
        if (header !== 'id') {
          const value = row[header as keyof typeof row];
          fileRow[header] = value !== undefined ? String(value) : null;
        }
      });

      // Use the row ID as the key for each row in the FileRowSet but exclude it from the FileRow
      fileRowSet[row.id as string] = fileRow;
    });

    return fileRowSet;
  }

  const validateRow = (row: GridValidRowModel, gridType: string): boolean => {
    switch (gridType) {
      case 'attributes':
        return AttributeStatusOptions.includes(row.status);
    }
    return true;
  };

  async function submitChanges() {
    if (hasUnsavedRows) {
      alert('Please save your changes before proceeding.');
      return;
    }
    await new Promise(resolve => setTimeout(resolve, 250));
    await saveChanges();
    await new Promise(resolve => setTimeout(resolve, 750));

    let hasErrors = false;

    setRows(
      rows.map(row => {
        row._error = !validateRow(row, gridType);
        hasErrors = row._error;
        return row;
      })
    );

    if (hasErrors) {
      alert('Some rows have validation errors. Please fix them before submitting.');
      return;
    }

    const fileRowSet: FileRowSet = convertRowsToFileRowSet(rows);
    const response = await fetch(`/api/bulkcrud/${gridType}/${currentSite?.schemaName}/${currentPlot?.plotID}/${currentCensus?.dateRanges[0].censusID}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(fileRowSet)
    });
    console.log('response: ', response);
    setChangesSubmitted(true);
  }

  return (
    <Box style={{ width: '100%' }}>
      <Box style={{ marginBottom: 8 }}>
        <Button sx={{ marginX: 2 }} disabled={!hasUnsavedRows} loading={isSaving} onClick={saveChanges} startDecorator={<SaveIcon />} loadingPosition={'start'}>
          Save
        </Button>
        <Button sx={{ marginX: 2 }} disabled={!hasUnsavedRows || isSaving} onClick={discardChanges} startDecorator={<RestoreIcon />}>
          Discard all changes
        </Button>
        <Button sx={{ marginX: 2 }} onClick={handleAddNewRow} startDecorator={<Add />}>
          New Row
        </Button>
      </Box>
      <Box sx={{ display: 'flex', flex: 1, height: '100%', width: '100%', maxHeight: '80vh', overflowY: 'auto' }}>
        <StyledDataGrid
          rows={rows}
          columns={columns}
          apiRef={apiRef}
          disableRowSelectionOnClick
          processRowUpdate={processRowUpdate}
          ignoreValueFormatterDuringExport
          initialState={{
            columns: {
              columnVisibilityModel: getColumnVisibilityModel(gridType)
            }
          }}
          sx={{
            [`& .${gridClasses.row}.row--removed`]: {
              backgroundColor: theme => (theme.palette.mode === 'light' ? 'rgba(255, 170, 170, 0.3)' : darken('rgba(255, 170, 170, 1)', 0.7))
            },
            [`& .${gridClasses.row}.row--edited`]: {
              backgroundColor: theme => (theme.palette.mode === 'light' ? 'rgba(255, 254, 176, 0.3)' : darken('rgba(255, 254, 176, 1)', 0.6))
            },
            [`& .${gridClasses.row}.row--invalid`]: {
              backgroundColor: theme => (theme.palette.mode === 'light' ? 'rgba(255, 0, 0, 0.3)' : darken('rgba(255,0,0,0.6)', 0.6))
            }
          }}
          loading={isSaving}
          getRowClassName={getRowClassName}
          getRowHeight={() => 'auto'}
        />
      </Box>
      <Button sx={{ marginTop: 8 }} onClick={submitChanges} color={'primary'} size={'lg'}>
        Finalize Changes
      </Button>
    </Box>
  );
}
