// viewfulltable view datagrid
'use client';

import { Box, Typography } from '@mui/joy';
import { AlertProps } from '@mui/material';
import { GridRowsProp } from '@mui/x-data-grid';
import { randomId } from '@mui/x-data-grid-generator';
import { useSession } from 'next-auth/react';
import { useState } from 'react';
import { ViewFullTableGridColumns } from '@/components/client/datagridcolumns';
import MeasurementsCommons from '@/components/datagrids/measurementscommons';
import { ViewFullTableViewRDS } from '@/config/sqlrdsdefinitions/views';

export default function ViewFullTableDataGrid() {
  const initialViewFullTableViewRDSRow: ViewFullTableViewRDS = {
    id: 0,
    coreMeasurementID: 0,
    plotID: 0,
    PlotDimensionUnits: '',
    attributeCode: '',
    attributeDescription: '',
    attributeStatus: '',
    censusDescription: '',
    censusEndDate: undefined,
    censusID: 0,
    censusStartDate: undefined,
    countryName: '',
    dbhUnits: '',
    description: '',
    dimensionX: 0,
    dimensionY: 0,
    family: '',
    familyID: 0,
    firstName: '',
    genus: '',
    genusAuthority: '',
    genusID: 0,
    homUnits: '',
    idLevel: '',
    isValidated: false,
    lastName: '',
    locationName: '',
    measuredDBH: 0,
    measuredHOM: 0,
    measurementDate: undefined,
    personnelID: 0,
    personnelRoles: '',
    plotArea: 0,
    plotAreaUnits: '',
    plotCensusNumber: 0,
    plotCoordinateUnits: '',
    plotDescription: '',
    plotGlobalX: 0,
    plotGlobalY: 0,
    plotGlobalZ: 0,
    plotName: '',
    plotShape: '',
    quadratArea: 0,
    quadratAreaUnits: '',
    quadratCoordinateUnits: '',
    quadratDimensionUnits: '',
    quadratDimensionX: 0,
    quadratDimensionY: 0,
    quadratID: 0,
    quadratName: '',
    quadratShape: '',
    quadratStartX: 0,
    quadratStartY: 0,
    speciesCode: '',
    speciesID: 0,
    speciesName: '',
    stemCoordinateUnits: '',
    stemID: 0,
    stemLocalX: 0,
    stemLocalY: 0,
    stemTag: '',
    subquadratCoordinateUnits: '',
    subquadratDimensionUnits: '',
    subquadratDimensionX: 0,
    subquadratDimensionY: 0,
    subquadratID: 0,
    subquadratName: '',
    subquadratX: 0,
    subquadratY: 0,
    subspeciesAuthority: '',
    subspeciesName: '',
    treeID: 0,
    treeTag: ''
  };
  const [rows, setRows] = useState<GridRowsProp>([initialViewFullTableViewRDSRow] as GridRowsProp);
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

  const addNewRowToGrid = () => {
    const id = randomId();
    const newRow = {
      ...initialViewFullTableViewRDSRow,
      id,
      isNew: true
    };

    setRows(oldRows => [...(oldRows ?? []), newRow]);
    setRowModesModel(oldModel => ({
      ...oldModel,
      [id]: { mode: 'edit', fieldToFocus: 'speciesCode' }
    }));
    console.log('viewfulltableview addnewrowtogrid triggered');
  };

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
