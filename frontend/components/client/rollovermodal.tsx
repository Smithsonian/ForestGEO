'use client';
import * as React from 'react';
import { useEffect, useState } from 'react';
import CloseIcon from '@mui/icons-material/Close';
import { usePlotContext, useSiteContext } from '@/app/contexts/userselectionprovider';
import { Stack } from '@mui/material';
import { Alert, Button, Checkbox, DialogActions, DialogContent, DialogTitle, Grid, IconButton, Modal, ModalDialog, Option, Select, Typography } from '@mui/joy';
import { DataGrid, GridRowSelectionModel } from '@mui/x-data-grid';
import { useOrgCensusListContext } from '@/app/contexts/listselectionprovider';
import { Box } from '@mui/system';

import { PersonnelGridColumns, quadratGridColumns } from './datagridcolumns';
import { QuadratRDS } from '@/config/sqlrdsdefinitions/zones';
import { OrgCensusToCensusResultMapper } from '@/config/sqlrdsdefinitions/timekeeping';
import { PersonnelRDS } from '@/config/sqlrdsdefinitions/personnel';

interface RolloverModalProps {
  open: boolean;
  onClose: () => void;
  onConfirm: (rolledOverPersonnel: boolean, rolledOverQuadrats: boolean, createdCensusID?: number) => void;
}

interface CensusValidationStatus {
  censusID: number;
  plotCensusNumber: number;
  hasPersonnelData: boolean;
  hasQuadratsData: boolean;
}

const defaultCVS: CensusValidationStatus = {
  censusID: 0,
  plotCensusNumber: 0,
  hasPersonnelData: false,
  hasQuadratsData: false
};

