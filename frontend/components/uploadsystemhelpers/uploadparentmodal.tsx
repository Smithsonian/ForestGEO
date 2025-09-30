'use client';

import { IconButton, Modal, ModalDialog } from '@mui/joy';
import CloseIcon from '@mui/icons-material/Close';

import UploadParent from '../uploadsystem/uploadparent';
import { FormType } from '@/config/macros/formdetails';

interface UPMProps {
  isUploadModalOpen: boolean;
  handleCloseUploadModal: () => void;
  formType: FormType;
  skipToProcessing?: boolean; // Skip file upload and go directly to batch processing
}

export default function UploadParentModal(props: UPMProps) {
  const { formType, handleCloseUploadModal, isUploadModalOpen, skipToProcessing } = props;

  return (
    <>
      <Modal
        open={isUploadModalOpen}
        onClose={handleCloseUploadModal}
        aria-labelledby="upload-dialog-title"
        aria-describedby="upload-dialog-description"
        sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      >
        <ModalDialog
          size="lg"
          sx={{ width: '100%', maxHeight: '100vh', overflow: 'auto' }}
          role="dialog"
          aria-labelledby="upload-dialog-title"
          aria-describedby="upload-dialog-description"
        >
          <IconButton
            aria-label={`Close ${formType} upload dialog`}
            onClick={handleCloseUploadModal}
            sx={{ position: 'absolute', top: 8, right: 8 }}
            onKeyDown={event => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                handleCloseUploadModal();
              }
            }}
          >
            <CloseIcon />
          </IconButton>
          <div id="upload-dialog-title" className="sr-only">
            {formType.charAt(0).toUpperCase() + formType.slice(1)} File Upload Dialog
          </div>
          <div id="upload-dialog-description" className="sr-only">
            Upload {formType} data files to the ForestGEO database system. Navigate using Tab key, activate buttons with Enter or Space.
          </div>
          <UploadParent onReset={handleCloseUploadModal} overrideUploadForm={formType} skipToProcessing={skipToProcessing} />
        </ModalDialog>
      </Modal>
    </>
  );
}
