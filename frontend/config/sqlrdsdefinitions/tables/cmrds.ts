// cmattributes custom data type

import { ResultType } from "@/config/utils";

// cmverrors custom data type
export type CMAttributesRDS = {
  id?: number;
  cmaID?: number;
  coreMeasurementID?: number;
  code?: string;
};

export type CMAttributesResult = ResultType<CMAttributesRDS>;

export type CMVErrorRDS = {
  id?: number;
  cmvErrorID?: number;
  coreMeasurementID?: number;
  validationErrorID?: number;
};

export type CMVErrorResult = ResultType<CMVErrorRDS>;
