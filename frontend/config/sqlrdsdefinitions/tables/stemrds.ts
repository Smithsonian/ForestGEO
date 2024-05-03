import { GridColDef } from '@mui/x-data-grid';
import { IDataMapper } from "../../datamapper";
import { bitToBoolean, booleanToBit, unitSelectionOptions } from '../../macros';


export type StemRDS = {
  id: number;
  stemID: number;
  treeID: number | null;
  subquadratID: number | null;
  stemNumber: number | null;
  stemTag: string | null;
  localX: number | null;
  localY: number | null;
  unit: string | null;
  moved: boolean | null;
  stemDescription: string | null;
};

export interface StemResult {
  StemID: any;
  TreeID: any;
  SubquadratID: any;
  StemNumber: any;
  StemTag: any;
  LocalX: any;
  LocalY: any;
  Unit: any;
  Moved: any;
  StemDescription: any;
}
export class StemsMapper implements IDataMapper<StemResult, StemRDS> {
  demapData(results: StemRDS[]): StemResult[] {
    return results.map(item => ({
      StemID: item.stemID?.toString() || '',
      TreeID: item.treeID?.toString() || '',
      SubquadratID: item.subquadratID?.toString() || '',
      StemNumber: item.stemNumber?.toString() || '',
      StemTag: item.stemTag || '',
      LocalX: item.localX?.toString() || '',
      LocalY: item.localY?.toString() || '',
      Moved: booleanToBit(item.moved!),
      Unit: item.unit || '',
      StemDescription: item.stemDescription || ''
    }));
  }

  mapData(results: StemResult[], indexOffset: number = 1): StemRDS[] {
    return results.map((item, index) => ({
      id: index + indexOffset,
      stemID: Number(item.StemID),
      treeID: Number(item.TreeID),
      subquadratID: Number(item.SubquadratID),
      stemNumber: Number(item.StemNumber),
      stemTag: String(item.StemTag),
      localX: Number(item.LocalX),
      localY: Number(item.LocalY),
      moved: bitToBoolean(item.Moved),
      unit: String(item.Unit),
      stemDescription: String(item.StemDescription)
    }));
  }
}

export const StemGridColumns: GridColDef[] = [
  // {field: 'stemID', headerName: 'StemID', headerClassName: 'header', flex: 1, align: 'left',},
  // {field: 'treeID', headerName: 'TreeID', headerClassName: 'header', flex: 1, align: 'left',},
  // {field: 'quadratID', headerName: 'QuadratID', headerClassName: 'header', flex: 1, align: 'left',},
  // {field: 'stemNumber', headerName: 'StemNumber', headerClassName: 'header', flex: 1, align: 'left',},
  { field: 'stemTag', headerName: 'Stem Tag', headerClassName: 'header', flex: 1, align: 'left', type: 'string', editable: true },
  { field: 'treeTag', headerName: 'Tree Tag', headerClassName: 'header', flex: 1, align: 'left', type: 'string', editable: true},
  { field: 'localX', headerName: 'Plot X', headerClassName: 'header', flex: 1, align: 'left', type: 'number', editable: true },
  { field: 'localY', headerName: 'Plot Y', headerClassName: 'header', flex: 1, align: 'left', type: 'number', editable: true},
  { field: 'unit', headerName: 'Unit', headerClassName: 'header', flex: 1, align: 'left', type: 'singleSelect', valueOptions: unitSelectionOptions, editable: true},
  { field: 'moved', headerName: 'Moved', headerClassName: 'header', flex: 1, align: 'left', type: 'boolean', editable: true},
  { field: 'stemDescription', headerName: 'StemDescription', headerClassName: 'header', flex: 1, align: 'left', type: 'string', editable: true},
];