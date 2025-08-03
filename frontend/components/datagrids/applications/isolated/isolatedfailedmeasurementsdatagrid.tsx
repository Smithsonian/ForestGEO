'use client';

// isolated failedmeasurements datagrid
import React, { RefObject, useCallback, useEffect, useMemo, useState } from 'react';
import { FailedMeasurementsGridColumns, preprocessor } from '@/components/client/datagridcolumns';
import IsolatedDataGridCommons from '@/components/datagrids/isolateddatagridcommons';
import { useOrgCensusContext, usePlotContext, useSiteContext } from '@/app/contexts/userselectionprovider';
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

export default function IsolatedFailedMeasurementsDataGrid() {
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

  function countInvalidCodes(codes?: string): number {
    if (!codes?.trim()) return 0;
    return codes
      .trim()
      .split(/\s*;\s*/)
      .filter(Boolean)
      .reduce((cnt, code) => (selectableOpts.codes.includes(code) ? cnt : cnt + 1), 0);
  }

  function computeFailureReasons(row: FailedMeasurementsRDS): string {
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

    if (row.x == null || row.x === 0 || row.x === -1) reasons.push('Missing X');
    if (row.y == null || row.y === 0 || row.y === -1) reasons.push('Missing Y');

    const hasCodes = !!row.codes?.trim();
    if (!hasCodes && (row.dbh == null || row.dbh === 0 || row.dbh === -1)) {
      reasons.push('Missing Codes and DBH');
    }
    if (!hasCodes && (row.hom == null || row.hom === 0 || row.hom === -1)) {
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
  }

  const onRowSave = useCallback(
    async (updatedRow: GridRowModel) => {
      // amended implementation to get full row out from function
      const reasons = computeFailureReasons(updatedRow);
      updatedRow = { ...updatedRow, failureReasons: reasons };
      if (reasons.length === 0) {
        // no reasons detected, so we can save the row
        await fetch(`/api/reingestsinglefailure/${currentSite?.schemaName ?? ''}/${updatedRow.failedMeasurementID}`);
      } else {
        // need to updated in-DB row with new reasons now that they've been found!
        await fetch(`/api/runquery`, { method: 'POST', body: JSON.stringify(`CALL ${currentSite?.schemaName}.reviewfailed();`) });
      }
      setRefresh(true);
    },
    [apiRef, currentSite, currentPlot, currentCensus, computeFailureReasons]
  );

  function displayFailureReason(params: any, column: GridColDef) {
    const failureReasonsFromRow = (params.row.failureReasons ?? '')
      .split('|')
      .map((reason: string) => reason.trim())
      .filter((reason: string) => reason !== '');
    const visibleReasons = failureReasonsFromRow.filter((reason: string) => fieldToReasons[column.field]?.includes(reason));
    if (visibleReasons && visibleReasons.length > 0) {
      return (
        <Stack direction={'column'} sx={{ display: 'flex', flex: 1, width: '100%' }}>
          {visibleReasons.map((reason: string, index: number) => (
            <Chip
              key={index}
              variant={'soft'}
              color={'danger'}
              sx={{ marginY: 0.5, display: 'flex', flex: 1, width: '100%', justifyContent: 'center', alignSelf: 'center' }}
            >
              {reason}
            </Chip>
          ))}
        </Stack>
      );
    } else return null;
  }

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
  }, [selectableOpts, refresh]);

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
      defaultHideEmpty={false} // override default true to false -- user should see any missing fields that need correcting
      apiRef={apiRef as RefObject<GridApiCommunity>}
      onDataUpdate={onRowSave}
    />
  ) : (
    <CircularProgress />
  );
}
