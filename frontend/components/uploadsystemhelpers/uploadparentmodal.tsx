"use client";

import {Button, IconButton, Modal, ModalDialog} from "@mui/joy";
import CloseIcon from "@mui/icons-material/Close";
import {Dispatch, SetStateAction, useState} from "react";
import UploadParent from "../uploadsystem/uploadparent";
import { useQuadratContext, useQuadratDispatch } from "@/app/contexts/userselectionprovider";

interface UPMProps {
  setRefresh: Dispatch<SetStateAction<boolean>>;
  formType: string;
}

export default function UploadParentModal(props: UPMProps) {
  const {setRefresh, formType} = props;
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  let currentQuadrat = useQuadratContext();
  let quadratDispatch = useQuadratDispatch();

  const handleOpenUploadModal = (): void => {
    setIsUploadModalOpen(true);
  };

  const handleCloseUploadModal = (): void => {
    setIsUploadModalOpen(false);
if (currentQuadrat !== null) quadratDispatch && quadratDispatch({quadrat: null});
    setRefresh(true); // Trigger refresh of DataGrid
  };
  return (
    <>
      <Button onClick={handleOpenUploadModal} variant="solid" color="primary">Upload</Button>
      {/* Modal for upload */}
      <Modal
        open={isUploadModalOpen}
        onClose={() => {
        }}
        aria-labelledby="upload-dialog-title"
        sx={{display: 'flex', alignItems: 'center', justifyContent: 'center'}}
      >
        <ModalDialog
          size="lg"
          sx={{width: '100%', maxHeight: '100vh', overflow: 'auto'}}
          role="alertdialog"
        >
          <IconButton
            aria-label="close"
            onClick={handleCloseUploadModal}
            sx={{position: 'absolute', top: 8, right: 8}}
          >
            <CloseIcon/>
          </IconButton>
          <UploadParent setIsUploadModalOpen={setIsUploadModalOpen} onReset={handleCloseUploadModal}
                        overrideUploadForm={formType}/>
        </ModalDialog>
      </Modal>
    </>
  );
}