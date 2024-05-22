import { GridColDef } from '@mui/x-data-grid';
import { IDataMapper, parseDate } from "../../datamapper";
import { bitToBoolean, booleanToBit, unitSelectionOptions } from '@/config/macros';

export type CoreMeasurementsRDS = {
  id?: number;
  coreMeasurementID?: number;
  censusID?: number;
  plotID?: number;
  quadratID?: number;
  subquadratID?: number;
  treeID?: number;
  stemID?: number;
  personnelID?: number;
  isValidated?: boolean;
  measurementDate?: Date;
  measuredDBH?: number;
  dbhUnit?: string;
  measuredHOM?: number;
  homUnit?: string;
  description?: string;
  userDefinedFields?: string;
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
      coreMeasurementID: item.CoreMeasurementID != null ? Number(item.CoreMeasurementID) : undefined,
      censusID: item.CensusID != null ? Number(item.CensusID) : undefined,
      plotID: item.PlotID != null ? Number(item.PlotID) : undefined,
      quadratID: item.QuadratID != null ? Number(item.QuadratID) : undefined,
      subquadratID: item.SubquadratID != null ? Number(item.SubquadratID) : undefined,
      treeID: item.TreeID != null ? Number(item.TreeID) : undefined,
      stemID: item.StemID != null ? Number(item.StemID) : undefined,
      personnelID: item.PersonnelID != null ? Number(item.PersonnelID) : undefined,
      isValidated: item.IsValidated != null ? bitToBoolean(item.IsValidated) : undefined,
      measurementDate: item.MeasurementDate != null ? parseDate(item.MeasurementDate) : undefined,
      measuredDBH: item.MeasuredDBH != null ? Number(item.MeasuredDBH) : undefined,
      dbhUnit: item.DBHUnit != null ? String(item.DBHUnit) : undefined,
      measuredHOM: item.MeasuredHOM != null ? Number(item.MeasuredHOM) : undefined,
      homUnit: item.HOMUnit != null ? String(item.HOMUnit) : undefined,
      description: item.Description != null ? String(item.Description) : undefined,
      userDefinedFields: item.UserDefinedFields != null ? String(item.UserDefinedFields) : undefined,
    }));
  }

  demapData(results: CoreMeasurementsRDS[]): CoreMeasurementsResult[] {
    return results.map((item) => ({
      CoreMeasurementID: item.coreMeasurementID != null ? Number(item.coreMeasurementID) : null,
      CensusID: item.censusID != null ? Number(item.censusID) : null,
      PlotID: item.plotID != null ? Number(item.plotID) : null,
      QuadratID: item.quadratID != null ? Number(item.quadratID) : null,
      SubquadratID: item.subquadratID != null ? Number(item.subquadratID) : null,
      TreeID: item.treeID != null ? Number(item.treeID) : null,
      StemID: item.stemID != null ? Number(item.stemID) : null,
      PersonnelID: item.personnelID != null ? Number(item.personnelID) : null,
      IsValidated: item.isValidated != null ? booleanToBit(item.isValidated) : null,
      MeasurementDate: item.measurementDate != null ? item.measurementDate.toISOString() : null,
      MeasuredDBH: item.measuredDBH != null ? Number(item.measuredDBH) : null,
      DBHUnit: item.dbhUnit != null ? String(item.dbhUnit) : null,
      MeasuredHOM: item.measuredHOM != null ? Number(item.measuredHOM) : null,
      HOMUnit: item.homUnit != null ? String(item.homUnit) : null,
      Description: item.description != null ? String(item.description) : null,
      UserDefinedFields: item.userDefinedFields != null ? String(item.userDefinedFields) : null,
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

