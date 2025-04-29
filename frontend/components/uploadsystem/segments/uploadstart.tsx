'use client';

import { ReviewStates, UploadStartProps } from '@/config/macros/uploadsystemmacros';
import { Box, Button, Stack, Tooltip, Typography } from '@mui/joy';
import AutocompleteFixedData from '@/components/autocompletefixeddata';
import React, { Dispatch, SetStateAction, useEffect, useState } from 'react';
import Select, { SelectOption } from '@mui/joy/Select';
import Option from '@mui/joy/Option';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import { useQuadratListContext, useQuadratListDispatch } from '@/app/contexts/listselectionprovider';
import { useOrgCensusContext, usePlotContext, useQuadratContext, useQuadratDispatch, useSiteContext } from '@/app/contexts/userselectionprovider';

import FinalizeSelectionsButton from '../../client/modals/finalizeselectionsbutton';
import { Quadrat } from '@/config/sqlrdsdefinitions/zones';

export default function UploadStart(props: Readonly<UploadStartProps>) {
  const { uploadForm, personnelRecording, setPersonnelRecording, setReviewState } = props;
  const [finish, setFinish] = useState<boolean>(false);
  const quadratListContext = useQuadratListContext();
  const quadratListDispatch = useQuadratListDispatch();
  const currentCensus = useOrgCensusContext();
  const currentSite = useSiteContext();
  const currentQuadrat = useQuadratContext();
  const currentPlot = usePlotContext();
  console.log('current quadrat: ', currentQuadrat);
  const [quadrat, setQuadrat] = useState<Quadrat>(currentQuadrat);
  const [quadratList, setQuadratList] = useState<Quadrat[] | undefined>([]);
  const quadratDispatch = useQuadratDispatch();
  const [isQuadratConfirmed, setIsQuadratConfirmed] = useState(!!currentQuadrat);

  const handleChange = (_event: React.SyntheticEvent | null, dispatcher: Dispatch<SetStateAction<string>>, newValue: string | null) => {
    if (newValue) {
      dispatcher(newValue);
    }
  };

  // Single function to handle "Back" action
  const handleBack = () => {
    if (personnelRecording !== '') {
      setPersonnelRecording('');
    } else if (isQuadratConfirmed) {
      setIsQuadratConfirmed(false);
    }
    setFinish(false);
  };
  useEffect(() => {
    if (quadratDispatch) quadratDispatch({ quadrat: undefined }).then(() => {}); // deselect quadrat at start of execution
  }, []);

  useEffect(() => {
    const loadQuadratsData = async () => {
      if (!currentPlot || !currentCensus) return;
      if (quadratListContext !== undefined && quadratListContext.length > 0) return { success: true };

      const quadratsResponse = await fetch(
        `/api/fetchall/quadrats/${currentPlot.plotID}/${currentCensus.plotCensusNumber}?schema=${currentSite?.schemaName || ''}`
      );
      const quadratsData = await quadratsResponse.json();
      if (!quadratsData) return;

      if (quadratListDispatch) {
        await quadratListDispatch({ quadratList: quadratsData });
      } else return;
      return;
    };
    if (currentPlot && currentCensus && currentSite) {
      // ensure that selectable list is restricted by selected plot
      // need to re-pull quadrats to be sure:
      loadQuadratsData()
        .then(() => {
          setQuadratList(quadratListContext?.filter(quadrat => quadrat?.plotID === currentPlot.id) || undefined);
        })
        .catch(console.error);
    }
  }, [currentSite, currentPlot, currentCensus]);

  useEffect(() => {
    if (finish) setReviewState(ReviewStates.UPLOAD_FILES);
  }, [finish]);

  const handleQuadratSelection = async (selectedQuadrat: Quadrat | undefined) => {
    setQuadrat(selectedQuadrat);
    if (quadratDispatch) {
      await quadratDispatch({ quadrat: selectedQuadrat });
    }
  };

  const handleConfirmQuadrat = async () => {
    await handleQuadratSelection(quadrat);
    setIsQuadratConfirmed(true);
  };

  const allSelectionsMade = uploadForm !== undefined && (uploadForm !== 'measurements' || (personnelRecording !== '' && isQuadratConfirmed));

  const showBackButton = personnelRecording !== '' || isQuadratConfirmed;

  const renderQuadratValue = (option: SelectOption<string> | null) => {
    if (!option) {
      return <Typography>Select a Quadrat</Typography>; // or some placeholder JSX
    }

    // Find the corresponding Quadrat object
    const selectedValue = option.value; // assuming option has a 'value' property
    const selectedQuadrat = quadratListContext?.find(c => c?.quadratName === selectedValue);

    // Return JSX
    return selectedQuadrat ? <Typography>{`Quadrat: ${selectedQuadrat?.quadratName}`}</Typography> : <Typography>No Quadrat</Typography>;
  };

  return (
    <Box
      sx={{
        display: 'flex',
        flex: 1,
        flexDirection: 'column',
        alignItems: 'center'
      }}
    >
      <Stack direction={'column'} sx={{ width: 'fit-content' }}>
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
                  borderColor: 'primary.main'
                }
              }}
            >
              Back
            </Button>
          </Tooltip>
        )}
        {/* Form Type Selection */}
        {uploadForm !== undefined && uploadForm !== 'measurements' && !finish && (
          <>
            <Typography sx={{ mb: 2 }}>You have selected:</Typography>
            <Typography>Form: {uploadForm}</Typography>
          </>
        )}
        {/* Personnel Recording Selection */}
        {uploadForm === 'measurements' && personnelRecording === '' && (
          <>
            <Typography sx={{ mb: 2 }}>Who recorded this data?</Typography>
            <AutocompleteFixedData dataType="personnel" value={personnelRecording} onChange={setPersonnelRecording} />
          </>
        )}

        {uploadForm === 'measurements' && personnelRecording !== '' && !isQuadratConfirmed && (
          <Stack direction={'column'} spacing={2} marginBottom={2}>
            <Typography level={'title-sm'}>Select Quadrat:</Typography>
            <Select
              placeholder="Select a Quadrat"
              name={currentQuadrat?.quadratName ?? 'None'}
              required
              autoFocus
              size={'md'}
              value={currentQuadrat?.quadratName ?? ''}
              renderValue={renderQuadratValue}
              onChange={async (_event: React.SyntheticEvent | null, newValue: string | null) => {
                // Find the corresponding Quadrat object using newValue
                const selectedQuadrat = quadratList?.find(quadrat => quadrat?.quadratName === newValue) || undefined;
                setQuadrat(selectedQuadrat);
              }}
            >
              <Option value={''}>None</Option>
              {quadratList?.map(item => (
                <Option value={item?.quadratName} key={item?.quadratName}>
                  <Box
                    sx={{
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'flex-start'
                    }}
                  >
                    <Typography level="body-lg">{item?.quadratName}</Typography>
                  </Box>
                </Option>
              ))}
            </Select>
            <Button onClick={handleConfirmQuadrat} size="sm" color="primary">
              Confirm
            </Button>
          </Stack>
        )}
        {uploadForm === 'measurements' && personnelRecording !== '' && currentQuadrat && !finish && (
          <>
            <Typography sx={{ mb: 2, mt: 2 }}>You have selected:</Typography>
            <Typography>Form: {uploadForm}</Typography>
            <Typography>Quadrat: {quadrat?.quadratName}</Typography>
            <Typography>Personnel: {personnelRecording}</Typography>
          </>
        )}
        {uploadForm !== undefined &&
          ['attributes', 'personnel', 'species', 'quadrats', 'subquadrats'].includes(uploadForm) &&
          personnelRecording !== '' &&
          currentQuadrat &&
          !finish && (
            <>
              <Typography sx={{ mb: 2, mt: 2 }}>You have selected:</Typography>
              <Typography>Form: {uploadForm}</Typography>
            </>
          )}
        <FinalizeSelectionsButton onFinish={() => setFinish(true)} show={allSelectionsMade && !finish} />
      </Stack>
    </Box>
  );
}
