// catalogsitesdatagrid.tsx
'use client';

import { standardizeGridColumns } from '@/components/client/clientmacros';
import { useSession } from 'next-auth/react';
import { useState } from 'react';
import IsolatedDataGridCommons from '@/components/datagrids/isolateddatagridcommons';

/**
 * siteName?: string;
 *   schemaName?: string;
 *   sqDimX?: number;
 *   sqDimY?: number;
 *   defaultUOMDBH?: string;
 *   defaultUOMHOM?: string;
 *   doubleDataEntry?: boolean;
 */

const columns = standardizeGridColumns([
  {
    field: 'siteName',
    headerName: 'Site Name',
    flex: 0.3,
    editable: true
  },
  {
    field: 'schemaName',
    headerName: 'Schema Name',
    flex: 0.5,
    editable: true
  },
  {
    field: 'sqDimX',
    headerName: 'Subquadrat Dimension X',
    flex: 0.3,
    editable: true
  },
  {
    field: 'sqDimY',
    headerName: 'Subquadrat Dimension Y',
    flex: 0.3,
    editable: true
  },
  {
    field: 'defaultUOMDBH',
    headerName: 'Default DBH UOM',
    flex: 0.3,
    editable: true
  },
  {
    field: 'defaultUOMHOM',
    headerName: 'Default HOM UOM',
    flex: 0.3,
    editable: true
  },
  {
    field: 'doubleDataEntry',
    headerName: 'Double Data Entry?',
    flex: 0.25,
    editable: true
  }
]);

export default function CatalogSitesDatagrid() {
  const { data: session } = useSession();
  const [refresh, setRefresh] = useState(false);
  return (
    <IsolatedDataGridCommons
      gridType={'sites'}
      gridColumns={columns}
      refresh={refresh}
      setRefresh={setRefresh}
      dynamicButtons={[]}
      initialRow={{
        id: 0,
        siteName: '',
        schemaName: '',
        sqDimX: 5,
        sqDimY: 5,
        defaultUOMDBH: 'mm',
        defaultUOMHOM: 'm',
        doubleDataEntry: false
      }}
      fieldToFocus={'siteName'}
      adminEmail={session?.user?.email}
    />
  );
}
