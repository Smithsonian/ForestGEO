import { GridColDef } from '@mui/x-data-grid';
import { IDataMapper } from '../../datamapper';

export type GenusRDS = {
  id?: number;
  genusID?: number;
  familyID?: number;
  genus?: string;
  referenceID?: number;
  genusAuthority?: string;
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
      genusID: item.GenusID != null ? Number(item.GenusID) : undefined,
      familyID: item.FamilyID != null ? Number(item.FamilyID) : undefined,
      genus: item.Genus != null ? String(item.Genus) : undefined,
      referenceID: item.ReferenceID != null ? Number(item.ReferenceID) : undefined,
      genusAuthority: item.GenusAuthority != null ? String(item.GenusAuthority) : undefined,
    }));
  }

  demapData(results: GenusRDS[]): GenusResult[] {
    return results.map((item) => ({
      GenusID: item.genusID != null ? Number(item.genusID) : null,
      FamilyID: item.familyID != null ? Number(item.familyID) : null,
      Genus: item.genus != null ? String(item.genus) : null,
      ReferenceID: item.referenceID != null ? Number(item.referenceID) : null,
      GenusAuthority: item.genusAuthority != null ? String(item.genusAuthority) : null,
    }));
  }
}


export const GenusGridColumns: GridColDef[] = [
  { field: 'genusID', headerName: 'GenusID', headerClassName: 'header', flex: 1, align: 'left', editable: false},
  { field: 'familyID', headerName: 'FamilyID', headerClassName: 'header', flex: 1, align: 'left', editable: false},
  { field: 'genus', headerName: 'GenusName', headerClassName: 'header', flex: 1, align: 'left', editable: true},
  { field: 'referenceID', headerName: 'ReferenceID', headerClassName: 'header', flex: 1, align: 'left', editable: false},
  { field: 'genusAuthority', headerName: 'Authority', headerClassName: 'header', flex: 1, align: 'left', editable: true},
];
