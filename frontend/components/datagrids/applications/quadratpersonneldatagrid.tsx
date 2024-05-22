"use client";

import { Box, Typography } from "@mui/joy";
import { AlertProps } from "@mui/material";
import { GridColDef, GridRowModes, GridRowModesModel, GridRowsProp } from "@mui/x-data-grid";
import { randomId } from "@mui/x-data-grid-generator";
import { useSession } from "next-auth/react";
import React, { useEffect, useState } from "react";
import DataGridCommons from "../datagridcommons";
import { useCensusContext, usePlotContext, useQuadratContext, useSiteContext } from "@/app/contexts/userselectionprovider";
import { useDataValidityContext } from "@/app/contexts/datavalidityprovider";

export default function QuadratPersonnelDataGrid() {
  const initialRows: GridRowsProp = [{
    id: 0,
    quadratPersonnelID: 0,
    quadratID: 0,
    personnelID: 0,
  }];
  const [rows, setRows] = useState(initialRows);
  const [rowCount, setRowCount] = useState(0);  // total number of rows
  const [rowModesModel, setRowModesModel] = useState<GridRowModesModel>({});
  const [snackbar, setSnackbar] = useState<Pick<
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
  const { data: session } = useSession();

  const [quadratOptions, setQuadratOptions] = useState<{ label: string; value: number; }[]>([]);
  const [personnelOptions, setPersonnelOptions] = useState<{ label: string; value: number; }[]>([]);

  let currentSite = useSiteContext();
  let currentPlot = usePlotContext();
  let currentCensus = useCensusContext();
  let { validity } = useDataValidityContext();

  const addNewRowToGrid = () => {
    const id = randomId();
    const nextQuadratPersonnelID = (rows.length > 0
      ? rows.reduce((max, row) => Math.max(row.quadratPersonnelID, max), 0)
      : 0) + 1;
    const newRow = {
      id: id,
      quadratPersonnelID: nextQuadratPersonnelID + 1,
      quadratID: null,
      personnelID: null,
      isNew: true,
    };
    // Add the new row to the state
    setRows(oldRows => [...oldRows, newRow]);
    // Set editing mode for the new row
    setRowModesModel(oldModel => ({
      ...oldModel,
      [id]: { mode: GridRowModes.Edit, fieldToFocus: 'quadratID' },
    }));
  };

  useEffect(() => {
    const fetchOptions = async () => {
      const quadratResponse = await fetch(`/api/fetchall/quadrats/${currentPlot?.plotID}/${currentCensus?.censusID}?schema=${currentSite?.schemaName}`);
      const quadratData = await quadratResponse.json();
      if (quadratData.length === 0) throw new Error("quadratData fetchall is empty");
      setQuadratOptions(quadratData.map((item: any) => ({
        label: item.quadratName, // Adjust based on your data structure
        value: item.quadratID,
      })));

      const personnelResponse = await fetch(`/api/fetchall/personnel?schema=${currentSite?.schemaName}`);
      const personnelData = await personnelResponse.json();
      if (personnelData.length === 0) throw new Error("personnelData fetchall is empty");
      setPersonnelOptions(personnelData.map((person: any) => ({
        label: `${person.firstName} ${person.lastName}`, // Adjust based on your data structure
        value: person.personnelID,
      })));
    };
    if (currentSite && currentPlot && currentCensus) fetchOptions().catch(console.error);
  }, [currentSite, currentPlot, currentCensus]);

  const QuadratPersonnelGridColumns: GridColDef[] = [
    { field: 'quadratPersonnelID', headerName: 'ID', headerClassName: 'header', minWidth: 75, align: 'left', editable: false },
    {
      field: 'quadratID',
      headerName: 'Quadrat ID',
      headerClassName: 'header',
      flex: 1,
      minWidth: 140,
      align: 'left',
      type: 'singleSelect',
      valueOptions: quadratOptions,
      editable: true,
    },
    {
      field: 'personnelID',
      headerName: 'Personnel ID',
      headerClassName: 'header',
      flex: 1,
      minWidth: 140,
      align: 'left',
      type: 'singleSelect',
      valueOptions: personnelOptions, 
      editable: true,
    },
  ];

  return (
    <>
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 3, width: '100%' }}>
        <Box sx={{
          width: '100%',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          backgroundColor: 'warning.main',
          borderRadius: '4px',
          p: 2
        }}>
          <Box sx={{ flexGrow: 1 }}>
            {session?.user.isAdmin && (
              <Typography level={"title-lg"} sx={{ color: "#ffa726" }}>
                Note: ADMINISTRATOR VIEW
              </Typography>
            )}
          </Box>

        </Box>
      </Box>
      <DataGridCommons
        locked={!validity['quadratpersonnel']}
        gridType="quadratpersonnel"
        gridColumns={QuadratPersonnelGridColumns}
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
