import { GridColDef } from '@mui/x-data-grid';
import { PersonnelRDS } from './personnelrds';
import MapperFactory, { IDataMapper } from "../../datamapper";
import { unitSelectionOptions } from '@/config/macros';

export type QuadratsRDS = {
  id: number;
  quadratID: number;
  plotID: number | null;
  censusID: number | null;
  quadratName: string | null;
  dimensionX: number | null;
  dimensionY: number | null;
  area: number | null;
  unit: string | null;
  quadratShape: string | null;
  personnel?: PersonnelRDS[];
};

export interface QuadratRaw {
  quadratID: number;
  plotID: number;
  quadratName: string;
}

export type Quadrat = QuadratRaw | null;

export interface QuadratsResult {
  QuadratID: any;
  PlotID: any;
  CensusID: any;
  QuadratName: any;
  DimensionX: any;
  DimensionY: any;
  Area: any;
  Unit: any;
  QuadratShape: any;
}

export class QuadratsMapper implements IDataMapper<any, QuadratsRDS> {
  demapData(results: QuadratsRDS[]): any[] {
    // Implement the demapData method to convert the QuadratsRDS array to a format suitable for the data source
    return results.map(quadrat => ({
      QuadratID: quadrat.quadratID,
      PlotID: quadrat.plotID,
      CensusID: quadrat.censusID,
      QuadratName: quadrat.quadratName,
      DimensionX: quadrat.dimensionX,
      DimensionY: quadrat.dimensionY,
      Area: quadrat.area,
      Unit: quadrat.unit,
      QuadratShape: quadrat.quadratShape,
      Personnel: JSON.stringify(quadrat.personnel)
    }));
  }

  mapData(results: any[], indexOffset: number = 1): QuadratsRDS[] {
    // Implement the mapData method to convert the data source format to the QuadratsRDS format
    return results.map((item, index) => {
      // Parse the personnel JSON, add 'id' property
      const personnelWithId: PersonnelRDS[] = item.personnel ? JSON.parse(`[${item.personnel}]`).map((p: any, idx: number) => ({
        id: idx + 1,
        personnelID: p.personnelID,
        firstName: p.firstName,
        lastName: p.lastName,
        role: p.role
      })) : [];

      return {
        id: index + indexOffset,
        quadratID: Number(item.QuadratID),
        plotID: Number(item.PlotID),
        censusID: Number(item.CensusID),
        quadratName: String(item.QuadratName),
        dimensionX: Number(item.DimensionX),
        dimensionY: Number(item.DimensionY),
        area: Number(item.Area),
        unit: String(item.Unit),
        quadratShape: String(item.QuadratShape),
        personnel: personnelWithId
      };
    });
  }
}

export const quadratsFields = [
  'quadratName',
  'dimensionX',
  'dimensionY',
  'area',
  'unit',
  'quadratShape',
  'personnel'
];


export const QuadratsGridColumns: GridColDef[] = [
  { field: 'quadratID', headerName: 'ID', headerClassName: 'header', maxWidth: 75, align: 'left', editable: false },
  // {field: 'plotID', headerName: 'PlotID', headerClassName: 'header', flex: 1, align: 'left',},
  // {field: 'censusID', headerName: 'CensusID', headerClassName: 'header', flex: 1, align: 'left',},
  {
    field: 'quadratName',
    headerName: 'Name',
    headerClassName: 'header',
    flex: 1,
    maxWidth: 140,
    align: 'left',
    type: 'string',
    editable: true
  },
  {
    field: 'dimensionX',
    headerName: 'X',
    headerClassName: 'header',
    flex: 1,
    maxWidth: 125,
    align: 'left',
    type: 'number',
    editable: true
  },
  {
    field: 'dimensionY',
    headerName: 'Y',
    headerClassName: 'header',
    flex: 1,
    maxWidth: 125,
    align: 'left',
    type: 'number',
    editable: true
  },
  { field: 'area', headerName: 'Area', headerClassName: 'header', flex: 1, maxWidth: 125, align: 'left', type: 'number', editable: true },
  { field: 'unit', headerName: 'Unit', headerClassName: 'header', flex: 1, maxWidth: 125, align: 'left', type: 'singleSelect', 
  valueOptions: unitSelectionOptions, editable: true },
  {
    field: 'quadratShape',
    headerName: 'Shape',
    headerClassName: 'header',
    flex: 1,
    maxWidth: 125,
    align: 'left',
    type: 'string',
    editable: true
  },
];