// DataGridCommons.tsx
"use client";
import React, {Dispatch, SetStateAction, useEffect, useMemo, useState} from 'react';
import {
  GridActionsCellItem,
  GridCellParams,
  GridColDef,
  GridEventListener,
  GridRowEditStopReasons,
  GridRowId,
  GridRowModel,
  GridRowModes,
  GridRowModesModel,
  GridRowParams,
  GridRowsProp,
  GridToolbarContainer,
  GridToolbarProps,
  ToolbarPropsOverrides
} from '@mui/x-data-grid'
import {
  Alert,
  AlertProps,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Snackbar
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/DeleteOutlined';
import SaveIcon from '@mui/icons-material/Save';
import CancelIcon from '@mui/icons-material/Close';
import RefreshIcon from '@mui/icons-material/Refresh';
import Box from "@mui/joy/Box";
import {Stack, Typography} from "@mui/joy";
import {CensusRDS, StyledDataGrid} from "@/config/sqlmacros";
import {
  computeMutation,
  createDeleteQuery,
  createFetchQuery,
  createProcessQuery,
  getGridID,
  validateRowStructure,
} from "@/config/datagridhelpers";
import {CMError, Plot} from "@/config/macros";
import UpdateContextsFromIDB from "@/config/updatecontextsfromidb";
import {useSession} from "next-auth/react";
import {useSiteContext} from "@/app/contexts/userselectionprovider";
import {saveAs} from 'file-saver';

interface EditToolbarCustomProps {
  handleAddNewRow?: () => void;
  handleRefresh?: () => Promise<void>;
  locked?: boolean;
}

type EditToolbarProps = EditToolbarCustomProps & GridToolbarProps & ToolbarPropsOverrides;


const errorMapping: { [key: string]: string[] } = {
  '1': ["attributes"],
  '2': ["measuredDBH"],
  '3': ["measuredHOM"],
  '4': ["treeTag", "stemTag"],
  '5': ["treeTag", "stemTag", "quadratName"],
  '6': ["stemQuadX", "stemQuadY"],
  '7': ["speciesName"],
  '8': ["measurementDate"],
  '9': ["treeTag", "stemTag", "plotCensusNumber"],
  '10': ["treeTag", "stemTag", "plotCensusNumber"],
  '11': ["quadratName"],
  '12': ["speciesName"],
  '13': ["measuredDBH"],
  '14': ["measuredDBH"],
  '15': ["treeTag"],
  '16': ["quadratName"],
};

export function EditToolbar(props: EditToolbarProps) {
  const {handleAddNewRow, handleRefresh, locked = false} = props;

  return (
    <GridToolbarContainer>
      {!locked && (
        <Button color="primary" startIcon={<AddIcon/>} onClick={handleAddNewRow}>
          Add Row
        </Button>
      )}
      <Button color="primary" startIcon={<RefreshIcon/>} onClick={handleRefresh}>
        Refresh
      </Button>
    </GridToolbarContainer>
  );
}

export interface DataGridCommonProps {
  gridType: string;
  gridColumns: GridColDef[];
  rows: GridRowsProp;
  setRows: Dispatch<SetStateAction<GridRowsProp>>;
  rowCount: number;
  setRowCount: Dispatch<SetStateAction<number>>;
  rowModesModel: GridRowModesModel;
  setRowModesModel: Dispatch<SetStateAction<GridRowModesModel>>;
  snackbar: Pick<AlertProps, "children" | "severity"> | null;
  setSnackbar: Dispatch<SetStateAction<Pick<AlertProps, "children" | "severity"> | null>>;
  refresh: boolean;
  setRefresh: Dispatch<SetStateAction<boolean>>;
  paginationModel: { pageSize: number, page: number };
  setPaginationModel: Dispatch<SetStateAction<{ pageSize: number, page: number }>>;
  isNewRowAdded: boolean;
  setIsNewRowAdded: Dispatch<SetStateAction<boolean>>;
  shouldAddRowAfterFetch: boolean;
  setShouldAddRowAfterFetch: Dispatch<SetStateAction<boolean>>;
  currentPlot: Plot | null;
  currentCensus?: CensusRDS | null;
  addNewRowToGrid: () => void;
  locked?: boolean;
}

// Define types for the new states and props
type PendingAction = {
  actionType: 'save' | 'delete' | '';
  actionId: GridRowId | null;
};

interface ConfirmationDialogProps {
  isOpen: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  message: string;
}

/**
 * Function to determine if all entries in a column are null
 */
function allValuesAreNull(rows: GridRowsProp, field: string): boolean {
  return rows.every(row => row[field] === null || row[field] === undefined);
}

/**
 * Function to filter out columns where all entries are null, except the actions column.
 */
function filterColumns(rows: GridRowsProp, columns: GridColDef[]): GridColDef[] {
  return columns.filter(col => col.field === 'actions' || !allValuesAreNull(rows, col.field));
}

/**
 * Renders common UI components for data grids.
 *
 * Handles state and logic for editing, saving, deleting rows, pagination,
 * validation errors and more. Renders a DataGrid component with customized
 * columns and cell renderers.
 */
export default function DataGridCommons(props: Readonly<DataGridCommonProps>) {
  const {
    addNewRowToGrid,
    gridColumns,
    gridType,
    rows,
    setRows,
    rowCount,
    setRowCount,
    rowModesModel,
    setRowModesModel,
    snackbar,
    setSnackbar,
    refresh,
    setRefresh,
    paginationModel,
    setPaginationModel,
    isNewRowAdded,
    setIsNewRowAdded,
    shouldAddRowAfterFetch,
    setShouldAddRowAfterFetch,
    currentPlot,
    currentCensus,
    locked = false
  } = props

  const [newLastPage, setNewLastPage] = useState<number | null>(null) // new state to track the new last page
  // State to store validation errors
  const [validationErrors, setValidationErrors] = useState<{
    [key: number]: CMError
  }>({})
  const [showErrorRows, setShowErrorRows] = useState<boolean>(true)
  const [showValidRows, setShowValidRows] = useState<boolean>(true)
  const [isDialogOpen, setIsDialogOpen] = useState<boolean>(false)
  const [errorRowsForExport, setErrorRowsForExport] = useState<GridRowModel[]>([]);


  const [pendingAction, setPendingAction] = useState<PendingAction>({
    actionType: '',
    actionId: null
  })

  const {data: session} = useSession()
  let email = session?.user?.email ?? ''
  const currentSite = useSiteContext()

  const {updateQuadratsContext, updateCensusContext, updatePlotsContext} =
    UpdateContextsFromIDB({
      email: email,
      schema: currentSite?.schemaName ?? ''
    });

  const extractErrorRows = () => {
    if (gridType !== 'measurementsSummary') return;
    const errorRows = rows.filter(row => rowHasError(row.id));
    setErrorRowsForExport(errorRows);
  };

  const saveErrorRowsAsCSV = () => {
    if (gridType !== 'measurementsSummary') return;
    let csvContent = "data:text/csv;charset=utf-8,";
    csvContent += gridColumns.map(col => col.headerName).join(",") + "\r\n"; // Column headers
    errorRowsForExport.forEach(row => {
      const rowValues = gridColumns.map(col => row[col.field] ?? '').join(",");
      csvContent += rowValues + "\r\n";
    });

    const blob = new Blob([csvContent], {type: "text/csv;charset=utf-8;"});
    saveAs(blob, `validation_errors_${currentPlot?.key}.csv`);
  };

  const printErrorRows = () => {
    if (gridType !== 'measurementsSummary') return;
    let printContent = "<html><head><style>";
    printContent += "table {width: 100%; border-collapse: collapse;}";
    printContent += "th, td {border: 1px solid black; padding: 8px; text-align: left;}";
    printContent += "</style></head><body>";
    printContent += "<table><thead><tr>";

    gridColumns.forEach(col => {
      printContent += `<th>${col.headerName}</th>`;
    });
    printContent += "</tr></thead><tbody>";

    errorRowsForExport.forEach(row => {
      printContent += "<tr>";
      gridColumns.forEach(col => {
        printContent += `<td>${row[col.field] ?? ''}</td>`;
      });
      printContent += "</tr>";
    });

    printContent += "</tbody></table></body></html>";

    const printWindow = window.open('', '', 'height=600,width=800');
    if (printWindow) {
      printWindow.document.write(printContent);
      printWindow.document.close();
      printWindow.print();
    }
  };

  // UI Button to trigger export
  const ExportErrorsButton = () => (
    gridType === 'measurementsSummary' && (
      <Button color="secondary" onClick={extractErrorRows}>
        Export Errors
      </Button>
    )
  );

  const openConfirmationDialog = (
    actionType: 'save' | 'delete',
    actionId: GridRowId
  ) => {
    setPendingAction({actionType, actionId})
    setIsDialogOpen(true)
  }

  const handleConfirmAction = async () => {
    setIsDialogOpen(false)
    if (
      pendingAction.actionType === 'save' &&
      pendingAction.actionId !== null
    ) {
      await performSaveAction(pendingAction.actionId)
    } else if (
      pendingAction.actionType === 'delete' &&
      pendingAction.actionId !== null
    ) {
      await performDeleteAction(pendingAction.actionId)
    }
    setPendingAction({actionType: '', actionId: null})
  }

  const handleCancelAction = () => {
    setIsDialogOpen(false)
    setPendingAction({actionType: '', actionId: null})
  }

  const performSaveAction = async (id: GridRowId) => {
    if (locked) return
    console.log('save confirmed')
    setRowModesModel(oldModel => ({
      ...oldModel,
      [id]: {mode: GridRowModes.View}
    }))

    // If the row was newly added, reset isNewRowAdded
    const row = rows.find(row => row.id === id)
    if (row?.isNew) {
      setIsNewRowAdded(false) // We are done adding a new row
      // Now we can refetch data for the current page without adding a new row
      setShouldAddRowAfterFetch(false) // Ensure we do not add a row during fetch
    }
    await fetchPaginatedData(paginationModel.page)
  }

  const performDeleteAction = async (id: GridRowId) => {
    if (locked) return
    console.log('delete confirm')
    console.log('gridType: ', gridType)
    let gridID = getGridID(gridType)
    console.log('gridID: ', gridID)
    const deletionID = rows.find(row => row.id == id)![gridID]
    const deleteQuery = createDeleteQuery(
      currentSite?.schemaName ?? '',
      gridType,
      deletionID
    )
    const response = await fetch(deleteQuery, {
      method: 'DELETE'
    })
    if (!response.ok)
      setSnackbar({children: 'Error: Deletion failed', severity: 'error'})
    else {
      setSnackbar({children: 'Row successfully deleted', severity: 'success'})
      setRows(rows.filter(row => row.id !== id))
      await fetchPaginatedData(paginationModel.page)
    }
  }

  const handleSaveClick = (id: GridRowId) => () => {
    if (locked) return
    openConfirmationDialog('save', id)
  }

  const handleDeleteClick = (id: GridRowId) => () => {
    if (locked) return
    if (gridType === 'census') {
      const rowToDelete = rows.find(row => row.id === id)
      if (
        currentCensus &&
        rowToDelete &&
        rowToDelete.censusID === currentCensus.censusID
      ) {
        alert('Cannot delete the currently selected census.')
        return
      }
    }
    openConfirmationDialog('delete', id)
  }

  // Toggle function for the checkbox
  const handleShowErrorRowsChange = (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    setShowErrorRows(event.target.checked)
  }

  const handleShowValidRowsChange = (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    setShowValidRows(event.target.checked)
  }

  const handleAddNewRow = async () => {
    if (locked) return;
    console.log('handleAddNewRow triggered');
  
    const newRowCount = rowCount + 1;
    const calculatedNewLastPage = Math.ceil(newRowCount / paginationModel.pageSize) - 1;
    const existingLastPage = Math.ceil(rowCount / paginationModel.pageSize) - 1;
    const isNewPageNeeded = newRowCount % paginationModel.pageSize === 1;
  
    setIsNewRowAdded(true);
    setShouldAddRowAfterFetch(isNewPageNeeded);
    setNewLastPage(calculatedNewLastPage); // Update newLastPage state
  
    if (isNewPageNeeded) {
      await setPaginationModel({ ...paginationModel, page: calculatedNewLastPage });
      addNewRowToGrid(); // Add the new row immediately after setting the page
    } else {
      // If no new page is needed, add the row immediately
      setPaginationModel({ ...paginationModel, page: existingLastPage });
      addNewRowToGrid();
    }
  }  

  const handleRefresh = async () => {
    setRefresh(true)
    try {
      const query = createFetchQuery(
        currentSite?.schemaName ?? '',
        gridType,
        paginationModel.page,
        paginationModel.pageSize,
        currentPlot?.id
      )
      const response = await fetch(query, {
        method: 'GET'
      })
      if (!response.ok) {
        throw new Error('Network response was not ok')
      }
      const data = await response.json()

      // Setting the fetched rows and total row count
      setRows(data[gridType])
      setRowCount(data.totalCount)
    } catch (error) {
      console.error('Error fetching data:', error)
      // Handle errors as appropriate for your application
    }
    setRefresh(false)
  }

  const fetchPaginatedData = async (pageToFetch: number) => {
    console.log('fetchPaginatedData triggered')
    setRefresh(true)
    let paginatedQuery = createFetchQuery(
      currentSite?.schemaName ?? '',
      gridType,
      pageToFetch,
      paginationModel.pageSize,
      currentPlot?.id
    )
    try {
      const response = await fetch(paginatedQuery, {method: 'GET'})
      const data = await response.json()
      if (!response.ok) throw new Error(data.message || 'Error fetching data')
      setRows(data[gridType])
      setRowCount(data.totalCount)

      if (isNewRowAdded && pageToFetch === newLastPage) {
        console.log('isNewRowAdded true, on new last page')
        addNewRowToGrid()
        setIsNewRowAdded(false)
      }
    } catch (error) {
      console.error('Error fetching data:', error)
      setSnackbar({children: 'Error fetching data', severity: 'error'})
    }
    setRefresh(false)
  }

  // // ... useEffect for handling row addition logic
  // useEffect(() => {
  //   if (isNewRowAdded) {
  //     console.log('useEffect --> isNewRowAdded true');
  //     const pageToFetch = shouldAddRowAfterFetch
  //       ? Math.ceil((rowCount + 1) / paginationModel.pageSize) - 1
  //       : paginationModel.page;
  //     fetchPaginatedData(pageToFetch).catch(console.error);
  //     console.log('useEffect --> isNewRowAdded true, fetch completed');
  //   }
  // }, [isNewRowAdded, rowCount, paginationModel, shouldAddRowAfterFetch]);
  //

  // ... useEffect for handling page changes
  useEffect(() => {
    if (!isNewRowAdded) {
      fetchPaginatedData(paginationModel.page).catch(console.error)
    }
  }, [paginationModel.page])

  // ... useEffect to listen for changed plot
  useEffect(() => {
    if (currentPlot?.id) {
      fetchPaginatedData(paginationModel.page).catch(console.error)
    }
  }, [currentPlot, paginationModel.page])

  useEffect(() => {
    if (refresh && currentSite) {
      handleRefresh().then(() => {
        setRefresh(false) // Reset refresh state after fetching data
      })
    }
  }, [refresh, setRefresh])

  const processRowUpdate = React.useCallback(
    async (
      newRow: GridRowModel,
      oldRow: GridRowModel
    ): Promise<GridRowModel> => {
      console.log(
        'Processing row update. Old row:',
        oldRow,
        '; New row:',
        newRow
      )

      // Determine if the oldRow is a new row
      const isNewRow = validateRowStructure(gridType, oldRow)

      const gridID = getGridID(gridType)
      const fetchProcessQuery = createProcessQuery(
        currentSite?.schemaName ?? '',
        gridType
      )

      if (newRow[gridID] === '') {
        throw new Error(`Primary key ${gridID} cannot be empty!`)
      }

      try {
        let response, responseJSON
        // If oldRow code is empty, it's a new row insertion
        if (isNewRow) {
          response = await fetch(fetchProcessQuery, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(newRow)
          })
          responseJSON = await response.json()
          if (response.status > 299 || response.status < 200)
            throw new Error(responseJSON.message || 'Insertion failed')
          setSnackbar({children: `New row added!`, severity: 'success'})
        } else {
          // If code is not empty, it's an update
          const mutation = computeMutation(gridType, newRow, oldRow)
          if (mutation) {
            response = await fetch(fetchProcessQuery, {
              method: 'PATCH',
              headers: {'Content-Type': 'application/json'},
              body: JSON.stringify({oldRow: oldRow, newRow: newRow})
            })
            responseJSON = await response.json()
            if (response.status > 299 || response.status < 200)
              throw new Error(responseJSON.message || 'Update failed')
            setSnackbar({children: `Row updated!`, severity: 'success'})
          }
        }

        // After save or update, reset isNewRowAdded if necessary and refresh data
        if (oldRow.isNew) {
          setIsNewRowAdded(false) // We are done adding a new row
          // Now we can refetch data for the current page without adding a new row
          setShouldAddRowAfterFetch(false) // Ensure we do not add a row during fetch
          if (gridType === 'census' || gridType === 'quadrats') {
            try {
              await updateQuadratsContext()
              await updateCensusContext()
              await updatePlotsContext()
            } catch (error: any) {
              console.error(error)
            }
          }
          await fetchPaginatedData(paginationModel.page)
        }

        return newRow
      } catch (error: any) {
        setSnackbar({children: error.message, severity: 'error'})
        throw error
      }
    },
    [
      setSnackbar,
      setIsNewRowAdded,
      fetchPaginatedData,
      paginationModel.page,
      gridType
    ]
  )

  const handleRowModesModelChange = (newRowModesModel: GridRowModesModel) => {
    setRowModesModel(newRowModesModel)
  }
  const handleCloseSnackbar = () => setSnackbar(null)

  const handleRowEditStop: GridEventListener<'rowEditStop'> = (
    params,
    event
  ) => {
    if (params.reason === GridRowEditStopReasons.rowFocusOut) {
      event.defaultMuiPrevented = true
    }
  }

  const handleEditClick = (id: GridRowId) => () => {
    if (locked) return
    console.log('edit button')
    setRowModesModel({...rowModesModel, [id]: {mode: GridRowModes.Edit}})
  }

  const handleCancelClick = (id: GridRowId, event?: React.MouseEvent) => {
    if (locked) return
    console.log('cancel button')
    event?.preventDefault()

    const row = rows.find(r => r.id === id)
    if (row?.isNew) {
      // If it's a new row, remove it from the grid
      setRows(oldRows => oldRows.filter(row => row.id !== id))
      setIsNewRowAdded(false)

      // Adjust pagination if this was the only row on a new page
      if (rowCount % paginationModel.pageSize === 1 && isNewRowAdded) {
        const newPage =
          paginationModel.page - 1 >= 0 ? paginationModel.page - 1 : 0
        setPaginationModel({...paginationModel, page: newPage})
      }
    } else {
      // For existing rows, just switch the mode back to view
      setRowModesModel(oldModel => ({
        ...oldModel,
        [id]: {mode: GridRowModes.View, ignoreModifications: true}
      }))
    }
  }

  function getGridActionsColumn(): GridColDef {
    return {
      field: 'actions',
      type: 'actions',
      headerName: 'Actions',
      width: 100,
      cellClassName: 'actions',
      getActions: ({id}) => {
        if (locked) return []
        const isInEditMode = rowModesModel[id]?.mode === 'edit'

        if (isInEditMode) {
          return [
            <GridActionsCellItem
              icon={<SaveIcon/>}
              label='Save'
              key={'save'}
              onClick={handleSaveClick(id)}
            />,
            <GridActionsCellItem
              icon={<CancelIcon/>}
              label='Cancel'
              key={'cancel'}
              onClick={event => handleCancelClick(id, event)}
            />
          ]
        }

        return [
          <GridActionsCellItem
            icon={<EditIcon/>}
            label='Edit'
            key={'edit'}
            onClick={handleEditClick(id)}
          />,
          <GridActionsCellItem
            icon={<DeleteIcon/>}
            label='Delete'
            key={'delete'}
            onClick={handleDeleteClick(id)}
          />
        ]
      }
    }
  }

  const fetchValidationErrors = async () => {
    if (gridType !== 'measurementsSummary' || !currentSite) return
    try {
      const response = await fetch(
        `/api/validations/validationerrordisplay?schema=${currentSite?.schemaName ?? ''
        }`
      )
      const errors: CMError[] = await response.json()

      // Define the type of the accumulator as Record<number, CMError>
      const errorMap = errors.reduce<Record<number, CMError>>((acc, error) => {
        acc[error.CoreMeasurementID] = error
        return acc
      }, {})

      setValidationErrors(errorMap)
    } catch (error) {
      console.error('Error fetching validation errors:', error)
    }
  }

  // useEffect to fetch validation errors when component mounts or refreshes
  useEffect(() => {
    fetchValidationErrors().catch(console.error)
  }, [refresh])

  const cellHasError = (colField: string, rowId: GridRowId) => {
    const error = validationErrors[Number(rowId)]
    if (!error) return false
    const errorFields = error.ValidationErrorIDs.flatMap(
      id => errorMapping[id.toString()] || []
    )
    return errorFields.includes(colField)
  }

  const getCellErrorMessages = (colField: string, rowId: GridRowId) => {
    const error = validationErrors[Number(rowId)]
    if (!error) return ''

    // Map the ValidationErrorIDs to their descriptions.
    // Assuming that each ValidationErrorID corresponds to an entry in Descriptions array.
    return error.ValidationErrorIDs.filter(id =>
      errorMapping[id.toString()]?.includes(colField)
    )
      .map(id => {
        // Find the index of this id in ValidationErrorIDs array
        const index = error.ValidationErrorIDs.indexOf(id)
        // Return the corresponding description
        return error.Descriptions[index]
      })
      .join('; ')
  }

  // Modify gridColumns to include validation errors, but only for specific grid types
  const modifiedColumns = gridColumns.map(column => {
    // Apply custom renderCell only for specific grid types
    if (gridType === 'coreMeasurements' || gridType === 'measurementsSummary') {
      return {
        ...column,
        /**
         * Renders a cell for the datagrid. Checks for errors on the cell
         * and conditionally displays error messages below the cell value.
         */
        renderCell: (params: GridCellParams) => {
          const cellValue =
            params.value !== undefined ? params.value?.toString() : ''
          const cellError = cellHasError(column.field, params.id)
            ? getCellErrorMessages(column.field, params.id)
            : ''
          return (
            <Box
              sx={{
                display: 'flex',
                flex: 1,
                flexDirection: 'column',
                marginY: 1.5
              }}
            >
              {cellError ? (
                <>
                  <Typography
                    sx={{whiteSpace: 'normal', lineHeight: 'normal'}}
                  >
                    {cellValue}
                  </Typography>
                  <Typography
                    color={'danger'}
                    variant={'solid'}
                    sx={{
                      color: 'error.main',
                      fontSize: '0.75rem',
                      mt: 1,
                      whiteSpace: 'normal',
                      lineHeight: 'normal'
                    }}
                  >
                    {cellError}
                  </Typography>
                </>
              ) : (
                <Typography sx={{whiteSpace: 'normal', lineHeight: 'normal'}}>
                  {cellValue}
                </Typography>
              )}
            </Box>
          )
        }
      }
    } else {
      // For other grid types, maintain the default rendering
      return column
    }
  })

  // Use useMemo to construct columns array conditionally based on 'locked' prop
  const columns = useMemo(() => {
    const commonColumns = modifiedColumns // Assuming modifiedColumns is already defined in your component
    if (locked) {
      return commonColumns // Return only the common columns when grid is locked
    }
    return [...commonColumns, getGridActionsColumn()] // Include actions column when grid is not locked
  }, [modifiedColumns, locked]);

  // Use useMemo to dynamically filter out columns with all null values
  const filteredColumns = useMemo(() => filterColumns(rows, columns), [rows, columns]);

  // Function to check if any column in a row has an error
  const rowHasError = (rowId: GridRowId) => {
    return gridColumns.some(column => cellHasError(column.field, rowId))
  }

  // Updated visibleRows computation
  const visibleRows = useMemo(() => {
    if (gridType === 'measurementsSummary') {
      if (showErrorRows && showValidRows) {
        console.log('Showing all rows, including those with errors.')
        return rows
      } else if (showValidRows && !showErrorRows) {
        console.log('Filtering out rows with errors.')
        return rows.filter(row => !rowHasError(row.id))
      } else if (!showValidRows && showErrorRows) {
        return rows.filter(row => rowHasError(row.id))
      } else {
        return []
      }
    }
    return rows
  }, [rows, showErrorRows, showValidRows, gridType, gridColumns])

  // Count the number of rows with errors
  const errorRowCount = useMemo(() => {
    if (gridType === 'measurementsSummary') {
      return rows.filter(row => rowHasError(row.id)).length
    }
    return 0
  }, [rows, gridType, gridColumns])

  // Display snackbar when rows with errors are detected
  useEffect(() => {
    if (gridType === 'measurementsSummary' && errorRowCount > 0) {
      setSnackbar({
        children: `${errorRowCount} row(s) with validation errors detected.`,
        severity: 'warning'
      })
    }
  }, [errorRowCount, gridType])

  // Modify gridRows to include a custom class for rows with errors
  const getRowClassName = (params: GridRowParams) => {
    return rowHasError(params.id) ? 'error-row' : ''
  }

  if (!currentSite) {
    return <>You must select a site to continue!</>
  } else if (!currentPlot) {
    return <>You must select a plot to continue!</>
  } else {
    return (
      <Box
        sx={{
          width: '100%',
          '& .actions': {
            color: 'text.secondary'
          },
          '& .textPrimary': {
            color: 'text.primary'
          }
        }}
      >
        <Box sx={{width: '100%', flexDirection: 'column'}}>
          {gridType === 'measurementsSummary' && (
            <Stack direction={'row'}>
              <Box>
                <Checkbox
                  checked={showErrorRows}
                  onChange={handleShowErrorRowsChange}
                />
                Show rows with errors: ({errorRowCount})
              </Box>
              <Box>
                <Checkbox
                  checked={showValidRows}
                  onChange={handleShowValidRowsChange}
                />
                Show rows without errors: ({rows.length - errorRowCount})
              </Box>
              <Box>
                <ExportErrorsButton/>
                <Button color="primary" onClick={saveErrorRowsAsCSV}>
                  Save Errors as CSV
                </Button>
                <Button color="primary" onClick={printErrorRows}>
                  Print Errors
                </Button>
              </Box>
            </Stack>
          )}
          <Typography level={'title-lg'}>
            Note: The Grid is filtered by your selected Plot and Plot ID
          </Typography>
          <StyledDataGrid
            sx={{width: '100%'}}
            rows={visibleRows}
            columns={filteredColumns}
            editMode='row'
            rowModesModel={rowModesModel}
            onRowModesModelChange={handleRowModesModelChange}
            onRowEditStop={handleRowEditStop}
            processRowUpdate={processRowUpdate}
            loading={refresh}
            paginationMode='server'
            onPaginationModelChange={setPaginationModel}
            paginationModel={paginationModel}
            rowCount={rowCount}
            pageSizeOptions={[paginationModel.pageSize]}
            slots={{
              toolbar: EditToolbar
            }}
            slotProps={{
              toolbar: {
                locked: locked,
                handleAddNewRow: handleAddNewRow,
                handleRefresh: handleRefresh
              }
            }}
            autoHeight
            getRowHeight={() => 'auto'}
            getRowClassName={getRowClassName}
          />
        </Box>
        {!!snackbar && (
          <Snackbar
            open
            anchorOrigin={{vertical: 'bottom', horizontal: 'center'}}
            onClose={handleCloseSnackbar}
            autoHideDuration={6000}
          >
            <Alert {...snackbar} onClose={handleCloseSnackbar}/>
          </Snackbar>
        )}
        <ConfirmationDialog
          isOpen={isDialogOpen}
          onConfirm={handleConfirmAction}
          onCancel={handleCancelAction}
          message={
            pendingAction.actionType === 'save'
              ? 'Are you sure you want to save changes?'
              : 'Are you sure you want to delete this row?'
          }
        />
      </Box>
    )
  }
}

// ConfirmationDialog component with TypeScript types
const ConfirmationDialog: React.FC<ConfirmationDialogProps> = (props) => {
  const {isOpen, onConfirm, onCancel, message} = props;
  return (
    <Dialog open={isOpen} onClose={onCancel}>
      <DialogTitle>Confirm Action</DialogTitle>
      <DialogContent>
        <DialogContentText>
          {message}
        </DialogContentText>
      </DialogContent>
      <DialogActions>
        <Button onClick={onCancel} color="primary">
          Cancel
        </Button>
        <Button onClick={onConfirm} color="primary">
          Confirm
        </Button>
      </DialogActions>
    </Dialog>
  );
};