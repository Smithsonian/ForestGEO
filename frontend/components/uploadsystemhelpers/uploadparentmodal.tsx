'use client';

import { Box, Button, Card, CardActions, CardContent, Chip, IconButton, Modal, ModalDialog, Stack, Typography } from '@mui/joy';
import CloseIcon from '@mui/icons-material/Close';
import { useEffect, useState } from 'react';

import UploadParent from '../uploadsystem/uploadparent';
import { FormType } from '@/config/macros/formdetails';
import { UploadMode, UploadModeLabels } from '@/config/uploadmodes';

interface UPMProps {
  isUploadModalOpen: boolean;
  handleCloseUploadModal: () => void;
  formType: FormType;
  skipToProcessing?: boolean;
  onUploadComplete?: () => void;
}

function getRevisionMatchLabel(formType: FormType): string {
  switch (formType) {
    case FormType.attributes:
      return 'Code';
    case FormType.species:
      return 'SpeciesCode';
    case FormType.personnel:
      return 'FirstName + LastName';
    case FormType.quadrats:
      return 'QuadratName';
    case FormType.measurements:
      return 'tag + stemtag + quadrat';
    default:
      return 'matching key';
  }
}

export default function UploadParentModal(props: UPMProps) {
  const { formType, handleCloseUploadModal, isUploadModalOpen, skipToProcessing, onUploadComplete } = props;
  const requiresModeSelection = !skipToProcessing && formType !== FormType.measurements;
  const revisionMatchLabel = getRevisionMatchLabel(formType);
  const [uploadMode, setUploadMode] = useState<UploadMode | undefined>(requiresModeSelection ? undefined : UploadMode.CLEAN_REUPLOAD);

  useEffect(() => {
    if (!isUploadModalOpen) {
      setUploadMode(requiresModeSelection ? undefined : UploadMode.CLEAN_REUPLOAD);
    }
  }, [isUploadModalOpen, requiresModeSelection]);

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
          sx={{
            width: 'min(880px, calc(100vw - 32px))',
            maxWidth: 'calc(100vw - 32px)',
            maxHeight: 'min(760px, calc(100vh - 32px))',
            overflow: 'auto',
            p: { xs: 2, sm: 3 }
          }}
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
          {uploadMode ? (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {requiresModeSelection && (
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2, pr: 5 }}>
                  <Stack spacing={0.5}>
                    <Typography level="title-sm">Upload Mode</Typography>
                    <Typography level="body-sm">
                      {UploadModeLabels[uploadMode]} selected for this {formType} upload.
                    </Typography>
                  </Stack>
                  <Button size="sm" variant="outlined" onClick={() => setUploadMode(undefined)}>
                    Change
                  </Button>
                </Box>
              )}
              <UploadParent
                onReset={handleCloseUploadModal}
                overrideUploadForm={formType}
                overrideUploadMode={uploadMode}
                skipToProcessing={skipToProcessing}
                onUploadComplete={onUploadComplete}
              />
            </Box>
          ) : (
            <Stack spacing={2} sx={{ py: 3, px: 1 }}>
              <Typography level="h3">Choose Upload Mode</Typography>
              <Typography level="body-sm">Select how this {formType} CSV should be applied.</Typography>
              <Card variant="outlined">
                <CardContent>
                  <Stack spacing={1}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <Typography level="title-md">{UploadModeLabels[UploadMode.CLEAN_REUPLOAD]}</Typography>
                      <Chip color="danger" size="sm">
                        Destructive
                      </Chip>
                    </Box>
                    <Typography level="body-sm">Deletes all existing {formType} data, then inserts the uploaded file as the new source of truth.</Typography>
                  </Stack>
                </CardContent>
                <CardActions sx={{ justifyContent: 'flex-start' }}>
                  <Button color="danger" variant="outlined" onClick={() => setUploadMode(UploadMode.CLEAN_REUPLOAD)}>
                    Use Clean Re-Upload
                  </Button>
                </CardActions>
              </Card>
              <Card variant="outlined">
                <CardContent>
                  <Stack spacing={1}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <Typography level="title-md">{UploadModeLabels[UploadMode.REVISIONS]}</Typography>
                      <Chip color="success" size="sm">
                        Recommended
                      </Chip>
                    </Box>
                    <Typography level="body-sm">
                      Updates existing records matched by {revisionMatchLabel} (case-insensitive) and adds any new rows from the file.
                    </Typography>
                  </Stack>
                </CardContent>
                <CardActions sx={{ justifyContent: 'flex-start' }}>
                  <Button variant="outlined" onClick={() => setUploadMode(UploadMode.REVISIONS)}>
                    Use Revisions Upload
                  </Button>
                </CardActions>
              </Card>
            </Stack>
          )}
        </ModalDialog>
      </Modal>
    </>
  );
}
