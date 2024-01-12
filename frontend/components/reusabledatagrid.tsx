import React, {useCallback, useEffect, useState} from 'react';
import {
  DataGrid,
  GridActionsCellItem,
  GridColDef,
  GridEventListener,
  GridRowId,
  GridRowModel,
  GridRowModes,
  GridRowModesModel,
  GridRowsProp,
  GridToolbarContainer
} from '@mui/x-data-grid';
import {Button} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/DeleteOutlined';
import SaveIcon from '@mui/icons-material/Save';
import CancelIcon from '@mui/icons-material/Close';
import RefreshIcon from '@mui/icons-material/Refresh';

interface ReusableDataGridProps {
  fetchUrl: string;
  columns: GridColDef[];
  addNewRow: (newRow: GridRowModel) => Promise<GridRowModel>;
  updateRow: (newRow: GridRowModel, oldRow: GridRowModel) => Promise<GridRowModel>;
  deleteRow: (rowId: GridRowId) => Promise<void>;
}

/**
 * ai-generated. should be used later once parity is reached as a future feature
 * @param fetchUrl
 * @param columns
 * @param addNewRow
 * @param updateRow
 * @param deleteRow
 * @constructor
 */

const ReusableDataGrid: React.FC<ReusableDataGridProps> = ({
                                                             fetchUrl,
                                                             columns,
                                                             addNewRow,
                                                             updateRow,
                                                             deleteRow,
                                                           }) => {
  const [rows, setRows] = useState<GridRowsProp>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [rowModesModel, setRowModesModel] = useState<GridRowModesModel>({});

  const fetchRows = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(fetchUrl);
      const data = await response.json();
      setRows(data);
    } catch (error) {
      console.error('Failed to fetch data:', error);
    }
    setLoading(false);
  }, [fetchUrl]);

  useEffect(() => {
    fetchRows();
  }, [fetchRows]);

  const handleAddClick = () => {
    const id = new Date().getTime(); // Temporary ID before real one is assigned
    setRows((prevRows) => [
      ...prevRows,
      {id, isNew: true, _action: 'add'},
    ]);
    setRowModesModel((prevModel) => ({
      ...prevModel,
      [id]: {mode: GridRowModes.Edit},
    }));
  };

  const handleEditClick = (id: GridRowId) => () => {
    setRowModesModel((prevModel) => ({
      ...prevModel,
      [id]: {mode: GridRowModes.Edit},
    }));
  };

  const handleSaveClick = (id: GridRowId) => async () => {
    const row = rows.find((row) => row.id === id) as GridRowModel;
    if (row.isNew) {
      const newRow = await addNewRow(row);
      setRows((prevRows) =>
        prevRows.map((row) => (row.id === id ? newRow : row)),
      );
    } else {
      const oldRow = rows.find((row) => row.id === id) as GridRowModel;
      const updatedRow = await updateRow(row, oldRow);
      setRows((prevRows) =>
        prevRows.map((row) => (row.id === id ? updatedRow : row)),
      );
    }
    setRowModesModel((prevModel) => ({
      ...prevModel,
      [id]: {mode: GridRowModes.View},
    }));
  };

  const handleDeleteClick = (id: GridRowId) => async () => {
    await deleteRow(id);
    setRows((prevRows) => prevRows.filter((row) => row.id !== id));
  };

  const handleCancelClick = (id: GridRowId) => () => {
    setRows((prevRows) => prevRows.filter((row) => row.id !== id));
    setRowModesModel((prevModel) => ({
      ...prevModel,
      [id]: {mode: GridRowModes.View},
    }));
  };

  const handleRowEditStop: GridEventListener<'rowEditStop'> = (
    params,
    event,
  ) => {
    if (params.reason === 'rowFocusOut') {
      event.defaultMuiPrevented = true;
    }
  };

  const actionColumn: GridColDef = {
    field: 'actions',
    type: 'actions',
    headerName: 'Actions',
    width: 100,
    getActions: (params) => {
      const isInEditMode =
        rowModesModel[params.id]?.mode === GridRowModes.Edit;

      if (isInEditMode) {
        return [
          <GridActionsCellItem
            key={"save"}
            icon={<SaveIcon/>}
            label="Save"
            onClick={handleSaveClick(params.id)}
            color="inherit"
          />,
          <GridActionsCellItem
            key={"cancel"}
            icon={<CancelIcon/>}
            label="Cancel"
            onClick={handleCancelClick(params.id)}
            color="inherit"
          />,
        ];
      }

      return [
        <GridActionsCellItem
          key={"edit"}
          icon={<EditIcon/>}
          label="Edit"
          onClick={handleEditClick(params.id)}
          color="inherit"
        />,
        <GridActionsCellItem
          key={"delete"}
          icon={<DeleteIcon/>}
          label="Delete"
          onClick={handleDeleteClick(params.id)}
          color="inherit"
        />,
      ];
    },
  };

  const combinedColumns = [...columns, actionColumn];

  return (
    <div style={{height: 600, width: '100%'}}>
      <GridToolbarContainer>
        <Button color="primary" startIcon={<AddIcon/>} onClick={handleAddClick}>
          Add Row
        </Button>
        <Button
          color="primary"
          startIcon={<RefreshIcon/>}
          onClick={fetchRows}
        >
          Refresh
        </Button>
      </GridToolbarContainer>
      <DataGrid
        rows={rows}
        columns={combinedColumns}
        loading={loading}
        rowModesModel={rowModesModel}
        editMode="row"
        onRowEditStop={handleRowEditStop}
        getRowId={(row) => row.id}
      />
    </div>
  );
};

export default ReusableDataGrid;
