import { GridColDef } from "@mui/x-data-grid";
import { IDataMapper } from "../../datamapper";
import { Templates } from "@/config/datagridhelpers";
import { unitSelectionOptions } from "@/config/macros";
import { ValidationFunction, RowValidationErrors } from "@/config/macros/formdetails";

export type SubquadratRDS = {
  id?: number;
  subquadratID?: number;
  subquadratName?: string;
  quadratID?: number;
  dimensionX?: number;
  dimensionY?: number;
  x?: number;
  y?: number;
  unit?: string;
  ordering?: number;
};

export type Subquadrat = SubquadratRDS | undefined;

export interface SubquadratResult {
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

export const validateSubquadratsRow: ValidationFunction = (row) => {
  const errors: RowValidationErrors = {};

  if (row['unit'] && !['km', 'hm', 'dam', 'm', 'dm', 'cm', 'mm'].includes(row['unit'])) {
    errors['unit'] = 'Invalid unit value.';
  }

  return Object.keys(errors).length > 0 ? errors : null;
};

export class SubquadratsMapper implements IDataMapper<SubquadratResult, SubquadratRDS> {
  demapData(results: SubquadratRDS[]): SubquadratResult[] {
    return results.map(item => ({
      SubquadratID: item.subquadratID != null ? String(item.subquadratID) : null,
      SubquadratName: item.subquadratName != null ? String(item.subquadratName) : null,
      QuadratID: item.quadratID != null ? String(item.quadratID) : null,
      DimensionX: item.dimensionX != null ? String(item.dimensionX) : null,
      DimensionY: item.dimensionY != null ? String(item.dimensionY) : null,
      X: item.x != null ? String(item.x) : null,
      Y: item.y != null ? String(item.y) : null,
      Unit: item.unit != null ? String(item.unit) : null,
      Ordering: item.ordering != null ? String(item.ordering) : null,
    }));
  }

  mapData(results: SubquadratResult[], indexOffset: number = 1): SubquadratRDS[] {
    return results.map((item, index) => ({
      id: index + indexOffset,
      subquadratID: item.SubquadratID != null ? Number(item.SubquadratID) : undefined,
      subquadratName: item.SubquadratName != null ? String(item.SubquadratName) : undefined,
      quadratID: item.QuadratID != null ? Number(item.QuadratID) : undefined,
      dimensionX: item.DimensionX != null ? Number(item.DimensionX) : undefined,
      dimensionY: item.DimensionY != null ? Number(item.DimensionY) : undefined,
      x: item.X != null ? Number(item.X) : undefined,
      y: item.Y != null ? Number(item.Y) : undefined,
      unit: item.Unit != null ? String(item.Unit) : undefined,
      ordering: item.Ordering != null ? Number(item.Ordering) : undefined,
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

export const SubquadratGridColumns: GridColDef[] = [
  { field: 'ordering', headerName: 'Order', headerClassName: 'header', flex: 1, align: 'left', editable: false },
  { field: 'subquadratName', headerName: 'Name', headerClassName: 'header', flex: 1, align: 'left', type: 'string', editable: true },
  { field: 'quadratID', headerName: 'Quadrat', headerClassName: 'header', flex: 1, align: 'left', editable: false },
  { field: 'dimensionX', headerName: 'X-Dimension', headerClassName: 'header', flex: 1, align: 'left', type: 'number', editable: true },
  { field: 'dimensionY', headerName: 'Y-Dimension', headerClassName: 'header', flex: 1, align: 'left', type: 'number', editable: true },
  { field: 'x', headerName: 'X', headerClassName: 'header', flex: 1, align: 'left', type: 'number', editable: true },
  { field: 'y', headerName: 'Y', headerClassName: 'header', flex: 1, align: 'left', type: 'number', editable: true },
  { field: 'unit', headerName: 'Units', headerClassName: 'header', flex: 1, align: 'left', type: 'singleSelect', valueOptions: unitSelectionOptions, editable: true },
];
