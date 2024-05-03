import {GridColDef} from '@mui/x-data-grid';
import { IDataMapper } from "../../datamapper";
import { Templates } from '@/config/datagridhelpers';

export type AttributesRDS = {
  id: number;
  code: string;
  description: string | null;
  status: string | null;
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
      code: String(item.Code),
      description: String(item.Description),
      status: String(item.Status)
    }));
  }
  demapData(results: AttributesRDS[]): AttributesResult[] {
    return results.map((item) => ({
      Code: String(item.code),
      Description: String(item.description),
      Status: String(item.status)
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