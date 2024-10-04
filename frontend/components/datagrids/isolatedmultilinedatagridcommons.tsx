'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DataGridProps, GridActionsCellItem, gridClasses, GridColDef, GridRowId, GridRowsProp, GridValidRowModel, useGridApiRef } from '@mui/x-data-grid';
import { Button } from '@mui/material';
import SaveIcon from '@mui/icons-material/Save';
import RestoreIcon from '@mui/icons-material/Restore';
import { randomId } from '@mui/x-data-grid-generator';
import DeleteIcon from '@mui/icons-material/DeleteOutlined';
import { darken } from '@mui/system';
import { StyledDataGrid } from '@/config/styleddatagrid';
import { LoadingButton } from '@mui/lab';
import { Add } from '@mui/icons-material';
import { getColumnVisibilityModel } from '@/config/datagridhelpers';
import { useOrgCensusContext, usePlotContext, useSiteContext } from '@/app/contexts/userselectionprovider';
import { FileRow, FileRowSet } from '@/config/macros/formdetails';
import { Box } from '@mui/joy';

export interface IsolatedDataGridCommonProps {
  gridType: string;
  gridColumns: GridColDef[];
  refresh: boolean;
  setRefresh: (refresh: boolean) => void;
  initialRow?: GridValidRowModel;
  locked?: boolean;
  clusters?: Record<string, string[]>;
}

export default function IsolatedMultilineDataGridCommons(props: Readonly<IsolatedDataGridCommonProps>) {
  const { gridColumns, gridType, refresh, setRefresh, initialRow } = props;
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

  const columns = useMemo<GridColDef[]>(
    () => [
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
                apiRef.current.updateRows([row]); // to trigger row render
              }}
            />
          ];
        }
      },
      ...gridColumns
    ],
    [gridColumns, unsavedChangesRef, apiRef, setRows]
  );

  const processRowUpdate = useCallback<NonNullable<DataGridProps['processRowUpdate']>>((newRow, oldRow) => {
    const rowId = newRow.id;

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

      // Simulate save operation
      await new Promise(resolve => setTimeout(resolve, 500));

      // After saving, process both edited and deleted rows
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

      // Clear unsaved changes
      unsavedChangesRef.current.unsavedRows = {};
      unsavedChangesRef.current.rowsBeforeChange = {};

      setHasUnsavedRows(false);
      setIsSaving(false);
    } catch (error) {
      setIsSaving(false);
    }
  }, [apiRef, setRows]);

  const getRowClassName = useCallback<NonNullable<DataGridProps['getRowClassName']>>(({ id }) => {
    const unsavedRow = unsavedChangesRef.current.unsavedRows[id];
    if (unsavedRow) {
      if (unsavedRow._action === 'delete') {
        return 'row--removed';
      }
      return 'row--edited';
    }
    return '';
  }, []);

  const handleAddNewRow = useCallback(() => {
    const newId = randomId();

    setRows(prevRows => {
      // Ensure that we're not stacking multiple new rows
      return [...prevRows, { ...initialRow, id: newId, isNew: true }];
    });
  }, [initialRow]);

  useEffect(() => {
    if (refresh) {
      setRefresh(false);
    }
  }, [refresh, setRefresh]);

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

  async function submitChanges() {
    await saveChanges();
    const fileRowSet: FileRowSet = convertRowsToFileRowSet(rows);
    const response = await fetch(`/api/bulkcrud/${gridType}/${currentSite?.schemaName}/${currentPlot?.id}/${currentCensus?.dateRanges[0].censusID}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(fileRowSet)
    });
  }

  return (
    <Box style={{ width: '100%' }}>
      <Box style={{ marginBottom: 8 }}>
        <LoadingButton disabled={!hasUnsavedRows} loading={isSaving} onClick={saveChanges} startIcon={<SaveIcon />} loadingPosition="start">
          <span>Save</span>
        </LoadingButton>
        <Button disabled={!hasUnsavedRows || isSaving} onClick={discardChanges} startIcon={<RestoreIcon />}>
          Discard all changes
        </Button>
        <Button onClick={handleAddNewRow} startIcon={<Add />}>
          New Row
        </Button>
      </Box>
      <Box sx={{ display: 'flex', flex: 1, height: '100%', width: '100%' }}>
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
              backgroundColor: theme => {
                if (theme.palette.mode === 'light') {
                  return 'rgba(255, 170, 170, 0.3)';
                }
                return darken('rgba(255, 170, 170, 1)', 0.7);
              }
            },
            [`& .${gridClasses.row}.row--edited`]: {
              backgroundColor: theme => {
                if (theme.palette.mode === 'light') {
                  return 'rgba(255, 254, 176, 0.3)';
                }
                return darken('rgba(255, 254, 176, 1)', 0.6);
              }
            }
          }}
          loading={isSaving}
          getRowClassName={getRowClassName}
          autoHeight
        />
      </Box>
    </Box>
  );
}
