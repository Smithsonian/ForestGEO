import {GridColDef} from '@mui/x-data-grid';
import { IDataMapper, parseDate } from "../../datamapper";
import { bitToBoolean, booleanToBit, unitSelectionOptions } from '@/config/macros';

export type CoreMeasurementsRDS = {
  id: number;
  coreMeasurementID: number;
  censusID: number | null;
  plotID: number | null;
  quadratID: number | null;
  subquadratID: number | null;
  treeID: number | null;
  stemID: number | null;
  personnelID: number | null;
  isValidated: boolean | null;
  measurementDate: Date | null;
  measuredDBH: number | null;
  dbhUnit: string | null;
  measuredHOM: number | null;
  homUnit: string | null;
  description: string | null;
  userDefinedFields: string | null;
};

export interface CoreMeasurementsResult {
  CoreMeasurementID: any;
  CensusID: any;
  PlotID: any;
  QuadratID: any;
  SubquadratID: any;
  TreeID: any;
  StemID: any;
  PersonnelID: any;
  IsValidated: any;
  MeasurementDate: any;
  MeasuredDBH: any;
  DBHUnit: any;
  MeasuredHOM: any;
  HOMUnit: any;
  Description: any;
  UserDefinedFields: any;
}

export class CoreMeasurementsMapper implements IDataMapper<CoreMeasurementsResult, CoreMeasurementsRDS> {
  mapData(results: CoreMeasurementsResult[], indexOffset: number = 1): CoreMeasurementsRDS[] {
    return results.map((item, index) => ({
      id: index + indexOffset,
      coreMeasurementID: Number(item.CoreMeasurementID),
      censusID: Number(item.CensusID),
      plotID: Number(item.PlotID),
      quadratID: Number(item.QuadratID),
      subquadratID: Number(item.SubquadratID),
      treeID: Number(item.TreeID),
      stemID: Number(item.StemID),
      personnelID: Number(item.PersonnelID),
      isValidated: bitToBoolean(item.IsValidated),
      measurementDate: parseDate(item.MeasurementDate),
      measuredDBH: Number(item.MeasuredDBH),
      dbhUnit: String(item.DBHUnit),
      measuredHOM: Number(item.MeasuredHOM),
      homUnit: String(item.HOMUnit),
      description: item.Description,
      userDefinedFields: item.UserDefinedFields,
    }));
  }
   demapData(results: CoreMeasurementsRDS[]): CoreMeasurementsResult[] {
      return results.map((item) => ({
        CoreMeasurementID: Number(item.coreMeasurementID),
        CensusID: Number(item.censusID),
        PlotID: Number(item.plotID),
        QuadratID: Number(item.quadratID),
        SubquadratID: Number(item.subquadratID),
        TreeID: Number(item.treeID),
        StemID: Number(item.stemID),
        PersonnelID: Number(item.personnelID),
        IsValidated: booleanToBit(item.isValidated!),
        MeasurementDate: item.measurementDate ? parseDate(item.measurementDate) : null,
        MeasuredDBH: Number(item.measuredDBH),
        DBHUnit: String(item.dbhUnit),
        MeasuredHOM: Number(item.measuredHOM),
        HOMUnit: String(item.homUnit),
        Description: String(item.description),
        UserDefinedFields: String(item.userDefinedFields)
      }));
   }
}

export const CoreMeasurementsGridColumns: GridColDef[] = [
  {field: 'coreMeasurementID', headerName: 'CMID', headerClassName: 'header', flex: 1, align: 'left', editable: false},
  {field: 'censusID', headerName: 'CensusID', headerClassName: 'header', flex: 1, align: 'left', editable: false},
  {field: 'plotID', headerName: 'PlotID', headerClassName: 'header', flex: 1, align: 'left', editable: false},
  {field: 'quadratID', headerName: 'QuadratID', headerClassName: 'header', flex: 1, align: 'left', editable: false},
  {field: 'subQuadratID', headerName: 'SubQuadratID', headerClassName: 'header', flex: 1, align: 'left', editable: false},
  {field: 'treeID', headerName: 'TreeID', headerClassName: 'header', flex: 1, align: 'left', editable: false},
  {field: 'stemID', headerName: 'StemID', headerClassName: 'header', flex: 1, align: 'left', editable: false},
  {field: 'personnelID', headerName: 'PersonnelID', headerClassName: 'header', flex: 1, align: 'left', editable: false},
  {field: 'isValidated', headerName: 'IsValidated', headerClassName: 'header', flex: 1, align: 'left', editable: false},
  {
    field: 'measurementDate',
    headerName: 'MeasurementDate',
    type: "date",
    headerClassName: 'header',
    flex: 1,
    valueGetter: (params: any) => {
      if (!params.value) return null;
      return new Date(params.value);
    }, 
    editable: true
  },
  {field: 'measuredDBH', headerName: 'DBH', headerClassName: 'header', flex: 1, align: 'left'},
  {field: 'dbhUnit', headerName: '<- Unit', headerClassName: 'header', flex: 1, align: 'left', editable: true, type: 'singleSelect', valueOptions: unitSelectionOptions,},
  {field: 'measuredHOM', headerName: 'HOM', headerClassName: 'header', flex: 1, align: 'left'},
  {field: 'homUnit', headerName: '<- Unit', headerClassName: 'header', flex: 1, align: 'left', editable: true, type: 'singleSelect', valueOptions: unitSelectionOptions,},
  {field: 'description', headerName: 'Description', headerClassName: 'header', flex: 1, align: 'left'},
];

export const coreMeasurementsFields = [
  'censusID',
  'plotID',
  'quadratID',
  'treeID',
  'stemID',
  'personnelID',
  'isValidated',
  'measurementDate',
  'measuredDBH',
  'measuredHOM',
  'description',
  'userDefinedFields'
];

