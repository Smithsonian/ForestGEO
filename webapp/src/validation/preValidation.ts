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

  if (columnName === "DBH"){
    if (!value) {
      validationErrors.add({
        index: row,
        column: columnName,
        errorMessage:"Gotta enter a value"
      })
    }

    if (parseInt(value, 10) > 200) {
      validationErrors.add({
        index: row,
        column: columnName,
        errorMessage:"Oops! That value is too high."
      })
    }
  
    if (parseInt(value, 10) < 1) {
      validationErrors.add({
        index: row,
        column: columnName,
        errorMessage:"Oops! That value is too low."
      })    }
  }

  return validationErrors
}