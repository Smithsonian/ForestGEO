// viewfulltable view datagrid
'use client';

import React, { useState } from 'react';
import { ViewFullTableGridColumns } from '@/components/client/datagridcolumns';
import { ViewFullTableRDS } from '@/config/sqlrdsdefinitions/views';
import { useSiteContext } from '@/app/contexts/userselectionprovider';
import IsolatedDataGridCommons from '@/components/datagrids/isolateddatagridcommons';
import { CachedOutlined } from '@mui/icons-material';

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
    stemGUID: 0,
    speciesID: 0,
    genusID: 0,
    familyID: 0,

    // coremeasurements
    measurementDate: undefined,
    measuredDBH: 0,
    measuredHOM: 0,
    description: '',
    isValidated: false,

    // plots
    plotName: '',
    locationName: '',
    countryName: '',
    dimensionX: 0,
    dimensionY: 0,
    plotArea: 0,
    plotGlobalX: 0,
    plotGlobalY: 0,
    plotGlobalZ: 0,
    plotShape: '',
    plotDescription: '',
    plotDefaultDimensionUnits: '',
    plotDefaultCoordinateUnits: '',
    plotDefaultAreaUnits: '',
    plotDefaultDBHUnits: '',
    plotDefaultHOMUnits: '',

    // census
    censusStartDate: undefined,
    censusEndDate: undefined,
    censusDescription: '',
    plotCensusNumber: 0,

    // quadrats
    quadratName: '',
    quadratDimensionX: 0,
    quadratDimensionY: 0,
    quadratArea: 0,
    quadratStartX: 0,
    quadratStartY: 0,
    quadratShape: '',

    // trees
    treeTag: '',

    // stems
    stemTag: '',
    stemLocalX: 0,
    stemLocalY: 0,

    // species
    speciesCode: '',
    speciesName: '',
    subspeciesName: '',
    subspeciesAuthority: '',
    speciesIDLevel: '',

    // genus
    genus: '',
    genusAuthority: '',

    // family
    family: '',

    // attributes
    attributes: '',
    userDefinedFields: ''
  };

  const [refresh, setRefresh] = useState(false);
  const currentSite = useSiteContext();

  async function reloadVFT() {
    await fetch(`/api/refreshviews/viewfulltable/${currentSite?.schemaName}`);
  }

  return (
    <IsolatedDataGridCommons
      initialRow={initialViewFullTable}
      gridType={'viewfulltable'}
      gridColumns={ViewFullTableGridColumns}
      refresh={refresh}
      setRefresh={setRefresh}
      dynamicButtons={[{ label: 'Reset View', onClick: async () => await reloadVFT(), tooltip: 'Manually reload the view', icon: <CachedOutlined /> }]}
    />
  );
}
