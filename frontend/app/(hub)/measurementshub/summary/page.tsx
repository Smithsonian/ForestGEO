import RenderGridFormExplanations from '@/components/client/rendergridformexplanations';
import MeasurementsSummaryViewDataGrid from '@/components/datagrids/applications/msvdatagrid';
import { DatagridType } from '@/config/macros/formdetails';

export default function SummaryPage() {
  return (
    <>
      <RenderGridFormExplanations datagridType={DatagridType.measurementssummaryview} />
      <MeasurementsSummaryViewDataGrid />
    </>
  );
}
