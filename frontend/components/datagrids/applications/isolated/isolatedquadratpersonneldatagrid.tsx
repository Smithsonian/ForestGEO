// quadratpersonnel datagrid
'use client';
import { GridColDef } from '@mui/x-data-grid';
import { useSession } from 'next-auth/react';
import React, { useEffect, useState } from 'react';
import { useOrgCensusContext, usePlotContext, useSiteContext } from '@/app/contexts/userselectionprovider';
import { GridSelections } from '@/config/macros';
import { useRouter } from 'next/navigation';
import { QuadratPersonnelRDS } from '@/config/sqlrdsdefinitions/personnel';
import IsolatedDataGridCommons from '@/components/datagrids/isolateddatagridcommons';

export default function IsolatedQuadratPersonnelDataGrid() {
  const initialQuadratPersonnelRDSRow: QuadratPersonnelRDS = {
    id: 0,
    quadratPersonnelID: 0,
    quadratID: 0,
    personnelID: 0,
    censusID: 0
  };
  const [refresh, setRefresh] = useState(false);
  const { data: session } = useSession();
  const router = useRouter();

  const [quadratOptions, setQuadratOptions] = useState<GridSelections[]>([]);
  const [personnelOptions, setPersonnelOptions] = useState<GridSelections[]>([]);
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const [isManualEntryFormOpen, setIsManualEntryFormOpen] = useState(false);

  const currentSite = useSiteContext();
  const currentPlot = usePlotContext();
  const currentCensus = useOrgCensusContext();

  useEffect(() => {
    const fetchOptions = async () => {
      const quadratResponse = await fetch(`/api/fetchall/quadrats/${currentPlot?.plotID}/${currentCensus?.plotCensusNumber}?schema=${currentSite?.schemaName}`);
      const quadratData = await quadratResponse.json();
      if (quadratData.length === 0) throw new Error('quadratData fetchall is empty');
      setQuadratOptions(
        quadratData.map((item: any) => ({
          label: item.quadratName, // Adjust based on your data structure
          value: item.quadratID
        }))
      );

      const personnelResponse = await fetch(`/api/fetchall/personnel?schema=${currentSite?.schemaName}`);
      const personnelData = await personnelResponse.json();
      if (personnelData.length === 0) throw new Error('personnelData fetchall is empty');
      setPersonnelOptions(
        personnelData.map((person: any) => ({
          label: `${person.firstName} ${person.lastName}`, // Adjust based on your data structure
          value: person.personnelID
        }))
      );
    };
    if (currentSite && currentPlot && currentCensus) fetchOptions().catch(console.error);
  }, [currentSite, currentPlot, currentCensus]);

  const QuadratPersonnelGridColumns: GridColDef[] = [
    {
      field: 'quadratPersonnelID',
      headerName: 'ID',
      headerClassName: 'header',
      minWidth: 75,
      align: 'left',
      editable: false
    },
    {
      field: 'quadratID',
      headerName: 'Quadrat ID',
      headerClassName: 'header',
      flex: 1,
      minWidth: 140,
      align: 'left',
      type: 'singleSelect',
      valueOptions: quadratOptions,
      editable: true
    },
    {
      field: 'personnelID',
      headerName: 'Personnel ID',
      headerClassName: 'header',
      flex: 1,
      minWidth: 140,
      align: 'left',
      type: 'singleSelect',
      valueOptions: personnelOptions,
      editable: true
    }
  ];

  return (
    <>
      <IsolatedDataGridCommons
        gridType="quadratpersonnel"
        gridColumns={QuadratPersonnelGridColumns}
        refresh={refresh}
        setRefresh={setRefresh}
        initialRow={initialQuadratPersonnelRDSRow}
        fieldToFocus={'quadratID'}
        dynamicButtons={[
          { label: 'Manual Entry Form', onClick: () => setIsManualEntryFormOpen(true), tooltip: 'Submit data by filling out a form' },
          { label: 'Upload', onClick: () => setIsUploadModalOpen(true), tooltip: 'Submit data by uploading a CSV file' }
        ]}
      />
    </>
  );
}
