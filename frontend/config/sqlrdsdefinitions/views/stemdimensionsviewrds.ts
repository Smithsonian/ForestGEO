import {GridColDef, GridValidRowModel} from '@mui/x-data-grid';
import {IDataMapper, parseDate} from "../../datamapper";
import {ColumnStates} from '@/config/macros';

export type StemDimensionsViewRDS = {
  id?: number;
  stemID?: number;
  stemTag?: string;
  treeID?: number;
  treeTag?: string;
  stemLocalX?: number;
  stemLocalY?: number;
  stemUnits?: string;
  subquadratID?: number;
  subquadratName?: string;
  subquadratDimensionX?: number;
  subquadratDimensionY?: number;
  subquadratX?: number;
  subquadratY?: number;
  subquadratUnits?: string;
  subquadratOrderPosition?: number;
  quadratID?: number;
  quadratName?: string;
  quadratDimensionX?: number;
  quadratDimensionY?: number;
  quadratUnits?: string;
  censusID?: number;
  plotCensusNumber?: number;
  startDate?: Date;
  endDate?: Date;
  plotID?: number;
  plotName?: string;
  locationName?: string;
  countryName?: string;
  plotDimensionX?: number;
  plotDimensionY?: number;
  plotGlobalX?: number;
  plotGlobalY?: number;
  plotGlobalZ?: number;
  plotUnits?: string;
};

export interface StemDimensionsViewResult {
  StemID: any;
  StemTag: any;
  TreeID: any;
  TreeTag: any;
  StemLocalX: any;
  StemLocalY: any;
  StemUnits: any;
  SubquadratID: any;
  SubquadratName: any;
  SubquadratDimensionX: any;
  SubquadratDimensionY: any;
  SubquadratX: any;
  SubquadratY: any;
  SubquadratUnits: any;
  SubquadratOrderPosition: any;
  QuadratID: any;
  QuadratName: any;
  QuadratDimensionX: any;
  QuadratDimensionY: any;
  QuadratUnits: any;
  CensusID: any;
  PlotCensusNumber: any;
  StartDate: any;
  EndDate: any;
  PlotID: any;
  PlotName: any;
  LocationName: any;
  CountryName: any;
  PlotDimensionX: any;
  PlotDimensionY: any;
  PlotGlobalX: any;
  PlotGlobalY: any;
  PlotGlobalZ: any;
  PlotUnits: any;
}

export class StemDimensionsMapper implements IDataMapper<StemDimensionsViewResult, StemDimensionsViewRDS> {
  demapData(results: StemDimensionsViewRDS[]): StemDimensionsViewResult[] {
    return results.map((item) => ({
      StemID: item.stemID != null ? String(item.stemID) : null,
      StemTag: item.stemTag != null ? String(item.stemTag) : null,
      TreeID: item.treeID != null ? String(item.treeID) : null,
      TreeTag: item.treeTag != null ? String(item.treeTag) : null,
      StemLocalX: item.stemLocalX != null ? String(item.stemLocalX) : null,
      StemLocalY: item.stemLocalY != null ? String(item.stemLocalY) : null,
      StemUnits: item.stemUnits != null ? String(item.stemUnits) : null,
      SubquadratID: item.subquadratID != null ? String(item.subquadratID) : null,
      SubquadratName: item.subquadratName != null ? String(item.subquadratName) : null,
      SubquadratDimensionX: item.subquadratDimensionX != null ? String(item.subquadratDimensionX) : null,
      SubquadratDimensionY: item.subquadratDimensionY != null ? String(item.subquadratDimensionY) : null,
      SubquadratX: item.subquadratX != null ? String(item.subquadratX) : null,
      SubquadratY: item.subquadratY != null ? String(item.subquadratY) : null,
      SubquadratUnits: item.subquadratUnits != null ? String(item.subquadratUnits) : null,
      SubquadratOrderPosition: item.subquadratOrderPosition != null ? String(item.subquadratOrderPosition) : null,
      QuadratID: item.quadratID != null ? String(item.quadratID) : null,
      QuadratName: item.quadratName != null ? String(item.quadratName) : null,
      QuadratDimensionX: item.quadratDimensionX != null ? String(item.quadratDimensionX) : null,
      QuadratDimensionY: item.quadratDimensionY != null ? String(item.quadratDimensionY) : null,
      QuadratUnits: item.quadratUnits != null ? String(item.quadratUnits) : null,
      CensusID: item.censusID != null ? String(item.censusID) : null,
      PlotCensusNumber: item.plotCensusNumber != null ? String(item.plotCensusNumber) : null,
      StartDate: item.startDate != null ? item.startDate.toISOString() : null,
      EndDate: item.endDate != null ? item.endDate.toISOString() : null,
      PlotID: item.plotID != null ? String(item.plotID) : null,
      PlotName: item.plotName != null ? String(item.plotName) : null,
      LocationName: item.locationName != null ? String(item.locationName) : null,
      CountryName: item.countryName != null ? String(item.countryName) : null,
      PlotDimensionX: item.plotDimensionX != null ? String(item.plotDimensionX) : null,
      PlotDimensionY: item.plotDimensionY != null ? String(item.plotDimensionY) : null,
      PlotGlobalX: item.plotGlobalX != null ? String(item.plotGlobalX) : null,
      PlotGlobalY: item.plotGlobalY != null ? String(item.plotGlobalY) : null,
      PlotGlobalZ: item.plotGlobalZ != null ? String(item.plotGlobalZ) : null,
      PlotUnits: item.plotUnits != null ? String(item.plotUnits) : null,
    }));
  }

