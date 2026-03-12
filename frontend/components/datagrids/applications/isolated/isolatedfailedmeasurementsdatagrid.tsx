'use client';

import React, { RefObject, useCallback, useEffect, useMemo, useState } from 'react';
import { FailedMeasurementsGridColumns, preprocessor } from '@/components/client/datagridcolumns';
import IsolatedDataGridCommons from '@/components/datagrids/isolateddatagridcommons';
import { useOrgCensusContext, usePlotContext, useSiteContext } from '@/app/contexts/compat-hooks';
import { GridColDef, GridRenderEditCellParams, GridRowModel, useGridApiRef } from '@mui/x-data-grid';
import { FailedMeasurementsRDS } from '@/config/sqlrdsdefinitions/core';
import { EditMeasurements } from '@/components/datagrids/measurementscommons';
import { Box, Chip, Stack, Typography } from '@mui/joy';
import { failureErrorMapping } from '@/config/datagridhelpers';
import CircularProgress from '@mui/joy/CircularProgress';
import { DatePicker } from '@mui/x-date-pickers';
import moment from 'moment/moment';
import { GridApiCommunity } from '@mui/x-data-grid/internals';
import { loadSelectableOptions, selectableAutocomplete } from '@/components/client/clientmacros';
import ailogger from '@/ailogger';
import ValidationCheckModal from '@/components/client/modals/validationcheckmodal';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';

interface IsolatedFailedMeasurementsDataGridProps {
  onRowReingested?: () => void;
}

function normalizeFailureText(value?: string | null): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function hasStoredCurrentIngestionFailures(
  row: Pick<FailedMeasurementsRDS, 'currentFailureReasons' | 'failureReasons'>
): boolean {
  const storedReasons = normalizeFailureText(row.currentFailureReasons) || normalizeFailureText(row.failureReasons);
  return storedReasons !== '' && storedReasons !== 'Ready for reingestion';
}

export function isReadyForReingestion(
  row: FailedMeasurementsRDS,
  computeFailureReasons: (row: FailedMeasurementsRDS) => string
): boolean {
  if (hasStoredCurrentIngestionFailures(row)) {
    return false;
  }

  return computeFailureReasons(row).length === 0;
}

export function formatDetailedFailureDescription(description?: string | null): string {
  const rawDescription = normalizeFailureText(description);
  if (!rawDescription) {
    return '';
  }

  if (rawDescription.startsWith('Measurement insert skipped: source row resolved to multiple candidate measurements')) {
    return 'Row matches two or more stems/trees.';
  }

  if (rawDescription.includes('already exists in a different quadrat')) {
    return 'Tree/stem already exists in a different quadrat for this census.';
  }

  if (rawDescription.startsWith('Stem resolution failed: no active stem matched')) {
    return 'Row could not be matched to a single stem in this census.';
  }

  if (rawDescription.startsWith('Invalid species code:')) {
    const speciesMatch = rawDescription.match(/Invalid species code: "([^"]+)"/);
    return speciesMatch ? `Species code "${speciesMatch[1]}" was not found.` : 'Species code was not found.';
  }

  if (rawDescription.startsWith('Measurement insert skipped: ')) {
    return rawDescription.replace(/^Measurement insert skipped:\s*/, '');
  }

  if (rawDescription.startsWith('Stem resolution failed: ')) {
    return rawDescription.replace(/^Stem resolution failed:\s*/, '');
  }

  return rawDescription;
}

