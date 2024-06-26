import { GridColDef } from "@mui/x-data-grid";
import { IDataMapper, parseDate } from "../../datamapper";
import { bitToBoolean, booleanToBit, ColumnStates } from "@/config/macros";
import { ValidationFunction, RowValidationErrors } from "@/config/macros/formdetails";

export const validateMeasurementsRow: ValidationFunction = (row) => {
  const errors: RowValidationErrors = {};

  if (row['dbhunit'] && !['km', 'hm', 'dam', 'm', 'dm', 'cm', 'mm'].includes(row['dbhunit'])) {
    errors['dbhunit'] = 'Invalid DBH unit value.';
  }
  if (row['homunit'] && !['km', 'hm', 'dam', 'm', 'dm', 'cm', 'mm'].includes(row['homunit'])) {
    errors['homunit'] = 'Invalid HOM unit value.';
  }

  return Object.keys(errors).length > 0 ? errors : null;
};

export type MeasurementsSummaryRDS = {
  id?: number;
  coreMeasurementID?: number;
  plotID?: number;
  plotName?: string;
  censusID?: number;
  quadratID?: number;
  quadratName?: string;
  subquadratID?: number;
  subquadratName?: string;
  speciesID?: number;
  speciesCode?: string;
  treeID?: number;
  treeTag?: string;
  stemID?: number;
  stemTag?: string;
  stemLocalX?: number;
  stemLocalY?: number;
  stemUnits?: string;
  personnelID?: number;
  personnelName?: string;
  measurementDate?: any;
  measuredDBH?: number;
  dbhUnits?: string;
  measuredHOM?: number;
  homUnits?: string;
  isValidated?: boolean;
  description?: string;
  attributes?: string;
};

export const initialMeasurementsSummaryViewRDSRow = {
  id: 0,
  coreMeasurementID: 0,
  plotID: 0,
  plotName: '',
  censusID: 0,
  quadratID: 0,
  quadratName: '',
  subquadratID: 0,
  subquadratName: '',
  speciesID: 0,
  speciesCode: '',
  treeID: 0,
  treeTag: '',
  stemID: 0,
  stemTag: '',
  stemLocalX: 0,
  stemLocalY: 0,
  stemUnits: '',
  personnelID: 0,
  personnelName: '',
  measurementDate: null,
  measuredDBH: 0,
  dbhUnits: '',
  measuredHOM: 0,
  homUnits: '',
  isValidated: null,
  description: '',
  attributes: '',
};

export interface MeasurementsSummaryResult {
  CoreMeasurementID: any;
  PlotID: any;
  PlotName: any;
  CensusID: any;
  QuadratID: any;
  QuadratName: any;
  SubquadratID: any;
  SubquadratName: any;
  SpeciesID: any;
  SpeciesCode: any;
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
  IsValidated: any;
  Description: any;
  Attributes: any;
}

