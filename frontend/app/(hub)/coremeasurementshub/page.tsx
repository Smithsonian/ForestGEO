"use client";
import {GridRowModes, GridRowModesModel, GridRowsProp} from "@mui/x-data-grid";
import {AlertProps} from "@mui/material";
import React, {useState} from "react";
import {CoreMeasurementsGridColumns} from "@/config/sqlmacros";
import {usePlotContext} from "@/app/contexts/userselectionprovider";
import {randomId} from "@mui/x-data-grid-generator";
import DataGridCommons from "@/components/datagridcommons";
import {Box} from "@mui/joy";
import Typography from "@mui/joy/Typography";

export default function CoreMeasurementsPage() {
  const initialRows: GridRowsProp = [
    {
      id: 0,
      coreMeasurementID: 0,
      censusID: 0,
      plotID: 0,
      quadratID: 0,
      treeID: 0,
      stemID: 0,
      personnelID: 0,
      isRemeasurement: false,
      isCurrent: false,
      isPrimaryStem: false,
      isValidated: false,
      measurementDate: new Date(),
      measuredDBH: 0.0,
      measuredHOM: 0.0,
      description: '',
      userDefinedFields: '',
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
  if (currentPlot) console.log(`current plot ID: ${currentPlot.key}`);

  const addNewRowToGrid = () => {
    const id = randomId();
    const nextCoreMeasurementID = (rows.length > 0
      ? rows.reduce((max, row) => Math.max(row.coreMeasurementID, max), 0)
      : 0) + 1;
    // New row object
    const newRow = {
      id: id,
      coreMeasurementID: nextCoreMeasurementID,  // Assuming id and coreMeasurementID are the same
      censusID: 0,
      plotID: currentPlot ? currentPlot.id : 0,  // Make sure currentPlot is defined and has an id
      quadratID: 0,
      treeID: 0,
      stemID: 0,
      personnelID: 0,
      isRemeasurement: false,
      isCurrent: false,
      isPrimaryStem: false,
      isValidated: false,
      measurementDate: new Date(),
      measuredDBH: 0.0,
      measuredHOM: 0.0,
      description: '',
      userDefinedFields: '',
      isNew: true,
    };
    // Add the new row to the state
    setRows(oldRows => [...oldRows, newRow]);
    // Set editing mode for the new row
    setRowModesModel(oldModel => ({
      ...oldModel,
      [id]: {mode: GridRowModes.Edit, fieldToFocus: 'coreMeasurementID'},
    }));
  };

  if (!currentPlot) {
    return <>You must select a plot to continue!</>;
  } else {
    return (
      <>
        <Box sx={{display: 'flex', flexDirection: 'column'}}>
          <Typography variant={"solid"} level={"title-md"} color={"warning"}>
            Note: This is a locked view and will not allow modification.
          </Typography>
          <Typography variant={"solid"} level={"title-md"} color={"warning"}>
            Please use this view as a way to confirm changes made to measurements.
          </Typography>
        </Box>
        <DataGridCommons
          locked={true}
          gridType="coreMeasurements"
          gridColumns={CoreMeasurementsGridColumns}
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
      </>
    );
  }
}