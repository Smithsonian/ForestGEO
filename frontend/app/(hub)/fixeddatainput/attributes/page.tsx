import RenderGridExplanations from '@/components/client/rendergridexplanations';
import IsolatedAttributesDataGrid from '@/components/datagrids/applications/isolated/isolatedattributesdatagrid';
import { DatagridType } from '@/config/macros/formdetails';

export default function AttributesPage() {
  return (
    <>
      <RenderGridExplanations datagridType={DatagridType.attributes} />
      <IsolatedAttributesDataGrid />
    </>
  );
}
