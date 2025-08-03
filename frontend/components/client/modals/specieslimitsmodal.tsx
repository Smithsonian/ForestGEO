'use client';

import { Dispatch, SetStateAction, useEffect, useState } from 'react';
import { SpeciesLimitsRDS, SpeciesRDS } from '@/config/sqlrdsdefinitions/taxonomies';
import {
  Accordion,
  AccordionDetails,
  AccordionGroup,
  AccordionSummary,
  Box,
  Button,
  Chip,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  FormHelperText,
  FormLabel,
  Input,
  Modal,
  ModalDialog,
  Slider,
  Stack,
  Switch,
  Typography
} from '@mui/joy';
import SouthIcon from '@mui/icons-material/South';
import NorthIcon from '@mui/icons-material/North';
import { useOrgCensusContext, usePlotContext, useSiteContext } from '@/app/contexts/userselectionprovider';
import { Info } from '@mui/icons-material';
import ailogger from '@/ailogger';

export default function SpeciesLimitsModal(props: {
  openSpeciesLimitsModal: boolean;
  handleCloseSpeciesLimitsModal: () => void;
  incomingSpecies: SpeciesRDS;
  allSpeciesLimits: SpeciesLimitsRDS[];
  setRefresh: Dispatch<SetStateAction<boolean>>;
}) {
  const BUFFER = 10;
  const { openSpeciesLimitsModal, handleCloseSpeciesLimitsModal, incomingSpecies, allSpeciesLimits, setRefresh } = props;
  const defaultLower = allSpeciesLimits.reduce((min, limit) => Math.min(min, limit.lowerBound || Infinity), 10);
  const defaultUpper = allSpeciesLimits.reduce((max, limit) => Math.max(max, limit.upperBound || -Infinity), 100);
  const originalLimit = allSpeciesLimits.find(limit => limit.speciesID === incomingSpecies.speciesID);
  const initialLowerBound = originalLimit?.lowerBound ?? defaultLower;
  const initialUpperBound = originalLimit?.upperBound ?? defaultUpper;
  const [newSpeciesLimit, setNewSpeciesLimit] = useState<SpeciesLimitsRDS | undefined>(originalLimit);
  const [range, setRange] = useState<{ min: number; max: number }>({
    min: Math.min(defaultLower, initialLowerBound) - BUFFER,
    max: Math.max(defaultUpper, initialUpperBound) + BUFFER
  });
  const [confirmationOpen, setConfirmationOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState<'enable' | 'disable' | null>(null);
  const currentSite = useSiteContext();
  const currentPlot = usePlotContext();
  const currentCensus = useOrgCensusContext();

  useEffect(() => {
    const lower = originalLimit?.lowerBound ?? defaultLower;
    const upper = originalLimit?.upperBound ?? defaultUpper;

    setNewSpeciesLimit(originalLimit);
    setRange({
      min: Math.min(range.min, lower - BUFFER),
      max: Math.max(range.max, upper + BUFFER)
    });
  }, [originalLimit, defaultLower, defaultUpper]);

  function handleSliderChange(_: Event, newValue: number | number[]) {
    if (Array.isArray(newValue) && newValue.length === 2) {
      const [lower, upper] = newValue;

      setNewSpeciesLimit({ ...newSpeciesLimit, lowerBound: lower, upperBound: upper });

      const newRange = { ...range };

      if (lower <= range.min + BUFFER) {
        newRange.min = lower - BUFFER;
      }
      if (upper >= range.max - BUFFER) {
        newRange.max = upper + BUFFER;
      }

      setRange(newRange);
    }
  }

  function handleToggleSwitch(action: 'enable' | 'disable') {
    setPendingAction(action);
    setConfirmationOpen(true);
  }

  function confirmToggleAction() {
    if (pendingAction === 'enable') {
      setNewSpeciesLimit(originalLimit ?? { lowerBound: defaultLower, upperBound: defaultUpper, speciesID: incomingSpecies.speciesID });
    } else if (pendingAction === 'disable') {
      setNewSpeciesLimit(undefined);
    }
    setPendingAction(null);
    setConfirmationOpen(false);
  }

  function cancelToggleAction() {
    setPendingAction(null);
    setConfirmationOpen(false);
  }

  function handleInputChange(value: string, type: 'lower' | 'upper') {
    const parsedValue = parseFloat(value);
    if (!isNaN(parsedValue)) {
      const newLimits: [number, number] = [newSpeciesLimit?.lowerBound ?? defaultLower, newSpeciesLimit?.upperBound ?? defaultUpper];
      if (type === 'lower') {
        newLimits[0] = Math.min(parsedValue, newLimits[1] - 0.1);
        if (parsedValue < range.min) {
          setRange({ ...range, min: parsedValue });
        }
      } else {
        newLimits[1] = Math.max(parsedValue, newLimits[0] + 0.1);
        if (parsedValue > range.max) {
          setRange({ ...range, max: parsedValue });
        }
      }
      setNewSpeciesLimit({ ...newSpeciesLimit, lowerBound: newLimits[0], upperBound: newLimits[1] });
    }
  }

  async function handleSave() {
    try {
      const submittedSpeciesLimit: SpeciesLimitsRDS = {
        ...newSpeciesLimit,
        limitType: 'DBH',
        censusID: currentCensus?.dateRanges[0].censusID,
        plotID: currentPlot?.plotID,
        speciesLimitID: 0
      };
      const method = newSpeciesLimit !== undefined ? (originalLimit ? 'PATCH' : 'POST') : 'DELETE'; // if an original limit exists, use PATCH, otherwise use POST
      const endpoint = `/api/fixeddata/specieslimits/${currentSite?.schemaName}/speciesLimitID/${currentPlot?.plotID}/${currentCensus?.plotCensusNumber}`;
      const response = await fetch(endpoint, {
        method: method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ oldRow: originalLimit, newRow: newSpeciesLimit !== undefined ? submittedSpeciesLimit : originalLimit })
      });
      if (response.ok) {
        alert('Species limits saved successfully!');
      }
    } catch (error: any) {
      ailogger.error('Error saving species limits:', error);
    } finally {
      setRefresh(true);
      closeModal();
    }
  }

  function closeModal() {
    setRange({
      min: Math.min(defaultLower, initialLowerBound) - BUFFER,
      max: Math.max(defaultUpper, initialUpperBound) + BUFFER
    }); // reset values in case modal's opened again
    handleCloseSpeciesLimitsModal();
  }

  return (
    <Modal open={openSpeciesLimitsModal} onClose={handleCloseSpeciesLimitsModal}>
      <ModalDialog sx={{ display: 'flex', flex: 1 }}>
        <DialogTitle>
          <Stack direction="row" spacing={2} sx={{ width: '100%', height: '100%' }}>
            <FormControl orientation="horizontal" sx={{ width: '100%', height: '100%', justifyContent: 'space-between' }}>
              <Box sx={{ display: 'flex', flex: 1, mr: 2, flexDirection: 'column' }}>
                <FormLabel>
                  <Typography level={'title-lg'}>Species Limits for {incomingSpecies.speciesName}</Typography>
                </FormLabel>
                <FormHelperText sx={{ mt: 0 }}>{newSpeciesLimit === undefined ? `Enable limits` : `Disable limits`}</FormHelperText>
              </Box>
              <Switch
                checked={newSpeciesLimit !== undefined}
                onChange={event => handleToggleSwitch(event.target.checked ? 'enable' : 'disable')}
                color={newSpeciesLimit !== undefined ? 'success' : 'neutral'}
                variant={newSpeciesLimit !== undefined ? 'solid' : 'outlined'}
                endDecorator={newSpeciesLimit !== undefined ? 'Enabled' : 'Disabled'}
                slotProps={{
                  endDecorator: {
                    sx: {
                      minWidth: 24
                    }
                  }
                }}
              />
            </FormControl>
          </Stack>
        </DialogTitle>
        <DialogContent>
          <AccordionGroup sx={{ width: '100%', height: '100%' }}>
            <Accordion expanded={newSpeciesLimit !== undefined} disabled={newSpeciesLimit === undefined}>
              <AccordionSummary>Modify Species Limit</AccordionSummary>
              <AccordionDetails>
                <FormControl sx={{ width: '100%', height: '100%', mb: 5 }}>
                  <Input value={'DBH'} disabled />
                  <FormHelperText>Only DBH limits can be set!</FormHelperText>
                </FormControl>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2 }}>
                  <FormControl>
                    <FormLabel>Lower Limit</FormLabel>
                    <Input
                      type="number"
                      value={newSpeciesLimit?.lowerBound}
                      onChange={e => handleInputChange(e.target.value, 'lower')}
                      sx={{ display: 'flex', flex: 1 }}
                      startDecorator={<SouthIcon />}
                      endDecorator={<Typography level={'body-md'}>{currentPlot?.defaultDBHUnits}</Typography>}
                    />
                    <FormHelperText>All values BELOW this limit will be flagged!</FormHelperText>
                  </FormControl>
                  <Typography level="body-md">to</Typography>
                  <FormControl>
                    <FormLabel>Upper Limit</FormLabel>
                    <Input
                      type="number"
                      value={newSpeciesLimit?.upperBound}
                      onChange={e => handleInputChange(e.target.value, 'upper')}
                      sx={{ display: 'flex', flex: 1 }}
                      startDecorator={<NorthIcon />}
                      endDecorator={<Typography level={'body-md'}>{currentPlot?.defaultDBHUnits}</Typography>}
                    />
                    <FormHelperText>All values ABOVE this limit will be flagged!</FormHelperText>
                  </FormControl>
                </Box>
                <Slider
                  sx={{ display: 'flex', flex: 1, paddingX: 5 }}
                  getAriaLabel={() => 'Limits range'}
                  value={[newSpeciesLimit?.lowerBound ?? defaultLower, newSpeciesLimit?.upperBound ?? defaultUpper]}
                  onChange={handleSliderChange}
                  valueLabelDisplay="auto"
                  min={range.min}
                  max={range.max}
                  step={0.1}
                />
                <Chip variant={'soft'} startDecorator={<Info />} color={'warning'}>
                  Units of measure are fixed and can only be updated by an administrator!
                </Chip>
              </AccordionDetails>
            </Accordion>
          </AccordionGroup>
        </DialogContent>
        <DialogActions>
          <Button
            variant={'soft'}
            onClick={() => {
              setNewSpeciesLimit(originalLimit);
              closeModal();
            }}
          >
            Cancel
          </Button>
          <Button variant={'soft'} onClick={handleSave}>
            Save
          </Button>
        </DialogActions>
        <Modal open={confirmationOpen} onClose={cancelToggleAction}>
          <ModalDialog>
            <DialogTitle>{pendingAction === 'enable' ? 'Enable Species Limits' : 'Disable Species Limits'}</DialogTitle>
            <DialogContent>
              <Typography>
                Are you sure you want to {pendingAction === 'enable' ? 'enable' : 'disable'} species limits for <strong>{incomingSpecies.speciesName}</strong>?
              </Typography>
            </DialogContent>
            <DialogActions>
              <Button variant="plain" color="neutral" onClick={cancelToggleAction}>
                Cancel
              </Button>
              <Button variant="solid" color={pendingAction === 'enable' ? 'success' : 'danger'} onClick={confirmToggleAction}>
                Confirm
              </Button>
            </DialogActions>
          </ModalDialog>
        </Modal>
      </ModalDialog>
    </Modal>
  );
}
