"use client";

import { Box, Button, Grid } from "@mui/material";
import { ReviewStates, UploadStartProps } from "@/config/macros";
import { ListSubheader, Stack, Tooltip, Typography } from "@mui/joy";
import SelectFormType from "@/components/uploadsystemhelpers/groupedformselection";
import AutocompleteFixedData from "@/components/forms/autocompletefixeddata";
import React, { useEffect, useState } from "react";
import Select from "@mui/joy/Select";
import List from "@mui/joy/List";
import Option from '@mui/joy/Option';
import FinalizeSelectionsButton from "../client/finalizeselectionsbutton";
import ArrowBackIcon from '@mui/icons-material/ArrowBack';

export default function UploadStart(props: Readonly<UploadStartProps>) {
  const {
    uploadForm, personnelRecording,
    setPersonnelRecording,
    setReviewState,
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

  // Single function to handle "Back" action
  const handleBack = () => {
    if (unitOfMeasurement !== '') {
      setUnitOfMeasurement('');
    } else if (personnelRecording !== '') {
      setPersonnelRecording('');
    }
    setFinish(false);
  };
  useEffect(() => {
    if (finish) setReviewState(ReviewStates.UPLOAD_FILES);
  }, [finish]);

  const allSelectionsMade = uploadForm !== '' &&
    (uploadForm !== 'measurements' ||
      (personnelRecording !== '' && unitOfMeasurement !== ''));

  const showBackButton = personnelRecording !== '' || unitOfMeasurement !== '';

  return (
    <Box sx={{ display: 'flex', flex: 1, flexDirection: 'column', alignItems: 'center' }}>
      <Stack direction={"column"} sx={{ width: 'fit-content' }}>
        {showBackButton && (
          <Tooltip title="Go back to the previous step">
            <Button
              onClick={handleBack}
              variant="outlined"
              startIcon={<ArrowBackIcon />}
              sx={{
                width: 'fit-content',
                mb: 2,
                color: 'primary.main',
                borderColor: 'primary.light',
                ':hover': {
                  bgcolor: 'primary.light',
                  borderColor: 'primary.main',
                }
              }}
            >
              Back
            </Button>
          </Tooltip>
        )}
        {/* Form Type Selection */}
        {uploadForm !== '' && uploadForm !== 'measurements' && !finish && (
          <>
            <Typography sx={{ mb: 2 }}>You have selected:</Typography>
            <Typography>Form: {uploadForm}</Typography>
          </>
        )}
        {/* Personnel Recording Selection */}
        {uploadForm === 'measurements' && personnelRecording === '' && (
          <>
            <Typography sx={{ mb: 2 }}>
              Who recorded this data?
            </Typography>
            <AutocompleteFixedData
              dataType="personnel"
              value={personnelRecording}
              onChange={setPersonnelRecording}
            />
          </>
        )}

        {/* Unit of Measurement Selection for measurements */}
        {uploadForm === 'measurements' && personnelRecording !== '' && unitOfMeasurement === '' && (
          <>
            <Typography sx={{ mb: 2 }}>
              Select the unit of measurement:
            </Typography>
            <Select
              value={unitOfMeasurement}
              onChange={handleChange}
              placeholder="Select unit"
              sx={{ minWidth: '200px' }}
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
        {uploadForm === 'measurements' && personnelRecording !== '' && unitOfMeasurement !== '' && !finish && (
          <>
            <Typography sx={{ mb: 2 }}>You have selected:</Typography>
            <Typography>Form: {uploadForm}</Typography>
            <Typography>Personnel: {personnelRecording}</Typography>
            <Typography>Units of measurement: {unitOfMeasurement}</Typography>
          </>
        )}
        <FinalizeSelectionsButton
          onFinish={() => setFinish(true)}
          show={allSelectionsMade && !finish}
        />
      </Stack>
    </Box>
  );
}