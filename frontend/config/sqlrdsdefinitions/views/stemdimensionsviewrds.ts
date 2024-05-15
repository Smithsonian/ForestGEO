import {GridColDef, GridValidRowModel} from '@mui/x-data-grid';
import {IDataMapper, parseDate} from "../../datamapper";

export type StemDimensionsViewRDS = {
  id: number;
  stemID: number;
  stemTag: string;
  treeID: number;
  treeTag: string;
  stemLocalX: number | null;
  stemLocalY: number | null;
  stemUnits: string | null;
  subquadratID: number | null;
  subquadratName: string | null;
  subquadratDimensionX: number | null;
  subquadratDimensionY: number | null;
  subquadratX: number | null;
  subquadratY: number | null;
  subquadratUnits: string | null;
  subquadratOrderPosition: number | null;
  quadratID: number | null;
  quadratName: string | null;
  quadratDimensionX: number | null;
  quadratDimensionY: number | null;
  quadratUnits: string | null;
  censusID: number | null;
  plotCensusNumber: number | null;
  startDate: Date | null;
  endDate: Date | null;
  plotID: number | null;
  plotName: string | null;
  locationName: string | null;
  countryName: string | null;
  plotDimensionX: number | null;
  plotDimensionY: number | null;
  plotGlobalX: number | null;
  plotGlobalY: number | null;
  plotGlobalZ: number | null;
  plotUnits: string | null;
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
      StemID: item.stemID,
      StemTag: item.stemTag,
      TreeID: item.treeID,
      TreeTag: item.treeTag,
      StemLocalX: item.stemLocalX,
      StemLocalY: item.stemLocalY,
      StemUnits: item.stemUnits,
      SubquadratID: item.subquadratID,
      SubquadratName: item.subquadratName,
      SubquadratDimensionX: item.subquadratDimensionX,
      SubquadratDimensionY: item.subquadratDimensionY,
      SubquadratX: item.subquadratX,
      SubquadratY: item.subquadratY,
      SubquadratUnits: item.subquadratUnits,
      SubquadratOrderPosition: item.subquadratOrderPosition,
      QuadratID: item.quadratID,
      QuadratName: item.quadratName,
      QuadratDimensionX: item.quadratDimensionX,
      QuadratDimensionY: item.quadratDimensionY,
      QuadratUnits: item.quadratUnits,
      CensusID: item.censusID,
      PlotCensusNumber: item.plotCensusNumber,
      StartDate: item.startDate,
      EndDate: item.endDate,
      PlotID: item.plotID,
      PlotName: item.plotName,
      LocationName: item.locationName,
      CountryName: item.countryName,
      PlotDimensionX: item.plotDimensionX,
      PlotDimensionY: item.plotDimensionY,
      PlotGlobalX: item.plotGlobalX,
      PlotGlobalY: item.plotGlobalY,
      PlotGlobalZ: item.plotGlobalZ,
      PlotUnits: item.plotUnits
    }));
  }

  mapData(results: StemDimensionsViewResult[], indexOffset: number = 1): StemDimensionsViewRDS[] {
    return results.map((item, index) => ({
      id: index + indexOffset,
      stemID: Number(item.StemID),
      stemTag: String(item.StemTag),
      treeID: Number(item.TreeID),
      treeTag: String(item.TreeTag),
      stemLocalX: Number(item.StemLocalX),
      stemLocalY: Number(item.StemLocalY),
      stemUnits: String(item.StemUnits),
      subquadratID: Number(item.SubquadratID),
      subquadratName: String(item.SubquadratName),
      subquadratDimensionX: Number(item.SubquadratDimensionX),
      subquadratDimensionY: Number(item.SubquadratDimensionY),
      subquadratX: Number(item.SubquadratX),
      subquadratY: Number(item.SubquadratY),
      subquadratUnits: String(item.SubquadratUnits),
      subquadratOrderPosition: Number(item.SubquadratOrderPosition),
      quadratID: Number(item.QuadratID),
      quadratName: String(item.QuadratName),
      quadratDimensionX: Number(item.QuadratDimensionX),
      quadratDimensionY: Number(item.QuadratDimensionY),
      quadratUnits: String(item.QuadratUnits),
      censusID: Number(item.CensusID),
      plotCensusNumber: Number(item.PlotCensusNumber),
      startDate: parseDate(item.StartDate),
      endDate: parseDate(item.EndDate),
      plotID: Number(item.PlotID),
      plotName: String(item.PlotName),
      locationName: String(item.LocationName),
      countryName: String(item.CountryName),
      plotDimensionX: Number(item.PlotDimensionX),
      plotDimensionY: Number(item.PlotDimensionY),
      plotGlobalX: Number(item.PlotGlobalX),
      plotGlobalY: Number(item.PlotGlobalY),
      plotGlobalZ: Number(item.PlotGlobalZ),
      plotUnits: String(item.PlotUnits)
    }));
  }
}

export const StemDimensionsGridColumns: GridColDef[] = [
  {field: 'stemID', headerName: '#', headerClassName: 'header', flex: 1, align: 'left'},
  {field: 'stemTag', headerName: 'Stem', headerClassName: 'header', flex: 1, align: 'left'},
  {field: 'treeTag', headerName: 'Tree', headerClassName: 'header', flex: 1, align: 'left'},
  {field: 'quadratName', headerName: 'Quadrat', headerClassName: 'header', flex: 1, align: 'left'},
  {field: 'plotName', headerName: 'Plot', headerClassName: 'header', flex: 1, align: 'left'},
  {field: 'locationName', headerName: 'Location', headerClassName: 'header', flex: 1, align: 'left'},
  {field: 'countryName', headerName: 'Country', headerClassName: 'header', flex: 1, align: 'left'},
  {field: 'quadratDimensionX', headerName: 'QDimX', headerClassName: 'header', flex: 1, align: 'left'},
  {field: 'quadratDimensionY', headerName: 'QDimY', headerClassName: 'header', flex: 1, align: 'left'},
  {field: 'stemQuadX', headerName: 'SQuadX', headerClassName: 'header', flex: 1, align: 'left'},
  {field: 'stemQuadY', headerName: 'SQuadY', headerClassName: 'header', flex: 1, align: 'left'},
  {field: 'stemDescription', headerName: 'Description', headerClassName: 'header', flex: 1, align: 'left'},
];
