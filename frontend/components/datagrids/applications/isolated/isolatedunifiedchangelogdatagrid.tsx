'use client';

// isolated unifiedchangelog datagrid
import React, { ReactNode, useMemo, useState } from 'react';
import IsolatedDataGridCommons from '@/components/datagrids/isolateddatagridcommons';
import { useOrgCensusContext, usePlotContext } from '@/app/contexts/userselectionprovider';
import { UnifiedChangelogGridColumns } from '@/components/client/datagridcolumns';
import { UnifiedChangelogRDS } from '@/config/sqlrdsdefinitions/core';
import { Box, Divider, Stack, Typography } from '@mui/joy';
import { GridColDef } from '@mui/x-data-grid';
import moment from 'moment';

export default function IsolatedUnifiedChangelogDataGrid() {
  const currentPlot = usePlotContext();
  const currentCensus = useOrgCensusContext();
  const initialUCRDSRow: UnifiedChangelogRDS = {
    id: 0,
    changeID: 0,
    tableName: '',
    recordID: '',
    operation: '',
    oldRowState: {},
    newRowState: {},
    changeTimestamp: new Date(),
    changedBy: '',
    plotID: currentPlot?.plotID ?? 0,
    censusID: currentCensus?.dateRanges[0].censusID ?? 0
  };
  const [refresh, setRefresh] = useState(false);

  function formatValue(value: any): ReactNode {
    if (value === null || value === undefined) {
      return 'NULL';
    }
    if (typeof value === 'object') {
      try {
        return JSON.stringify(value);
      } catch (error) {
        return '[Circular Object]';
      }
    }
    return value.toString();
  }

  const columns: GridColDef[] = useMemo(
    () =>
      UnifiedChangelogGridColumns.map(col => {
        if (['oldRowState', 'newRowState'].includes(col.field)) {
          return {
            ...col,
            renderCell: (params: any) => {
              let raw = params.value;
              if (typeof raw === 'string') {
                try {
                  raw = JSON.parse(raw);
                } catch (e) {
                  return <Typography>Invalid JSON</Typography>;
                }
              }
              const arr = Array.isArray(raw) ? raw : [raw];
              if (!arr.length) return <></>;

              return arr.map((obj, idx) => (
                <React.Fragment key={idx}>
                  <Box
                    sx={{
                      display: 'flex',
                      flexDirection: 'column',
                      backgroundColor: 'neutral.softBg',
                      borderRadius: '8px',
                      padding: '8px',
                      overflow: 'auto',
                      fontSize: '12px'
                    }}
                  >
                    {obj &&
                      Object.keys(obj).length > 0 &&
                      Object.entries(obj).map(([key, value]) => (
                        <Stack direction={'row'} key={key}>
                          <Typography level={'body-md'}>
                            <strong>{key}</strong>:{formatValue(value)}
                          </Typography>
                        </Stack>
                      ))}
                  </Box>
                  <Divider sx={{ my: 1 }} />
                </React.Fragment>
              ));
            }
          };
        } else if (col.field === 'changeTimestamp') {
          return {
            ...col,
            renderCell: (params: any) => {
              const date = moment(params.value);
              return date.isValid() ? date.format('dddd, MMMM Do YYYY, hh:mm:ss a') : 'Invalid Date';
            }
          };
        }
        return col;
      }),
    [UnifiedChangelogGridColumns]
  );

  return (
    <>
      <IsolatedDataGridCommons
        gridType="unifiedchangelog"
        gridColumns={columns}
        refresh={refresh}
        setRefresh={setRefresh}
        initialRow={initialUCRDSRow}
        fieldToFocus={'tableName'}
        dynamicButtons={[]}
        locked={true}
      />
    </>
  );
}