export class MeasurementsSummaryMapper implements IDataMapper<MeasurementsSummaryResult, MeasurementsSummaryRDS> {
  demapData(results: MeasurementsSummaryRDS[]): MeasurementsSummaryResult[] {
    return results.map(item => ({
      CoreMeasurementID: item.coreMeasurementID != undefined ? String(item.coreMeasurementID) : null,
      PlotID: item.plotID != undefined ? String(item.plotID) : null,
      PlotName: item.plotName != undefined ? String(item.plotName) : null,
      CensusID: item.censusID != undefined ? String(item.censusID) : null,
      QuadratID: item.quadratID != undefined ? String(item.quadratID) : null,
      QuadratName: item.quadratName != undefined ? String(item.quadratName) : null,
      SubquadratID: item.subquadratID != undefined ? String(item.subquadratID) : null,
      SubquadratName: item.subquadratName != undefined ? String(item.subquadratName) : null,
      SpeciesID: item.speciesID != undefined ? String(item.speciesID) : null,
      SpeciesCode: item.speciesCode != undefined ? String(item.speciesCode) : null,
      TreeID: item.treeID != undefined ? String(item.treeID) : null,
      TreeTag: item.treeTag != undefined ? String(item.treeTag) : null,
      StemID: item.stemID != undefined ? String(item.stemID) : null,
      StemTag: item.stemTag != undefined ? String(item.stemTag) : null,
      StemLocalX: item.stemLocalX != undefined ? String(item.stemLocalX) : null,
      StemLocalY: item.stemLocalY != undefined ? String(item.stemLocalY) : null,
      StemUnits: item.stemUnits != undefined ? String(item.stemUnits) : null,
      PersonnelID: item.personnelID != undefined ? String(item.personnelID) : null,
      PersonnelName: item.personnelName != undefined ? String(item.personnelName) : null,
      MeasurementDate: parseDate(item.measurementDate),
      MeasuredDBH: item.measuredDBH != undefined ? String(item.measuredDBH) : null,
      DBHUnits: item.dbhUnits != undefined ? String(item.dbhUnits) : null,
      MeasuredHOM: item.measuredHOM != undefined ? String(item.measuredHOM) : null,
      HOMUnits: item.homUnits != undefined ? String(item.homUnits) : null,
      IsValidated: item.isValidated != undefined ? booleanToBit(item.isValidated) : null,
      Description: item.description != undefined ? String(item.description) : null,
      Attributes: item.attributes != undefined ? String(item.attributes) : null,
    }));
  }

  mapData(results: MeasurementsSummaryResult[], indexOffset: number = 1): MeasurementsSummaryRDS[] {
    return results.map((item, index) => ({
      id: index + indexOffset,
      coreMeasurementID: item.CoreMeasurementID != null ? Number(item.CoreMeasurementID) : undefined,
      plotID: item.PlotID != null ? Number(item.PlotID) : undefined,
      plotName: item.PlotName != null ? String(item.PlotName) : undefined,
      censusID: item.CensusID != null ? Number(item.CensusID) : undefined,
      quadratID: item.QuadratID != null ? Number(item.QuadratID) : undefined,
      quadratName: item.QuadratName != null ? String(item.QuadratName) : undefined,
      subquadratID: item.SubquadratID != null ? Number(item.SubquadratID) : undefined,
      subquadratName: item.SubquadratName != null ? String(item.SubquadratName) : undefined,
      speciesID: item.SpeciesID != null ? Number(item.SpeciesID) : undefined,
      speciesCode: item.SpeciesCode != null ? String(item.SpeciesCode) : undefined,
      treeID: item.TreeID != null ? Number(item.TreeID) : undefined,
      treeTag: item.TreeTag != null ? String(item.TreeTag) : undefined,
      stemID: item.StemID != null ? Number(item.StemID) : undefined,
      stemTag: item.StemTag != null ? String(item.StemTag) : undefined,
      stemLocalX: item.StemLocalX != null ? Number(item.StemLocalX) : undefined,
      stemLocalY: item.StemLocalY != null ? Number(item.StemLocalY) : undefined,
      stemUnits: item.StemUnits != null ? String(item.StemUnits) : undefined,
      personnelID: item.PersonnelID != null ? Number(item.PersonnelID) : undefined,
      personnelName: (item.PersonnelName != null && item.PersonnelName !== 'Unknown') ? String(item.PersonnelName) : undefined,
      measurementDate: parseDate(item.MeasurementDate),
      measuredDBH: item.MeasuredDBH != null ? Number(item.MeasuredDBH) : undefined,
      dbhUnits: item.DBHUnits != null ? String(item.DBHUnits) : undefined,
      measuredHOM: item.MeasuredHOM != null ? Number(item.MeasuredHOM) : undefined,
      homUnits: item.HOMUnits != null ? String(item.HOMUnits) : undefined,
      isValidated: item.IsValidated != null ? bitToBoolean(item.IsValidated) : undefined,
      description: item.Description != null ? String(item.Description) : undefined,
      attributes: item.Attributes != null ? String(item.Attributes) : undefined,
    }));
  }
}

