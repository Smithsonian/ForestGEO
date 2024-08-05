// census custom data type
import { createInitialObject, ResultType } from "@/config/utils";
import { IDataMapper, parseDate } from "../../datamapper";

export const initialCensusRDSRow = createInitialObject<CensusRDS>();

export type CensusRaw = {
  id?: number;
  censusID?: number;
  plotID?: number;
  plotCensusNumber?: number;
  startDate?: Date;
  endDate?: Date;
  description?: string;
};

export type CensusRDS = CensusRaw | undefined;

export type CensusResult = ResultType<CensusRDS>;

export const censusFields = ["plotID", "plotCensusNumber", "startDate", "endDate", "description"];
