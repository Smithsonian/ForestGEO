import IsolatedPersonnelDataGrid from '@/components/datagrids/applications/isolated/isolatedpersonneldatagrid';
import { DatagridType } from '@/config/macros/formdetails';
import RenderGridFormExplanations from '@/components/client/rendergridformexplanations';

export default function PersonnelPage() {
  return (
    <>
      <RenderGridFormExplanations datagridType={DatagridType.personnel} />
      <IsolatedPersonnelDataGrid />
    </>
  );
}
