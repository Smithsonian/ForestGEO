'use client';
import {GridRowModes, GridRowModesModel, GridRowsProp} from "@mui/x-data-grid";
import {AlertProps} from "@mui/material";
import React, {useState} from "react";
import {CoreMeasurementsGridColumns} from "@/config/sqlmacros";
import {usePlotContext} from "@/app/contexts/userselectionprovider";
import {randomId} from "@mui/x-data-grid-generator";
import DataGridCommons from "@/components/datagridcommons";
import {Box, Button, Modal, ModalClose, ModalDialog} from "@mui/joy";
import Typography from "@mui/joy/Typography";
import {useSession} from "next-auth/react";
import UploadParent from "@/components/uploadsystem/uploadparent";

export default function CoreMeasurementsPage() {
  const {data: session} = useSession();
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
      userDefinedFields: ''
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
              {session?.user.isAdmin ? (
                <>
                  <Typography level={"title-lg"} sx={{color: "#ffa726"}}>
                    Note: ADMINISTRATOR VIEW
                  </Typography>
                  <Typography level={"body-md"} sx={{color: "#ffa726"}}>
                    Add/Delete/Modify settings have been activated. <br/>
                    Please be careful! Changes to this table will be moved to the stored database and will require
                    administrator privileges to undo/remove.
                  </Typography>
                </>
              ) : (
                <>
                  <Typography level={"title-lg"} sx={{color: "#ffa726"}}>
                    Note: This is a locked view and will not allow modification.
                  </Typography>
                  <Typography level={"body-md"} sx={{color: "#ffa726"}}>
                    Please use this view as a way to confirm changes made to measurements.
                  </Typography>
                </>
              )}
            </Box>

            {/* Upload Button */}
            <Button onClick={handleOpenUploadModal} variant="solid" color="primary">Upload Data</Button>
          </Box>
        </Box>

        <DataGridCommons
          locked={!session?.user.isAdmin}
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
}