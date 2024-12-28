import RenderGridExplanations from '@/components/client/rendergridexplanations';
import IsolatedQuadratsDataGrid from '@/components/datagrids/applications/isolated/isolatedquadratsdatagrid';
import { DatagridType } from '@/config/macros/formdetails';

export default function QuadratsPage() {
  return (
    <>
      <RenderGridExplanations datagridType={DatagridType.quadrats} />
      <IsolatedQuadratsDataGrid />
    </>
  );
}
