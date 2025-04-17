'use client';

// multiline measurements datagrid
import React, { useEffect, useMemo, useState } from 'react';
import IsolatedMultilineDataGridCommons from '@/components/datagrids/isolatedmultilinedatagridcommons';
import { MeasurementsFormGridColumns } from '@/components/client/formcolumns';
import { DataGridSignals, FormType } from '@/config/macros/formdetails';
import { Autocomplete, Box } from '@mui/joy';
import RenderFormExplanations from '@/components/client/renderformexplanations';
import MapperFactory from '@/config/datamapper';
import { AttributesRDS, AttributesResult } from '@/config/sqlrdsdefinitions/core';
import { SpeciesRDS, SpeciesResult, StemRDS, StemResult, TreeRDS, TreeResult } from '@/config/sqlrdsdefinitions/taxonomies';
import { QuadratRDS, QuadratResult } from '@/config/sqlrdsdefinitions/zones';
import { useOrgCensusContext, usePlotContext, useSiteContext } from '@/app/contexts/userselectionprovider';
import { GridColDef } from '@mui/x-data-grid';
import { DatePicker } from '@mui/x-date-pickers';
import moment from 'moment';
import CircularProgress from '@mui/joy/CircularProgress';

export default function MultilineMeasurementsDataGrid(props: DataGridSignals) {
  const { setChangesSubmitted } = props;
  const initialMeasurementsFormRow = {
    id: 0,
    tag: '',
    stemtag: '',
    spcode: '',
    quadrat: '',
    lx: 0,
    ly: 0,
    dbh: 0,
    hom: 0,
    date: null,
    codes: ''
  };
  const [refresh, setRefresh] = useState(false);
  const currentSite = useSiteContext();
  const currentPlot = usePlotContext();
  const currentCensus = useOrgCensusContext();
  const [selectableOpts, setSelectableOpts] = useState<{ [optName: string]: string[] }>({
    tag: [],
    stemtag: [],
    quadrat: [],
    spcode: [],
    codes: []
  });

  useEffect(() => {
    async function loadOptions() {
      const codeOpts = MapperFactory.getMapper<AttributesRDS, AttributesResult>('attributes')
        .mapData(await (await fetch(`/api/fetchall/attributes?schema=${currentSite?.schemaName ?? ''}`)).json())
        .map(i => i.code)
        .filter((code): code is string => code !== undefined);
      const tagOpts = MapperFactory.getMapper<TreeRDS, TreeResult>('trees')
        .mapData(await (await fetch(`/api/fetchall/trees?schema=${currentSite?.schemaName ?? ''}`)).json())
        .map(i => i.treeTag)
        .filter((tag): tag is string => tag !== undefined);
      const stemOpts = MapperFactory.getMapper<StemRDS, StemResult>('stems')
        .mapData(await (await fetch(`/api/fetchall/stems?schema=${currentSite?.schemaName ?? ''}`)).json())
        .map(i => i.stemTag)
        .filter((stemTag): stemTag is string => stemTag !== undefined);
      const quadOpts = MapperFactory.getMapper<QuadratRDS, QuadratResult>('quadrats')
        .mapData(
          await (
            await fetch(`/api/fetchall/quadrats/${currentPlot?.plotID ?? 0}/${currentCensus?.plotCensusNumber ?? 0}?schema=${currentSite?.schemaName ?? ''}`)
          ).json()
        )
        .map(i => i.quadratName)
        .filter((quadrat): quadrat is string => quadrat !== undefined);
      const specOpts = MapperFactory.getMapper<SpeciesRDS, SpeciesResult>('species')
        .mapData(await (await fetch(`/api/fetchall/species?schema=${currentSite?.schemaName ?? ''}`)).json())
        .map(i => i.speciesCode)
        .filter((species): species is string => species !== undefined);
      setSelectableOpts(prev => {
        return {
          ...prev,
          tag: tagOpts,
          stemtag: stemOpts,
          quadrat: quadOpts,
          spcode: specOpts,
          codes: codeOpts
        };
      });
    }

    loadOptions().catch(console.error);
  }, [currentSite, currentPlot, currentCensus]);

  const gridColumns: GridColDef[] = useMemo(() => {
    return [
      ...MeasurementsFormGridColumns.map((column: GridColDef) => {
        return {
          ...column,
          renderEditCell: (params: any) => {
            if (Object.keys(selectableOpts).includes(column.field)) {
              return (
                <Box sx={{ display: 'flex', flex: 1, flexDirection: 'column', width: '100%', height: '100%' }}>
                  <Autocomplete
                    sx={{ display: 'flex', flex: 1, width: '100%', height: '100%' }}
                    multiple={column.field === 'codes'}
                    variant={'soft'}
                    autoSelect
                    autoHighlight
                    isOptionEqualToValue={(option, value) => option === value}
                    options={selectableOpts[column.field]}
                    value={params.value}
                    onChange={(_event, value) => {
                      if (value) {
                        params.api.setEditCellValue({
                          id: params.id,
                          field: params.field,
                          value: Array.isArray(value) ? value.join(';') : value
                        });
                      }
                    }}
                  />
                </Box>
              );
            } else if (column.field === 'date') {
              return (
                <DatePicker
                  sx={{ my: 1 }}
                  label={column.headerName}
                  value={moment(params.value, 'YYYY-MM-DD')}
                  onChange={newValue => {
                    params.api.setEditCellValue({ id: params.id, field: params.field, value: newValue ? newValue.format('YYYY-MM-DD') : null });
                  }}
                />
              );
            }
          }
        };
      })
    ];
  }, [selectableOpts]);

  return Object.keys(selectableOpts)
    .filter(i => !['tag', 'stemtag'].includes(i))
    .every(key => selectableOpts[key].length > 0) ? (
    <Box>
      {RenderFormExplanations(FormType.measurements)}
      <IsolatedMultilineDataGridCommons
        gridType="measurements"
        gridColumns={gridColumns}
        refresh={refresh}
        setRefresh={setRefresh}
        initialRow={initialMeasurementsFormRow}
        setChangesSubmitted={setChangesSubmitted}
      />
    </Box>
  ) : (
    <CircularProgress />
  );
}
