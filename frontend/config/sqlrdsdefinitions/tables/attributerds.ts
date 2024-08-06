// attributes custom data type
import { createInitialObject, ResultType } from '@/config/utils';
import { FileRow, RowValidationErrors, ValidationFunction } from '@/config/macros/formdetails';

// attributes table column character limits
const ATTRIBUTES_CODE_LIMIT = 10;

export const validateAttributesRow: ValidationFunction = (row: FileRow) => {
  const errors: RowValidationErrors = {};

  if (row['code'] && row['code'].length > ATTRIBUTES_CODE_LIMIT) {
    errors['code'] = `Code exceeds ${ATTRIBUTES_CODE_LIMIT} characters.`;
  }
  // Allowing NULL for status, otherwise checking for valid values
  if (
    row['status'] !== null &&
    row['status'] !== undefined &&
    !['alive', 'alive-not measured', 'dead', 'stem dead', 'broken below', 'omitted', 'missing'].includes(row['status'])
  ) {
    errors['status'] = 'Invalid status value.';
  }

  return Object.keys(errors).length > 0 ? errors : null;
};

export type AttributesRDS = {
  id?: number;
  code?: string;
  description?: string;
  status?: string;
};

export type AttributesResult = ResultType<AttributesRDS>;

export const initialAttributesRDSRow = createInitialObject<AttributesRDS>();

export const AttributeStatusOptions = ['alive', 'alive-not measured', 'dead', 'missing', 'broken below', 'stem dead'];

export const attributesFields = ['code', 'description', 'status'];
