'use client';

import { GridRowModel } from '@mui/x-data-grid';
import React, { useEffect, useState } from 'react';
import {
  Button,
  DialogActions,
  DialogContent,
  DialogTitle,
  Modal,
  ModalDialog,
  Step,
  stepClasses,
  StepIndicator,
  stepIndicatorClasses,
  Stepper,
  Typography
} from '@mui/joy';
import { getUpdatedValues } from '@/config/utils';
import MapperFactory from '@/config/datamapper';
import { useSiteContext } from '@/app/contexts/userselectionprovider';
import { Diversity2, Forest, Grass, GridView, PrecisionManufacturing } from '@mui/icons-material';
import { v4 } from 'uuid';

interface MSVEditingProps {
  gridType: string;
  oldRow: GridRowModel;
  newRow: GridRowModel;
  handleClose: () => void;
  handleSave: (confirmedRow: GridRowModel) => void;
}

export default function MSVEditingModal(props: MSVEditingProps) {
  const currentSite = useSiteContext();
  const { gridType, handleClose, oldRow, newRow, handleSave } = props;
  const updatedFields = getUpdatedValues(oldRow, newRow);
  const { coreMeasurementID, quadratID, treeID, stemID, speciesID } = newRow;
  const fieldGroups = {
    coremeasurements: ['measuredDBH', 'measuredHOM', 'measurementDate'],
    quadrats: ['quadratName'],
    trees: ['treeTag'],
    stems: ['stemTag', 'stemLocalX', 'stemLocalY'],
    species: ['speciesName', 'subspeciesName', 'speciesCode']
  };
  type UploadStatus = 'idle' | 'in-progress' | 'completed' | 'error';
  const [beginUpload, setBeginUpload] = useState(false);
  const [isConfirmStep, setIsConfirmStep] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<{
    [Key in keyof typeof fieldGroups]: UploadStatus;
  }>({
    coremeasurements: 'idle',
    quadrats: 'idle',
    trees: 'idle',
    stems: 'idle',
    species: 'idle'
  });
  const stepIcons = [<PrecisionManufacturing key={v4()} />, <GridView key={v4()} />, <Forest key={v4()} />, <Grass key={v4()} />, <Diversity2 key={v4()} />];

  const handleUpdate = async (groupName: keyof typeof fieldGroups, tableName: string, idColumn: string, idValue: any) => {
    console.log('handle update entered for group name: ', groupName);
    setUploadStatus(prev => ({
      ...prev,
      [groupName]: 'in-progress'
    }));
    const matchingFields = Object.keys(updatedFields).reduce(
      (acc, key) => {
        if (fieldGroups[groupName].includes(key)) {
          acc[key] = updatedFields[key];
        }
        return acc;
      },
      {} as Partial<typeof updatedFields>
    );

    console.log(`matching fields for group name ${groupName}: `, matchingFields);

    if (Object.keys(matchingFields).length > 0) {
      console.log('match found: ');
      if (groupName === 'stems') {
        // need to correct for key matching
        if (matchingFields.stemLocalX) {
          matchingFields.localX = matchingFields.stemLocalX;
          delete matchingFields.stemLocalX;
        }
        if (matchingFields.stemLocalY) {
          matchingFields.localY = matchingFields.stemLocalY;
          delete matchingFields.stemLocalY;
        }
      }
      try {
        const demappedData = MapperFactory.getMapper<any, any>(groupName).demapData([matchingFields])[0];
        const query = `UPDATE ?? SET ? WHERE ?? = ?`;
        const response = await fetch(`/api/formatrunquery`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: query, params: [`${currentSite?.schemaName}.${tableName}`, demappedData, idColumn, idValue] })
        });
        if (response.ok)
          setUploadStatus(prev => ({
            ...prev,
            [groupName]: 'completed'
          }));
        else throw new Error(`err`);
      } catch (e) {
        console.error(e);
        setUploadStatus(prev => ({
          ...prev,
          [groupName]: 'error'
        }));
      }
    } else {
      setUploadStatus(prev => ({
        ...prev,
        [groupName]: 'completed'
      }));
    }
  };

  const handleBeginUpload = async () => {
    await handleUpdate('coremeasurements', 'coremeasurements', 'CoreMeasurementID', coreMeasurementID);
    await new Promise(resolve => setTimeout(resolve, 1000));
    await handleUpdate('quadrats', 'quadrats', 'QuadratID', quadratID);
    await new Promise(resolve => setTimeout(resolve, 1000));
    await handleUpdate('trees', 'trees', 'TreeID', treeID);
    await new Promise(resolve => setTimeout(resolve, 1000));
    await handleUpdate('stems', 'stems', 'StemID', stemID);
    await new Promise(resolve => setTimeout(resolve, 1000));
    await handleUpdate('species', 'species', 'SpeciesID', speciesID);
  };

  const handleFinalConfirm = () => {
    handleSave(newRow);
  };

  useEffect(() => {
    if (beginUpload) handleBeginUpload();
  }, [beginUpload]);

  useEffect(() => {
    console.log('use effect upload status: ', uploadStatus);
    if (Object.values(uploadStatus).every(value => value === 'completed')) setIsConfirmStep(true);
  }, [uploadStatus]);

  // pulled from JoyUI doc example
  function IconStepper() {
    const steps = Object.keys(uploadStatus);
    return (
      <Stepper
        size="lg"
        sx={{
          width: '100%',
          '--StepIndicator-size': '3rem',
          '--Step-connectorInset': '0px',
          [`& .${stepIndicatorClasses.root}`]: {
            borderWidth: 4
          },
          [`& .${stepClasses.root}::after`]: {
            height: 4
          },
          [`& .${stepClasses.completed}`]: {
            [`& .${stepIndicatorClasses.root}`]: {
              borderColor: 'primary.300',
              color: 'primary.300'
            },
            '&::after': {
              bgcolor: 'primary.300'
            }
          },
          [`& .${stepClasses.active}`]: {
            [`& .${stepIndicatorClasses.root}`]: {
              borderColor: 'currentColor'
            }
          },
          [`& .${stepClasses.disabled} *`]: {
            color: 'neutral.outlinedDisabledColor'
          }
        }}
      >
        {steps.map((stepKey, index) => {
          const status = uploadStatus[stepKey as keyof typeof uploadStatus];

          // Determine the step's state
          const isCompleted = status === 'completed';
          const isActive = status === 'in-progress';
          const isDisabled = status === 'idle';

          return (
            <Step
              key={stepKey}
              completed={isCompleted}
              active={isActive}
              disabled={isDisabled}
              orientation="vertical"
              indicator={
                <StepIndicator variant={isActive ? 'solid' : 'outlined'} color={isCompleted ? 'primary' : isActive ? 'primary' : 'neutral'}>
                  {stepIcons[index]}
                </StepIndicator>
              }
            >
              <Typography
                sx={{
                  textTransform: 'uppercase',
                  fontWeight: 'lg',
                  fontSize: '0.75rem',
                  letterSpacing: '0.5px'
                }}
              >
                {stepKey === 'coremeasurements' ? 'CoreMeasurements' : stepKey.charAt(0).toUpperCase() + stepKey.slice(1)}
              </Typography>
            </Step>
          );
        })}
      </Stepper>
    );
  }

  return (
    <Modal open onClose={handleClose}>
      <ModalDialog variant="outlined" sx={{ maxWidth: '90vw', overflow: 'auto' }}>
        <DialogTitle>Data Editing</DialogTitle>
        <DialogContent>
          <Typography level={'title-lg'}>In order to make changes to this data set, cascading changes must be made across the schema. </Typography>
          {!beginUpload && !isConfirmStep && (
            <Typography level={'title-md'}>Press the Begin button to begin this process, or Cancel to revert your changes. </Typography>
          )}
          {beginUpload && !isConfirmStep && (
            <>
              <Typography level={'title-md'} sx={{ marginBottom: '2em' }}>
                Beginning upload...
              </Typography>
              {IconStepper()}
            </>
          )}
        </DialogContent>
        <DialogActions>
          {!beginUpload && !isConfirmStep && (
            <>
              <Button variant={'soft'} color={'danger'} onClick={handleClose}>
                Cancel
              </Button>
              <Button variant={'soft'} color={'success'} onClick={() => setBeginUpload(true)}>
                Begin Upload
              </Button>
            </>
          )}
          {isConfirmStep && (
            <>
              <Button
                variant={'soft'}
                color={'primary'}
                onClick={handleFinalConfirm}
                disabled={Object.values(uploadStatus).some(value => value !== 'completed')}
              >
                Confirm Changes
              </Button>
            </>
          )}
        </DialogActions>
      </ModalDialog>
    </Modal>
  );
}
