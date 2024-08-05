// core measurements custom data type
import { ResultType } from "@/config/utils";
import { IDataMapper, parseDate } from "../../datamapper";
import { bitToBoolean, booleanToBit } from "@/config/macros";

export type CoreMeasurementsRDS = {
  id?: number;
  coreMeasurementID?: number;
  censusID?: number;
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

export type CoreMeasurementsResult = ResultType<CoreMeasurementsRDS>;

export const coreMeasurementsFields = ["stemID", "isValidated", "measurementDate", "measuredDBH", "measuredHOM", "description", "userDefinedFields"];
