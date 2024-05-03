import { GridColDef } from '@mui/x-data-grid';
import { IDataMapper } from '../../datamapper';

export type FamilyRDS = {
  id: number;
  familyID: number;
  family: string | null;
  referenceID: number | null;
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
      familyID: Number(item.FamilyID),
      family: String(item.Family),
      referenceID: Number(item.ReferenceID)
    }));
  }
  demapData(results: FamilyRDS[]): FamilyResult[] {
    return results.map((item) => ({
      FamilyID: Number(item.familyID),
      Family: String(item.family),
      ReferenceID: Number(item.referenceID),
    }));
  }
}

export const FamilyGridColumns: GridColDef[] = [
  { field: 'familyID', headerName: 'FamilyID', headerClassName: 'header', flex: 1, align: 'left', },
  { field: 'family', headerName: 'Family', headerClassName: 'header', flex: 1, align: 'left', },
  { field: 'referenceID', headerName: 'ReferenceID', headerClassName: 'header', flex: 1, align: 'left', },
];