'use client';

// multiline measurements datagrid
import React, { useEffect, useMemo, useState } from 'react';
import IsolatedMultilineDataGridCommons from '@/components/datagrids/isolatedmultilinedatagridcommons';
import { MeasurementsFormGridColumns } from '@/components/client/formcolumns';
import { DataGridSignals, FormType } from '@/config/macros/formdetails';
import { Box } from '@mui/joy';
import RenderFormExplanations from '@/components/client/renderformexplanations';
import { useOrgCensusContext, usePlotContext, useSiteContext } from '@/app/contexts/userselectionprovider';
import { GridColDef } from '@mui/x-data-grid';
import { DatePicker } from '@mui/x-date-pickers';
import moment from 'moment';
import CircularProgress from '@mui/joy/CircularProgress';
import { loadSelectableOptions, selectableAutocomplete } from '@/components/client/clientmacros';

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
    codes: '',
    description: ''
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
    loadSelectableOptions(currentSite, currentPlot, currentCensus, setSelectableOpts).catch(console.error);
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
                  {selectableAutocomplete(params, column, selectableOpts)}
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
