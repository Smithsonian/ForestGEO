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

interface IsolatedFailedMeasurementsDataGridProps {
  onRowReingested?: () => void;
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
    censusID: currentCensus?.dateRanges[0].censusID,
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
    failureReasons: ''
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
      // Note: DBH/HOM of 0 may be valid in some contexts
      // Only flag as missing if null or -1 (sentinel value)
      if (!hasCodes && (row.dbh == null || row.dbh === -1)) {
        reasons.push('Missing Codes and DBH');
      }
      if (!hasCodes && (row.hom == null || row.hom === -1)) {
        reasons.push('Missing Codes and HOM');
      }

      const sentinel = new Date('1900-01-01');
      const actualDate = row.date instanceof Date ? row.date : new Date(row.date as any);

      if (!actualDate || actualDate.getTime() === sentinel.getTime()) {
        reasons.push('Missing Date');
      }

      if (countInvalidCodes(row.codes) > 0) {
        reasons.push('Invalid Codes');
      }

      return reasons.join('|');
    },
    [selectableOpts, countInvalidCodes]
  );

  const onRowSave = useCallback(
    async (newRow: GridRowModel, oldRow: GridRowModel): Promise<void> => {
      const reasons = computeFailureReasons(newRow);
      const updatedRow: GridRowModel = { ...newRow, failureReasons: reasons };
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
        } else {
          const reviewResponse = await fetch(`/api/query`, {
            method: 'POST',
            body: JSON.stringify(`CALL ${currentSite?.schemaName}.reviewfailed();`)
          });
          if (!reviewResponse.ok) {
            const errorData = await reviewResponse.json().catch(() => ({ message: `HTTP ${reviewResponse.status}` }));
            throw new Error(errorData.message || `Failed to update validation reasons: ${reviewResponse.status}`);
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
      const failureReasonsFromRow = (params.row.failureReasons ?? '')
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
    [fieldToReasons]
  );

  const columns: GridColDef[] = useMemo(() => {
    return [
      ...FailedMeasurementsGridColumns.map(column => {
        return {
          ...column,
          editable: true,
          renderCell: (params: any) => {
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
    <IsolatedDataGridCommons
      gridType="failedmeasurements"
      gridColumns={columns}
      refresh={refresh}
      setRefresh={setRefresh}
      initialRow={initialFailedMeasurementsRow}
      fieldToFocus={'tag'}
      dynamicButtons={[]}
      defaultHideEmpty={false}
      apiRef={apiRef as RefObject<GridApiCommunity>}
      onDataUpdate={onRowSave}
    />
  ) : (
    <CircularProgress />
  );
}