export default function RolloverModal(props: RolloverModalProps) {
  const { open, onClose, onConfirm } = props;
  const [rolloverPersonnel, setRolloverPersonnel] = useState(false);
  const [rolloverQuadrats, setRolloverQuadrats] = useState(false);
  const [selectedQuadrats, setSelectedQuadrats] = useState<QuadratRDS[]>([]);
  const [selectedPersonnel, setSelectedPersonnel] = useState<PersonnelRDS[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [previousPersonnel, setPreviousPersonnel] = useState<PersonnelRDS[]>([]);
  const [previousQuadrats, setPreviousQuadrats] = useState<QuadratRDS[]>([]);
  const [loading, setLoading] = useState(true);
  const [customizePersonnel, setCustomizePersonnel] = useState(false);
  const [customizeQuadrats, setCustomizeQuadrats] = useState(false);
  const [censusValidationStatus, setCensusValidationStatus] = useState<CensusValidationStatus[]>([]);
  const [selectedQuadratsCensus, setSelectedQuadratsCensus] = useState<CensusValidationStatus>(defaultCVS);
  const [selectedPersonnelCensus, setSelectedPersonnelCensus] = useState<CensusValidationStatus>(defaultCVS);
  const [confirmNoQuadratsRollover, setConfirmNoQuadratsRollover] = useState(false);
  const [confirmNoPersonnelRollover, setConfirmNoPersonnelRollover] = useState(false);
  const [relatedData, setRelatedData] = useState<any[]>([]);

  const currentSite = useSiteContext();
  const currentPlot = usePlotContext();
  const censusListContext = useOrgCensusListContext();

  const fetchPreviousQuadratsData = async (plotCensusNumber: number) => {
    try {
      setLoading(true);
      const quadratsResponse = await fetch(`/api/fetchall/quadrats/${currentPlot?.plotID}/${plotCensusNumber}?schema=${currentSite?.schemaName}`);
      const quadratsData = await quadratsResponse.json();
      setPreviousQuadrats(quadratsData);

      setLoading(false);
    } catch (error) {
      console.error('Failed to fetch previous data', error);
      setError('Failed to fetch previous data. Please try again.');
      setLoading(false);
    }
  };

  const fetchPreviousPersonnelData = async (plotCensusNumber: number) => {
    try {
      setLoading(true);
      const personnelResponse = await fetch(`/api/fetchall/personnel/${currentPlot?.plotID}/${plotCensusNumber}?schema=${currentSite?.schemaName}`);
      const personnelData = await personnelResponse.json();
      setPreviousPersonnel(personnelData);
      const rolesResponse = await fetch(`/api/fetchall/roles/undefined/${plotCensusNumber}/undefined?schema=${currentSite?.schemaName}`, { method: 'GET' });
      setRelatedData(await rolesResponse.json());
      setLoading(false);
    } catch (error) {
      console.error('Failed to fetch previous data', error);
      setError('Failed to fetch previous data. Please try again.');
      setLoading(false);
    }
  };

  const validatePreviousCensusData = async () => {
    if (!censusListContext || censusListContext.length === 0) {
      return defaultCVS;
    }

    const validationStatusPromises = censusListContext.map(async census => {
      const { schemaName } = currentSite || {};
      const { plotID } = currentPlot || {};
      const { plotCensusNumber } = census || {};

      if (!schemaName || !plotID || !plotCensusNumber) {
        return null;
      }

      const personnelCheck = await fetch(`/api/cmprevalidation/personnel/${schemaName}/${plotID}/${plotCensusNumber}`);
      const quadratsCheck = await fetch(`/api/cmprevalidation/quadrats/${schemaName}/${plotID}/${plotCensusNumber}`);

      const personnelValid = personnelCheck.status === 200;
      const quadratsValid = quadratsCheck.status === 200;

      return {
        censusID: census?.dateRanges[0].censusID,
        plotCensusNumber: census?.plotCensusNumber,
        hasPersonnelData: personnelValid,
        hasQuadratsData: quadratsValid
      };
    });

    const validationStatuses = await Promise.all(validationStatusPromises);
    setCensusValidationStatus(validationStatuses.filter(status => status !== null) as CensusValidationStatus[]);
    setLoading(false);
  };

  useEffect(() => {
    if (open) {
      validatePreviousCensusData();
    }
  }, [open]);

  useEffect(() => {
    if (!open) {
      resetState();
    }
  }, [open]);

  useEffect(() => {
    if (selectedQuadratsCensus.censusID !== 0) {
      const foundCensus = censusListContext?.find(census => census?.dateRanges.some(dateRange => dateRange.censusID === selectedQuadratsCensus.censusID));

      if (foundCensus) {
        const plotCensusNumber = foundCensus.plotCensusNumber;
        fetchPreviousQuadratsData(plotCensusNumber);
      }
    }
  }, [selectedQuadratsCensus, censusListContext]);

  useEffect(() => {
    if (selectedPersonnelCensus.censusID !== 0) {
      const foundCensus = censusListContext?.find(census => census?.dateRanges.some(dateRange => dateRange.censusID === selectedPersonnelCensus.censusID));
      if (foundCensus) {
        const plotCensusNumber = foundCensus.plotCensusNumber;
        fetchPreviousPersonnelData(plotCensusNumber);
      }
    }
  }, [selectedPersonnelCensus, censusListContext]);

  useEffect(() => {
    if (!customizePersonnel && previousPersonnel.length > 0 && selectedPersonnelCensus.censusID !== 0) setSelectedPersonnel(previousPersonnel);
    if (!customizeQuadrats && previousQuadrats.length > 0 && selectedQuadratsCensus.censusID !== 0) setSelectedQuadrats(previousQuadrats);
  }, [customizePersonnel, customizeQuadrats, selectedQuadratsCensus, previousPersonnel, previousQuadrats]);

  const resetState = () => {
    setRolloverPersonnel(false);
    setRolloverQuadrats(false);
    setSelectedQuadrats([]);
    setSelectedPersonnel([]);
    setError(null);
    setLoading(false);
    setCustomizePersonnel(false);
    setCustomizeQuadrats(false);
    setSelectedQuadratsCensus(defaultCVS);
    setSelectedPersonnelCensus(defaultCVS);
    setConfirmNoQuadratsRollover(false);
    setConfirmNoPersonnelRollover(false);
  };

  const handleConfirm = async () => {
    if (confirmNoQuadratsRollover && confirmNoPersonnelRollover && selectedPersonnelCensus.censusID === 0 && selectedQuadratsCensus.censusID === 0) {
      console.log('confirm no rollover');
      onConfirm(rolloverPersonnel, rolloverQuadrats);
      resetState();
      return;
    } else if (selectedPersonnelCensus.censusID === 0 && !confirmNoPersonnelRollover) {
      alert('Please confirm that you do not wish to rollover personnel to proceed');
    } else if (selectedQuadratsCensus.censusID === 0 && !confirmNoQuadratsRollover) {
      alert('Please confirm that you do not wish to rollover quadrats to proceed');
    }

    if (!rolloverPersonnel && !rolloverQuadrats) {
      alert('You must select at least one option to roll over or confirm no rollover.');
      return;
    } else if (rolloverQuadrats && selectedQuadrats.length === 0 && customizeQuadrats) {
      alert('You must select at least one quadrat to roll over.');
      return;
    } else if (rolloverPersonnel && selectedPersonnel.length === 0 && customizePersonnel) {
      alert('You must select at least one person to roll over.');
      return;
    }

    if (!currentSite?.schemaName || !currentPlot?.plotID) throw new Error('site context and plot context are undefined.');

    setLoading(true);

    try {
      if (rolloverPersonnel || rolloverQuadrats) {
        const highestPlotCensusNumber =
          censusListContext && censusListContext.length > 0
            ? censusListContext.reduce(
                (max, census) => ((census?.plotCensusNumber ?? 0) > max ? (census?.plotCensusNumber ?? 0) : max),
                censusListContext[0]?.plotCensusNumber ?? 0
              )
            : 0;
        if (!highestPlotCensusNumber) throw new Error('highest plot census number calculation failed');

        const mapper = new OrgCensusToCensusResultMapper();
        const newCensusID = await mapper.startNewCensus(currentSite?.schemaName, currentPlot?.plotID, highestPlotCensusNumber + 1);
        if (!newCensusID) throw new Error('census creation failure');
        // Perform the rollover
        if (rolloverPersonnel) {
          // passing source censusID to rollover endpoint
          console.log('rollover personnel');
          await fetch(`/api/rollover/personnel/${currentSite?.schemaName}/${currentPlot?.plotID}/${selectedPersonnelCensus?.censusID}/${newCensusID}`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              incoming: customizePersonnel ? selectedPersonnel.map(person => person.personnelID) : previousPersonnel.map(person => person.personnelID)
            })
          });
        }

        if (rolloverQuadrats) {
          // passing source censusID to rollover endpoint
          await fetch(`/api/rollover/quadrats/${currentSite?.schemaName}/${currentPlot?.plotID}/${selectedQuadratsCensus?.censusID}/${newCensusID}`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              incoming: customizeQuadrats ? selectedQuadrats.map(quadrat => quadrat.quadratID) : previousQuadrats.map(quadrat => quadrat.quadratID)
            })
          });
        }
        onConfirm(rolloverPersonnel, rolloverQuadrats, newCensusID);
      } else onConfirm(false, false);
    } catch (error) {
      console.error('Failed to perform rollover', error);
      setError(`Failed to perform rollover: ${error}. Please try again.`);
      onConfirm(false, false);
    } finally {
      setLoading(false);
      resetState();
    }
  };

  const handleRowSelection = <T extends { personnelID?: number; quadratID?: number }>(
    selectionModel: GridRowSelectionModel,
    setSelection: React.Dispatch<React.SetStateAction<T[]>>
  ) => {
    setSelection(
      selectionModel
        .map(id => {
          return (previousPersonnel.find(p => p.id === id) as T) || (previousQuadrats.find(q => q.id === id) as T);
        })
        .filter(Boolean)
    );
  };

  if (loading) {
    return (
      <Modal open={open} onClose={onClose}>
        <ModalDialog>
          <Typography>Loading...</Typography>
        </ModalDialog>
      </Modal>
    );
  }

  return (
    <Modal open={open} onClose={undefined}>
      <ModalDialog
        role="alertdialog"
        sx={{
          width: '90vw',
          height: '90vh',
          display: 'flex',
          flexDirection: 'column',
          flex: 1,
          overflow: 'auto'
        }}
      >
        <DialogTitle>
          <Stack direction="row" justifyContent="space-between" alignItems="center" mb={2}>
            <Typography level="title-lg">Rollover Census Data</Typography>
            <IconButton variant="plain" size="sm" onClick={onClose} sx={{ position: 'absolute', top: 8, right: 8 }}>
              <CloseIcon />
            </IconButton>
          </Stack>
        </DialogTitle>
        <DialogContent
          sx={{
            width: '100%',
            height: '100%',
            overflow: 'auto'
          }}
        >
          {error && <Alert color="danger">{error}</Alert>}
          <Grid container spacing={2} sx={{ flex: 1, display: 'flex', flexDirection: 'row', width: '100%', height: '100%' }}>
            <Grid xs={'auto'} sx={{ width: '50%', height: '50%' }}>
              <Typography mb={2} level="title-md" fontWeight={'xl'}>
                Roll over <b>Personnel</b> data:
              </Typography>
              <Select
                sx={{ mb: 2 }}
                value={selectedPersonnelCensus.censusID}
                onChange={(_event, newValue) => {
                  const selected = censusValidationStatus.find(census => census.censusID === newValue) || defaultCVS;
                  if (selected === defaultCVS) setConfirmNoPersonnelRollover(false);
                  setSelectedPersonnelCensus(selected);
                }}
              >
                <Option value={0}>
                  Do not roll over any <b>Personnel</b> data
                </Option>
                {censusValidationStatus.map(census => (
                  <Option key={census.censusID} value={census.censusID} disabled={!census.hasPersonnelData}>
                    {`Census ${census.plotCensusNumber} - Personnel: ${census.hasPersonnelData ? 'Yes' : 'No'}`}
                  </Option>
                ))}
              </Select>
              {selectedPersonnelCensus.censusID === 0 ? (
                <Box sx={{ display: 'flex', flex: 1, flexDirection: 'column' }}>
                  <Alert color="warning" sx={{ my: 2 }}>
                    You have selected to not roll over any Personnel data. <br /> Please confirm to proceed.
                  </Alert>
                  <Button
                    variant={confirmNoPersonnelRollover ? 'solid' : 'outlined'}
                    color="warning"
                    onClick={() => {
                      setConfirmNoPersonnelRollover(!confirmNoPersonnelRollover);
                    }}
                  >
                    {confirmNoPersonnelRollover ? `Confirmed` : `Confirm No Rollover`}
                  </Button>
                </Box>
              ) : (
                <Box sx={{ display: 'flex', flex: 1, flexDirection: 'column' }}>
                  <Stack direction="row" spacing={2} alignItems="center">
                    <Checkbox
                      checked={rolloverPersonnel}
                      onChange={() => setRolloverPersonnel(!rolloverPersonnel)}
                      disabled={!customizePersonnel && !selectedPersonnelCensus?.hasPersonnelData}
                    />
                    <Typography>Roll over personnel data</Typography>
                  </Stack>
                  {rolloverPersonnel && (
                    <Box sx={{ display: 'flex', flex: 1, flexDirection: 'column' }}>
                      <Button onClick={() => setCustomizePersonnel(!customizePersonnel)}>
                        {customizePersonnel ? 'Roll over all personnel' : 'Customize personnel selection'}
                      </Button>
                      {customizePersonnel && (
                        <DataGrid
                          rows={previousPersonnel}
                          columns={PersonnelGridColumns}
                          pageSizeOptions={[5, 10, 25, 100]}
                          checkboxSelection
                          onRowSelectionModelChange={selectionModel => handleRowSelection(selectionModel, setSelectedPersonnel)}
                          initialState={{
                            pagination: {
                              paginationModel: { pageSize: 5, page: 0 }
                            }
                          }}
                          autoHeight
                        />
                      )}
                    </Box>
                  )}
                </Box>
              )}
            </Grid>
            <Grid xs={'auto'} sx={{ width: '50%', height: '50%' }}>
              <Typography mb={2} level="title-md" fontWeight={'xl'}>
                Roll over <b>Quadrats</b> data
              </Typography>
              <Select
                sx={{ mb: 2 }}
                value={selectedQuadratsCensus.censusID}
                onChange={(_event, newValue) => {
                  const selected = censusValidationStatus.find(census => census.censusID === newValue) || defaultCVS;
                  if (selected === defaultCVS) setConfirmNoQuadratsRollover(false);
                  setSelectedQuadratsCensus(selected);
                }}
              >
                <Option value={0}>
                  Do not roll over any <b>Quadrats</b> data
                </Option>
                {censusValidationStatus.map(census => (
                  <Option key={census.censusID} value={census.censusID} disabled={!census.hasQuadratsData}>
                    {`Census ${census.plotCensusNumber} - Quadrats: ${census.hasQuadratsData ? 'Yes' : 'No'}`}
                  </Option>
                ))}
              </Select>
              {selectedQuadratsCensus.censusID === 0 ? (
                <Box sx={{ display: 'flex', flex: 1, flexDirection: 'column' }}>
                  <Alert color="warning" sx={{ my: 2 }}>
                    You have selected to not roll over any Quadrats data. <br /> Please confirm to proceed.
                  </Alert>
                  <Button
                    variant={confirmNoQuadratsRollover ? 'solid' : 'outlined'}
                    color="warning"
                    onClick={() => {
                      setConfirmNoQuadratsRollover(!confirmNoQuadratsRollover);
                    }}
                  >
                    {confirmNoQuadratsRollover ? `Confirmed` : `Confirm No Rollover`}
                  </Button>
                </Box>
              ) : (
                <Box sx={{ display: 'flex', flex: 1, flexDirection: 'column' }}>
                  <Stack direction="row" spacing={2} alignItems="center">
                    <Checkbox
                      checked={rolloverQuadrats}
                      onChange={() => setRolloverQuadrats(!rolloverQuadrats)}
                      disabled={!customizeQuadrats && !selectedQuadratsCensus?.hasQuadratsData}
                    />
                    <Typography>Roll over quadrats data</Typography>
                  </Stack>
                  {rolloverQuadrats && (
                    <Box sx={{ display: 'flex', flex: 1, flexDirection: 'column' }}>
                      <Button onClick={() => setCustomizeQuadrats(!customizeQuadrats)}>
                        {customizeQuadrats ? 'Roll over all quadrats' : 'Customize quadrats selection'}
                      </Button>
                      {customizeQuadrats && (
                        <DataGrid
                          rows={previousQuadrats}
                          columns={quadratGridColumns}
                          pageSizeOptions={[5, 10, 25, 100]}
                          checkboxSelection
                          onRowSelectionModelChange={selectionModel => handleRowSelection(selectionModel, setSelectedPersonnel)}
                          initialState={{
                            pagination: {
                              paginationModel: { pageSize: 5, page: 0 }
                            }
                          }}
                          autoHeight
                        />
                      )}
                    </Box>
                  )}
                </Box>
              )}
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions>
          <Stack direction="row" justifyContent="flex-end" spacing={1} mt={2}>
            <Button variant="plain" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="solid" onClick={handleConfirm}>
              Confirm
            </Button>
          </Stack>
        </DialogActions>
      </ModalDialog>
    </Modal>
  );
}
