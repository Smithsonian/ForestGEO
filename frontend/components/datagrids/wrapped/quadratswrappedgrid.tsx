'use client';
import { initialQuadratRDSRow } from '@/config/sqlrdsdefinitions/tables/quadratrds';
import { quadratGridColumns } from '@/components/client/datagridcolumns';
import CommonsWrapper from '@/components/datagrids/commonswrapper';
import { FormType } from '@/config/macros/formdetails';
import { useOrgCensusContext, usePlotContext } from '@/app/contexts/userselectionprovider';

export default function QuadratsWrappedDataGrid() {
  const currentPlot = usePlotContext();
  const currentCensus = useOrgCensusContext();

  // Setting initial row with context values
  const initialQuadratRow = {
    ...initialQuadratRDSRow,
    plotID: currentPlot?.id ?? 0,
    censusID: currentCensus?.dateRanges[0].censusID ?? 0
  };

  return (
    <CommonsWrapper
      initialRow={initialQuadratRow}
      gridType="quadrats"
      gridFieldToFocus="quadratName"
      gridColumns={quadratGridColumns}
      uploadFormType={FormType.quadrats}
    />
  );
}