  mapData(results: StemDimensionsViewResult[], indexOffset: number = 1): StemDimensionsViewRDS[] {
    return results.map((item, index) => ({
      id: index + indexOffset,
      stemID: item.StemID != null ? Number(item.StemID) : undefined,
      stemTag: item.StemTag != null ? String(item.StemTag) : undefined,
      treeID: item.TreeID != null ? Number(item.TreeID) : undefined,
      treeTag: item.TreeTag != null ? String(item.TreeTag) : undefined,
      stemLocalX: item.StemLocalX != null ? Number(item.StemLocalX) : undefined,
      stemLocalY: item.StemLocalY != null ? Number(item.StemLocalY) : undefined,
      stemUnits: item.StemUnits != null ? String(item.StemUnits) : undefined,
      subquadratID: item.SubquadratID != null ? Number(item.SubquadratID) : undefined,
      subquadratName: item.SubquadratName != null ? String(item.SubquadratName) : undefined,
      subquadratDimensionX: item.SubquadratDimensionX != null ? Number(item.SubquadratDimensionX) : undefined,
      subquadratDimensionY: item.SubquadratDimensionY != null ? Number(item.SubquadratDimensionY) : undefined,
      subquadratX: item.SubquadratX != null ? Number(item.SubquadratX) : undefined,
      subquadratY: item.SubquadratY != null ? Number(item.SubquadratY) : undefined,
      subquadratUnits: item.SubquadratUnits != null ? String(item.SubquadratUnits) : undefined,
      subquadratOrderPosition: item.SubquadratOrderPosition != null ? Number(item.SubquadratOrderPosition) : undefined,
      quadratID: item.QuadratID != null ? Number(item.QuadratID) : undefined,
      quadratName: item.QuadratName != null ? String(item.QuadratName) : undefined,
      quadratDimensionX: item.QuadratDimensionX != null ? Number(item.QuadratDimensionX) : undefined,
      quadratDimensionY: item.QuadratDimensionY != null ? Number(item.QuadratDimensionY) : undefined,
      quadratUnits: item.QuadratUnits != null ? String(item.QuadratUnits) : undefined,
      censusID: item.CensusID != null ? Number(item.CensusID) : undefined,
      plotCensusNumber: item.PlotCensusNumber != null ? Number(item.PlotCensusNumber) : undefined,
      startDate: item.StartDate != null ? parseDate(item.StartDate) : undefined,
      endDate: item.EndDate != null ? parseDate(item.EndDate) : undefined,
      plotID: item.PlotID != null ? Number(item.PlotID) : undefined,
      plotName: item.PlotName != null ? String(item.PlotName) : undefined,
      locationName: item.LocationName != null ? String(item.LocationName) : undefined,
      countryName: item.CountryName != null ? String(item.CountryName) : undefined,
      plotDimensionX: item.PlotDimensionX != null ? Number(item.PlotDimensionX) : undefined,
      plotDimensionY: item.PlotDimensionY != null ? Number(item.PlotDimensionY) : undefined,
      plotGlobalX: item.PlotGlobalX != null ? Number(item.PlotGlobalX) : undefined,
      plotGlobalY: item.PlotGlobalY != null ? Number(item.PlotGlobalY) : undefined,
      plotGlobalZ: item.PlotGlobalZ != null ? Number(item.PlotGlobalZ) : undefined,
      plotUnits: item.PlotUnits != null ? String(item.PlotUnits) : undefined,
    }));
  }
}

