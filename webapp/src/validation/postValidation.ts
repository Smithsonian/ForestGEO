import { Stem } from "../types";

export type PostValidationError = {
  // For now using the index in the data array since there's no PK.
  // This must change if we can't guarantee the order of the array (e.g. sorting)
  index: number 
  column: string
  errorMessage: string
}

export function postValidate(data: Stem[]): PostValidationError[] {
  console.log("postvalidate")
  console.log(data)
  const errors: PostValidationError[] = [];

  data.forEach(stem => {
    if (stem.DBH.toString() === "9001") {
      errors.push({
        index: data.indexOf(stem),
        column: "DBH",
        errorMessage: "That's a pretty wide tree"
      })
    }
  });

  console.log(errors)

  return errors;
}