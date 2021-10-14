import { ValidationError } from "./validationError";

export function preValidate(row: number, columnName: string, value: any): Set<ValidationError> { 
  const validationErrors = new Set<ValidationError>()

  if (parseInt(value, 10) === 1337) {
    validationErrors.add({
      index: row,
      column: columnName,
      errorMessage: "Oops! That value is too *sick* to be true!"
    })
  }

  return validationErrors
}