// family custom data type
import { ResultType } from "@/config/utils";
import { IDataMapper } from "../../datamapper";

export type FamilyRDS = {
  id?: number;
  familyID?: number;
  family?: string;
  referenceID?: number;
};

export type FamilyResult = ResultType<FamilyRDS>;
