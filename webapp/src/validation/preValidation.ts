import { ValidationError } from "./validationError";

export function preValidate(row: number, columnName: string, value: any): Set<ValidationError> { 
  const validationErrors = new Set<ValidationError>()

  if (columnName === "DBH"){
    if (!value) {
      validationErrors.add({
        index: row,
        column: columnName,
        errorMessage:"DBH value cannot be empty."
      })
    }

    // TODO: Extract the DBH bounds to constants.

    if (parseInt(value, 10) > 200) {
      validationErrors.add({
        index: row,
        column: columnName,
        errorMessage:"DBH value must be between 1 and 200."
      })
    }
  
    if (parseInt(value, 10) < 1) {
      validationErrors.add({
        index: row,
        column: columnName,
        errorMessage:"DBH value must be between 1 and 200."
      })    }
  }

  return validationErrors
}