'use client';

// isolated failedmeasurements datagrid
import React, { useEffect, useMemo, useState } from 'react';
import { FailedMeasurementsGridColumns, InputChip, preprocessor } from '@/components/client/datagridcolumns';
import IsolatedDataGridCommons from '@/components/datagrids/isolateddatagridcommons';
import { useOrgCensusContext, usePlotContext, useSiteContext } from '@/app/contexts/userselectionprovider';
import { GridColDef, GridRenderEditCellParams } from '@mui/x-data-grid';
import MapperFactory from '@/config/datamapper';
import { AttributesRDS, AttributesResult } from '@/config/sqlrdsdefinitions/core';
import { EditMeasurements } from '@/components/datagrids/measurementscommons';
import { Box, Chip, Stack, Typography } from '@mui/joy';
import { failureErrorMapping } from '@/config/datagridhelpers';

export default function IsolatedFailedMeasurementsDataGrid() {
  const [refresh, setRefresh] = useState(false);
  const [selectableCodes, setSelectableCodes] = useState<string[]>([]);
  const [reloadCodes, setReloadCodes] = useState(true);
  const currentPlot = usePlotContext();
  const currentCensus = useOrgCensusContext();
  const currentSite = useSiteContext();

  useEffect(() => {
    async function reloadCodes() {
      const response = await fetch(`/api/fetchall/attributes?schema=${currentSite?.schemaName ?? ''}`);
      const data = MapperFactory.getMapper<AttributesRDS, AttributesResult>('attributes').mapData(await response.json());
      setSelectableCodes(data.map(i => i.code).filter((code): code is string => code !== undefined));
      setReloadCodes(false);
    }

    reloadCodes().catch(console.error);
  }, [reloadCodes]);

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
            const failureReasonsFromRow = params.row.failureReasons
              .split('|')
              .map((reason: string) => reason.trim())
              .filter((reason: string) => reason !== '');
            const failureReason = failureReasonsFromRow.filter((reason: string) => {
              const mappedColumns = failureErrorMapping[reason];
              return mappedColumns && mappedColumns.includes(column.field);
            });
            console.log(failureReason);
            return (
              <Stack direction={'column'} sx={{ display: 'flex', flex: 1, width: '100%' }}>
                <Box sx={{ display: 'flex', flex: 1, flexDirection: 'row', width: '100%', marginY: 0.5 }}>
                  {column.field === 'codes' ? (
                    ((params.value ?? '').split(';') ?? [])
                      .filter((code: string) => selectableCodes.includes(code))
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
            if (column.field === 'codes') {
              return <InputChip params={params} selectableAttributes={selectableCodes} setReloadAttributes={setReloadCodes} />;
            } else if (['dbh', 'hom', 'x', 'y'].includes(column.field)) {
              return <EditMeasurements params={params} />;
            }
          },
          valueFormatter: (value: any) => (['dbh', 'hom', 'x', 'y'].includes(column.field) ? Number(value).toFixed(2) : value),
          preProcessEditCellProps: (params: any) => (['dbh', 'hom', 'x', 'y'].includes(column.field) ? preprocessor(params) : {})
        };
      })
    ];
  }, [selectableCodes]);

  return (
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
  );
}
