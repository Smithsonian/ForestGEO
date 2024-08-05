// validation error custom data type
export type ValidationErrorRDS = {
  id: number;
  validationErrorID: number;
  validationErrorDescription: string | null;
};

export interface ValidationErrorResult {
  ValidationErrorID: any;
  ValidationErrorDescription: any;
}
