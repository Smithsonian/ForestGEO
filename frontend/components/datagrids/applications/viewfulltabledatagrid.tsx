// viewfulltable view datagrid
'use client';

import { Box, Typography } from '@mui/joy';
import { AlertProps } from '@mui/material';
import { GridRowsProp } from '@mui/x-data-grid';
import { randomId } from '@mui/x-data-grid-generator';
import { useSession } from 'next-auth/react';
import { useEffect, useState } from 'react';
import { ViewFullTableGridColumns } from '@/components/client/datagridcolumns';
import MeasurementsCommons from '@/components/datagrids/measurementscommons';
import { ViewFullTableRDS } from '@/config/sqlrdsdefinitions/views';
import { useLoading } from '@/app/contexts/loadingprovider';
import { useSiteContext } from '@/app/contexts/userselectionprovider';

export default function ViewFullTableDataGrid() {
  const initialViewFullTable: ViewFullTableRDS = {
    // datagrid
    id: 0,

    // IDs
    coreMeasurementID: 0,
    plotID: 0,
    censusID: 0,
    quadratID: 0,
    treeID: 0,
    stemID: 0,
    personnelID: 0,
    speciesID: 0,
    genusID: 0,
    familyID: 0,

    // coremeasurements
    measurementDate: undefined,
    measuredDBH: 0,
    dbhUnits: '',
    measuredHOM: 0,
    homUnits: '',
    description: '',
    isValidated: false,

    // plots
    plotName: '',
    locationName: '',
    countryName: '',
    dimensionX: 0,
    dimensionY: 0,
    plotDimensionUnits: '',
    plotArea: 0,
    plotAreaUnits: '',
    plotGlobalX: 0,
    plotGlobalY: 0,
    plotGlobalZ: 0,
    plotCoordinateUnits: '',
    plotShape: '',
    plotDescription: '',

    // census
    censusStartDate: undefined,
    censusEndDate: undefined,
    censusDescription: '',
    plotCensusNumber: 0,

    // quadrats
    quadratName: '',
    quadratDimensionX: 0,
    quadratDimensionY: 0,
    quadratDimensionUnits: '',
    quadratArea: 0,
    quadratAreaUnits: '',
    quadratStartX: 0,
    quadratStartY: 0,
    quadratCoordinateUnits: '',
    quadratShape: '',

    // trees
    treeTag: '',

    // stems
    stemTag: '',
    stemLocalX: 0,
    stemLocalY: 0,
    stemCoordinateUnits: '',

    // personnel
    firstName: '',
    lastName: '',

    // roles
    personnelRoles: '',

    // species
    speciesCode: '',
    speciesName: '',
    subspeciesName: '',
    subspeciesAuthority: '',
    idLevel: '',

    // genus
    genus: '',
    genusAuthority: '',

    // family
    family: '',

    // attributes
    attributeCode: '',
    attributeDescription: '',
    attributeStatus: ''
  };

  const [rows, setRows] = useState<GridRowsProp>([initialViewFullTable] as GridRowsProp);
  const [rowCount, setRowCount] = useState(0);
  const [rowModesModel, setRowModesModel] = useState({});
  const [snackbar, setSnackbar] = useState<Pick<AlertProps, 'children' | 'severity'> | null>(null);
  const [refresh, setRefresh] = useState(false);
  const [paginationModel, setPaginationModel] = useState({
    page: 0,
    pageSize: 10
  });
  const [isNewRowAdded, setIsNewRowAdded] = useState(false);
  const [shouldAddRowAfterFetch, setShouldAddRowAfterFetch] = useState(false);
  const { data: session } = useSession();
  const { setLoading } = useLoading();
  const currentSite = useSiteContext();

  const addNewRowToGrid = () => {
    const id = randomId();
    const newRow = {
      ...initialViewFullTable,
      id,
      isNew: true
    };

    setRows(oldRows => [...(oldRows ?? []), newRow]);
    setRowModesModel(oldModel => ({
      ...oldModel,
      [id]: { mode: 'edit', fieldToFocus: 'speciesCode' }
    }));
  };

  async function reloadVFT() {
    setLoading(true, 'Refreshing Historical View...');
    const response = await fetch(`/api/refreshviews/viewfulltable/${currentSite?.schemaName ?? ''}`, { method: 'POST' });
    if (!response.ok) throw new Error('Historical View Refresh failure');
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  useEffect(() => {
    reloadVFT().catch(console.error).then(() => setLoading(false));
  }, []);

  return (
    <>
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          mb: 3,
          width: '100%',
          flexDirection: 'column'
        }}
      >
        <Box
          sx={{
            width: '100%',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            backgroundColor: 'warning.main',
            borderRadius: '4px',
            p: 2
          }}
        >
          <Box sx={{ flexGrow: 1 }}>
            {session?.user.userStatus !== 'field crew' && (
              <Typography level="title-lg" sx={{ color: '#ffa726' }}>
                Note: ADMINISTRATOR VIEW
              </Typography>
            )}
          </Box>
        </Box>

        <MeasurementsCommons
          gridType="viewfulltable"
          gridColumns={ViewFullTableGridColumns}
          rows={rows}
          setRows={setRows}
          rowCount={rowCount}
          setRowCount={setRowCount}
          rowModesModel={rowModesModel}
          setRowModesModel={setRowModesModel}
          snackbar={snackbar}
          setSnackbar={setSnackbar}
          refresh={refresh}
          setRefresh={setRefresh}
          paginationModel={paginationModel}
          setPaginationModel={setPaginationModel}
          isNewRowAdded={isNewRowAdded}
          setIsNewRowAdded={setIsNewRowAdded}
          shouldAddRowAfterFetch={shouldAddRowAfterFetch}
          setShouldAddRowAfterFetch={setShouldAddRowAfterFetch}
          addNewRowToGrid={addNewRowToGrid}
        />
      </Box>
    </>
  );
}
