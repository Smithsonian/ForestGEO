import RenderGridFormExplanations from '@/components/client/rendergridformexplanations';
import IsolatedAttributesDataGrid from '@/components/datagrids/applications/isolated/isolatedattributesdatagrid';
import { DatagridType } from '@/config/macros/formdetails';

export default function AttributesPage() {
  return (
    <>
      <RenderGridFormExplanations datagridType={DatagridType.attributes} />
      <IsolatedAttributesDataGrid />
    </>
  );
}
