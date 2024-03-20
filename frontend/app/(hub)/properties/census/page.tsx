"use client";
import {GridRowModes, GridRowModesModel, GridRowsProp} from "@mui/x-data-grid";
import {AlertProps} from "@mui/material";
import React, {useState} from "react";
import {CensusGridColumns} from "@/config/sqlmacros";
import {usePlotContext} from "@/app/contexts/userselectionprovider";
import {randomId} from "@mui/x-data-grid-generator";
import DataGridCommons from "@/components/datagridcommons";


export default function CensusPage() {
  const initialRows: GridRowsProp = [
    {
      id: 0,
      censusID: 0,
      plotID: 0,
      plotCensusNumber: 0,
      startDate: new Date(),
      endDate: new Date(),
      description: ''
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
    const nextCensusID = (rows.length > 0
      ? rows.reduce((max, row) => Math.max(row.censusID, max), 0)
      : 0) + 1;
    const newRow = {
      id: id,
      censusID: nextCensusID,
      plotID: currentPlot ? currentPlot.id : 0,
      plotCensusNumber: 0,
      startDate: new Date(),
      endDate: new Date(),
      description: '',
      isNew: true
    };
    // Add the new row to the state
    setRows(oldRows => [...oldRows, newRow]);
    // Set editing mode for the new row
    setRowModesModel(oldModel => ({
      ...oldModel,
      [id]: {mode: GridRowModes.Edit, fieldToFocus: 'censusID'},
    }));
  };

  return (
    <DataGridCommons
      gridType="census"
      gridColumns={CensusGridColumns}
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