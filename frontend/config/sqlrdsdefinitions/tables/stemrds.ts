// stem custom data type
import {IDataMapper} from "../../datamapper";
import {bitToBoolean, booleanToBit, unitSelectionOptions} from '../../macros';

export type StemRDS = {
  id?: number;
  stemID?: number;
  treeID?: number;
  quadratID?: number;
  stemNumber?: number;
  stemTag?: string;
  localX?: number;
  localY?: number;
  coordinateUnits?: string;
  moved?: boolean;
  stemDescription?: string;
};

export interface StemResult {
  StemID: any;
  TreeID: any;
  QuadratID: any;
  StemNumber: any;
  StemTag: any;
  LocalX: any;
  LocalY: any;
  CoordinateUnits: any;
  Moved: any;
  StemDescription: any;
}

export class StemsMapper implements IDataMapper<StemResult, StemRDS> {
  mapData(results: StemResult[], indexOffset: number = 1): StemRDS[] {
    return results.map((item, index) => ({
      id: index + indexOffset,
      stemID: item.StemID != null ? Number(item.StemID) : undefined,
      treeID: item.TreeID != null ? Number(item.TreeID) : undefined,
      quadratID: item.QuadratID != null ? Number(item.QuadratID) : undefined,
      stemNumber: item.StemNumber != null ? Number(item.StemNumber) : undefined,
      stemTag: item.StemTag != null ? String(item.StemTag) : undefined,
      localX: item.LocalX != null ? Number(item.LocalX) : undefined,
      localY: item.LocalY != null ? Number(item.LocalY) : undefined,
      moved: item.Moved != null ? bitToBoolean(item.Moved) : undefined,
      coordinateUnits: item.CoordinateUnits != null ? unitSelectionOptions.find(x => x === item.CoordinateUnits) : undefined,
      stemDescription: item.StemDescription != null ? String(item.StemDescription) : undefined,
    }));
  }

  demapData(results: StemRDS[]): StemResult[] {
    return results.map(item => ({
      StemID: item.stemID !== undefined ? String(item.stemID) : null,
      TreeID: item.treeID !== undefined ? String(item.treeID) : null,
      QuadratID: item.quadratID !== undefined ? String(item.quadratID) : null,
      StemNumber: item.stemNumber !== undefined ? String(item.stemNumber) : null,
      StemTag: item.stemTag !== undefined ? String(item.stemTag) : null,
      LocalX: item.localX !== undefined ? String(item.localX) : null,
      LocalY: item.localY !== undefined ? String(item.localY) : null,
      Moved: item.moved !== undefined ? booleanToBit(item.moved) : null,
      CoordinateUnits: item.coordinateUnits !== undefined ? item.coordinateUnits : null,
      StemDescription: item.stemDescription !== undefined ? String(item.stemDescription) : null,
    }));
  }
}

