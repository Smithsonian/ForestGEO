import { GridColDef } from '@mui/x-data-grid';
import { IDataMapper } from "../../datamapper";
import { bitToBoolean, booleanToBit, unitSelectionOptions } from '../../macros';


export type StemRDS = {
  id?: number;
  stemID?: number;
  treeID?: number;
  subquadratID?: number;
  stemNumber?: number;
  stemTag?: string;
  localX?: number;
  localY?: number;
  unit?: string;
  moved?: boolean;
  stemDescription?: string;
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
  mapData(results: StemResult[], indexOffset: number = 1): StemRDS[] {
    return results.map((item, index) => ({
      id: index + indexOffset,
      stemID: item.StemID != null ? Number(item.StemID) : undefined,
      treeID: item.TreeID != null ? Number(item.TreeID) : undefined,
      subquadratID: item.SubquadratID != null ? Number(item.SubquadratID) : undefined,
      stemNumber: item.StemNumber != null ? Number(item.StemNumber) : undefined,
      stemTag: item.StemTag != null ? String(item.StemTag) : undefined,
      localX: item.LocalX != null ? Number(item.LocalX) : undefined,
      localY: item.LocalY != null ? Number(item.LocalY) : undefined,
      moved: item.Moved != null ? bitToBoolean(item.Moved) : undefined,
      unit: item.Unit != null ? String(item.Unit) : undefined,
      stemDescription: item.StemDescription != null ? String(item.StemDescription) : undefined,
    }));
  }

  demapData(results: StemRDS[]): StemResult[] {
    return results.map(item => ({
      StemID: item.stemID != null ? String(item.stemID) : null,
      TreeID: item.treeID != null ? String(item.treeID) : null,
      SubquadratID: item.subquadratID != null ? String(item.subquadratID) : null,
      StemNumber: item.stemNumber != null ? String(item.stemNumber) : null,
      StemTag: item.stemTag != null ? String(item.stemTag) : null,
      LocalX: item.localX != null ? String(item.localX) : null,
      LocalY: item.localY != null ? String(item.localY) : null,
      Moved: item.moved != null ? booleanToBit(item.moved) : null,
      Unit: item.unit != null ? String(item.unit) : null,
      StemDescription: item.stemDescription != null ? String(item.stemDescription) : null,
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