// core measurements custom data type
import {IDataMapper, parseDate} from "../../datamapper";
import {bitToBoolean, booleanToBit} from '@/config/macros';

export type CoreMeasurementsRDS = {
  id?: number;
  coreMeasurementID?: number;
  stemID?: number;
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
  StemID: any;
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
      stemID: item.StemID != null ? Number(item.StemID) : undefined,
      isValidated: item.IsValidated != null ? bitToBoolean(item.IsValidated) : undefined,
      measurementDate: parseDate(item.MeasurementDate),
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
      CoreMeasurementID: item.coreMeasurementID != undefined ? Number(item.coreMeasurementID) : null,
      StemID: item.stemID != undefined ? Number(item.stemID) : null,
      IsValidated: item.isValidated != undefined ? booleanToBit(item.isValidated) : null,
      MeasurementDate: parseDate(item.measurementDate),
      MeasuredDBH: item.measuredDBH != undefined ? Number(item.measuredDBH) : null,
      DBHUnit: item.dbhUnit != undefined ? String(item.dbhUnit) : null,
      MeasuredHOM: item.measuredHOM != undefined ? Number(item.measuredHOM) : null,
      HOMUnit: item.homUnit != undefined ? String(item.homUnit) : null,
      Description: item.description != undefined ? String(item.description) : null,
      UserDefinedFields: item.userDefinedFields != undefined ? String(item.userDefinedFields) : null,
    }));
  }
}


export const coreMeasurementsFields = [
  'stemID',
  'isValidated',
  'measurementDate',
  'measuredDBH',
  'measuredHOM',
  'description',
  'userDefinedFields'
];

