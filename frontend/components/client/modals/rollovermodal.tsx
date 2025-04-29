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

import { AllTaxonomiesViewGridColumns, AttributeGridColumns, PersonnelGridColumns, QuadratGridColumns } from '../datagridcolumns';
import { OrgCensusToCensusResultMapper } from '@/config/sqlrdsdefinitions/timekeeping';
import { PersonnelRDS } from '@/config/sqlrdsdefinitions/personnel';
import { AttributesRDS } from '@/config/sqlrdsdefinitions/core';
import { QuadratRDS } from '@/config/sqlrdsdefinitions/zones';
import { SpeciesRDS } from '@/config/sqlrdsdefinitions/taxonomies';

interface RolloverModalProps {
  open: boolean;
  onClose: () => void;
  onConfirm: (
    rolledOverPersonnel: boolean,
    rolledOverQuadrats: boolean,
    rolledOverAttributes: boolean,
    rolledOverSpecies: boolean,
    createdCensusID?: number
  ) => void;
}

interface CensusValidationStatus {
  censusID: number;
  plotCensusNumber: number;
  hasPersonnelData: boolean;
  hasQuadratsData: boolean;
  hasAttributesData: boolean;
  hasSpeciesData: boolean;
}

const defaultCVS: CensusValidationStatus = {
  censusID: 0,
  plotCensusNumber: 0,
  hasPersonnelData: false,
  hasQuadratsData: false,
  hasAttributesData: false,
  hasSpeciesData: false
};

const CATEGORY_MAP = {
  personnel: { idKey: 'personnelID', displayName: 'Personnel' },
  quadrats: { idKey: 'quadratID', displayName: 'Quadrats' },
  attributes: { idKey: 'code', displayName: 'Attributes' },
  species: { idKey: 'speciesID', displayName: 'Species' }
} as const;

type CategoryKey = keyof typeof CATEGORY_MAP;

const CATEGORY_KEYS = Object.keys(CATEGORY_MAP) as CategoryKey[];

const FLAG_KEY_MAP: Record<CategoryKey, keyof CensusValidationStatus> = {
  personnel: 'hasPersonnelData',
  quadrats: 'hasQuadratsData',
  attributes: 'hasAttributesData',
  species: 'hasSpeciesData'
};

const COLUMN_MAP: Record<CategoryKey, any[]> = {
  personnel: PersonnelGridColumns,
  quadrats: QuadratGridColumns,
  attributes: [AttributeGridColumns],
  species: [AllTaxonomiesViewGridColumns]
};

interface CategoryState<T> {
  rollover: boolean;
  confirmNo: boolean;
  customize: boolean;
  census: CensusValidationStatus;
  selected: T[]; // what the user picked
  previous: T[]; // full list loaded from API
}

type AllCategoriesState = {
  [K in CategoryKey]: CategoryState<
    K extends 'personnel' ? PersonnelRDS : K extends 'quadrats' ? QuadratRDS : K extends 'attributes' ? AttributesRDS : SpeciesRDS
  >;
};

const defaultCat: CategoryState<any> = {
  rollover: false,
  confirmNo: false,
  customize: false,
  census: defaultCVS,
  selected: [],
  previous: []
};

