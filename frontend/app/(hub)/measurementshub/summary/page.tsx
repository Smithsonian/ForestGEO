import RenderGridExplanations from '@/components/client/rendergridexplanations';
import MeasurementsSummaryViewDataGrid from '@/components/datagrids/applications/msvdatagrid';
import { DatagridType } from '@/config/macros/formdetails';

export default function SummaryPage() {
  return (
    <>
      <RenderGridExplanations datagridType={DatagridType.measurementssummaryview} />
      <MeasurementsSummaryViewDataGrid />
    </>
  );
}
