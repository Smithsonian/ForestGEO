import { GridColDef } from '@mui/x-data-grid';
import { PersonnelRDS } from './personnelrds';
import MapperFactory, { IDataMapper } from "../../datamapper";
import { unitSelectionOptions } from '@/config/macros';
import { ValidationFunction, RowValidationErrors } from '@/config/macros/formdetails';

export type QuadratRDS = {
  id?: number;
  quadratID?: number;
  plotID?: number;
  // censusID?: number;
  quadratName?: string;
  startX?: number;
  startY?: number;
  dimensionX?: number;
  dimensionY?: number;
  area?: number;
  unit?: string;
  quadratShape?: string;
  // personnel?: PersonnelRDS[];
};

export interface QuadratRaw {
  quadratID: number;
  plotID: number;
  quadratName: string;
}

export type Quadrat = QuadratRDS | undefined;

export interface QuadratsResult {
  QuadratID: any;
  PlotID: any;
  // CensusID: any;
  QuadratName: any;
  StartX: any;
  StartY: any;
  DimensionX: any;
  DimensionY: any;
  Area: any;
  Unit: any;
  QuadratShape: any;
}

export const validateQuadratsRow: ValidationFunction = (row) => {
  const errors: RowValidationErrors = {};

  if (row['unit'] && !['km', 'hm', 'dam', 'm', 'dm', 'cm', 'mm'].includes(row['unit'])) {
    errors['unit'] = 'Invalid unit value.';
  }

  return Object.keys(errors).length > 0 ? errors : null;
};


export class QuadratsMapper implements IDataMapper<QuadratsResult, QuadratRDS> {
  mapData(results: any[], indexOffset: number = 1): QuadratRDS[] {
    return results.map((item, index) => ({
      id: index + indexOffset,
      quadratID: item.QuadratID != null ? Number(item.QuadratID) : undefined,
      plotID: item.PlotID != null ? Number(item.PlotID) : undefined,
      // censusID: item.CensusID != null ? Number(item.CensusID) : undefined,
      quadratName: item.QuadratName != null ? String(item.QuadratName) : undefined,
      startX: item.StartX != null ? Number(item.StartX) : undefined,
      startY: item.StartY != null ? Number(item.StartY) : undefined,
      dimensionX: item.DimensionX != null ? Number(item.DimensionX) : undefined,
      dimensionY: item.DimensionY != null ? Number(item.DimensionY) : undefined,
      area: item.Area != null ? Number(item.Area) : undefined,
      unit: item.Unit != null ? String(item.Unit) : undefined,
      quadratShape: item.QuadratShape != null ? String(item.QuadratShape) : undefined,
      // personnel: personnelWithId
    }));
  }

  demapData(results: QuadratRDS[]): any[] {
    return results.map(quadrat => ({
      QuadratID: quadrat.quadratID !== undefined ? Number(quadrat.quadratID) : null,
      PlotID: quadrat.plotID !== undefined ? Number(quadrat.plotID) : null,
      // CensusID: quadrat.censusID !== undefined ? Number(quadrat.censusID) : null,
      QuadratName: quadrat.quadratName !== undefined ? String(quadrat.quadratName) : null,
      StartX: quadrat.startX !== undefined ? Number(quadrat.startX) : null,
      StartY: quadrat.startY !== undefined ? Number(quadrat.startY) : null,
      DimensionX: quadrat.dimensionX !== undefined ? Number(quadrat.dimensionX) : null,
      DimensionY: quadrat.dimensionY !== undefined ? Number(quadrat.dimensionY) : null,
      Area: quadrat.area !== undefined ? Number(quadrat.area) : null,
      Unit: quadrat.unit !== undefined ? String(quadrat.unit) : null,
      QuadratShape: quadrat.quadratShape !== undefined ? String(quadrat.quadratShape) : null,
      // Personnel: JSON.stringify(quadrat.personnel)
    }));
  }
}


export const quadratsFields = [
  'quadratName',
  'dimensionX',
  'dimensionY',
  'area',
  'unit',
  'quadratShape',
];


export const QuadratsGridColumns: GridColDef[] = [
  { field: 'quadratID', headerName: 'ID', headerClassName: 'header', maxWidth: 50, align: 'left', editable: false },
  // {field: 'plotID', headerName: 'PlotID', headerClassName: 'header', flex: 1, align: 'left',},
  // {field: 'censusID', headerName: 'CensusID', headerClassName: 'header', flex: 1, align: 'left',},
  {
    field: 'quadratName',
    headerName: 'Name',
    headerClassName: 'header',
    flex: 1,
    minWidth: 140,
    align: 'left',
    type: 'string',
    editable: true
  },
  {
    field: 'dimensionX',
    headerName: 'X',
    headerClassName: 'header',
    flex: 1,
    minWidth: 125,
    align: 'left',
    type: 'number',
    editable: true
  },
  {
    field: 'dimensionY',
    headerName: 'Y',
    headerClassName: 'header',
    flex: 1,
    minWidth: 125,
    align: 'left',
    type: 'number',
    editable: true
  },
  { field: 'area', headerName: 'Area', headerClassName: 'header', flex: 1, minWidth: 125, align: 'left', type: 'number', editable: true },
  {
    field: 'unit', headerName: 'Unit', headerClassName: 'header', flex: 1, minWidth: 125, align: 'left', type: 'singleSelect',
    valueOptions: unitSelectionOptions, editable: true
  },
  {
    field: 'quadratShape',
    headerName: 'Shape',
    headerClassName: 'header',
    flex: 1,
    minWidth: 125,
    align: 'left',
    type: 'string',
    editable: true
  },
];