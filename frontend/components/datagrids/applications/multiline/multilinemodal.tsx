'use client';

import { DialogTitle, IconButton, Modal, ModalDialog } from '@mui/joy';
import CloseIcon from '@mui/icons-material/Close';
import MultilineSpeciesDataGrid from '@/components/datagrids/applications/multiline/multilinespeciesdatagrid';
import MultilineAttributesDataGrid from '@/components/datagrids/applications/multiline/multilineattributesdatagrid';
import MultilineQuadratsDataGrid from '@/components/datagrids/applications/multiline/multilinequadratsdatagrid';
import MultilinePersonnelDataGrid from '@/components/datagrids/applications/multiline/multilinepersonneldatagrid';
import MultilineMeasurementsDataGrid from '@/components/datagrids/applications/multiline/multilinemeasurementsdatagrid';
import { useEffect, useState } from 'react';
import { ReviewStates } from '@/config/macros/uploadsystemmacros';
import { useSiteContext } from '@/app/contexts/compat-hooks';
import UploadValidation from '@/components/uploadsystem/segments/uploadvalidation';
import UploadUpdateValidations from '@/components/uploadsystem/segments/uploadupdatevalidations';
import RenderGridFormExplanations from '@/components/client/rendergridformexplanations';
import { FormType, getDataGridForForm } from '@/config/macros/formdetails';
import { useDataValidityContext } from '@/app/contexts/datavalidityprovider';
import Divider from '@mui/joy/Divider';

interface MultilineModalProps {
  isManualEntryFormOpen: boolean;
  handleCloseManualEntryForm: () => void;
  formType: FormType | `${FormType}`;
  onSubmitComplete?: () => void;
}

export default function MultilineModal(props: MultilineModalProps) {
  const { isManualEntryFormOpen, handleCloseManualEntryForm, formType, onSubmitComplete } = props;
  const referenceGridType = getDataGridForForm(formType as FormType);

  const [changesSubmitted, setChangesSubmitted] = useState(false);
  const [isSubmittingChanges, setIsSubmittingChanges] = useState(false);
  const [openValidations, setOpenValidations] = useState(false);
  const [openUpdateValidations, setOpenUpdateValidations] = useState(false);
  const [tempReviewState, setTempReviewState] = useState<ReviewStates>(ReviewStates.VALIDATE);
  const currentSite = useSiteContext();
  const { triggerRefresh } = useDataValidityContext();

  function getDataGrid() {
    if (openValidations || openUpdateValidations) return null;
    switch (formType) {
      case 'species':
        return <MultilineSpeciesDataGrid setChangesSubmitted={setChangesSubmitted} setIsSubmittingChanges={setIsSubmittingChanges} />;
      case 'attributes':
        return <MultilineAttributesDataGrid setChangesSubmitted={setChangesSubmitted} setIsSubmittingChanges={setIsSubmittingChanges} />;
      case 'quadrats':
        return <MultilineQuadratsDataGrid setChangesSubmitted={setChangesSubmitted} setIsSubmittingChanges={setIsSubmittingChanges} />;
      case 'personnel':
        return <MultilinePersonnelDataGrid setChangesSubmitted={setChangesSubmitted} setIsSubmittingChanges={setIsSubmittingChanges} />;
      case 'measurements':
        return <MultilineMeasurementsDataGrid setChangesSubmitted={setChangesSubmitted} setIsSubmittingChanges={setIsSubmittingChanges} />;
    }
  }

  const [hasRequestedClose, setHasRequestedClose] = useState(false);
  const isValidationStepOpen = openValidations || openUpdateValidations;
  const hasValidationFinished = tempReviewState !== ReviewStates.VALIDATE && tempReviewState !== ReviewStates.UPDATE;

  useEffect(() => {
    if (isManualEntryFormOpen) return;
    setChangesSubmitted(false);
    setOpenValidations(false);
    setOpenUpdateValidations(false);
    setTempReviewState(ReviewStates.VALIDATE);
    setHasRequestedClose(false);
  }, [isManualEntryFormOpen]);

  function requestCloseManualEntryForm() {
    setHasRequestedClose(true);
    handleCloseManualEntryForm();
  }

  useEffect(() => {
    if (!changesSubmitted) return;
    setChangesSubmitted(false);
    triggerRefresh();
    onSubmitComplete?.();
    if (formType === 'measurements') {
      setTempReviewState(ReviewStates.VALIDATE);
      setOpenValidations(true);
      setOpenUpdateValidations(false);
    } else {
      handleCloseManualEntryForm();
    }
  }, [changesSubmitted, formType, triggerRefresh, onSubmitComplete, handleCloseManualEntryForm]);

  useEffect(() => {
    if (openValidations && tempReviewState === ReviewStates.UPDATE) {
      setOpenValidations(false);
      setOpenUpdateValidations(true);
    }
  }, [tempReviewState, openValidations]);

  useEffect(() => {
    if (isValidationStepOpen && hasValidationFinished && !hasRequestedClose) {
      setHasRequestedClose(true);
      handleCloseManualEntryForm();
    }
  }, [isValidationStepOpen, hasValidationFinished, hasRequestedClose, handleCloseManualEntryForm]);

  return (
    <Modal
      open={isManualEntryFormOpen}
      onClose={() => {}}
      aria-labelledby="upload-dialog-title"
      sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}
    >
      <ModalDialog size="lg" sx={{ width: '100%', maxHeight: '100vh', overflow: 'auto' }} role="alertdialog" variant={'plain'}>
        <IconButton aria-label="close" onClick={requestCloseManualEntryForm} disabled={isSubmittingChanges} sx={{ position: 'absolute', top: 8, right: 8 }}>
          <CloseIcon />
        </IconButton>
        <DialogTitle sx={{ alignSelf: 'center', justifyContent: 'center' }} level={'h3'} color={'primary'}>
          Manual Input Form - {formType.charAt(0).toUpperCase() + formType.slice(1)}
        </DialogTitle>
        {referenceGridType && <RenderGridFormExplanations datagridType={referenceGridType} />}
        <Divider orientation={'horizontal'} sx={{ my: 2 }} />
        {openValidations && !openUpdateValidations && <UploadValidation schema={currentSite?.schemaName ?? ''} setReviewState={setTempReviewState} />}
        {openUpdateValidations && !openValidations && <UploadUpdateValidations schema={currentSite?.schemaName ?? ''} setReviewState={setTempReviewState} />}
        {getDataGrid()}
      </ModalDialog>
    </Modal>
  );
}
