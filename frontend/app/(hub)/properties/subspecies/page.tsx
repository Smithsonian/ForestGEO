"use client";
import {GridRowModes, GridRowModesModel, GridRowsProp} from "@mui/x-data-grid";
import {AlertProps} from "@mui/material";
import React, {useState} from "react";
import {AttributeGridColumns} from "@/config/sqlmacros";
import {usePlotContext} from "@/app/contexts/userselectionprovider";
import {randomId} from "@mui/x-data-grid-generator";
import DataGridCommons from "@/components/datagridcommons";

export default function SubSpeciesPage() {
  const initialRows: GridRowsProp = [
    {
      id: 0,
      subSpeciesID: 0,
      speciesID: 0,
      subSpeciesName: '',
      subSpeciesCode: '',
      currentTaxonFlag: false,
      obsoleteTaxonFlag: false,
      authority: '',
      infraSpecificLevel: ''
    },
  ]
  const [rows, setRows] = React.useState(initialRows);
  const [rowCount, setRowCount] = useState(0);  // total number of rows
  const [rowModesModel, setRowModesModel] = React.useState<GridRowModesModel>({});
  const [snackbar, setSnackbar] = React.useState<Pick<
    AlertProps,
    'children' | 'severity'
  > | null>(null);
  const [refresh, setRefresh] = useState(false);
  const [paginationModel, setPaginationModel] = useState({
    page: 0,
    pageSize: 10,
  });
  const [isNewRowAdded, setIsNewRowAdded] = useState<boolean>(false);
  const [shouldAddRowAfterFetch, setShouldAddRowAfterFetch] = useState(false);
  let currentPlot = usePlotContext();
  const addNewRowToGrid = () => {
    const id = randomId();
    // New row object
    const nextSubSpeciesID = (rows.length > 0
      ? rows.reduce((max, row) => Math.max(row.speciesID, max), 0)
      : 0) + 1;

    const newRow = {
      id: id,
      subSpeciesID: nextSubSpeciesID,
      speciesID: 0,
      subSpeciesName: '',
      subSpeciesCode: '',
      currentTaxonFlag: false,
      obsoleteTaxonFlag: false,
      authority: '',
      infraSpecificLevel: ''
    };
    // Add the new row to the state
    setRows(oldRows => [...oldRows, newRow]);
    // Set editing mode for the new row
    setRowModesModel(oldModel => ({
      ...oldModel,
      [id]: {mode: GridRowModes.Edit, fieldToFocus: 'subSpeciesID'},
    }));
  };

  return (
    <DataGridCommons
      gridType="attributes"
      gridColumns={AttributeGridColumns}
      rows={rows}
      setRows={setRows}
      rowCount={rowCount}
      setRowCount={setRowCount}
      rowModesModel={rowModesModel}
      setRowModesModel={setRowModesModel}
      snackbar={snackbar}
      setSnackbar={setSnackbar}
      refresh={refresh}
      setRefresh={setRefresh}
      paginationModel={paginationModel}
      setPaginationModel={setPaginationModel}
      isNewRowAdded={isNewRowAdded}
      setIsNewRowAdded={setIsNewRowAdded}
      shouldAddRowAfterFetch={shouldAddRowAfterFetch}
      setShouldAddRowAfterFetch={setShouldAddRowAfterFetch}
      currentPlot={currentPlot}
      addNewRowToGrid={addNewRowToGrid}
    />
  );
}