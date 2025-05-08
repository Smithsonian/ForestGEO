import RenderGridFormExplanations from '@/components/client/rendergridformexplanations';
import IsolatedAllTaxonomiesViewDataGrid from '@/components/datagrids/applications/isolated/isolatedalltaxonomiesdatagrid';
import { DatagridType } from '@/config/macros/formdetails';

export default function AllTaxonomiesPage() {
  return (
    <>
      <RenderGridFormExplanations datagridType={DatagridType.alltaxonomiesview} />
      <IsolatedAllTaxonomiesViewDataGrid />
    </>
  );
}
