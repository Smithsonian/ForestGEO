import RenderGridExplanations from '@/components/client/rendergridexplanations';
import IsolatedAllTaxonomiesViewDataGrid from '@/components/datagrids/applications/isolated/isolatedalltaxonomiesdatagrid';
import { DatagridType } from '@/config/macros/formdetails';

export default function AllTaxonomiesPage() {
  return (
    <>
      <RenderGridExplanations datagridType={DatagridType.alltaxonomiesview} />
      <IsolatedAllTaxonomiesViewDataGrid />
    </>
  );
}
