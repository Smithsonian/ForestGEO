"use client";

import {Box, Button, Grid} from "@mui/material";
import {ReviewStates, TableHeadersByFormType, UploadStartProps} from "@/config/macros";
import {Stack, Typography} from "@mui/joy";
import SelectFormType from "@/components/uploadsystemhelpers/groupedformselection";
import AutocompleteFixedData from "@/components/forms/autocompletefixeddata";
import React, {useEffect, useState} from "react";
import CircularProgress from "@mui/joy/CircularProgress";

export default function UploadStart(props: Readonly<UploadStartProps>) {
  const {
    uploadForm, personnelRecording,
    setUploadForm, setPersonnelRecording,
    setExpectedHeaders, setReviewState
  } = props;

  const [timer, setTimer] = useState<number>(5);
  const [isTimerActive, setIsTimerActive] = useState<boolean>(false);

  useEffect(() => {
    let interval: NodeJS.Timeout;

    if (isTimerActive && timer > 0) {
      interval = setInterval(() => {
        setTimer((prevTimer) => prevTimer - 1);
      }, 1000);
    } else if (timer === 0) {
      setReviewState(ReviewStates.UPLOAD_FILES);
      setIsTimerActive(false); // Stop the timer
    }

    return () => clearInterval(interval);
  }, [isTimerActive, timer, setReviewState]);

  useEffect(() => {
    if (uploadForm && personnelRecording) {
      setIsTimerActive(true);
    }
  }, [uploadForm, personnelRecording]);

  return (
    <Box sx={{display: 'flex', flex: 1, flexDirection: 'column'}}>
      <Grid container spacing={2} sx={{marginRight: 2}}>
        <Button onClick={() => {
          setPersonnelRecording('');
        }} sx={{width: 'fit-content'}}>
          Back
        </Button>
        <Grid item xs={6}>
          {(!TableHeadersByFormType.hasOwnProperty(uploadForm) && personnelRecording === '') && (
            <Stack direction={"column"} sx={{width: 'fit-content'}}>
              <Typography sx={{mb: 2}}>
                Your file will need the correct headers in order to be uploaded to your intended table
                destination.<br/> Please review the table header requirements before continuing:
              </Typography>
              <Box sx={{display: 'flex', width: 'fit-content', justifyContent: 'center', mb: 1}}>
                <SelectFormType
                  externalState={uploadForm}
                  updateExternalState={setUploadForm}
                  updateExternalHeaders={setExpectedHeaders}
                />
              </Box>
            </Stack>
          )}
          {(TableHeadersByFormType.hasOwnProperty(uploadForm) && personnelRecording === '') && (
            <Stack direction={"column"} sx={{width: 'fit-content'}}>
              <Typography sx={{mb: 2}}>
                You have selected {uploadForm}. Please ensure that your file has the following headers
                before
                continuing: <br/>
                {uploadForm !== '' && TableHeadersByFormType[uploadForm]?.map(obj => obj.label).join(', ')}
                <br/>
                Who recorded this data?
              </Typography>
              <Stack direction={"row"}>
                <Button sx={{marginRight: 2, width: 'fit-content'}} onClick={() => setUploadForm('')}>
                  Back
                </Button>
                <AutocompleteFixedData
                  dataType="personnel"
                  value={personnelRecording}
                  onChange={setPersonnelRecording}
                />
              </Stack>
            </Stack>
          )}
          {(TableHeadersByFormType.hasOwnProperty(uploadForm) && personnelRecording !== '') && (
            <Stack direction={"column"} sx={{display: 'flex', flexDirection: 'column', mb: 10}}>
              <Typography sx={{mb: 2}}>
                You have selected {uploadForm}. Please ensure that your file has the following headers
                before
                continuing: <br/>
                {uploadForm !== '' && TableHeadersByFormType[uploadForm]?.map(obj => obj.label).join(', ')}
                <br/>
                The person recording the data is {personnelRecording}. Please verify this before
                continuing.
              </Typography>
              <Stack direction={"column"}>
                {isTimerActive && (
                  <CircularProgress value={(timer / 5) * 100}/>
                )}
              </Stack>
            </Stack>
          )}
        </Grid>
        <Grid item xs={6}/>
      </Grid>
    </Box>
  );
}