export default function RolloverModal(props: RolloverModalProps) {
  const { open, onClose, onConfirm } = props;
  const [cats, setCats] = useState<AllCategoriesState>(
    Object.fromEntries((Object.keys(CATEGORY_MAP) as CategoryKey[]).map(k => [k, { ...defaultCat }])) as AllCategoriesState
  );
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [censusValidationStatus, setCensusValidationStatus] = useState<CensusValidationStatus[]>([]);
  const [relatedData, setRelatedData] = useState<any[]>([]);

  const currentSite = useSiteContext();
  const currentPlot = usePlotContext();
  const censusListContext = useOrgCensusListContext();

  function updateCat<K extends CategoryKey>(key: K, patch: Partial<CategoryState<any>>) {
    setCats(c => ({ ...c, [key]: { ...c[key], ...patch } }));
  }

  async function fetchPreviousData<K extends CategoryKey>(key: K, plotCensusNumber: number) {
    try {
      setLoading(true);
      const response = await fetch(`/api/fetchall/${key}/${currentPlot?.plotID}/${plotCensusNumber}?schema=${currentSite?.schemaName}`);
      const data = (await response.json()) as CategoryState<any>['previous'];
      updateCat(key, {
        previous: data,
        selected: cats[key].customize ? cats[key].selected : data
      });
      if (key === 'personnel') {
        const rolesResponse = await fetch(`/api/fetchall/roles/undefined/${plotCensusNumber}/undefined?schema=${currentSite?.schemaName}`, { method: 'GET' });
        setRelatedData(await rolesResponse.json());
      }
      setLoading(false);
    } catch (error) {
      console.error('Failed to fetch previous data', error);
      setError('Failed to fetch previous data. Please try again.');
      setLoading(false);
    }
  }

  async function validationPrevCensus() {
    if (!censusListContext?.length) {
      setLoading(false);
      return;
    }

    setLoading(true);

    const status = await Promise.all(
      censusListContext.map(async census => {
        const { schemaName } = currentSite || {};
        const { plotID } = currentPlot || {};
        const { plotCensusNumber } = census || {};
        if (!schemaName || !plotID || !plotCensusNumber) return null;

        const responses = await Promise.all(CATEGORY_KEYS.map(key => fetch(`/api/cmprevalidation/${key}/${schemaName}/${plotID}/${plotCensusNumber}`)));

        const flags = CATEGORY_KEYS.reduce<Partial<CensusValidationStatus>>((acc, key, idx) => {
          const flagKey = FLAG_KEY_MAP[key];
          return {
            ...acc,
            [flagKey]: responses[idx].ok // `ok` is boolean
          };
        }, {});

        return {
          censusID: census?.dateRanges[0].censusID,
          plotCensusNumber: census?.plotCensusNumber,
          ...flags
        } as CensusValidationStatus;
      })
    );
    setCensusValidationStatus(status.filter((s): s is CensusValidationStatus => s !== null));
    setLoading(false);
  }

  useEffect(() => {
    if (open) {
      validationPrevCensus().catch(console.error);
    }
  }, [open]);

  useEffect(() => {
    if (!open) {
      resetState();
    }
  }, [open]);

  const resetState = () => {
    // rebuild every category from the same default template
    setCats(() => {
      const fresh = {} as AllCategoriesState;
      (Object.keys(CATEGORY_MAP) as CategoryKey[]).forEach(key => {
        fresh[key] = { ...defaultCat };
      });
      return fresh;
    });

    setError(null);
    setLoading(false);
  };

  async function handleConfirm() {
    const entries = Object.entries(cats) as [CategoryKey, CategoryState<any>][];
    if (entries.every(([, c]) => c.confirmNo) && entries.every(([, c]) => c.census.censusID === 0)) {
      onConfirm(false, false, false, false);
      resetState();
      return;
    }

    for (const [key, c] of entries) {
      if (c.census.censusID === 0 && !c.confirmNo) {
        alert(`Please confirm that you do not wish to roll over ${CATEGORY_MAP[key].displayName}.`);
        return;
      }
    }

    if (!entries.some(([, c]) => c.rollover)) {
      alert('You must roll over at least one category or confirm no-rollover.');
      return;
    }

    for (const [key, c] of entries) {
      if (c.rollover && c.customize && c.selected.length === 0) {
        alert(`You must select at least one ${CATEGORY_MAP[key].displayName}.`);
        return;
      }
    }

    try {
      setLoading(true);

      const maxPlot = Math.max(0, ...(censusListContext?.map(c => c?.plotCensusNumber ?? 0) ?? []));
      const mapper = new OrgCensusToCensusResultMapper();
      const newCensusID = await mapper.startNewCensus(currentSite?.schemaName ?? '', currentPlot?.plotID ?? 0, maxPlot + 1);
      if (!newCensusID) throw new Error('Failed to create new census');

      await Promise.all(
        entries.map(async ([key, c]) => {
          if (!c.rollover) return;

          const list = c.customize ? c.selected : c.previous;
          const ids = list.map(item => (item as any)[CATEGORY_MAP[key].idKey]).filter(Boolean);

          await fetch(`/api/rollover/${key}/${currentSite!.schemaName}/${currentPlot!.plotID}/${c.census.censusID}/${newCensusID}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ incoming: ids })
          });
        })
      );

      onConfirm(cats.personnel.rollover, cats.quadrats.rollover, cats.attributes.rollover, cats.species.rollover, newCensusID);
      resetState();
    } catch (err) {
      console.error(err);
      setError(`Rollover failed: ${err}`);
      onConfirm(false, false, false, false);
    } finally {
      setLoading(false);
    }
  }

  const handleRowSelection = <K extends CategoryKey>(key: K, selectionModel: GridRowSelectionModel) => {
    const selectedIds = Array.from(selectionModel.ids);
    const prevList = cats[key].previous;
    const selectedItems = prevList.filter(item => selectedIds.includes(item.id!));
    updateCat(key, { selected: selectedItems });
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
    <Modal open={open} onClose={onClose} data-testid="rollover-modal">
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

        <DialogContent sx={{ width: '100%', height: '100%', overflow: 'auto' }}>
          {error && <Alert color="danger">{error}</Alert>}

          <Grid container spacing={2} sx={{ flex: 1, flexDirection: 'row', width: '100%', height: '100%' }}>
            {CATEGORY_KEYS.map(key => {
              const { displayName, idKey } = CATEGORY_MAP[key];
              const cat = cats[key];
              const flagKey = FLAG_KEY_MAP[key];

              return (
                <Grid xs="auto" sx={{ width: '50%', height: '50%' }} key={key}>
                  <Typography mb={2} level="title-md" fontWeight="xl">
                    Roll over <b>{displayName}</b> data:
                  </Typography>

                  <Select
                    sx={{ mb: 2 }}
                    value={cat.census.censusID}
                    onChange={async (_, newValue) => {
                      const status = censusValidationStatus.find(c => c.censusID === newValue) || defaultCVS;
                      updateCat(key, {
                        census: status,
                        confirmNo: status.censusID === 0 ? false : cat.confirmNo,
                        rollover: status.censusID > 0
                      });
                      if (status.censusID !== 0) await fetchPreviousData(key, status.plotCensusNumber);
                    }}
                  >
                    <Option value={0}>
                      Do not roll over any <b>{displayName}</b> data
                    </Option>
                    {censusValidationStatus.map(census => (
                      <Option key={census.censusID} value={census.censusID} disabled={!census[flagKey]}>
                        {`Census ${census.plotCensusNumber} – ${displayName}: ${census[flagKey] ? 'Yes' : 'No'}`}
                      </Option>
                    ))}
                  </Select>

                  {cat.census.censusID === 0 ? (
                    <Box sx={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
                      <Alert color="warning" sx={{ my: 2 }}>
                        You have chosen NOT to roll over any {displayName} data. <br />
                        Please confirm to proceed.
                      </Alert>
                      <Button variant={cat.confirmNo ? 'solid' : 'outlined'} color="warning" onClick={() => updateCat(key, { confirmNo: !cat.confirmNo })}>
                        {cat.confirmNo ? 'Confirmed' : 'Confirm No Rollover'}
                      </Button>
                    </Box>
                  ) : (
                    <Box sx={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
                      <Stack direction="row" spacing={2} alignItems="center">
                        <Checkbox checked={cat.rollover} disabled={!cat.census[flagKey]} onChange={() => updateCat(key, { rollover: !cat.rollover })} />
                        <Typography>Roll over {displayName.toLowerCase()} data</Typography>
                      </Stack>

                      {cat.rollover && (
                        <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                          <Button onClick={() => updateCat(key, { customize: !cat.customize })}>
                            {cat.customize ? `Roll over all ${displayName.toLowerCase()}` : `Customize ${displayName.toLowerCase()} selection`}
                          </Button>

                          {cat.customize && (
                            <DataGrid
                              rows={cat.previous}
                              columns={COLUMN_MAP[key]}
                              pageSizeOptions={[5, 10, 25, 100]}
                              checkboxSelection
                              onRowSelectionModelChange={model => handleRowSelection(key, model)}
                              initialState={{
                                pagination: { paginationModel: { pageSize: 5, page: 0 } }
                              }}
                            />
                          )}
                        </Box>
                      )}
                    </Box>
                  )}
                </Grid>
              );
            })}
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
