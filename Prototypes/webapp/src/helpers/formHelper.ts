import { sortBy } from "lodash";
import { Tree } from "../types";

/**
 * In old tree form, data is populated from n-1 census data. However, we don't want to display meausrements in the form.
 * This function is to copy partial properties (the ones that are readonly) from n-1 census.
 */
export function getDataForForm(latestCencusData: Tree[]): Tree[] {
  // Sorted return data to keep them in the same order.
  // Otherwise when switching between online/offline, the row might be in different order leading to confusion.
  const sortedCencus: Tree[] = sortBy(latestCencusData, "Tag", "Subquadrat");
  return sortedCencus.map((item) => ({
    ...item,
    // prun the properties
    DBH: undefined,
    Htmeas: undefined,
    Codes: "",
    Comments: "",
  }));
}
