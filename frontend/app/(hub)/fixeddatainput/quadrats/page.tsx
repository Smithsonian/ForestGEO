import RenderGridFormExplanations from '@/components/client/rendergridformexplanations';
import IsolatedQuadratsDataGrid from '@/components/datagrids/applications/isolated/isolatedquadratsdatagrid';
import { DatagridType } from '@/config/macros/formdetails';

export default function QuadratsPage() {
  return (
    <>
      <RenderGridFormExplanations datagridType={DatagridType.quadrats} />
      <IsolatedQuadratsDataGrid />
    </>
  );
}
