import {GridColDef} from '@mui/x-data-grid';
import { IDataMapper } from "../../datamapper";
import { FileRow, RowValidationErrors, ValidationFunction } from '@/config/macros/formdetails';

// attributes table column character limits
const ATTRIBUTES_CODE_LIMIT = 10;

export const validateAttributesRow: ValidationFunction = (row: FileRow) => {
  const errors: RowValidationErrors = {};

  if (row['code'] && row['code'].length > ATTRIBUTES_CODE_LIMIT) {
    errors['code'] = `Code exceeds ${ATTRIBUTES_CODE_LIMIT} characters.`;
  }
  // Allowing NULL for status, otherwise checking for valid values
  if (row['status'] !== null && row['status'] !== undefined && !['alive', 'alive-not measured', 'dead', 'stem dead', 'broken below', 'omitted', 'missing'].includes(row['status'])) {
    errors['status'] = 'Invalid status value.';
  }

  return Object.keys(errors).length > 0 ? errors : null;
};

export type AttributesRDS = {
  id?: number;
  code?: string;
  description?: string;
  status?: string;
};

export const AttributeStatusOptions = ['alive', 'alive-not measured', 'dead', 'missing', 'broken below', 'stem dead'];

export interface AttributesResult {
  Code: any;
  Description: any;
  Status: any;
}

export class AttributesMapper implements IDataMapper<AttributesResult, AttributesRDS> {
  mapData(results: AttributesResult[], indexOffset: number = 1): AttributesRDS[] {
    return results.map((item, index) => ({
      id: index + indexOffset,
      code: item.Code != null ? String(item.Code) : undefined,
      description: item.Description != null ? String(item.Description) : undefined,
      status: item.Status != null ? String(item.Status) : undefined,
    }));
  }

  demapData(results: AttributesRDS[]): AttributesResult[] {
    return results.map((item) => ({
      Code: item.code != null ? String(item.code) : null,
      Description: item.description != null ? String(item.description) : null,
      Status: item.status != null ? String(item.status) : null,
    }));
  }
}

export const attributesFields = ['code', 'description', 'status'];

export const AttributeGridColumns: GridColDef[] = [
  {field: 'code', headerName: 'Code', headerClassName: 'header', minWidth: 150, flex: 1, editable: true}, // all unique ID columns need to be tagged 'id'
  {
    field: 'description',
    headerName: 'Description',
    headerClassName: 'header',
    minWidth: 250,
    flex: 1,
    align: 'left',
    editable: true
  },
  {
    field: 'status',
    headerName: 'Status',
    headerClassName: 'header',
    minWidth: 150,
    flex: 1,
    align: 'left',
    editable: true,
    type: 'singleSelect',
    valueOptions: AttributeStatusOptions,
  },
];