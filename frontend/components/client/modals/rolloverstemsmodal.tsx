'use client';

import { useOrgCensusContext, usePlotContext, useSiteContext } from '@/app/contexts/userselectionprovider';
import ContextValidationGuard from '@/components/shared/ContextValidationGuard';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Modal,
  ModalDialog,
  Option,
  Select,
  Stack,
  Typography
} from '@mui/joy';
import { DataGrid, GridRowSelectionModel } from '@mui/x-data-grid';
import { Dispatch, SetStateAction, useEffect, useState } from 'react';
import CloseIcon from '@mui/icons-material/Close';

import { StemGridColumns } from '../datagridcolumns';
import { StemRDS } from '@/config/sqlrdsdefinitions/taxonomies';
import { createAndUpdateCensusList, OrgCensusRDS, OrgCensusToCensusResultMapper } from '@/config/sqlrdsdefinitions/timekeeping';
import { useAsyncOperation } from '@/hooks/useAsyncOperation';
import { useApiWrapper } from '@/utils/apiWrapper';
import ailogger from '@/ailogger';

interface RolloverStemsModalProps {
  open: boolean;
  onClose: () => void;
  onConfirm: (rolledOverStems: boolean) => void;
}

interface CensusValidationStatus {
  censusID: number;
  plotCensusNumber: number;
  hasStemsData: boolean;
}

const defaultCVS: CensusValidationStatus = {
  censusID: 0,
  plotCensusNumber: 0,
  hasStemsData: false
};

