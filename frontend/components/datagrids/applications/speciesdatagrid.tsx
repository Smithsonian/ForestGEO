"use client";
import { GridRowModes, GridRowModesModel, GridRowsProp } from "@mui/x-data-grid";
import { AlertProps } from "@mui/material";
import React, { useState } from "react";
import { useOrgCensusContext } from "@/app/contexts/userselectionprovider";
import { randomId } from "@mui/x-data-grid-generator";
import DataGridCommons from "@/components/datagrids/datagridcommons";
import { useSession } from "next-auth/react";
import { Box, Button, Typography } from "@mui/joy";
import UploadParentModal from "@/components/uploadsystemhelpers/uploadparentmodal";
import { SpeciesGridColumns } from "@/components/client/datagridcolumns";

export default function SpeciesDataGrid() {
  /**
   *   id?: number;
   speciesID?: number;
   genusID?: number;
   currentTaxonFlag?: boolean;
   obsoleteTaxonFlag?: boolean;
   speciesName?: string;
   subspeciesName?: string;
   speciesCode?: string;
   idLevel?: string;
   speciesAuthority?: string;
   subspeciesAuthority?: string;
   fieldFamily?: string;
   description?: string;
   referenceID?: number;
   */
  const initialRows: GridRowsProp = [
    {
      id: 0,
      speciesID: 0,
      speciesCode: "",
      speciesName: "",
      subspeciesName: "",
      defaultDBHMax: 0,
      idLevel: "",
      authority: "",
      fieldFamily: "",
      description: "",
      referenceID: 0
    }
  ];
  const [rows, setRows] = React.useState(initialRows);
  const [rowCount, setRowCount] = useState(0); // total number of rows
  const [rowModesModel, setRowModesModel] = React.useState<GridRowModesModel>({});
  const [snackbar, setSnackbar] = React.useState<Pick<AlertProps, "children" | "severity"> | null>(null);
  const [refresh, setRefresh] = useState(false);
  const [paginationModel, setPaginationModel] = useState({
    page: 0,
    pageSize: 10
  });
  const [isNewRowAdded, setIsNewRowAdded] = useState<boolean>(false);
  const [shouldAddRowAfterFetch, setShouldAddRowAfterFetch] = useState(false);
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const { data: session } = useSession();
  const currentCensus = useOrgCensusContext();
  const addNewRowToGrid = () => {
    const id = randomId();
    // New row object
    const nextSpeciesID = (rows.length > 0 ? rows.reduce((max, row) => Math.max(row.speciesID, max), 0) : 0) + 1;

    const newRow = {
      id: id,
      speciesCode: "",
      speciesID: nextSpeciesID,
      speciesName: "",
      subSpeciesName: "",
      defaultDBHMax: 0,
      idLevel: "",
      authority: "",
      fieldFamily: "",
      description: "",
      isNew: true
    };
    // Add the new row to the state
    setRows(oldRows => [...oldRows, newRow]);
    // Set editing mode for the new row
    setRowModesModel(oldModel => ({
      ...oldModel,
      [id]: { mode: GridRowModes.Edit, fieldToFocus: "speciesName" }
    }));
  };
  return (
    <>
      <Box sx={{ display: "flex", alignItems: "center", mb: 3, width: "100%" }}>
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
              <Typography level={"title-lg"} sx={{ color: "#ffa726" }}>
                Note: ADMINISTRATOR VIEW
              </Typography>
            )}
            <Typography level={"title-md"} sx={{ color: "#ffa726" }}>
              Note: This is a locked view and will not allow modification.
            </Typography>
            <Typography level={"body-md"} sx={{ color: "#ffa726" }}>
              Please use this view as a way to confirm changes made to measurements.
            </Typography>
          </Box>

          {/* Upload Button */}
          <Button onClick={() => setIsUploadModalOpen(true)} variant="solid" color="primary">
            Upload
          </Button>
        </Box>
      </Box>

      <UploadParentModal
        isUploadModalOpen={isUploadModalOpen}
        handleCloseUploadModal={() => {
          setIsUploadModalOpen(false);
          setRefresh(true);
        }}
        formType={"species"}
      />

      <DataGridCommons
        gridType="species"
        gridColumns={SpeciesGridColumns}
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
