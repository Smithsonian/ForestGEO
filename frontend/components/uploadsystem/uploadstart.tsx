"use client";

import {Box, Button, Grid} from "@mui/material";
import {ReviewStates, TableHeadersByFormType, UploadStartProps} from "@/config/macros";
import {Stack, Typography} from "@mui/joy";
import SelectFormType from "@/components/uploadsystemhelpers/groupedformselection";
import AutocompleteFixedData from "@/components/forms/autocompletefixeddata";
import React from "react";
import CircularProgress from "@mui/joy/CircularProgress";

export default function UploadStart(props: Readonly<UploadStartProps>) {
  const {
    uploadForm, personnelRecording,
    setUploadForm, setPersonnelRecording,
    setExpectedHeaders, setReviewState
  } = props;

  return (
    <Box sx={{display: 'flex', flex: 1, flexDirection: 'column'}}>
      <Grid container spacing={2} sx={{marginRight: 2}}>
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
                You have selected {uploadForm}. Please ensure that your file has the following headers before
                continuing: <br/>
                {uploadForm !== '' && TableHeadersByFormType[uploadForm]?.map(obj => obj.label).join(', ')} <br/>
                Who recorded this data?
              </Typography>
              <AutocompleteFixedData
                dataType="personnel"
                value={personnelRecording}
                onChange={setPersonnelRecording}
              />
            </Stack>
          )}
          {(TableHeadersByFormType.hasOwnProperty(uploadForm) && personnelRecording !== '') && (
            <Stack direction={"column"} sx={{display: 'flex', flexDirection: 'column', mb: 10}}>
              <Typography sx={{mb: 2}}>
                You have selected {uploadForm}. Please ensure that your file has the following headers before
                continuing: <br/>
                {uploadForm !== '' && TableHeadersByFormType[uploadForm]?.map(obj => obj.label).join(', ')} <br/>
                The person recording the data is {personnelRecording}. Please verify this before continuing.
              </Typography>
              <Stack direction={"row"}>
                <Button onClick={() => {
                  setUploadForm('');
                  setPersonnelRecording('');
                }} sx={{width: 'fit-content'}}>
                  Reset
                </Button>
                <Button onClick={() => setReviewState(ReviewStates.PARSE)} sx={{width: 'fit-content'}}>
                  Continue
                </Button>
              </Stack>
            </Stack>
          )}
        </Grid>
        <Grid item xs={6} />
      </Grid>
    </Box>
  );
}