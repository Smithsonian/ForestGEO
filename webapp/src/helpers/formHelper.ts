import { Tree } from "../types";

/**
 * In old tree form, data is populated from n-1 census data. However, we don't want to display meausrements in the form.
 * This function is to copy partial properties (the ones that are readonly) from n-1 census.
 */
export function getDataForForm(latestCencusData: Tree[]): Tree[] {
  return latestCencusData.map((item) => ({
    ...item,
    // prun the properties
    DBH: undefined,
    Htmeas: undefined,
    Codes: "",
    Comments: "",
  }));
}
