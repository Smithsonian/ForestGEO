'use client';

import { IconButton, Modal, ModalDialog } from '@mui/joy';
import CloseIcon from '@mui/icons-material/Close';

import UploadParent from '../uploadsystem/uploadparent';
import { FormType } from '@/config/macros/formdetails';
import { Dispatch, SetStateAction } from 'react';

interface UPMProps {
  isUploadModalOpen: boolean;
  handleCloseUploadModal: () => void;
  formType: FormType;
  msmtsUploadCompleted?: boolean;
  setMsmstsUploadCompleted?: Dispatch<SetStateAction<boolean>>;
}

export default function UploadParentModal(props: UPMProps) {
  const { formType, handleCloseUploadModal, isUploadModalOpen, msmtsUploadCompleted = undefined, setMsmstsUploadCompleted = undefined } = props;

  return (
    <>
      <Modal
        open={isUploadModalOpen}
        onClose={() => {}}
        aria-labelledby="upload-dialog-title"
        sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      >
        <ModalDialog size="lg" sx={{ width: '100%', maxHeight: '100vh', overflow: 'auto' }} role="alertdialog">
          <IconButton aria-label="close" onClick={handleCloseUploadModal} sx={{ position: 'absolute', top: 8, right: 8 }}>
            <CloseIcon />
          </IconButton>
          <UploadParent onReset={handleCloseUploadModal} overrideUploadForm={formType} setMsmtsUploadCompleted={setMsmstsUploadCompleted} />
        </ModalDialog>
      </Modal>
    </>
  );
}
