import { GridColDef } from '@mui/x-data-grid';
import { IDataMapper } from '../../datamapper';

export type GenusRDS = {
  id: number;
  genusID: number;
  familyID: number | null;
  genus: string | null;
  referenceID: number | null;
  genusAuthority: string | null;
};

export interface GenusResult {
  GenusID: any;
  FamilyID: any;
  Genus: any;
  ReferenceID: any;
  GenusAuthority: any;
}

export class GenusMapper implements IDataMapper<GenusResult, GenusRDS> {
  mapData(results: GenusResult[], indexOffset: number = 1): GenusRDS[] {
    return results.map((item, index) => ({
      id: index + indexOffset,
      genusID: Number(item.GenusID),
      familyID: Number(item.FamilyID),
      genus: String(item.Genus),
      referenceID: Number(item.ReferenceID),
      genusAuthority: String(item.GenusAuthority),
    }));
  }
  demapData(results: GenusRDS[]): GenusResult[] {
    return results.map((item) => ({
      GenusID: Number(item.genusID),
      FamilyID: Number(item.familyID),
      Genus: String(item.genus),
      ReferenceID: Number(item.referenceID),
      GenusAuthority: String(item.genusAuthority)
    }));
  }
}

export const GenusGridColumns: GridColDef[] = [
  { field: 'genusID', headerName: 'GenusID', headerClassName: 'header', flex: 1, align: 'left', },
  { field: 'familyID', headerName: 'FamilyID', headerClassName: 'header', flex: 1, align: 'left', },
  { field: 'genus', headerName: 'GenusName', headerClassName: 'header', flex: 1, align: 'left', },
  { field: 'referenceID', headerName: 'ReferenceID', headerClassName: 'header', flex: 1, align: 'left', },
  { field: 'genusAuthority', headerName: 'Authority', headerClassName: 'header', flex: 1, align: 'left', },
];