export function getStemDimensionsViewHCs(): ColumnStates {
  return {
    treeID: false,
    subquadratID: false,
    quadratID: false,
    censusID: false,
    plotCensusNumber: false,
    startDate: false,
    endDate: false,
    plotID: false,
    plotName: false,
  };
}

export const StemDimensionsGridColumns: GridColDef[] = [
  {field: 'stemID', headerName: '#', headerClassName: 'header', flex: 1, align: 'left'},
  {field: 'stemTag', headerName: 'Stem Tag', headerClassName: 'header', flex: 1, align: 'left'},
  {field: 'treeID', headerName: 'Tree ID', headerClassName: 'header', flex: 1, align: 'left'},
  {field: 'treeTag', headerName: 'Tree Tag', headerClassName: 'header', flex: 1, align: 'left'},
  {field: 'stemLocalX', headerName: 'Stem Local X', headerClassName: 'header', flex: 1, align: 'left'},
  {field: 'stemLocalY', headerName: 'Stem Local Y', headerClassName: 'header', flex: 1, align: 'left'},
  {field: 'stemUnits', headerName: 'Stem Units', headerClassName: 'header', flex: 1, align: 'left'},
  {field: 'subquadratID', headerName: 'Subquadrat ID', headerClassName: 'header', flex: 1, align: 'left'},
  {field: 'subquadratName', headerName: 'Subquadrat Name', headerClassName: 'header', flex: 1, align: 'left'},
  {field: 'subquadratDimensionX', headerName: 'Subquadrat Dim X', headerClassName: 'header', flex: 1, align: 'left'},
  {field: 'subquadratDimensionY', headerName: 'Subquadrat Dim Y', headerClassName: 'header', flex: 1, align: 'left'},
  {field: 'subquadratX', headerName: 'Subquadrat X', headerClassName: 'header', flex: 1, align: 'left'},
  {field: 'subquadratY', headerName: 'Subquadrat Y', headerClassName: 'header', flex: 1, align: 'left'},
  {field: 'subquadratUnits', headerName: 'Subquadrat Units', headerClassName: 'header', flex: 1, align: 'left'},
  {
    field: 'subquadratOrderPosition',
    headerName: 'Subquadrat Order Position',
    headerClassName: 'header',
    flex: 1,
    align: 'left'
  },
  {field: 'quadratID', headerName: 'Quadrat ID', headerClassName: 'header', flex: 1, align: 'left'},
  {field: 'quadratName', headerName: 'Quadrat Name', headerClassName: 'header', flex: 1, align: 'left'},
  {field: 'quadratDimensionX', headerName: 'QDimX', headerClassName: 'header', flex: 1, align: 'left'},
  {field: 'quadratDimensionY', headerName: 'QDimY', headerClassName: 'header', flex: 1, align: 'left'},
  {field: 'quadratUnits', headerName: 'Quadrat Units', headerClassName: 'header', flex: 1, align: 'left'},
  {field: 'censusID', headerName: 'Census ID', headerClassName: 'header', flex: 1, align: 'left'},
  {field: 'plotCensusNumber', headerName: 'Plot Census Number', headerClassName: 'header', flex: 1, align: 'left'},
  {field: 'startDate', headerName: 'Start Date', headerClassName: 'header', flex: 1, align: 'left'},
  {field: 'endDate', headerName: 'End Date', headerClassName: 'header', flex: 1, align: 'left'},
  {field: 'plotID', headerName: 'Plot ID', headerClassName: 'header', flex: 1, align: 'left'},
  {field: 'plotName', headerName: 'Plot', headerClassName: 'header', flex: 1, align: 'left'},
  {field: 'locationName', headerName: 'Location', headerClassName: 'header', flex: 1, align: 'left'},
  {field: 'countryName', headerName: 'Country', headerClassName: 'header', flex: 1, align: 'left'},
  {field: 'plotDimensionX', headerName: 'Plot Dim X', headerClassName: 'header', flex: 1, align: 'left'},
  {field: 'plotDimensionY', headerName: 'Plot Dim Y', headerClassName: 'header', flex: 1, align: 'left'},
  {field: 'plotGlobalX', headerName: 'Plot Global X', headerClassName: 'header', flex: 1, align: 'left'},
  {field: 'plotGlobalY', headerName: 'Plot Global Y', headerClassName: 'header', flex: 1, align: 'left'},
  {field: 'plotGlobalZ', headerName: 'Plot Global Z', headerClassName: 'header', flex: 1, align: 'left'},
  {field: 'plotUnits', headerName: 'Plot Units', headerClassName: 'header', flex: 1, align: 'left'},
];
