"use client";

import {ReviewStates} from "@/config/macros/uploadsystemmacros";
import {UploadStartProps} from "@/config/macros/uploadsystemmacros";
import {Box, Button, ListSubheader, Stack, Tooltip, Typography} from "@mui/joy";
import AutocompleteFixedData from "@/components/forms/autocompletefixeddata";
import React, {Dispatch, SetStateAction, useEffect, useState} from "react";
import Select, {SelectOption} from "@mui/joy/Select";
import List from "@mui/joy/List";
import Option from '@mui/joy/Option';
import FinalizeSelectionsButton from "../../client/finalizeselectionsbutton";
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import {Quadrat} from "@/config/sqlrdsdefinitions/tables/quadratrds";
import {useQuadratListContext} from "@/app/contexts/listselectionprovider";
import {usePlotContext, useQuadratContext, useQuadratDispatch} from "@/app/contexts/userselectionprovider";

export default function UploadStart(props: Readonly<UploadStartProps>) {
  const {
    uploadForm, personnelRecording,
    setPersonnelRecording,
    setReviewState,
    dbhUnit, setDBHUnit,
    homUnit, setHOMUnit,
    coordUnit, setCoordUnit
  } = props;
  const [finish, setFinish] = useState<boolean>(false);
  let quadratListContext = useQuadratListContext();
  let currentQuadrat = useQuadratContext();
  let currentPlot = usePlotContext();
  console.log('current quadrat: ', currentQuadrat);
  const [quadrat, setQuadrat] = useState<Quadrat>();
  const [quadratList, setQuadratList] = useState<Quadrat[] | undefined>([]);
  const quadratDispatch = useQuadratDispatch();
  const [isQuadratConfirmed, setIsQuadratConfirmed] = useState(false);
  const handleChange = (
    _event: React.SyntheticEvent | null,
    dispatcher: Dispatch<SetStateAction<string>>,
    newValue: string | null,
  ) => {
    if (newValue) {
      dispatcher(newValue);
    }
  };

  // Single function to handle "Back" action
  const handleBack = () => {
    // if (dbhUnit !== '' || homUnit !== '' || coordUnit !== '') {
    //   setCoordUnit('');
    //   setDBHUnit('');
    //   setHOMUnit('');
    // } else if (personnelRecording !== '') {
    //   setPersonnelRecording('');
    // } else if (isQuadratConfirmed) {
    //   setIsQuadratConfirmed(false);
    // }
    if (personnelRecording !== '') {
      setPersonnelRecording('');
    } else if (isQuadratConfirmed) {
      setIsQuadratConfirmed(false);
    }
    setFinish(false);
  };

  useEffect(() => {
    if (currentPlot) {
      // ensure that selectable list is restricted by selected plot
      setQuadratList(quadratListContext?.filter(quadrat => quadrat?.plotID === currentPlot.id) || undefined);
    }
  }, []);

  useEffect(() => {
    if (finish) setReviewState(ReviewStates.UPLOAD_FILES);
  }, [finish]);

  const handleQuadratSelection = async (selectedQuadrat: Quadrat | undefined) => {
    setQuadrat(selectedQuadrat);
    if (quadratDispatch) {
      await quadratDispatch({quadrat: selectedQuadrat});
    }
  };

  const handleConfirmQuadrat = async () => {
    await handleQuadratSelection(quadrat);
    setIsQuadratConfirmed(true);
  };

  const allSelectionsMade = uploadForm !== '' &&
    (uploadForm !== 'measurements' ||
      // (personnelRecording !== '' && (dbhUnit !== '' && homUnit !== '' && coordUnit !== '') && isQuadratConfirmed));
      (personnelRecording !== '' && isQuadratConfirmed));

  // const showBackButton = personnelRecording !== '' || (dbhUnit !== '' && homUnit !== '' && coordUnit !== '') || isQuadratConfirmed;
  const showBackButton = personnelRecording !== '' || isQuadratConfirmed;

  const renderQuadratValue = (option: SelectOption<string> | null) => {
    if (!option) {
      return <Typography>Select a Quadrat</Typography>; // or some placeholder JSX
    }

    // Find the corresponding CensusRDS object
    const selectedValue = option.value; // assuming option has a 'value' property
    const selectedQuadrat = quadratListContext?.find(c => c?.quadratName === selectedValue);

    // Return JSX
    return selectedQuadrat ? <Typography>{`Quadrat: ${selectedQuadrat?.quadratName}`}</Typography> :
      <Typography>No Quadrat</Typography>;
  };

  return (
    <Box sx={{display: 'flex', flex: 1, flexDirection: 'column', alignItems: 'center'}}>
      <Stack direction={"column"} sx={{width: 'fit-content'}}>
        {showBackButton && (
          <Tooltip title="Go back to the previous step">
            <Button
              onClick={handleBack}
              variant="outlined"
              startDecorator={<ArrowBackIcon/>}
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
            <Typography sx={{mb: 2}}>You have selected:</Typography>
            <Typography>Form: {uploadForm}</Typography>
          </>
        )}
        {/* Personnel Recording Selection */}
        {uploadForm === 'measurements' && personnelRecording === '' && (
          <>
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

        {/* Unit of Measurement Selection for measurements -- DEPRECATED, UNITS INCORPORATED INTO FORM TYPE */}
        {/* {uploadForm === 'measurements' && personnelRecording !== '' && (dbhUnit === '' || homUnit === '' || coordUnit === '') && (
          <>
            <Stack direction={'row'} spacing={2}>
              <Box>
                <Typography sx={{mb: 2}}>
                  Select the DBH unit of measurement:
                </Typography>
                <Select
                  value={dbhUnit}
                  defaultValue={'cm'}
                  onChange={(event: React.SyntheticEvent | null,
                             newValue: string | null,) => handleChange(event, setDBHUnit, newValue ?? '')}
                  placeholder="Select unit"
                  sx={{minWidth: '200px'}}
                >
                  <List>
                    <ListSubheader>Metric Units</ListSubheader>
                    <Option value={"km"}>Kilometers (km)</Option>
                    <Option value={"m"}>Meters (m)</Option>
                    <Option value={"cm"}>Centimeters (cm)</Option>
                    <Option value={"mm"}>Millimeters (mm)</Option>
                  </List>
                </Select>
                <Box>
                  <Typography sx={{mb: 2}}>
                    Select the HOM unit of measurement:
                  </Typography>
                  <Select
                    value={homUnit}
                    defaultValue={'m'}
                    onChange={(event: React.SyntheticEvent | null,
                               newValue: string | null,) => handleChange(event, setHOMUnit, newValue ?? '')}
                    placeholder="Select unit"
                    sx={{minWidth: '200px'}}
                  >
                    <List>
                      <ListSubheader>Metric Units</ListSubheader>
                      <Option value={"km"}>Kilometers (km)</Option>
                      <Option value={"m"}>Meters (m)</Option>
                      <Option value={"cm"}>Centimeters (cm)</Option>
                      <Option value={"mm"}>Millimeters (mm)</Option>
                    </List>
                  </Select>
                </Box>
                <Box>
                  <Typography sx={{mb: 2}}>
                    Select the Coordinate unit of measurement:
                  </Typography>
                  <Select
                    value={coordUnit}
                    defaultValue={'m'}
                    onChange={(event: React.SyntheticEvent | null,
                               newValue: string | null,) => handleChange(event, setCoordUnit, newValue ?? '')}
                    placeholder="Select unit"
                    sx={{minWidth: '200px'}}
                  >
                    <List>
                      <ListSubheader>Metric Units</ListSubheader>
                      <Option value={"km"}>Kilometers (km)</Option>
                      <Option value={"m"}>Meters (m)</Option>
                      <Option value={"cm"}>Centimeters (cm)</Option>
                      <Option value={"mm"}>Millimeters (mm)</Option>
                    </List>
                  </Select>
                </Box>
              </Box>
            </Stack>
          </>
        )} */}
        {/* {(uploadForm === "measurements" && personnelRecording !== '' && (dbhUnit !== '' && homUnit !== '' && coordUnit !== '') && !isQuadratConfirmed) && ( */}
        {(uploadForm === "measurements" && personnelRecording !== '' && !isQuadratConfirmed) && (
          <Stack direction={"column"} spacing={2} marginBottom={2}>
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
                const selectedQuadrat = quadratList?.find(quadrat => quadrat?.quadratName === newValue) || undefined;
                setQuadrat(selectedQuadrat);
              }}
            >
              <Option value={""}>None</Option>
              {quadratList?.map((item) => (
                <Option value={item?.quadratName} key={item?.quadratName}>
                  <Box sx={{display: 'flex', flexDirection: 'column', alignItems: 'flex-start'}}>
                    <Typography level="body-lg">{item?.quadratName}</Typography>
                  </Box>
                </Option>
              ))}
            </Select>
            <Button onClick={handleConfirmQuadrat} size="sm" color="primary">Confirm</Button>
          </Stack>
        )}
        {/* {uploadForm === 'measurements' && personnelRecording !== '' && (dbhUnit !== '' && homUnit !== '' && coordUnit !== '') && currentQuadrat && !finish && ( */}
        {uploadForm === 'measurements' && personnelRecording !== '' && currentQuadrat && !finish && (
          <>
            <Typography sx={{mb: 2, mt: 2}}>You have selected:</Typography>
            <Typography>Form: {uploadForm}</Typography>
            <Typography>Quadrat: {quadrat?.quadratName}</Typography>
            <Typography>Personnel: {personnelRecording}</Typography>
            {/* <Stack direction={'row'}>
              <Typography sx={{mx: 2}}>DBH units of measurement: {dbhUnit}</Typography>
              <Typography sx={{mx: 2}}>HOM units of measurement: {homUnit}</Typography>
              <Typography sx={{mx: 2}}>Coordinate units of measurement: {coordUnit}</Typography>
            </Stack> */}
          </>
        )}
        {/* {['attributes', 'personnel', 'species', 'quadrats', 'subquadrats'].includes(uploadForm) && personnelRecording !== '' && (dbhUnit !== '' && homUnit !== '' && coordUnit !== '') && currentQuadrat && !finish && ( */}
        {['attributes', 'personnel', 'species', 'quadrats', 'subquadrats'].includes(uploadForm) && personnelRecording !== '' && currentQuadrat && !finish && (
          <>
            <Typography sx={{mb: 2, mt: 2}}>You have selected:</Typography>
            <Typography>Form: {uploadForm}</Typography>
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