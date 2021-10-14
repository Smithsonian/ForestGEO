import { Stem } from "../types";
import { ValidationError } from "./validationError";

export function postValidate(data: Stem[]): Set<ValidationError> {
  const errors = new Set<ValidationError>()
  data.forEach(stem => {
    if (stem.DBH.toString() === "9001") {
      errors.add({
        index: data.indexOf(stem),
        column: "DBH",
        errorMessage: "That's a pretty wide tree"
      })
    }
  });

  return errors;
}