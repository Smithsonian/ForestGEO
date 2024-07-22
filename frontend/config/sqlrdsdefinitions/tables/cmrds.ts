// cmattributes custom data type
// cmverrors custom data type
export type CMAttributesRDS = {
  id: number;
  cmaID: number;
  coreMeasurementID: number | null;
  code: string | null;
};

export interface CMAttributesResult {
  CMAID: any;
  CoreMeasurementID: any;
  Code: any;
}

export type CMVErrorRDS = {
  id: number;
  cmvErrorID: number;
  coreMeasurementID: number | null;
  validationErrorID: number | null;
};

export interface CMVErrorResult {
  CMVErrorID: any;
  CoreMeasurementID: any;
  ValidationErrorID: any;
}