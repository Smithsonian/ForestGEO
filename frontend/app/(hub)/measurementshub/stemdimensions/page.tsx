"use client";
import {GridRowModes, GridRowModesModel, GridRowsProp} from "@mui/x-data-grid";
import {AlertProps} from "@mui/material";
import React, {useState} from "react";
import {StemDimensionsGridColumns} from '@/config/sqlrdsdefinitions/views/stemdimensionsviewrds';
import {usePlotContext} from "@/app/contexts/userselectionprovider";
import {randomId} from "@mui/x-data-grid-generator";
import DataGridCommons from "@/components/datagridcommons";
import {useSession} from "next-auth/react";
import {Box, Typography} from "@mui/joy";
import UploadParentModal from "@/components/uploadsystemhelpers/uploadparentmodal";

export default function StemTreeDetailsPage() {
  const initialRows: GridRowsProp = [
    {
      id: 0,
      stemID: 0,
      stemTag: '',
      treeID: 0,
      treeTag: '',
      familyName: null,
      genusName: null,
      speciesName: null,
      subSpeciesName: null,
      quadratName: null,
      plotName: null,
      locationName: null,
      countryName: null,
      quadratDimensionX: null,
      quadratDimensionY: null,
      stemQuadX: null,
      stemQuadY: null,
      stemDescription: null,
    },
  ];
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
  const {data: session} = useSession();
  // Function to fetch paginated data
  const addNewRowToGrid = () => {
    const id = randomId();
    // New row object
    const nextStemID = (rows.length > 0
      ? rows.reduce((max, row) => Math.max(row.stemID, max), 0)
      : 0) + 1;

    const newRow = {
      id: id,
      stemID: nextStemID,
      stemTag: '',
      treeID: 0,
      treeTag: '',
      familyName: null,
      genusName: null,
      speciesName: null,
      subSpeciesName: null,
      quadratName: null,
      plotName: null,
      locationName: null,
      countryName: null,
      quadratDimensionX: null,
      quadratDimensionY: null,
      stemQuadX: null,
      stemQuadY: null,
      stemDescription: null,
      isNew: true
    };
    // Add the new row to the state
    setRows(oldRows => [...oldRows, newRow]);
    // Set editing mode for the new row
    setRowModesModel(oldModel => ({
      ...oldModel,
      [id]: {mode: GridRowModes.Edit, fieldToFocus: 'stemTag'},
    }));
  };
  return (
    <>
      <Box sx={{display: 'flex', alignItems: 'center', mb: 3, width: '100%'}}>
        <Box sx={{
          width: '100%',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          backgroundColor: 'warning.main',
          borderRadius: '4px',
          p: 2
        }}>
          <Box sx={{flexGrow: 1}}>
            {session?.user.isAdmin && (
              <Typography level={"title-lg"} sx={{color: "#ffa726"}}>
                Note: ADMINISTRATOR VIEW
              </Typography>
            )}
            <Typography level={"title-md"} sx={{color: "#ffa726"}}>
              Note: This is a locked view and will not allow modification.
            </Typography>
            <Typography level={"body-md"} sx={{color: "#ffa726"}}>
              Please use this view as a way to confirm changes made to measurements.
            </Typography>
          </Box>
        </Box>
      </Box>

      <DataGridCommons
        locked={true}
        gridType="stemdimensionsview"
        gridColumns={StemDimensionsGridColumns}
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
        addNewRowToGrid={addNewRowToGrid}
      />
    </>
  );
}