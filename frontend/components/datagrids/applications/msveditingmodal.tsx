'use client';

import { GridRowModel } from '@mui/x-data-grid';
import React, { useEffect, useState } from 'react';
import { Button, DialogActions, DialogContent, DialogTitle, LinearProgress, Modal, ModalDialog, Typography } from '@mui/joy';
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
  const { handleClose, oldRow, newRow, handleSave } = props;
  const updatedFields = getUpdatedValues(oldRow, newRow);
  const { coreMeasurementID, quadratID, treeID, stemID, speciesID } = newRow;
  const fieldGroups = {
    coremeasurements: ['measuredDBH', 'measuredHOM', 'measurementDate'],
    quadrats: ['quadratName'],
    trees: ['treeTag'],
    stems: ['stemTag', 'stemLocalX', 'stemLocalY'],
    species: ['speciesName', 'subspeciesName', 'speciesCode'],
    attributes: ['attributes']
  };
  type UploadStatus = 'idle' | 'in-progress' | 'completed' | 'error';
  const [uploadStatus, setUploadStatus] = useState<{
    [Key in keyof typeof fieldGroups]: UploadStatus;
  }>({
    coremeasurements: 'idle',
    quadrats: 'idle',
    trees: 'idle',
    stems: 'idle',
    species: 'idle',
    attributes: 'idle'
  });
  const [loadingProgress, setLoadingProgress] = useState(0);
  const stepIcons = [<PrecisionManufacturing key={v4()} />, <GridView key={v4()} />, <Forest key={v4()} />, <Grass key={v4()} />, <Diversity2 key={v4()} />];

  async function handleAttributes(tableName: string, idColumn: string, idValue: any) {}

  async function handleUpdate(groupName: keyof typeof fieldGroups, tableName: string, idColumn: string, idValue: any) {
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
      if (groupName === 'attributes' && matchingFields.attributes.split(';').length > 0) {
        // delete from cmattributes where coremeasurementID = <inserted>
        const splitAttrs = matchingFields.attributes.replace(/\s+/g, '').split(';');
        const deleteExisting = `DELETE FROM ?? WHERE ?? = ?`;
        await fetch(`/api/formatrunquery`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: deleteExisting, params: [`${currentSite?.schemaName}.${tableName}`, idColumn, idValue] })
        });
        // insert into cmattributes (coremeasurementID, attributeCode) values (<inserted>, <inserted>)
        const insertQuery = `INSERT IGNORE INTO ?? (CoreMeasurementID, Code) VALUES ${splitAttrs.map(() => '(?, ?)').join(', ')}`;
        const insertParams = splitAttrs.flatMap((attr: any) => [idValue, attr]);
        await fetch(`/api/formatrunquery`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            query: insertQuery,
            params: [`${currentSite?.schemaName}.${tableName}`, ...insertParams]
          })
        });
      } else {
        try {
          const demappedData = MapperFactory.getMapper<any, any>(groupName).demapData([matchingFields])[0];
          const searchExisting = `SELECT * FROM ?? WHERE ?? = ?`;
          const searchResponse = (
            await (
              await fetch(`/api/formatrunquery`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ query: searchExisting, params: [`${currentSite?.schemaName}.${tableName}`, idColumn, idValue] })
              })
            ).json()
          )[0];
          const query = `UPDATE ?? SET ? WHERE ?? = ?`;
          const response = await fetch(`/api/formatrunquery`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              query: query,
              params: [
                `${currentSite?.schemaName}.${tableName}`,
                demappedData,
                idColumn,
                searchResponse[idColumn] !== undefined || searchResponse[idColumn] !== null ? searchResponse[idColumn] : idValue
              ]
            })
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
      }
    } else {
      setUploadStatus(prev => ({
        ...prev,
        [groupName]: 'completed'
      }));
    }
  }

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
    await handleUpdate('species', 'species', 'SpeciesID', speciesID);
    await new Promise(resolve => setTimeout(resolve, 250));
    await handleUpdate('attributes', 'cmattributes', 'CoreMeasurementID', coreMeasurementID);
    await new Promise(resolve => setTimeout(resolve, 250));
    setLoadingProgress(100);
  };

  const handleFinalConfirm = () => {
    handleSave(newRow);
  };

  useEffect(() => {
    handleBeginUpload().then(() => {});
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
          {loadingProgress === 100 && <Typography level={'title-md'}>Update complete!</Typography>}
        </DialogContent>
        <DialogActions>
          <Button variant={'soft'} color={'primary'} onClick={handleFinalConfirm} disabled={loadingProgress < 100}>
            Finish
          </Button>
        </DialogActions>
      </ModalDialog>
    </Modal>
  );
}
