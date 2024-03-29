"use client";
import {GridRowModes, GridRowModesModel, GridRowsProp} from "@mui/x-data-grid";
import {AlertProps} from "@mui/material";
import React, {useState} from "react";
import {SpeciesGridColumns} from "@/config/sqlmacros";
import {usePlotContext} from "@/app/contexts/userselectionprovider";
import {randomId} from "@mui/x-data-grid-generator";
import DataGridCommons from "@/components/datagridcommons";
import {useSession} from "next-auth/react";
import {Box, Button, Modal, ModalClose, ModalDialog, Typography} from "@mui/joy";
import UploadParent from "@/components/uploadsystem/uploadparent";

export default function SpeciesPage() {
  const initialRows: GridRowsProp = [
    {
      id: 0,
      speciesID: 0,
      speciesName: '',
      speciesCode: '',
      defaultDBHMin: 0,
      defaultDBHMax: 0,
      defaultHOMMin: 0,
      defaultHOMMax: 0,
      idLevel: '',
      authority: '',
      fieldFamily: '',
      description: '',
      referenceID: 0,
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
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const {data: session} = useSession();
  const handleOpenUploadModal = (): void => {
    setIsUploadModalOpen(true);
  };

  const handleCloseUploadModal = (): void => {
    setIsUploadModalOpen(false);
    setRefresh(true); // Trigger refresh of DataGrid
  };
  let currentPlot = usePlotContext();

  const addNewRowToGrid = () => {
    const id = randomId();
    // New row object
    const nextSpeciesID = (rows.length > 0
      ? rows.reduce((max, row) => Math.max(row.speciesID, max), 0)
      : 0) + 1;

    const newRow = {
      id: id,
      speciesID: nextSpeciesID,
      speciesName: '',
      speciesCode: '',
      defaultDBHMin: 0,
      defaultDBHMax: 0,
      defaultHOMMin: 0,
      defaultHOMMax: 0,
      idLevel: '',
      authority: '',
      fieldFamily: '',
      description: '',
    };
    // Add the new row to the state
    setRows(oldRows => [...oldRows, newRow]);
    // Set editing mode for the new row
    setRowModesModel(oldModel => ({
      ...oldModel,
      [id]: {mode: GridRowModes.Edit, fieldToFocus: 'speciesName'},
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

          {/* Upload Button */}
          <Button onClick={handleOpenUploadModal} variant="solid" color="primary">Upload Measurements</Button>
        </Box>
      </Box>

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
        currentPlot={currentPlot}
        addNewRowToGrid={addNewRowToGrid}
      />

      {/* Modal for upload */}
      <Modal
        open={isUploadModalOpen}
        onClose={handleCloseUploadModal}
        aria-labelledby="upload-dialog-title"
        sx={{display: 'flex', alignItems: 'center', justifyContent: 'center'}}
      >
        <ModalDialog
          size="lg"
          sx={{width: '100%', maxHeight: '100vh', overflow: 'auto'}}
        >
          <ModalClose onClick={handleCloseUploadModal}/>
          <UploadParent setIsUploadModalOpen={setIsUploadModalOpen} onReset={handleCloseUploadModal} overrideUploadForm={"quadrats"}/>
          {/* Additional modal content if needed */}
        </ModalDialog>
      </Modal>
    </>
  );
}