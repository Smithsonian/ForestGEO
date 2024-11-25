// viewfulltable view datagrid
'use client';

import { AlertProps } from '@mui/material';
import { GridRowsProp } from '@mui/x-data-grid';
import { randomId } from '@mui/x-data-grid-generator';
import React, { useEffect, useState } from 'react';
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
  const [snackbar, setSnackbar] = React.useState<Array<Pick<AlertProps, 'children' | 'severity'>>>([]);
  const [refresh, setRefresh] = useState(false);
  const [paginationModel, setPaginationModel] = useState({
    page: 0,
    pageSize: 10
  });
  const [isNewRowAdded, setIsNewRowAdded] = useState(false);
  const [shouldAddRowAfterFetch, setShouldAddRowAfterFetch] = useState(false);
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
    try {
      setLoading(true, 'Refreshing Historical View...');
      const startTime = Date.now();
      const response = await fetch(`/api/refreshviews/viewfulltable/${currentSite?.schemaName ?? ''}`, { method: 'POST' });
      if (!response.ok) throw new Error('Historical View Refresh failure');
      setLoading(true, 'Processing data...');
      await response.json();
      const duration = (Date.now() - startTime) / 1000;
      setLoading(true, `Completed in ${duration.toFixed(2)} seconds.`);
      await new Promise(resolve => setTimeout(resolve, 1000));
    } catch (e: any) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let isMounted = true;
    if (isMounted) {
      reloadVFT().catch(console.error);
    }
    return () => {
      isMounted = false;
    };
  }, [refresh]);

  return (
    <>
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
        dynamicButtons={[]}
      />
    </>
  );
}
