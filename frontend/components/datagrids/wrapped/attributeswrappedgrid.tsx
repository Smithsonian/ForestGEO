'use client';
import { initialAttributesRDSRow } from '@/config/sqlrdsdefinitions/tables/attributerds';
import { AttributeGridColumns } from '@/components/client/datagridcolumns';
import CommonsWrapper from '@/components/datagrids/commonswrapper';
import { FormType } from '@/config/macros/formdetails';

export default function AttributesWrappedDataGrid() {
  return (
    <CommonsWrapper
      initialRow={initialAttributesRDSRow}
      gridType="attributes"
      gridFieldToFocus="code"
      gridColumns={AttributeGridColumns}
      uploadFormType={FormType.attributes}
    />
  );
}
