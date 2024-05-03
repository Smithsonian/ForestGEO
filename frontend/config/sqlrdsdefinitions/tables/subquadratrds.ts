import { GridColDef } from "@mui/x-data-grid";
import { IDataMapper } from "../../datamapper";
import { Templates } from "@/config/datagridhelpers";

export type SubQuadratRDS = {
  id: number;
  subquadratID: number;
  subquadratName: string;
  quadratID: number | null;
  dimensionX: number | null;
  dimensionY: number | null;
  x: number | null;
  y: number | null;
  unit: string | null;
  ordering: number | null;
}

export type Subquadrat = SubQuadratRDS | null;

export interface SubQuadratResult {
  SubquadratID: any;
  SubquadratName: any;
  QuadratID: any;
  DimensionX: any;
  DimensionY: any;
  X: any;
  Y: any;
  Unit: any;
  Ordering: any;
}

export class SubquadratsMapper implements IDataMapper<SubQuadratResult, SubQuadratRDS> {
  demapData(results: SubQuadratRDS[]): SubQuadratResult[] {
    return results.map(item => ({
      SubquadratID: item.subquadratID,
      SubquadratName: item.subquadratName,
      QuadratID: item.quadratID,
      DimensionX: item.dimensionX,
      DimensionY: item.dimensionY,
      X: item.x,
      Y: item.y,
      Unit: item.unit,
      Ordering: item.ordering
    }));


  }
  mapData(results: SubQuadratResult[], indexOffset: number = 1): SubQuadratRDS[] {
    return results.map((item, index) => ({
      id: index + indexOffset,
      subquadratID: Number(item.SubquadratID),
      subquadratName: String(item.SubquadratName),
      quadratID: Number(item.QuadratID),
      dimensionX: Number(item.DimensionX),
      dimensionY: Number(item.DimensionY),
      x: Number(item.X),
      y: Number(item.Y),
      unit: String(item.Unit),
      ordering: Number(item.Ordering)
    }));
  }
}

export const subquadratsFields = [
  'subquadratName',
  'dimensionX',
  'dimensionY',
  'x',
  'y',
  'unit',
  'ordering'
];

export const SubQuadratGridColumns: GridColDef[] = [
  { field: 'ordering', headerName: 'Order', headerClassName: 'header', flex: 1, align: 'left', editable: true },
  { field: 'subquadratName', headerName: 'Name', headerClassName: 'header', flex: 1, align: 'left', type: 'string', editable: true },
  { field: 'quadratID', headerName: 'Quadrat', headerClassName: 'header', flex: 1, align: 'left', editable: false },
  { field: 'dimensionX', headerName: 'X-Dimension', headerClassName: 'header', flex: 1, align: 'left', type: 'number', editable: true },
  { field: 'dimensionY', headerName: 'Y-Dimension', headerClassName: 'header', flex: 1, align: 'left', type: 'number', editable: true },
  { field: 'x', headerName: 'X', headerClassName: 'header', flex: 1, align: 'left', type: 'number', editable: true },
  { field: 'y', headerName: 'Y', headerClassName: 'header', flex: 1, align: 'left', type: 'number', editable: true },
  { field: 'unit', headerName: 'Units', headerClassName: 'header', flex: 1, align: 'left', type: 'number', editable: true },
];
