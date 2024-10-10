'use client';

import { Chip, Divider, IconButton, Modal, ModalDialog, Stack, Typography } from '@mui/joy';
import CloseIcon from '@mui/icons-material/Close';
import MultilineSpeciesDataGrid from '@/components/datagrids/applications/multiline/multilinespeciesdatagrid';
import MultilineAttributesDataGrid from '@/components/datagrids/applications/multiline/multilineattributesdatagrid';
import MultilineQuadratsDataGrid from '@/components/datagrids/applications/multiline/multilinequadratsdatagrid';
import MultilinePersonnelDataGrid from '@/components/datagrids/applications/multiline/multilinepersonneldatagrid';
import MultilineMeasurementsDataGrid from '@/components/datagrids/applications/multiline/multilinemeasurementsdatagrid';
import { useEffect, useState } from 'react';
import { ReviewStates } from '@/config/macros/uploadsystemmacros';
import { useSiteContext } from '@/app/contexts/userselectionprovider';
import UploadValidation from '@/components/uploadsystem/segments/uploadvalidation';
import UploadUpdateValidations from '@/components/uploadsystem/segments/uploadupdatevalidations';

interface MultilineModalProps {
  isManualEntryFormOpen: boolean;
  handleCloseManualEntryForm: () => void;
  formType: string;
}

export default function MultilineModal(props: MultilineModalProps) {
  const { isManualEntryFormOpen, handleCloseManualEntryForm, formType } = props;

  const [changesSubmitted, setChangesSubmitted] = useState(false);
  const [openValidations, setOpenValidations] = useState(false);
  const [openUpdateValidations, setOpenUpdateValidations] = useState(false);
  const [tempReviewState, setTempReviewState] = useState<ReviewStates>(ReviewStates.VALIDATE);
  const currentSite = useSiteContext();

  function getDataGrid() {
    if (openValidations || openUpdateValidations) return null;
    switch (formType) {
      case 'species':
        return <MultilineSpeciesDataGrid setChangesSubmitted={setChangesSubmitted} />;
      case 'attributes':
        return <MultilineAttributesDataGrid setChangesSubmitted={setChangesSubmitted} />;
      case 'quadrats':
        return <MultilineQuadratsDataGrid setChangesSubmitted={setChangesSubmitted} />;
      case 'personnel':
        return <MultilinePersonnelDataGrid setChangesSubmitted={setChangesSubmitted} />;
      case 'measurements':
        return <MultilineMeasurementsDataGrid setChangesSubmitted={setChangesSubmitted} />;
    }
  }

  useEffect(() => {
    if (changesSubmitted) {
      if (formType === 'measurements' && tempReviewState === ReviewStates.VALIDATE) {
        setOpenValidations(true);
        setOpenUpdateValidations(false);
      }
    } else handleCloseManualEntryForm();
  }, [changesSubmitted]);

  useEffect(() => {
    // monitor changes in tempReviewState and trigger update once they're done
    if (openValidations && tempReviewState === ReviewStates.UPDATE) {
      setOpenValidations(false);
      setOpenUpdateValidations(true);
    }
  }, [tempReviewState]);

  return (
    <Modal
      open={isManualEntryFormOpen}
      onClose={() => {}}
      aria-labelledby="upload-dialog-title"
      sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}
    >
      <ModalDialog size="lg" sx={{ width: '100%', maxHeight: '100vh', overflow: 'auto' }} role="alertdialog">
        <IconButton aria-label="close" onClick={handleCloseManualEntryForm} sx={{ position: 'absolute', top: 8, right: 8 }}>
          <CloseIcon />
        </IconButton>
        <Typography level={'title-lg'} sx={{ marginY: 5, textAlign: 'center' }}>
          Manual Input Form - {formType.charAt(0).toUpperCase() + formType.slice(1)}
        </Typography>
        <Stack direction={'row'} spacing={2} divider={<Divider orientation={'vertical'} />} sx={{ alignSelf: 'center', justifyContent: 'center' }}>
          <Chip variant={'soft'} size={'lg'}>
            <Chip color={'primary'} variant={'soft'}>
              Alt/Opt
            </Chip>{' '}
            -{' '}
            <Chip color={'primary'} variant={'soft'}>
              n
            </Chip>
            : Create a new row
          </Chip>
          <Chip variant={'soft'} size={'lg'}>
            <Chip variant={'soft'} color={'primary'}>
              Save
            </Chip>{' '}
            your changes before finalizing
          </Chip>
          <Chip variant={'soft'} size={'lg'}>
            <Chip variant={'soft'} color={'primary'}>
              Finalize Changes
            </Chip>{' '}
            to submit your additions
          </Chip>
        </Stack>
        {openValidations && !openUpdateValidations && <UploadValidation schema={currentSite?.schemaName ?? ''} setReviewState={setTempReviewState} />}
        {openUpdateValidations && !openValidations && <UploadUpdateValidations schema={currentSite?.schemaName ?? ''} setReviewState={setTempReviewState} />}
        {getDataGrid()}
      </ModalDialog>
    </Modal>
  );
}
