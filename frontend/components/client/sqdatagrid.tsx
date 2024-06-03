"use client";

import { useOrgCensusContext, usePlotContext, useQuadratContext, useSiteContext } from "@/app/contexts/userselectionprovider";
import { SubquadratGridColumns } from "@/config/sqlrdsdefinitions/tables/subquadratrds";
import { AlertProps } from "@mui/material";
import { Box } from "@mui/system";
import { GridRowsProp, GridRowModesModel, GridRowModes, GridColDef } from "@mui/x-data-grid";
import { randomId } from "@mui/x-data-grid-generator";
import { useSession } from "next-auth/react";
import React, { useEffect, useState } from "react";
import DataGridCommons from "../datagrids/datagridcommons";
import { Typography } from "@mui/joy";

export default function SubquadratsDataGrid() {
  let currentQuadrat = useQuadratContext();
  const initialRows: GridRowsProp = [
    {
      id: 0,
      subquadratID: 0,
      subquadratName: '',
      quadratID: undefined,
      xIndex: 0,
      yIndex: 0,
      sqIndex: 0,
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
  const { data: session } = useSession();
  const currentPlot = usePlotContext();
  const currentCensus = useOrgCensusContext();
  const currentSite = useSiteContext();
  const [quadratOptions, setQuadratOptions] = useState<{ label: string; value: number; }[]>([]);

  useEffect(() => {
    const fetchOptions = async () => {
      const quadratResponse = await fetch(`/api/fetchall/quadrats/${currentPlot?.plotID}/${currentCensus?.plotCensusNumber}?schema=${currentSite?.schemaName}`);
      const quadratData = await quadratResponse.json();
      if (quadratData.length === 0) throw new Error("quadratData fetchall is empty");
      setQuadratOptions(quadratData.map((item: any) => ({
        label: item.quadratName, // Adjust based on your data structure
        value: item.quadratID,
      })));
    };
    if (currentSite && currentPlot && currentCensus) fetchOptions().catch(console.error);
  }, [currentSite, currentPlot, currentCensus]);
  const modifiedSubquadratGridColumns: GridColDef[] = SubquadratGridColumns.map((col) => {
    if (col.field === 'quadratID') {
      return {
        ...col,
        type: 'singleSelect',
        valueOptions: quadratOptions,
        editable: true,
      };
    }
    return col;
  });
  
  // Function to fetch paginated data
  const addNewRowToGrid = () => {
    const id = randomId();
    // New row object
    const nextSubQuadratID = (rows.length > 0
      ? rows.reduce((max, row) => Math.max(row.subquadratID, max), 0)
      : 0) + 1;
      const nextSQIndex = (rows.length > 0
        ? rows.reduce((max, row) => Math.max(row.sqIndex, max), 0)
        : 0) + 1;
      
    const newRow = {
      id: id,
      subquadratID: nextSubQuadratID,
      subquadratName: '',
      quadratID: undefined,
      xIndex: 0,
      yIndex: 0,
      sqIndex: nextSQIndex,
      isNew: true
    };
    // Add the new row to the state
    setRows(oldRows => [...oldRows, newRow]);
    // Set editing mode for the new row
    setRowModesModel(oldModel => ({
      ...oldModel,
      [id]: { mode: GridRowModes.Edit, fieldToFocus: 'subquadratName' },
    }));
  };
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
            <Typography level={"title-md"} sx={{ color: "#ffa726x`" }}>
              Note: This is a locked view and will not allow modification.
            </Typography>
            <Typography level={"body-md"} sx={{ color: "#ffa726" }}>
              Please use this view as a way to confirm changes made to measurements.
            </Typography>
          </Box>

        </Box>
      </Box>

      <DataGridCommons
        gridType="subquadrats"
        gridColumns={SubquadratGridColumns}
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
