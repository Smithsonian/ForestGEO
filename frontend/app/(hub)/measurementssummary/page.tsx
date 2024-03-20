'use client';
import React, {useState} from "react";
import {GridRowModes, GridRowModesModel, GridRowsProp} from "@mui/x-data-grid";
import {AlertProps} from "@mui/material";
import DataGridCommons from "@/components/datagridcommons";
import {MeasurementsSummaryGridColumns} from "@/config/sqlmacros";
import {Box, Button, Modal, ModalClose, ModalDialog, Typography} from "@mui/joy";
import {useSession} from "next-auth/react";
import {usePlotContext} from "@/app/contexts/userselectionprovider";
import {randomId} from "@mui/x-data-grid-generator";
import UploadParent from "@/components/uploadsystem/uploadparent";

export default function MeasurementsSummaryPage() {
  const {data: session} = useSession();
  const initialRows: GridRowsProp = [
    {
      id: 0,
      coreMeasurementID: 0,
      plotName: '',
      plotCensusNumber: 0,
      censusStartDate: new Date(),
      censusEndDate: new Date(),
      quadratName: '',
      treeTag: '',
      stemTag: '',
      stemQuadX: 0,
      stemQuadY: 0,
      stemQuadZ: 0,
      speciesName: '',
      subSpeciesName: '',
      genus: '',
      family: '',
      personnelName: '',
      measurementDate: new Date(),
      measuredDBH: 0.0,
      measuredHOM: 0.0,
      description: '',
      attributes: '',
      validationErrors: [],
    }
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
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const currentPlot = usePlotContext();
  if (currentPlot) console.log(`current plot name: ${currentPlot.key}`);

  const handleOpenUploadModal = (): void => {
    setIsUploadModalOpen(true);
  };

  const handleCloseUploadModal = (): void => {
    setIsUploadModalOpen(false);
    setRefresh(true); // Trigger refresh of DataGrid
  };

  const addNewRowToGrid = () => {
    const id = randomId();
    // Define new row structure based on MeasurementsSummaryRDS type
    const newRow = {
      id: id,
      coreMeasurementID: 0,
      plotName: '',
      plotCensusNumber: 0,
      censusStartDate: new Date(),
      censusEndDate: new Date(),
      quadratName: '',
      treeTag: '',
      stemTag: '',
      stemQuadX: 0,
      stemQuadY: 0,
      stemQuadZ: 0,
      speciesName: '',
      subSpeciesName: '',
      genus: '',
      family: '',
      personnelName: '',
      measurementDate: new Date(),
      measuredDBH: 0.0,
      measuredHOM: 0.0,
      description: '',
      attributes: '',
      validationErrors: [],
      isNew: true,
    };
    setRows(oldRows => [...oldRows, newRow]);
    setRowModesModel(oldModel => ({...oldModel, [id]: {mode: GridRowModes.Edit}}));
  };

  if (!currentPlot) {
    return <>You must select a Plot to continue!</>;
  }

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
          <Button onClick={handleOpenUploadModal} variant="solid" color="primary">Upload Data</Button>
        </Box>
      </Box>

      <DataGridCommons
        locked={true}
        gridType="measurementsSummary"
        gridColumns={MeasurementsSummaryGridColumns}
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
          <UploadParent setIsUploadModalOpen={setIsUploadModalOpen} onReset={handleCloseUploadModal}/>
          {/* Additional modal content if needed */}
        </ModalDialog>
      </Modal>
    </>
  );
}
