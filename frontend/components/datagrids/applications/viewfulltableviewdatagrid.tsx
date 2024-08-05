// viewfulltable view datagrid
"use client";

import { useOrgCensusContext } from "@/app/contexts/userselectionprovider";
import { initialViewFullTableViewRDS } from "@/config/sqlrdsdefinitions/views/viewfulltableviewrds";
import { Box, Typography } from "@mui/joy";
import { AlertProps } from "@mui/material";
import { GridRowsProp } from "@mui/x-data-grid";
import { randomId } from "@mui/x-data-grid-generator";
import { useSession } from "next-auth/react";
import { useState } from "react";
import { ViewFullTableGridColumns } from "@/components/client/datagridcolumns";

import DataGridCommons from "../datagridcommons";

export default function ViewFullTableViewDataGrid() {
  const [rows, setRows] = useState<GridRowsProp>([initialViewFullTableViewRDS] as GridRowsProp);
  const [rowCount, setRowCount] = useState(0);
  const [rowModesModel, setRowModesModel] = useState({});
  const [snackbar, setSnackbar] = useState<Pick<AlertProps, "children" | "severity"> | null>(null);
  const [refresh, setRefresh] = useState(false);
  const [paginationModel, setPaginationModel] = useState({
    page: 0,
    pageSize: 10
  });
  const [isNewRowAdded, setIsNewRowAdded] = useState(false);
  const [shouldAddRowAfterFetch, setShouldAddRowAfterFetch] = useState(false);
  const { data: session } = useSession();
  const currentCensus = useOrgCensusContext();

  const addNewRowToGrid = () => {
    const id = randomId();
    const newRow = {
      ...initialViewFullTableViewRDS,
      id,
      isNew: true
    };

    setRows(oldRows => [...(oldRows ?? []), newRow]);
    setRowModesModel(oldModel => ({
      ...oldModel,
      [id]: { mode: "edit", fieldToFocus: "speciesCode" }
    }));
    console.log("viewfulltableview addnewrowtogrid triggered");
  };

  return (
    <>
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          mb: 3,
          width: "100%",
          flexDirection: "column"
        }}
      >
        <Box
          sx={{
            width: "100%",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            backgroundColor: "warning.main",
            borderRadius: "4px",
            p: 2
          }}
        >
          <Box sx={{ flexGrow: 1 }}>
            {session?.user.userStatus !== "fieldcrew" && (
              <Typography level="title-lg" sx={{ color: "#ffa726" }}>
                Note: ADMINISTRATOR VIEW
              </Typography>
            )}
          </Box>
        </Box>

        <DataGridCommons
          gridType="viewfulltableview"
          gridColumns={ViewFullTableGridColumns}
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
      </Box>
    </>
  );
}
