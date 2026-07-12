'use client';

import React, { Dispatch, SetStateAction, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DataGridProps, GridActionsCellItem, gridClasses, GridColDef, GridRowId, GridRowsProp, GridValidRowModel, useGridApiRef } from '@mui/x-data-grid';
import { Alert, Box, Button, Stack, Typography } from '@mui/joy';
import SaveIcon from '@mui/icons-material/Save';
import RestoreIcon from '@mui/icons-material/Restore';
import { randomId } from '@mui/x-data-grid-generator';
import DeleteIcon from '@mui/icons-material/DeleteOutlined';
import { darken } from '@mui/system';
import { StyledDataGrid } from '@/config/styleddatagrid';
import { Add } from '@mui/icons-material';
import { getColumnVisibilityModel } from '@/config/datagridhelpers';
import { getGridTypeLabel } from '@/config/macros/siteconfigs';
import { useOrgCensusContext, usePlotContext, useSiteContext } from '@/app/contexts/compat-hooks';
import { FileRow, FileRowSet, FormType, RequiredTableHeadersByFormType } from '@/config/macros/formdetails';
import { AttributeStatusOptions } from '@/lib/db/definitions/core';

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
  const { gridColumns, gridType, refresh: _refresh, setRefresh: _setRefresh, initialRow, setChangesSubmitted } = props;
  const apiRef = useGridApiRef();

  const [rows, setRows] = useState<GridRowsProp>([]);
  const [hasUnsavedRows, setHasUnsavedRows] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [formMessage, setFormMessage] = useState('');

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
    const baseColumns: GridColDef[] = [
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
                apiRef.current?.updateRows([unsavedChangesRef.current.rowsBeforeChange[id]]);
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
                apiRef.current?.updateRows([row]);
              }}
            />
          ];
        }
      },
      ...gridColumns
    ];

    return baseColumns;
  }, [gridColumns, apiRef]);

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
    const newRowIds = new Set(
      Object.values(unsavedChangesRef.current.unsavedRows)
        .filter(row => row.isNew)
        .map(row => row.id)
    );
    setRows(previousRows => previousRows.filter(row => !newRowIds.has(row.id)));
    Object.values(unsavedChangesRef.current.rowsBeforeChange).forEach(row => {
      apiRef.current?.updateRows([row]);
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

      const filteredRows = rows.filter(row => !rowsToDelete.some(deletedRow => deletedRow.id === row.id));
      const savedRows = filteredRows.map(row => {
        const updatedRow = rowsToSave.find(editedRow => editedRow.id === row.id);
        const nextRow = updatedRow ? { ...row, ...updatedRow } : row;
        return { ...nextRow, _error: !validateRow(nextRow, gridType) };
      });
      setRows(savedRows);

      unsavedChangesRef.current.unsavedRows = {};
      unsavedChangesRef.current.rowsBeforeChange = {};

      setHasUnsavedRows(false);
      setFormMessage(
        savedRows.some(row => row._error)
          ? 'Some rows are missing required values. Complete the red rows before finalizing.'
          : 'Rows saved and ready to finalize.'
      );
      setIsSaving(false);
    } catch {
      setIsSaving(false);
    }
  }, [gridType, rows]);

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
    const firstEditableField = gridColumns.find(column => column.field !== 'actions' && column.editable !== false)?.field;
    const newRow = { ...initialRow, id: newId, isNew: true };

    unsavedChangesRef.current.unsavedRows[newId] = newRow;
    setHasUnsavedRows(true);

    setRows(prevRows => {
      const rowIndex = prevRows.length;
      requestAnimationFrame(() => {
        apiRef.current?.scrollToIndexes({ rowIndex, colIndex: firstEditableField ? 1 : 0 });
        if (firstEditableField) {
          apiRef.current?.setCellFocus(newId, firstEditableField);
          apiRef.current?.startCellEditMode({ id: newId, field: firstEditableField });
        }
      });
      return [...prevRows, newRow];
    });
    setFormMessage('New row added. Enter data in the highlighted first cell, then use Save before finalizing.');
  }, [apiRef, gridColumns, initialRow]);

  // Removed problematic refresh effect that caused infinite rerender
  // The refresh pattern should be handled by parent component if needed

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
    const requiredFields = RequiredTableHeadersByFormType[gridType as FormType]?.map(header => header.label) ?? [];
    const hasRequiredValues = requiredFields.every(field => {
      const value = row[field];
      return value !== undefined && value !== null && (typeof value !== 'string' || value.trim().length > 0);
    });
    if (!hasRequiredValues) return false;

    switch (gridType) {
      case 'attributes':
        return AttributeStatusOptions.includes(row.status);
    }
    return true;
  };

  const canFinalize = rows.length > 0 && !hasUnsavedRows && rows.every(row => validateRow(row, gridType));

  async function submitChanges() {
    if (hasUnsavedRows) {
      setFormMessage('Save your row edits before finalizing.');
      return;
    }
    if (rows.length === 0) {
      setFormMessage('Add at least one row before finalizing.');
      return;
    }
    let hasErrors = false;

    setRows(
      rows.map(row => {
        row._error = !validateRow(row, gridType);
        hasErrors = hasErrors || row._error;
        return row;
      })
    );

    if (hasErrors) {
      setFormMessage('Some rows are missing required values. Complete the red rows before finalizing.');
      return;
    }

    const fileRowSet: FileRowSet = convertRowsToFileRowSet(rows);
    const response = await fetch(`/api/bulkcrud`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        gridType: gridType,
        schema: currentSite?.schemaName,
        plot: currentPlot,
        census: currentCensus,
        fileRowSet: fileRowSet
      })
    });
    if (!response.ok) {
      const responseBody = await response.json().catch(() => null);
      setFormMessage(responseBody?.error ?? 'The rows could not be submitted. No completion was recorded.');
      return;
    }
    setChangesSubmitted(true);
  }

  return (
    <Box style={{ width: '100%' }}>
      <Stack spacing={1} sx={{ mb: 2 }}>
        <Typography level="body-sm">Add a row, edit its cells, choose Save, and then finalize the completed rows.</Typography>
        {formMessage && (
          <Alert color={formMessage.startsWith('New row') ? 'primary' : 'warning'} aria-live="polite">
            {formMessage}
          </Alert>
        )}
      </Stack>
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
          aria-label={getGridTypeLabel(gridType)}
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
              backgroundColor: (theme: any) => (theme.palette.mode === 'light' ? 'rgba(255, 170, 170, 0.3)' : darken('rgba(255, 170, 170, 1)', 0.7))
            },
            [`& .${gridClasses.row}.row--edited`]: {
              backgroundColor: (theme: any) => (theme.palette.mode === 'light' ? 'rgba(255, 254, 176, 0.3)' : darken('rgba(255, 254, 176, 1)', 0.6))
            },
            [`& .${gridClasses.row}.row--invalid`]: {
              backgroundColor: (theme: any) => (theme.palette.mode === 'light' ? 'rgba(255, 0, 0, 0.3)' : darken('rgba(255,0,0,0.6)', 0.6))
            }
          }}
          loading={isSaving}
          getRowClassName={getRowClassName}
          getRowHeight={() => 'auto'}
        />
      </Box>
      <Button sx={{ marginTop: 8 }} onClick={submitChanges} color={'primary'} size={'lg'} disabled={!canFinalize || isSaving}>
        Finalize Changes
      </Button>
    </Box>
  );
}