export default function IsolatedFailedMeasurementsDataGrid({ onRowReingested }: IsolatedFailedMeasurementsDataGridProps = {}) {
  const [refresh, setRefresh] = useState(false);
  const [selectableOpts, setSelectableOpts] = useState<{ [optName: string]: string[] }>({
    tag: [],
    stemTag: [],
    quadrat: [],
    spCode: [],
    codes: []
  });
  const [validationModalOpen, setValidationModalOpen] = useState(false);
  const [validationResults, setValidationResults] = useState<any>(null);
  const [isValidating, setIsValidating] = useState(false);
  const currentPlot = usePlotContext();
  const currentCensus = useOrgCensusContext();
  const currentSite = useSiteContext();
  const apiRef = useGridApiRef();

  useEffect(() => {
    loadSelectableOptions(currentSite, currentPlot, currentCensus, setSelectableOpts).catch(ailogger.error);
  }, [currentSite, currentPlot, currentCensus]);

  const initialFailedMeasurementsRow: FailedMeasurementsRDS = {
    id: 0,
    failedMeasurementID: 0,
    plotID: currentPlot?.plotID,
    censusID: currentCensus?.dateRanges?.[0]?.censusID,
    tag: '',
    stemTag: '',
    spCode: '',
    quadrat: '',
    x: 0,
    y: 0,
    dbh: 0,
    hom: 0,
    date: null,
    codes: '',
    description: '',
    failureReasons: '',
    originalFailureReasons: '',
    currentFailureReasons: '',
    lastValidatedAt: null
  };

  const fieldToReasons = useMemo(() => {
    const m: Record<string, string[]> = {};
    Object.entries(failureErrorMapping).forEach(([reason, cols]) => {
      cols.forEach(col => {
        if (!m[col]) m[col] = [];
        m[col].push(reason);
      });
    });
    return m;
  }, []);

  const countInvalidCodes = useCallback(
    (codes?: string): number => {
      if (!codes?.trim()) return 0;
      return codes
        .trim()
        .split(/\s*;\s*/)
        .filter(Boolean)
        .reduce((cnt, code) => (selectableOpts.codes.includes(code) ? cnt : cnt + 1), 0);
    },
    [selectableOpts.codes]
  );

  const computeFailureReasons = useCallback(
    (row: FailedMeasurementsRDS): string => {
      const reasons: string[] = [];

      if (!row.spCode?.trim()) {
        reasons.push('SpCode missing');
      } else if (!selectableOpts.spCode.includes(row.spCode.trim())) {
        reasons.push('SpCode invalid');
      }

      if (!row.quadrat?.trim()) {
        reasons.push('Quadrat missing');
      } else if (!selectableOpts.quadrat.includes(row.quadrat.trim())) {
        reasons.push('Quadrat invalid');
      }

      // Note: x === 0 and y === 0 are valid coordinates (origin point)
      // Only flag as missing if null or -1 (sentinel value for missing data)
      if (row.x == null || row.x === -1) reasons.push('Missing X');
      if (row.y == null || row.y === -1) reasons.push('Missing Y');

      const hasCodes = !!row.codes?.trim();
      // If both DBH > 0 AND HOM > 0, the row has valid measurement data
      // and doesn't need codes - skip missing codes/DBH/HOM validation
      const hasValidMeasurements = row.dbh != null && row.dbh > 0 && row.hom != null && row.hom > 0;

      if (!hasValidMeasurements) {
        // Only flag for missing/invalid codes if we don't have valid measurements
        // Rows with DBH > 0 AND HOM > 0 are valid without codes
        if (!hasCodes && (row.dbh == null || row.dbh === -1)) {
          reasons.push('Missing Codes and DBH');
        }
        if (!hasCodes && (row.hom == null || row.hom === -1)) {
          reasons.push('Missing Codes and HOM');
        }
        // Only check for invalid codes if row doesn't have valid measurements
        if (countInvalidCodes(row.codes) > 0) {
          reasons.push('Invalid Codes');
        }
      }

      const sentinel = new Date('1900-01-01');
      const actualDate = row.date instanceof Date ? row.date : new Date(row.date as any);

      if (!actualDate || actualDate.getTime() === sentinel.getTime()) {
        reasons.push('Missing Date');
      }

      return reasons.join('|');
    },
    [selectableOpts, countInvalidCodes]
  );

  const onRowSave = useCallback(
    async (newRow: GridRowModel, oldRow: GridRowModel): Promise<void> => {
      const reasons = computeFailureReasons(newRow);
      const updatedRow: GridRowModel = { ...newRow, failureReasons: reasons, currentFailureReasons: reasons };
      const failedMeasurementID = newRow.failedMeasurementID ?? oldRow.failedMeasurementID;

      try {
        const updateResponse = await fetch(`/api/fixeddata/failedmeasurements/${currentSite?.schemaName ?? ''}/${failedMeasurementID}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ newRow: updatedRow, oldRow: oldRow })
        });

        if (!updateResponse.ok) {
          const errorData = await updateResponse.json().catch(() => ({ message: `HTTP ${updateResponse.status}` }));
          throw new Error(errorData.message || `Failed to save row edits: ${updateResponse.status}`);
        }

        if (reasons.length === 0) {
          const reingestResponse = await fetch(`/api/reingestsinglefailure/${currentSite?.schemaName ?? ''}/${failedMeasurementID}`);
          if (!reingestResponse.ok) {
            const errorData = await reingestResponse.json().catch(() => ({ message: `HTTP ${reingestResponse.status}` }));
            throw new Error(errorData.message || `Failed to reingest row: ${reingestResponse.status}`);
          }

          await loadSelectableOptions(currentSite, currentPlot, currentCensus, setSelectableOpts);

          // Notify parent that a row was successfully reingested
          if (onRowReingested) {
            onRowReingested();
          }
        }

        // Trigger refresh immediately - no arbitrary delay needed
        // The database operations are already complete at this point
        setRefresh(true);
      } catch (error: any) {
        ailogger.error('Failed to save row:', error);
        throw error;
      }
    },
    [currentSite, currentPlot, currentCensus, computeFailureReasons, setSelectableOpts, onRowReingested]
  );

  const displayFailureReason = useCallback(
    (params: any, column: GridColDef) => {
      const storedReasons = params.row.currentFailureReasons ?? params.row.failureReasons ?? '';

      // Check if stored reasons contain actual failure messages (not just status like "Ready for reingestion")
      const actualFailureKeys = Object.keys(failureErrorMapping);
      const hasActualFailures = actualFailureKeys.some(key => storedReasons.includes(key));

      // Use stored reasons only if they contain actual failure messages, otherwise compute them client-side
      const failureReasonsString = hasActualFailures ? storedReasons : computeFailureReasons(params.row);

      const failureReasonsFromRow = failureReasonsString
        .split('|')
        .map((reason: string) => reason.trim())
        .filter((reason: string) => reason !== '');
      const visibleReasons = failureReasonsFromRow
        .filter((reason: string) => fieldToReasons[column.field]?.includes(reason))
        .filter((reason: string, index: number, array: string[]) => array.indexOf(reason) === index);

      const displayReason = visibleReasons.length > 0 ? visibleReasons[0] : null;

      if (displayReason) {
        return (
          <Stack direction={'column'} sx={{ display: 'flex', flex: 1, width: '100%' }}>
            <Chip
              variant={'soft'}
              color={'danger'}
              sx={{
                marginY: 0.5,
                display: 'flex',
                flex: 1,
                width: '100%',
                justifyContent: 'center',
                alignSelf: 'center',
                fontSize: '0.75rem',
                whiteSpace: 'normal',
                minHeight: '24px',
                height: 'auto'
              }}
            >
              {displayReason}
            </Chip>
          </Stack>
        );
      } else return null;
    },
    [fieldToReasons, computeFailureReasons]
  );

  const handleCheckIfReady = useCallback(async () => {
    if (!currentSite?.schemaName || !currentPlot?.plotID || !currentCensus?.dateRanges?.[0]?.censusID) return;
    setIsValidating(true);
    try {
      const response = await fetch(`/api/validatefailed/${currentSite.schemaName}/${currentPlot.plotID}/${currentCensus.dateRanges[0].censusID}`);
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
        throw new Error(errorData.error || `Validation check failed: ${response.status}`);
      }
      const results = await response.json();
      setValidationResults(results);
      setValidationModalOpen(true);
      setRefresh(true);
    } catch (error: any) {
      ailogger.error('Validation check failed:', error);
    } finally {
      setIsValidating(false);
    }
  }, [currentSite?.schemaName, currentPlot?.plotID, currentCensus?.dateRanges]);

  const columns: GridColDef[] = useMemo(() => {
    return [
      ...FailedMeasurementsGridColumns.map(column => {
        const isReasonColumn = ['currentFailureReasons', 'description', 'originalFailureReasons', 'failureReasons', 'lastValidatedAt'].includes(column.field);
        return {
          ...column,
          editable: !isReasonColumn,
          renderCell: (params: any) => {
            if (isReasonColumn) {
              const displayValue = column.field === 'description' ? formatDetailedFailureDescription(params.value) : params.value;
              return (
                <Typography sx={{ whiteSpace: 'normal', lineHeight: 'normal' }}>
                  {displayValue === '' || displayValue === null || displayValue === undefined ? 'null' : String(displayValue)}
                </Typography>
              );
            }
            return (
              <Stack direction={'column'} sx={{ display: 'flex', flex: 1, width: '100%' }}>
                <Box sx={{ display: 'flex', flex: 1, flexDirection: 'row', width: '100%', marginY: 0.5 }}>
                  {column.field === 'codes' ? (
                    ((params.value ?? '').split(';') ?? [])
                      .filter((code: string) => selectableOpts.codes.includes(code))
                      .map((i: string, index: number) => (
                        <Chip key={index} variant={'soft'}>
                          {i}
                        </Chip>
                      ))
                  ) : (
                    <Typography
                      sx={{
                        whiteSpace: 'normal',
                        lineHeight: 'normal'
                      }}
                    >
                      {column.field === 'date'
                        ? moment(params.value).format('YYYY-MM-DD')
                        : ['dbh', 'hom', 'x', 'y'].includes(column.field)
                          ? Number(params.value).toFixed(2)
                          : params.value === '' || params.value === null
                            ? 'null'
                            : params.value}
                    </Typography>
                  )}
                </Box>
                {displayFailureReason(params, column)}
              </Stack>
            );
          },
          renderEditCell: (params: GridRenderEditCellParams) => {
            if (isReasonColumn) return null;
            if (column.field === 'date') {
              return (
                <Box sx={{ width: '100%', height: '100%' }}>
                  <DatePicker
                    sx={{ flex: 1 }}
                    label={column.headerName}
                    value={moment(params.value, 'YYYY-MM-DD')}
                    onChange={newValue => {
                      params.api.setEditCellValue({ id: params.id, field: params.field, value: newValue ? newValue.format('YYYY-MM-DD') : null });
                    }}
                    slotProps={{
                      textField: {
                        fullWidth: true,
                        variant: 'outlined',
                        sx: {
                          marginTop: 0.5,
                          height: '100%',
                          '& .MuiInputBase-root': {
                            height: '100%'
                          },
                          '& .MuiOutlinedInput-notchedOutline': {
                            top: 0
                          }
                        }
                      }
                    }}
                  />
                </Box>
              );
            } else if (Object.keys(selectableOpts).includes(column.field)) {
              return (
                <Box sx={{ display: 'flex', flex: 1, flexDirection: 'column', width: '100%', height: '100%' }}>
                  {selectableAutocomplete(params, column, selectableOpts)}
                  {displayFailureReason(params, column)}
                </Box>
              );
            } else if (['dbh', 'hom', 'x', 'y'].includes(column.field)) {
              return (
                <Box sx={{ width: '100%', height: '100%' }}>
                  <EditMeasurements params={params} />
                  {displayFailureReason(params, column)}
                </Box>
              );
            }
          },
          valueFormatter: (value: any) => (['dbh', 'hom', 'x', 'y'].includes(column.field) ? Number(value).toFixed(2) : value),
          preProcessEditCellProps: (params: any) => (['dbh', 'hom', 'x', 'y'].includes(column.field) ? preprocessor(params) : {})
        };
      })
    ];
  }, [selectableOpts, displayFailureReason]);

  return Object.keys(selectableOpts)
    .filter(i => !['tag', 'stemTag'].includes(i))
    .every(key => selectableOpts[key].length > 0) ? (
    <>
      <IsolatedDataGridCommons
        gridType="failedmeasurements"
        gridColumns={columns}
        refresh={refresh}
        setRefresh={setRefresh}
        initialRow={initialFailedMeasurementsRow}
        fieldToFocus={'tag'}
        dynamicButtons={[
          {
            label: isValidating ? 'Checking...' : 'Check if Ready',
            onClick: handleCheckIfReady,
            tooltip: 'Recompute current validation reasons for failed measurements',
            icon: <CheckCircleOutlineIcon />
          }
        ]}
        defaultHideEmpty={false}
        apiRef={apiRef as RefObject<GridApiCommunity>}
        onDataUpdate={onRowSave}
      />
      <ValidationCheckModal open={validationModalOpen} onClose={() => setValidationModalOpen(false)} results={validationResults} />
    </>
  ) : (
    <CircularProgress />
  );
}
