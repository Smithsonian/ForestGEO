'use client';

import { GridRowModel } from '@mui/x-data-grid';
import React, { useEffect, useState } from 'react';
import { Button, DialogActions, DialogContent, DialogTitle, LinearProgress, Modal, ModalDialog } from '@mui/joy';
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
  const [uploadStatus, setUploadStatus] = useState<{
    [Key in keyof typeof fieldGroups]: UploadStatus;
  }>({
    coremeasurements: 'idle',
    quadrats: 'idle',
    trees: 'idle',
    stems: 'idle',
    species: 'idle'
  });
  const [loadingProgress, setLoadingProgress] = useState(0);
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
    setLoadingProgress(0);
    await handleUpdate('coremeasurements', 'coremeasurements', 'CoreMeasurementID', coreMeasurementID);
    await new Promise(resolve => setTimeout(resolve, 250));
    await handleUpdate('quadrats', 'quadrats', 'QuadratID', quadratID);
    await new Promise(resolve => setTimeout(resolve, 250));
    await handleUpdate('trees', 'trees', 'TreeID', treeID);
    await new Promise(resolve => setTimeout(resolve, 250));
    await handleUpdate('stems', 'stems', 'StemID', stemID);
    await new Promise(resolve => setTimeout(resolve, 250));
    await handleUpdate('species', 'species', 'SpeciesID', speciesID);
    await new Promise(resolve => setTimeout(resolve, 250));
    setLoadingProgress(100);
  };

  const handleFinalConfirm = () => {
    handleSave(newRow);
  };

  useEffect(() => {
    handleBeginUpload();
  }, []);

  return (
    <Modal open onClose={handleClose}>
      <ModalDialog
        variant="outlined"
        sx={{
          display: 'flex',
          flexDirection: 'column',
          width: '100%',
          maxWidth: '90vw',
          minWidth: '40vw',
          overflow: 'hidden'
        }}
      >
        <DialogTitle>Saving Changes...</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <LinearProgress determinate value={loadingProgress} title={'Processing changes. Please wait... '} size={'lg'} sx={{ width: '100%' }} />
        </DialogContent>
        <DialogActions>
          <Button
            variant={'soft'}
            color={'primary'}
            onClick={handleFinalConfirm}
            disabled={Object.values(uploadStatus).some(value => value !== 'completed') || loadingProgress < 100}
          >
            Finish
          </Button>
        </DialogActions>
      </ModalDialog>
    </Modal>
  );
}
