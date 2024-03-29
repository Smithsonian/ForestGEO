// attributes page
"use client";
import {GridRowsProp} from "@mui/x-data-grid";
import {AlertProps} from "@mui/material";
import React, {useState} from "react";
import {usePlotContext} from "@/app/contexts/userselectionprovider";
import {randomId} from "@mui/x-data-grid-generator";
import DataGridCommons from "@/components/datagridcommons";
import {AttributeGridColumns} from "@/config/sqlmacros";
import {Box, Button, Modal, ModalClose, ModalDialog, Typography } from "@mui/joy";
import UploadParent from "@/components/uploadsystem/uploadparent";
import {useSession} from "next-auth/react";

export default function AttributesPage() {
  const initialRows: GridRowsProp = [{id: 0, code: '', description: '', status: ''}];
  const [rows, setRows] = useState(initialRows);
  const [rowCount, setRowCount] = useState(0);
  const [rowModesModel, setRowModesModel] = useState({});
  const [snackbar, setSnackbar] = React.useState<Pick<
    AlertProps,
    'children' | 'severity'
  > | null>(null);
  const [refresh, setRefresh] = useState(false);
  const [paginationModel, setPaginationModel] = useState({page: 0, pageSize: 10});
  const [isNewRowAdded, setIsNewRowAdded] = useState(false);
  const [shouldAddRowAfterFetch, setShouldAddRowAfterFetch] = useState(false);
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const currentPlot = usePlotContext();
  const {data: session} = useSession();

  const handleOpenUploadModal = (): void => {
    setIsUploadModalOpen(true);
  };

  const handleCloseUploadModal = (): void => {
    setIsUploadModalOpen(false);
    setRefresh(true); // Trigger refresh of DataGrid
  };

  const addNewRowToGrid = () => {
    const id = randomId();
    const newRow = {id, code: '', description: '', status: '', isNew: true};
    setRows(oldRows => [...oldRows, newRow]);
    setRowModesModel(oldModel => ({
      ...oldModel,
      [id]: {mode: 'edit', fieldToFocus: 'code'},
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
          </Box>

          {/* Upload Button */}
          <Button onClick={handleOpenUploadModal} variant="solid" color="primary">Upload Attributes</Button>
        </Box>
      </Box>

      <DataGridCommons
        gridType="attributes"
        gridColumns={AttributeGridColumns}
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
          <UploadParent setIsUploadModalOpen={setIsUploadModalOpen} onReset={handleCloseUploadModal} overrideUploadForm={"attributes"}/>
          {/* Additional modal content if needed */}
        </ModalDialog>
      </Modal>
    </>
  );
}