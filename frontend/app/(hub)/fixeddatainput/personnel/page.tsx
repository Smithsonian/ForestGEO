import IsolatedPersonnelDataGrid from '@/components/datagrids/applications/isolated/isolatedpersonneldatagrid';
import { DatagridType } from '@/config/macros/formdetails';
import RenderGridExplanations from '@/components/client/rendergridexplanations';

export default function PersonnelPage() {
  return (
    <>
      <RenderGridExplanations datagridType={DatagridType.personnel} />
      <IsolatedPersonnelDataGrid />
    </>
  );
}
