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
    codes: ''
  };

  const columns: GridColDef[] = useMemo(() => {
    return [
      ...FailedMeasurementsGridColumns.map(column => {
        if (column.field === 'codes') {
          return {
            ...column,
            renderCell: (params: any) => {
              const codes: string[] = (params.value ?? '').split(';') ?? [];
              const filteredCodes = codes.filter(code => selectableCodes.includes(code));
              return filteredCodes.join(';');
            },
            renderEditCell: (params: GridRenderEditCellParams) => (
              <InputChip params={params} selectableAttributes={selectableCodes} setReloadAttributes={setReloadCodes} />
            )
          };
        } else if (['dbh', 'hom', 'x', 'y'].includes(column.field)) {
          column = {
            ...column,
            valueFormatter: (value: any) => {
              return Number(value).toFixed(2);
            },
            preProcessEditCellProps: params => preprocessor(params),
            renderEditCell: (params: GridRenderEditCellParams) => <EditMeasurements params={params} />
          };
        }
        return column;
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
