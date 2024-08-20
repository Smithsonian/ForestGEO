'use client';
import { initialPersonnelRDSRow } from '@/config/sqlrdsdefinitions/tables/personnelrds';
import { PersonnelGridColumns } from '@/components/client/datagridcolumns';
import CommonsWrapper from '@/components/datagrids/commonswrapper';
import { FormType } from '@/config/macros/formdetails';

export default function PersonnelWrappedDataGrid() {
  return (
    <CommonsWrapper
      initialRow={initialPersonnelRDSRow}
      gridType="personnel"
      gridFieldToFocus="firstName"
      gridColumns={PersonnelGridColumns}
      uploadFormType={FormType.personnel}
    />
  );
}
