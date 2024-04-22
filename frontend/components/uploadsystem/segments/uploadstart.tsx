"use client";

import { ReviewStates } from "@/config/macros/uploadsystemmacros";
import { UploadStartProps } from "@/config/macros/uploadsystemmacros";
import { Box, Button, ListSubheader, Stack, Tooltip, Typography } from "@mui/joy";
import AutocompleteFixedData from "@/components/forms/autocompletefixeddata";
import React, { useEffect, useState } from "react";
import Select, { SelectOption } from "@mui/joy/Select";
import List from "@mui/joy/List";
import Option from '@mui/joy/Option';
import FinalizeSelectionsButton from "../../client/finalizeselectionsbutton";
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import { Quadrat } from "@/config/sqlrdsdefinitions/quadratrds";
import { useQuadratListContext } from "@/app/contexts/listselectionprovider";
import { useQuadratContext, useQuadratDispatch } from "@/app/contexts/userselectionprovider";

export default function UploadStart(props: Readonly<UploadStartProps>) {
  const {
    uploadForm, personnelRecording,
    setPersonnelRecording,
    setReviewState,
    unitOfMeasurement, setUnitOfMeasurement
  } = props;
  const [finish, setFinish] = useState<boolean>(false);
  let quadratListContext = useQuadratListContext();
  let currentQuadrat = useQuadratContext();
  const [quadrat, setQuadrat] = useState<Quadrat>(currentQuadrat);
  const quadratDispatch = useQuadratDispatch();
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

  const handleQuadratSelection = async (selectedQuadrat: Quadrat | null) => {
    setQuadrat(selectedQuadrat);
    if (quadratDispatch) {
      await quadratDispatch({ quadrat: selectedQuadrat });
    }
  };

  const allSelectionsMade = uploadForm !== '' &&
    (uploadForm !== 'measurements' ||
      (personnelRecording !== '' && unitOfMeasurement !== '' || currentQuadrat?.quadratName !== null));

  const showBackButton = personnelRecording !== '' || unitOfMeasurement !== '' || currentQuadrat?.quadratName !== null;

  const renderQuadratValue = (option: SelectOption<string> | null) => {
    if (!option) {
      return <Typography>Select a Quadrat</Typography>; // or some placeholder JSX
    }

    // Find the corresponding CensusRDS object
    const selectedValue = option.value; // assuming option has a 'value' property
    const selectedQuadrat = quadratListContext?.find(c => c?.quadratName === selectedValue);

    // Return JSX
    return selectedQuadrat ? <Typography>{`Quadrat: ${selectedQuadrat?.quadratName}`}</Typography> : <Typography>No Quadrat</Typography>;
  };

  return (
    <Box sx={{ display: 'flex', flex: 1, flexDirection: 'column', alignItems: 'center' }}>
      <Stack direction={"column"} sx={{ width: 'fit-content' }}>
        {showBackButton && (
          <Tooltip title="Go back to the previous step">
            <Button
              onClick={handleBack}
              variant="outlined"
              startDecorator={<ArrowBackIcon />}
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
                <Option value={"in"}>Inches (in)</Option>
                <Option value={"ft"}>Feet (ft)</Option>
                <Option value={"yd"}>Yards (yd)</Option>
                <Option value={"mi"}>Miles (mi)</Option>
              </List>
            </Select>
          </>
        )}
        {(uploadForm === "measurements" && personnelRecording !== '' && unitOfMeasurement !== '' && currentQuadrat?.quadratName === null) && (
          <Stack direction={"column"} spacing={2}>
            <Typography level={"title-sm"}>Select Quadrat:</Typography>
            <Select
              placeholder="Select a Quadrat"
              name="None"
              required
              autoFocus
              size={"md"}
              renderValue={renderQuadratValue}
              onChange={async (_event: React.SyntheticEvent | null, newValue: string | null) => {
                // Find the corresponding Plot object using newValue
                const selectedQuadrat = quadratListContext?.find(quadrat => quadrat?.quadratName === newValue) || null;
                setQuadrat(selectedQuadrat);
              }}
            >
              <Option value={""}>None</Option>
              {quadratListContext?.map((item) => (
                <Option value={item?.quadratName} key={item?.quadratName}>
                  <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
                    <Typography level="body-lg">{item?.quadratName}</Typography>
                  </Box>
                </Option>
              ))}
            </Select>
            <Button size={"sm"} variant={"soft"} color="success" onClick={async () => {
              await handleQuadratSelection(quadrat);
            }}>
              Submit
            </Button>
          </Stack>
        )}
        {uploadForm === 'measurements' && personnelRecording !== '' && unitOfMeasurement !== '' && currentQuadrat?.quadratName !== null && !finish && (
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