import { GridColDef } from "@mui/x-data-grid";
import moment from "moment";
import { IDataMapper, parseDate } from "../../datamapper";

export interface MeasurementsSummaryResult {
  CoreMeasurementID: any;
  PlotID: any;
  PlotName: any;
  CensusID: any;
  StartDate: any;
  EndDate: any;
  QuadratID: any;
  QuadratName: any;
  SubquadratID: any;
  SubquadratName: any;
  TreeID: any;
  TreeTag: any;
  StemID: any;
  StemTag: any;
  StemLocalX: any;
  StemLocalY: any;
  StemUnits: any;
  PersonnelID: any;
  PersonnelName: any;
  MeasurementDate: any;
  MeasuredDBH: any;
  DBHUnits: any;
  MeasuredHOM: any;
  HOMUnits: any;
  Description: any;
  Attributes: any;
}

export type MeasurementsSummaryRDS = {
  id: number;
  coreMeasurementID: number;
  plotID: number | null;
  plotName: string | null;
  censusID: number | null;
  censusStartDate: any;
  censusEndDate: any;
  quadratID: number | null;
  quadratName: string | null;
  subquadratID: number | null;
  subquadratName: string | null;
  treeID: number | null;
  treeTag: string | null;
  stemID: number | null;
  stemTag: string | null;
  stemLocalX: number | null;
  stemLocalY: number | null;
  stemUnits: string | null;
  personnelID: number | null;
  personnelName: string | null;
  measurementDate: any;
  measuredDBH: number | null;
  dbhUnits: string | null;
  measuredHOM: number | null;
  homUnits: string | null;
  description: string | null;
  attributes: string | null;
};

export class MeasurementsSummaryMapper implements IDataMapper<MeasurementsSummaryResult, MeasurementsSummaryRDS> {
  demapData(results: MeasurementsSummaryRDS[]): MeasurementsSummaryResult[] {
    return results.map(item => ({
      CoreMeasurementID: item.coreMeasurementID,
      PlotID: item.plotID,
      PlotName: item.plotName,
      CensusID: item.censusID,
      StartDate: item.censusStartDate,
      EndDate: item.censusEndDate,
      QuadratID: item.quadratID,
      QuadratName: item.quadratName,
      SubquadratID: item.subquadratID,
      SubquadratName: item.subquadratName,
      TreeID: item.treeID,
      TreeTag: item.treeTag,
      StemID: item.stemID,
      StemTag: item.stemTag,
      StemLocalX: item.stemLocalX,
      StemLocalY: item.stemLocalY,
      StemUnits: item.stemUnits,
      PersonnelID: item.personnelID,
      PersonnelName: item.personnelName,
      MeasurementDate: item.measurementDate,
      MeasuredDBH: item.measuredDBH,
      DBHUnits: item.dbhUnits,
      MeasuredHOM: item.measuredHOM,
      HOMUnits: item.homUnits,
      Description: item.description,
      Attributes: item.attributes
    }));
  }
  mapData(results: MeasurementsSummaryResult[], indexOffset: number = 1): MeasurementsSummaryRDS[] {
    return results.map((item, index) => ({
      id: index + indexOffset,
      coreMeasurementID: Number(item.CoreMeasurementID),
      plotID: Number(item.PlotID),
      plotName: String(item.PlotName),
      censusID: Number(item.CensusID),
      censusStartDate: parseDate(item.StartDate),
      censusEndDate: parseDate(item.EndDate),
      quadratID: Number(item.QuadratID),
      quadratName: String(item.QuadratName),
      subquadratID: Number(item.SubquadratID),
      subquadratName: String(item.SubquadratName),
      treeID: Number(item.TreeID),
      treeTag: String(item.TreeTag),
      stemID: Number(item.StemID),
      stemTag: String(item.StemTag),
      stemLocalX: Number(item.StemLocalX),
      stemLocalY: Number(item.StemLocalY),
      stemUnits: String(item.StemUnits),
      personnelID: Number(item.PersonnelID),
      personnelName: String(item.PersonnelName),
      measurementDate: parseDate(item.MeasurementDate),
      measuredDBH: Number(item.MeasuredDBH),
      dbhUnits: String(item.DBHUnits),
      measuredHOM: Number(item.MeasuredHOM),
      homUnits: String(item.HOMUnits),
      description: String(item.Description),
      attributes: String(item.Attributes)
    }));
  }
}

export const MeasurementsSummaryGridColumns: GridColDef[] = [
  { field: 'coreMeasurementID', headerName: '#', headerClassName: 'header', flex: 1, align: 'left' },
  { field: 'quadratName', headerName: 'Quadrat', headerClassName: 'header', flex: 1, align: 'left', },
  { field: 'subquadratName', headerName: 'Subquadrat', headerClassName: 'header', flex: 1, align: 'left', },
  { field: 'treeTag', headerName: 'Tag', headerClassName: 'header', flex: 1, align: 'left', },
  { field: 'stemTag', headerName: 'Stem', headerClassName: 'header', flex: 1, align: 'left', },
  { field: 'stemLocalX', headerName: 'X', headerClassName: 'header', flex: 1, align: 'left', },
  { field: 'stemLocalY', headerName: 'Y', headerClassName: 'header', flex: 1, align: 'left', },
  { field: 'personnelName', headerName: 'Recording', headerClassName: 'header', flex: 1, align: 'left', },
  {
    field: 'measurementDate', headerName: 'Date', headerClassName: 'header', flex: 1,
    valueGetter: (value: any) => {
      // Check if the date is present and valid
      if (!value || !moment(value).isValid()) return '';
      // Format the date
      return new Date(value).toDateString();
    },
  },
  { field: 'measuredDBH', headerName: 'DBH', headerClassName: 'header', flex: 1, align: 'left', },
  { field: 'measuredHOM', headerName: 'HOM', headerClassName: 'header', flex: 1, align: 'left', },
  { field: 'description', headerName: 'Description', headerClassName: 'header', flex: 1, align: 'left', },
  { field: 'attributes', headerName: 'Attributes', headerClassName: 'header', flex: 1, align: 'left', },
];