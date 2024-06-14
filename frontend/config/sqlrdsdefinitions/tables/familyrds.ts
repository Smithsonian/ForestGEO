import {GridColDef} from '@mui/x-data-grid';
import {IDataMapper} from '../../datamapper';

export type FamilyRDS = {
  id?: number;
  familyID?: number;
  family?: string;
  referenceID?: number;
};

export interface FamilyResult {
  FamilyID: any;
  Family: any;
  ReferenceID: any;
}

export class FamilyMapper implements IDataMapper<FamilyResult, FamilyRDS> {
  mapData(results: FamilyResult[], indexOffset: number = 1): FamilyRDS[] {
    return results.map((item, index) => ({
      id: index + indexOffset,
      familyID: item.FamilyID != null ? Number(item.FamilyID) : undefined,
      family: item.Family != null ? String(item.Family) : undefined,
      referenceID: item.ReferenceID != null ? Number(item.ReferenceID) : undefined,
    }));
  }

  demapData(results: FamilyRDS[]): FamilyResult[] {
    return results.map((item) => ({
      FamilyID: item.familyID != null ? Number(item.familyID) : null,
      Family: item.family != null ? String(item.family) : null,
      ReferenceID: item.referenceID != null ? Number(item.referenceID) : null,
    }));
  }
}

export const FamilyGridColumns: GridColDef[] = [
  {field: 'familyID', headerName: 'FamilyID', headerClassName: 'header', flex: 1, align: 'left', editable: false},
  {field: 'family', headerName: 'Family', headerClassName: 'header', flex: 1, align: 'left', editable: false},
  {field: 'referenceID', headerName: 'ReferenceID', headerClassName: 'header', flex: 1, align: 'left', editable: false},
];