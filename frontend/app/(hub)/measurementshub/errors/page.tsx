import RenderGridFormExplanations from '@/components/client/rendergridformexplanations';
import MeasurementsSummaryViewDataGrid from '@/components/datagrids/applications/msvdatagrid';
import { DatagridType } from '@/config/macros/formdetails';

export default function ErrorsPage() {
  return (
    <>
      <RenderGridFormExplanations datagridType={DatagridType.measurementssummaryview} />
      <MeasurementsSummaryViewDataGrid initialVisibleFilters={['errors']} showToolbarActions={false} />
    </>
  );
}
