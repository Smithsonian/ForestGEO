"use client";

import {Box, Button, Grid} from "@mui/material";
import {ReviewStates, UploadStartProps} from "@/config/macros";
import {ListSubheader, Stack, Typography} from "@mui/joy";
import SelectFormType from "@/components/uploadsystemhelpers/groupedformselection";
import AutocompleteFixedData from "@/components/forms/autocompletefixeddata";
import React, {useEffect, useState} from "react";
import Select from "@mui/joy/Select";
import List from "@mui/joy/List";
import Option from '@mui/joy/Option';

export default function UploadStart(props: Readonly<UploadStartProps>) {
  const {
    uploadForm, personnelRecording,
    setUploadForm, setPersonnelRecording,
    setExpectedHeaders, setReviewState,
    unitOfMeasurement, setUnitOfMeasurement
  } = props;
  const [finish, setFinish] = useState<boolean>(false);

  const handleChange = (
    _event: React.SyntheticEvent | null,
    newValue: string | null,
  ) => {
    if (newValue) {
      setUnitOfMeasurement(newValue);
    }
  };
  const handleFormTypeBack = () => {
    setUploadForm('');
    setUnitOfMeasurement('');
    setFinish(false);
    // Other states to reset if necessary
  };

  const handlePersonnelRecordingBack = () => {
    setPersonnelRecording('');
    setUnitOfMeasurement('');
    setFinish(false);
    // Reset other states if required
  };

  const handleUnitOfMeasurementBack = () => {
    setUnitOfMeasurement('');
    setFinish(false);
  }

  useEffect(() => {
    if (finish) setReviewState(ReviewStates.UPLOAD_FILES);
  }, [finish]);

  return (
    <Box sx={{display: 'flex', flex: 1, flexDirection: 'column'}}>
      <Grid container spacing={2} sx={{marginRight: 2}}>
        <Grid item xs={6}>
          <Stack direction={"column"} sx={{width: 'fit-content'}}>
            {/* Form Type Selection */}
            {uploadForm === '' && (
              <>
                <Typography sx={{mb: 2}}>
                  Select the type of form you wish to upload:
                </Typography>
                <SelectFormType
                  externalState={uploadForm}
                  updateExternalState={setUploadForm}
                  updateExternalHeaders={setExpectedHeaders}
                />
              </>
            )}
            {uploadForm !== '' && uploadForm !== 'fixeddata_census' && (
              <>
                <Button onClick={handleUnitOfMeasurementBack} sx={{width: 'fit-content', mb: 2}}>Back</Button>
                <Typography sx={{mb: 2}}>You have selected:</Typography>
                <Typography>Form: {uploadForm}</Typography>
                <Button onClick={() => setFinish(true)}>
                  Finalize selections
                </Button>
              </>
            )}
            {/* Personnel Recording Selection */}
            {uploadForm === 'fixeddata_census' && personnelRecording === '' && (
              <>
                <Button onClick={handleFormTypeBack} sx={{width: 'fit-content', mb: 2}}>Back</Button>
                <Typography sx={{mb: 2}}>
                  Who recorded this data?
                </Typography>
                <AutocompleteFixedData
                  dataType="personnel"
                  value={personnelRecording}
                  onChange={setPersonnelRecording}
                />
              </>
            )}

            {/* Unit of Measurement Selection for fixeddata_census */}
            {uploadForm === 'fixeddata_census' && personnelRecording !== '' && unitOfMeasurement === '' && (
              <>
                <Button onClick={handlePersonnelRecordingBack} sx={{width: 'fit-content', mb: 2}}>Back</Button>
                <Typography sx={{mb: 2}}>
                  Select the unit of measurement:
                </Typography>
                <Select
                  value={unitOfMeasurement}
                  onChange={handleChange}
                  placeholder="Select unit"
                  sx={{minWidth: '200px'}}
                >
                  <List>
                    <ListSubheader>Metric Units</ListSubheader>
                    <Option value={"km"}>Kilometers (km)</Option>
                    <Option value={"m"}>Meters (m)</Option>
                    <Option value={"cm"}>Centimeters (cm)</Option>
                    <Option value={"mm"}>Millimeters (mm)</Option>

                    <ListSubheader>Imperial Units</ListSubheader>
                    <Option value={"inches"}>Inches</Option>
                    <Option value={"feet"}>Feet</Option>
                    <Option value={"yards"}>Yards</Option>
                    <Option value={"miles"}>Miles</Option>
                  </List>
                </Select>
              </>
            )}
            {uploadForm === 'fixeddata_census' && personnelRecording !== '' && unitOfMeasurement !== '' && !finish && (
              <>
                <Button onClick={handleUnitOfMeasurementBack} sx={{width: 'fit-content', mb: 2}}>Back</Button>
                <Typography sx={{mb: 2}}>You have selected:</Typography>
                <Typography>Form: {uploadForm}</Typography>
                <Typography>Personnel: {personnelRecording}</Typography>
                <Typography>Units of measurement: {unitOfMeasurement}</Typography>
                <Button onClick={() => setFinish(true)}>
                  Finalize selections
                </Button>
              </>
            )}
          </Stack>
        </Grid>
        <Grid item xs={6}/>
      </Grid>
    </Box>
  );
}