export function getMeasurementsSummaryViewHCs(): ColumnStates {
  return {
    plotID: false,
    censusID: false,
    quadratID: false,
    subquadratID: false,
    treeID: false,
    stemID: false,
    personnelID: false,
  };
}

export const gridColumnsArrayMSVRDS: GridColDef[][] = [
  [
    { field: 'coreMeasurementID', headerName: '#', headerAlign: 'left', headerClassName: 'header', flex: 0.25, align: 'left' },
    { field: 'plotID', headerName: 'Plot ID', headerAlign: 'left', headerClassName: 'header', flex: 1, align: 'left', editable: true },
    { field: 'plotName', headerName: 'Plot Name', headerAlign: 'left', headerClassName: 'header', flex: 1, align: 'left', editable: true },
    { field: 'censusID', headerName: 'Census ID', headerAlign: 'left', headerClassName: 'header', flex: 1, align: 'left', editable: true },
    { field: 'quadratID', headerName: 'Quadrat ID', headerAlign: 'left', headerClassName: 'header', flex: 1, align: 'left', editable: true },
    { field: 'quadratName', headerName: 'Quadrat', headerAlign: 'left', headerClassName: 'header', flex: 0.8, align: 'left', editable: true },
    {
      field: 'subquadratID',
      headerName: 'Subquadrat ID', headerAlign: 'left',
      headerClassName: 'header',
      flex: 1,
      align: 'left',
      editable: true
    },
    {
      field: 'subquadratName',
      headerName: 'Subquadrat', headerAlign: 'left',
      headerClassName: 'header',
      flex: 1,
      align: 'left',
      editable: true
    },
    { field: 'speciesID', headerName: 'Species ID', headerAlign: 'left', headerClassName: 'header', flex: 1, align: 'left', editable: true },
    {
      field: 'speciesCode',
      headerName: 'Species Code', headerAlign: 'left',
      headerClassName: 'header',
      flex: 1.2,
      align: 'left',
      editable: true
    },
    { field: 'treeID', headerName: 'Tree ID', headerAlign: 'left', headerClassName: 'header', flex: 1, align: 'left', editable: true },
    { field: 'treeTag', headerName: 'Tree', headerAlign: 'left', headerClassName: 'header', flex: 0.7, align: 'left', editable: true },
    { field: 'stemID', headerName: 'Stem ID', headerAlign: 'left', headerClassName: 'header', flex: 1, align: 'left', editable: true },
    { field: 'stemTag', headerName: 'Stem', headerAlign: 'left', headerClassName: 'header', flex: 0.7, align: 'left', editable: true },
    { field: 'stemLocalX', headerName: 'X', headerAlign: 'left', headerClassName: 'header', flex: 0.7, align: 'left', editable: true },
    { field: 'stemLocalY', headerName: 'Y', headerAlign: 'left', headerClassName: 'header', flex: 0.7, align: 'left', editable: true }
  ],
  [
    { field: 'personnelID', headerName: 'Personnel ID', headerClassName: 'header', flex: 1, align: 'left', editable: true },
    { field: 'personnelName', headerName: 'Recording', headerClassName: 'header', flex: 1, align: 'left', editable: true },
    { field: 'measuredDBH', headerName: 'DBH', headerClassName: 'header', flex: 0.8, align: 'left', editable: true }
  ],
  [{ field: 'measuredHOM', headerName: 'HOM', headerClassName: 'header', flex: 0.5, align: 'left', editable: true }],
  [
    { field: 'description', headerName: 'Description', headerClassName: 'header', flex: 1, align: 'left', editable: true },
    { field: 'attributes', headerName: 'Attributes', headerClassName: 'header', flex: 1, align: 'left', editable: true }
  ]
];