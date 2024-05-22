import {GridColDef} from "@mui/x-data-grid";
import moment from "moment";
import {IDataMapper, parseDate} from "../../datamapper";
import { unitSelectionOptions } from "@/config/macros";
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
  censusStartDate?: any;
  censusEndDate?: any;
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
  description?: string;
  attributes?: string;
};

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
  Description: any;
  Attributes: any;
}

export class MeasurementsSummaryMapper implements IDataMapper<MeasurementsSummaryResult, MeasurementsSummaryRDS> {
  demapData(results: MeasurementsSummaryRDS[]): MeasurementsSummaryResult[] {
    return results.map(item => ({
      CoreMeasurementID: item.coreMeasurementID != null ? String(item.coreMeasurementID) : null,
      PlotID: item.plotID != null ? String(item.plotID) : null,
      PlotName: item.plotName != null ? String(item.plotName) : null,
      CensusID: item.censusID != null ? String(item.censusID) : null,
      StartDate: item.censusStartDate,
      EndDate: item.censusEndDate,
      QuadratID: item.quadratID != null ? String(item.quadratID) : null,
      QuadratName: item.quadratName != null ? String(item.quadratName) : null,
      SubquadratID: item.subquadratID != null ? String(item.subquadratID) : null,
      SubquadratName: item.subquadratName != null ? String(item.subquadratName) : null,
      SpeciesID: item.speciesID != null ? String(item.speciesID) : null,
      SpeciesCode: item.speciesCode != null ? String(item.speciesCode) : null,
      TreeID: item.treeID != null ? String(item.treeID) : null,
      TreeTag: item.treeTag != null ? String(item.treeTag) : null,
      StemID: item.stemID != null ? String(item.stemID) : null,
      StemTag: item.stemTag != null ? String(item.stemTag) : null,
      StemLocalX: item.stemLocalX != null ? String(item.stemLocalX) : null,
      StemLocalY: item.stemLocalY != null ? String(item.stemLocalY) : null,
      StemUnits: item.stemUnits != null ? String(item.stemUnits) : null,
      PersonnelID: item.personnelID != null ? String(item.personnelID) : null,
      PersonnelName: item.personnelName != null ? String(item.personnelName) : null,
      MeasurementDate: item.measurementDate,
      MeasuredDBH: item.measuredDBH != null ? String(item.measuredDBH) : null,
      DBHUnits: item.dbhUnits != null ? String(item.dbhUnits) : null,
      MeasuredHOM: item.measuredHOM != null ? String(item.measuredHOM) : null,
      HOMUnits: item.homUnits != null ? String(item.homUnits) : null,
      Description: item.description != null ? String(item.description) : null,
      Attributes: item.attributes != null ? String(item.attributes) : null,
    }));
  }

  mapData(results: MeasurementsSummaryResult[], indexOffset: number = 1): MeasurementsSummaryRDS[] {
    return results.map((item, index) => ({
      id: index + indexOffset,
      coreMeasurementID: item.CoreMeasurementID != null ? Number(item.CoreMeasurementID) : undefined,
      plotID: item.PlotID != null ? Number(item.PlotID) : undefined,
      plotName: item.PlotName != null ? String(item.PlotName) : undefined,
      censusID: item.CensusID != null ? Number(item.CensusID) : undefined,
      censusStartDate: parseDate(item.StartDate),
      censusEndDate: parseDate(item.EndDate),
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
      personnelName: item.PersonnelName != null ? String(item.PersonnelName) : undefined,
      measurementDate: parseDate(item.MeasurementDate),
      measuredDBH: item.MeasuredDBH != null ? Number(item.MeasuredDBH) : undefined,
      dbhUnits: item.DBHUnits != null ? String(item.DBHUnits) : undefined,
      measuredHOM: item.MeasuredHOM != null ? Number(item.MeasuredHOM) : undefined,
      homUnits: item.HOMUnits != null ? String(item.HOMUnits) : undefined,
      description: item.Description != null ? String(item.Description) : undefined,
      attributes: item.Attributes != null ? String(item.Attributes) : undefined,
    }));
  }
}

export const MeasurementsSummaryGridColumns: GridColDef[] = [
  {field: 'coreMeasurementID', headerName: '#', headerClassName: 'header', flex: 1, align: 'left'},
  {
    field: 'subquadratName',
    headerName: 'Subquadrat',
    headerClassName: 'header',
    flex: 1,
    align: 'left',
    editable: true
  },
  {field: 'speciesCode', headerName: 'SpCode', headerClassName: 'header', flex: 1, align: 'left', editable: true},
  {field: 'treeTag', headerName: 'Tag', headerClassName: 'header', flex: 1, align: 'left', editable: true},
  {field: 'stemTag', headerName: 'Stem', headerClassName: 'header', flex: 1, align: 'left', editable: true},
  {field: 'stemLocalX', headerName: 'X', headerClassName: 'header', flex: 1, align: 'left', editable: true},
  {field: 'stemLocalY', headerName: 'Y', headerClassName: 'header', flex: 1, align: 'left', editable: true},
  {field: 'stemUnits', headerName: '<- Unit', headerClassName: 'header', flex: 1, align: 'left', editable: true, type: 'singleSelect', valueOptions: unitSelectionOptions,},
  {field: 'personnelName', headerName: 'Recording', headerClassName: 'header', flex: 1, align: 'left', editable: true},
  {
    field: 'measurementDate', headerName: 'Date', headerClassName: 'header', flex: 1,
    valueGetter: (value: any) => {
      // Check if the date is present and valid
      if (!value || !moment(value).isValid()) return '';
      // Format the date
      return new Date(value).toDateString();
    },
    editable: true
  },
  {field: 'measuredDBH', headerName: 'DBH', headerClassName: 'header', flex: 1, align: 'left', editable: true},
  {field: 'dbhUnits', headerName: '<- Unit', headerClassName: 'header', flex: 1, align: 'left', editable: true, type: 'singleSelect', valueOptions: unitSelectionOptions,},
  {field: 'measuredHOM', headerName: 'HOM', headerClassName: 'header', flex: 1, align: 'left', editable: true},
  {field: 'homUnits', headerName: '<- Unit', headerClassName: 'header', flex: 1, align: 'left', editable: true, type: 'singleSelect', valueOptions: unitSelectionOptions,},
  {field: 'description', headerName: 'Description', headerClassName: 'header', flex: 1, align: 'left', editable: true},
  {field: 'attributes', headerName: 'Attributes', headerClassName: 'header', flex: 1, align: 'left', editable: true},
];