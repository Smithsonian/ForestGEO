// DataGridCommons.tsx
import React from 'react';
import {
  GridActionsCellItem,
  GridColDef,
  GridRowId,
  GridRowModel,
  GridRowModesModel,
  GridRowsProp,
  GridToolbarContainer,
} from '@mui/x-data-grid';
import {Button} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/DeleteOutlined';
import SaveIcon from '@mui/icons-material/Save';
import CancelIcon from '@mui/icons-material/Close';
import RefreshIcon from '@mui/icons-material/Refresh';
import {Plot} from "@/config/macros";

export interface EditToolbarProps {
  setIsNewRowAdded: React.Dispatch<React.SetStateAction<boolean>>;
  rows: GridRowsProp;
  setRows: React.Dispatch<React.SetStateAction<GridRowsProp>>;
  setRowModesModel: React.Dispatch<React.SetStateAction<GridRowModesModel>>;
  setRefresh: React.Dispatch<React.SetStateAction<boolean>>;
  currentPlot: Plot;
  rowCount: number; // Total number of rows across all pages
  setRowCount: React.Dispatch<React.SetStateAction<number>>;
  paginationModel: { page: number, pageSize: number };
  onPaginationModelChange: React.Dispatch<React.SetStateAction<{ page: number, pageSize: number }>>;
  handleAddNewRow: () => void;
  handleRefresh: () => void;
}

export function EditToolbar(props: Readonly<EditToolbarProps>) {
  const {handleAddNewRow, handleRefresh} = props;

  return (
    <GridToolbarContainer>
      <Button color="primary" startIcon={<AddIcon/>} onClick={handleAddNewRow}>
        Add Row
      </Button>
      <Button color="primary" startIcon={<RefreshIcon/>} onClick={handleRefresh}>
        Refresh
      </Button>
    </GridToolbarContainer>
  );
}

export function computeMutation(newRow: GridRowModel, oldRow: GridRowModel, fields: Array<keyof any>) {
  return fields.some(field => newRow[field] !== oldRow[field]);
}

export function getGridActionsColumn(
  rowModesModel: GridRowModesModel,
  handleSaveClick: (id: GridRowId) => void,
  handleCancelClick: (id: GridRowId, event?: React.MouseEvent) => void,
  handleEditClick: (id: GridRowId) => void,
  handleDeleteClick: (id: GridRowId) => void,
): GridColDef {
  return {
    field: 'actions',
    type: 'actions',
    headerName: 'Actions',
    width: 100,
    cellClassName: 'actions',
    getActions: ({id}) => {
      const isInEditMode = rowModesModel[id]?.mode === 'edit';

      if (isInEditMode) {
        return [
          <GridActionsCellItem
            icon={<SaveIcon/>}
            label="Save"
            key={"save"}
            onClick={() => handleSaveClick(id)}
          />,
          <GridActionsCellItem
            icon={<CancelIcon/>}
            label="Cancel"
            key={"cancel"}
            onClick={(event) => handleCancelClick(id, event)}
          />,
        ];
      }

      return [
        <GridActionsCellItem
          icon={<EditIcon/>}
          label="Edit"
          key={"edit"}
          onClick={() => handleEditClick(id)}
        />,
        <GridActionsCellItem
          icon={<DeleteIcon/>}
          label="Delete"
          key={"delete"}
          onClick={() => handleDeleteClick(id)}
        />,
      ];
    },
  };
}
