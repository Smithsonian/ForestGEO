'use client';

// isolated failedmeasurements datagrid
import React, { useEffect, useMemo, useState } from 'react';
import { FailedMeasurementsGridColumns, preprocessor } from '@/components/client/datagridcolumns';
import IsolatedDataGridCommons from '@/components/datagrids/isolateddatagridcommons';
import { useOrgCensusContext, usePlotContext, useSiteContext } from '@/app/contexts/userselectionprovider';
import { GridColDef, GridRenderEditCellParams } from '@mui/x-data-grid';
import MapperFactory from '@/config/datamapper';
import { AttributesRDS, AttributesResult } from '@/config/sqlrdsdefinitions/core';
import { EditMeasurements } from '@/components/datagrids/measurementscommons';
import { Autocomplete, Box, Chip, Stack, Typography } from '@mui/joy';
import { failureErrorMapping } from '@/config/datagridhelpers';
import { SpeciesRDS, SpeciesResult, StemRDS, StemResult, TreeRDS, TreeResult } from '@/config/sqlrdsdefinitions/taxonomies';
import { QuadratRDS, QuadratResult } from '@/config/sqlrdsdefinitions/zones';
import CircularProgress from '@mui/joy/CircularProgress';

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

  useEffect(() => {
    async function loadOptions() {
      const codeOpts = MapperFactory.getMapper<AttributesRDS, AttributesResult>('attributes')
        .mapData(await (await fetch(`/api/fetchall/attributes?schema=${currentSite?.schemaName ?? ''}`)).json())
        .map(i => i.code)
        .filter((code): code is string => code !== undefined);
      const tagOpts = MapperFactory.getMapper<TreeRDS, TreeResult>('trees')
        .mapData(await (await fetch(`/api/fetchall/trees?schema=${currentSite?.schemaName ?? ''}`)).json())
        .map(i => i.treeTag)
        .filter((code): code is string => code !== undefined);
      const stemOpts = MapperFactory.getMapper<StemRDS, StemResult>('stems')
        .mapData(await (await fetch(`/api/fetchall/stems?schema=${currentSite?.schemaName ?? ''}`)).json())
        .map(i => i.stemTag)
        .filter((code): code is string => code !== undefined);
      const quadOpts = MapperFactory.getMapper<QuadratRDS, QuadratResult>('quadrats')
        .mapData(
          await (
            await fetch(`/api/fetchall/quadrats/${currentPlot?.plotID ?? 0}/${currentCensus?.plotCensusNumber ?? 0}?schema=${currentSite?.schemaName ?? ''}`)
          ).json()
        )
        .map(i => i.quadratName)
        .filter((code): code is string => code !== undefined);
      const specOpts = MapperFactory.getMapper<SpeciesRDS, SpeciesResult>('species')
        .mapData(await (await fetch(`/api/fetchall/species?schema=${currentSite?.schemaName ?? ''}`)).json())
        .map(i => i.speciesCode)
        .filter((code): code is string => code !== undefined);
      setSelectableOpts(prev => {
        return {
          ...prev,
          tag: tagOpts,
          stemTag: stemOpts,
          quadrat: quadOpts,
          spCode: specOpts,
          codes: codeOpts
        };
      });
    }

    loadOptions().catch(console.error);
  }, [currentSite, currentPlot, currentCensus]);

  const initialFailedMeasurementsRow = {
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
    failureReasons: ''
  };

  const columns: GridColDef[] = useMemo(() => {
    return [
      ...FailedMeasurementsGridColumns.map(column => {
        return {
          ...column,
          renderCell: (params: any) => {
            const failureReasonsFromRow = (params.row.failureReasons ?? '')
              .split('|')
              .map((reason: string) => reason.trim())
              .filter((reason: string) => reason !== '');
            const failureReason = failureReasonsFromRow.filter((reason: string) => {
              const mappedColumns = failureErrorMapping[reason];
              return mappedColumns && mappedColumns.includes(column.field);
            });
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
                      {params.value instanceof Date
                        ? new Date(params.value).toDateString()
                        : params.value === '' || params.value === null
                          ? 'null'
                          : params.value}
                    </Typography>
                  )}
                </Box>
                {failureReason && failureReason.length > 0 && (
                  <Chip variant={'soft'} color={'danger'} sx={{ marginY: 0.5 }}>
                    {failureReason.join(', ')}
                  </Chip>
                )}
              </Stack>
            );
          },
          renderEditCell: (params: GridRenderEditCellParams) => {
            if (Object.keys(selectableOpts).includes(column.field)) {
              if (params.value && !selectableOpts[column.field].includes(params.value)) {
                setTimeout(() => {
                  setSelectableOpts(prevState => {
                    const updatedArray = [...prevState[column.field], params.value];
                    return {
                      ...prevState,
                      [column.field]: Array.from(new Set(updatedArray)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }))
                    };
                  });
                }, 0);
              }
              return (
                <Autocomplete
                  variant={'soft'}
                  autoSelect
                  isOptionEqualToValue={(option, value) => option === value}
                  options={selectableOpts[column.field]}
                  value={params.value || ''}
                  onChange={(_event, value) => {
                    if (value) {
                      params.api.setEditCellValue({
                        id: params.id,
                        field: params.field,
                        value
                      });
                    }
                  }}
                />
              );
            }
            if (['dbh', 'hom', 'x', 'y'].includes(column.field)) {
              return <EditMeasurements params={params} />;
            }
          },
          valueFormatter: (value: any) => (['dbh', 'hom', 'x', 'y'].includes(column.field) ? Number(value).toFixed(2) : value),
          preProcessEditCellProps: (params: any) => (['dbh', 'hom', 'x', 'y'].includes(column.field) ? preprocessor(params) : {})
        };
      })
    ];
  }, [selectableOpts]);

  return Object.keys(selectableOpts).every(key => selectableOpts[key].length > 0) ? (
    <IsolatedDataGridCommons
      gridType="failedmeasurements"
      gridColumns={columns}
      refresh={refresh}
      setRefresh={setRefresh}
      initialRow={initialFailedMeasurementsRow}
      fieldToFocus={'tag'}
      dynamicButtons={[]}
      defaultHideEmpty={false} // override default true to false -- user should see any missing fields that need correcting
    />
  ) : (
    <CircularProgress />
  );
}
