import { ValidationError } from "./validationError";
import { Tree } from "../types";

// FIXME: Post validation is removed because the React state change currently conflicts 
// with cloud validation.
// export function postValidate(data: Tree[]): Set<ValidationError> {
//   const errors = new Set<ValidationError>()

//   data.forEach(stem => {
//     if (stem && stem.DBH) {
//       if (stem.DBH.toString() === "9001") {
//         errors.add({
//           index: data.indexOf(stem),
//           column: "DBH",
//           errorMessage: "That's a pretty wide tree"
//         })
//       }
//     }
//   });

//   return errors;
// }