export default function RolloverStemsModal(props: RolloverStemsModalProps) {
  const { open, onClose, onConfirm } = props;
  const [rolloverStems, setRolloverStems] = useState(false);
  const [selectedStems, setSelectedStems] = useState<StemRDS[]>([]);
  const [previousStems, setPreviousStems] = useState<StemRDS[]>([]);
  const [customizeStems, setCustomizeStems] = useState(false);
  const [censusValidationStatus, setCensusValidationStatus] = useState<CensusValidationStatus[]>([]);
  const [selectedStemsCensus, setSelectedStemsCensus] = useState<CensusValidationStatus>(defaultCVS);
  const [confirmNoStemsRollover, setConfirmNoStemsRollover] = useState(false);
  const [updatedCensusList, setUpdatedCensusList] = useState<OrgCensusRDS[]>([]);

  const currentSite = useSiteContext();
  const currentPlot = usePlotContext();
  const currentCensus = useOrgCensusContext();

  // Initialize API wrapper
  const ApiWrapper = useApiWrapper();

  // Use async operation hook for fetching previous stems data
  const { execute: fetchPreviousStemsData } = useAsyncOperation(
    async (plotCensusNumber: number) => {
      const response = await ApiWrapper.get(`/api/fetchall/stems/${currentPlot?.plotID}/${plotCensusNumber}?schema=${currentSite?.schemaName}`, {
        loadingMessage: 'Loading previous stems data...',
        category: 'api'
      });
      const stemsData = await response.json();
      setPreviousStems(stemsData);
      return stemsData;
    },
    {
      onError: error => {
        ailogger.error('failed to fetch previous data: ', error);
        alert(`Failed to fetch previous stems data: ${error.message}`);
      }
    }
  );

  // Use async operation hook for census validation
  const { execute: validatePreviousCensusDataNew } = useAsyncOperation(
    async () => {
      // need to re-fetch the census list --> can't use list context here because it's outdated!
      const response = await ApiWrapper.get(
        `/api/fetchall/census/${currentPlot?.plotID ?? 0}/${currentCensus?.plotCensusNumber ?? 0}?schema=${currentSite?.schemaName || ''}`,
        {
          loadingMessage: 'Loading census data...',
          category: 'api'
        }
      );
      const censusRDSLoad = await response.json();
      const censusList = await createAndUpdateCensusList(censusRDSLoad);
      setUpdatedCensusList(censusList);

      const validationStatusPromises = censusList.map(async census => {
        const { schemaName } = currentSite || {};
        const { plotID } = currentPlot || {};
        const { plotCensusNumber } = census || {};

        if (!schemaName || !plotID || !plotCensusNumber) return null;

        try {
          const stemsCheck = await ApiWrapper.get(`/api/cmprevalidation/stems/${schemaName}/${plotID}/${plotCensusNumber}`, { showErrorAlert: false });

          return {
            censusID: census?.dateRanges[0].censusID,
            plotCensusNumber: census?.plotCensusNumber,
            hasStemsData: stemsCheck.status === 200
          };
        } catch {
          return {
            censusID: census?.dateRanges[0].censusID,
            plotCensusNumber: census?.plotCensusNumber,
            hasStemsData: false
          };
        }
      });

      const validationStatuses = await Promise.all(validationStatusPromises);
      setCensusValidationStatus(validationStatuses.filter(status => status !== null) as CensusValidationStatus[]);

      return validationStatuses;
    },
    {
      loadingMessage: 'Validating census data...',
      category: 'processing'
    }
  );

  const validatePreviousCensusData = async () => {
    // need to re-fetch the census list --> can't use list context here because it's outdated!
    const response = await fetch(
      `/api/fetchall/census/${currentPlot?.plotID ?? 0}/${currentCensus?.plotCensusNumber ?? 0}?schema=${currentSite?.schemaName || ''}`
    );
    const censusRDSLoad = await response.json();
    const censusList = await createAndUpdateCensusList(censusRDSLoad);
    setUpdatedCensusList(censusList);
    const validationStatusPromises = censusList.map(async census => {
      const { schemaName } = currentSite || {};
      const { plotID } = currentPlot || {};
      const { plotCensusNumber } = census || {};

      if (!schemaName || !plotID || !plotCensusNumber) return null;

      const stemsCheck = await fetch(`/api/cmprevalidation/stems/${schemaName}/${plotID}/${plotCensusNumber}`);

      return {
        censusID: census?.dateRanges[0].censusID,
        plotCensusNumber: census?.plotCensusNumber,
        hasStemsData: stemsCheck.status === 200
      };
    });
    const validationStatuses = await Promise.all(validationStatusPromises);
    setCensusValidationStatus(validationStatuses.filter(status => status !== null) as CensusValidationStatus[]);
  };
  const resetState = () => {
    setRolloverStems(false);
    setSelectedStems([]);
    setPreviousStems([]);
    setCustomizeStems(false);
    setSelectedStems([]);
    setSelectedStemsCensus(defaultCVS);
    setConfirmNoStemsRollover(false);
  };

  useEffect(() => {
    if (open) validatePreviousCensusData().catch(ailogger.error);
    else resetState();
  }, [open]);

  useEffect(() => {
    if (selectedStemsCensus.censusID !== 0) {
      const foundCensus = updatedCensusList?.find(census => census?.dateRanges.some(dateRange => dateRange.censusID === selectedStemsCensus.censusID));
      if (foundCensus) {
        const plotCensusNumber = foundCensus.plotCensusNumber;
        fetchPreviousStemsData(plotCensusNumber).catch(ailogger.error);
      }
    }
  }, [selectedStemsCensus, updatedCensusList]);

  useEffect(() => {
    if (!customizeStems && previousStems.length > 0 && selectedStemsCensus.censusID !== 0) setSelectedStems(previousStems);
  }, [customizeStems, selectedStemsCensus, previousStems]);

  // Use async operation for confirm handling
  const { execute: handleConfirm } = useAsyncOperation(
    async () => {
      if (confirmNoStemsRollover && selectedStemsCensus.censusID === 0) {
        onConfirm(false);
        resetState();
        return;
      } else if (selectedStemsCensus.censusID === 0 && !confirmNoStemsRollover) {
        alert('Please confirm that you do not wish to rollover stems to proceed');
        return;
      }

      if (!rolloverStems) {
        alert('You must select at least one option to roll over or confirm no rollover.');
        return;
      } else if (rolloverStems && selectedStems.length === 0 && customizeStems) {
        alert('You must select at least one stem to roll over');
        return;
      }

      if (!currentSite?.schemaName || !currentPlot?.plotID) {
        alert('Site or plot context is missing. Please ensure all required selections are made.');
        return;
      }
      if (rolloverStems) {
        const highestPlotCensusNumber =
          updatedCensusList.length > 0
            ? updatedCensusList.reduce(
                (max, census) => ((census?.plotCensusNumber ?? 0) > max ? (census?.plotCensusNumber ?? 0) : max),
                updatedCensusList[0]?.plotCensusNumber ?? 0
              )
            : 0;
        if (!highestPlotCensusNumber) throw new Error('highest plot census number calculation failed');

        const mapper = new OrgCensusToCensusResultMapper();
        const newCensusID = await mapper.startNewCensus(currentSite?.schemaName, currentPlot?.plotID, highestPlotCensusNumber + 1);
        if (!newCensusID) throw new Error('census creation failure');

        await ApiWrapper.post(
          `/api/rollover/personnel/${currentSite?.schemaName}/${currentPlot?.plotID}/${selectedStemsCensus?.censusID}/${newCensusID}`,
          { incoming: customizeStems ? selectedStems.map(stem => stem.stemGUID) : previousStems.map(stem => stem.stemGUID) },
          {
            loadingMessage: 'Rolling over stems...',
            category: 'processing'
          }
        );
      }
      onConfirm(rolloverStems);
      resetState();
    },
    {
      loadingMessage: 'Processing rollover...',
      category: 'processing',
      onError: error => {
        ailogger.error('failed to perform stems rollover: ', error);
        onConfirm(false);
        resetState();
      }
    }
  );

  const handleRowSelection = <T extends { stemGUID?: number }>(selectionModel: GridRowSelectionModel, setSelection: Dispatch<SetStateAction<T[]>>) => {
    setSelection(
      (selectionModel as any)
        .map((id: number) => {
          return previousStems.find(p => p.id === id) as T;
        })
        .filter(Boolean)
    );
  };

  return (
    <ContextValidationGuard
      requireSite={true}
      requirePlot={true}
      requireCensus={true}
      customMessage="Rollover operations require active site, plot, and census selections."
    >
      <Modal open={open} onClose={undefined} data-testid={'rollover-stems-modal'}>
        <ModalDialog role="alertdialog">
          <DialogTitle>
            <Stack direction={'row'} justifyContent={'space-between'} alignItems={'center'} mb={2}>
              <Typography level="title-lg">Rollover Stems Data</Typography>
              <IconButton variant="plain" size="sm" onClick={onClose} sx={{ position: 'absolute', top: 8, right: 8 }}>
                <CloseIcon />
              </IconButton>
            </Stack>
          </DialogTitle>
          <DialogContent>
            <Stack direction={'column'}>
              <Typography mb={2} level="title-md" fontWeight={'xl'}>
                Roll over <b>Stems</b> data:
              </Typography>
              <Select
                sx={{ mb: 2 }}
                value={selectedStemsCensus.censusID}
                onChange={(_event, newValue) => {
                  const selected = censusValidationStatus.find(census => census.censusID === newValue) || defaultCVS;
                  if (selected === defaultCVS) setConfirmNoStemsRollover(false);
                  setSelectedStemsCensus(selected);
                }}
              >
                <Option value={0}>Do not roll over any Stems data</Option>
                {censusValidationStatus.map(census => (
                  <Option key={census.censusID} value={census.censusID} disabled={!census.hasStemsData}>
                    {`Census: ${census.plotCensusNumber} - Stems: ${census.hasStemsData ? `Yes` : `No`}`}
                  </Option>
                ))}
              </Select>
              {selectedStemsCensus.censusID === 0 ? (
                <Box sx={{ display: 'flex', flex: 1, flexDirection: 'column' }}>
                  <Alert color="warning" sx={{ my: 2 }}>
                    You have selected to not roll over any Stems data. <br /> Please confirm to proceed.
                  </Alert>
                  <Button
                    variant={confirmNoStemsRollover ? 'solid' : 'soft'}
                    color="warning"
                    onClick={() => {
                      setConfirmNoStemsRollover(!confirmNoStemsRollover);
                    }}
                  >
                    {confirmNoStemsRollover ? `Confirmed` : `Confirm No Rollover`}
                  </Button>
                </Box>
              ) : (
                <Box sx={{ display: 'flex', flex: 1, flexDirection: 'column' }}>
                  <Stack direction={'row'} spacing={2} alignItems={'center'}>
                    <Checkbox
                      aria-label={'stems rollover checkbox'}
                      checked={rolloverStems}
                      onChange={() => setRolloverStems(!rolloverStems)}
                      disabled={!customizeStems && !selectedStemsCensus.hasStemsData}
                    />
                    <Typography>Rollover stems data</Typography>
                  </Stack>
                  {rolloverStems && (
                    <Box sx={{ display: 'flex', flex: 1, flexDirection: 'column' }}>
                      <Button onClick={() => setCustomizeStems(!customizeStems)}>{customizeStems ? 'Roll over all stems' : 'Customize stems selection'}</Button>
                      {customizeStems && (
                        <DataGrid
                          rows={previousStems}
                          columns={StemGridColumns}
                          pageSizeOptions={[5, 10, 25, 100]}
                          checkboxSelection
                          onRowSelectionModelChange={selectionModel => handleRowSelection(selectionModel, setSelectedStems)}
                          initialState={{
                            pagination: {
                              paginationModel: { pageSize: 5, page: 0 }
                            }
                          }}
                        />
                      )}
                    </Box>
                  )}
                </Box>
              )}
            </Stack>
          </DialogContent>
          <DialogActions>
            <Stack direction={'row'} justifyContent={'flex-end'} spacing={1} mt={2}>
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
    </ContextValidationGuard>
  );
}
