import { useState, useMemo } from "react";

import { QuadratDataEntryForm } from "./QuadratDataEntryForm";
import { QuadratMetadataEntryForm } from "./QuadratMetadataEntryForm";
import { Stem } from "../../types";
import { insertStems } from "./dataService";
import { columns } from "./QuadratDataEntryForm/columnHeaders";
import { mockCensusData } from "../../mockData/mockCensusData";

export const New = () => {
  const [errors, setErrors] = useState<any>([]);

  const hardCodedFormData: Stem[] = [
    {
      Subquadrat: 11,
      Tag: 1,
      SpCode: "species",
      DBH: 10,
      Htmeas: 1.5,
      Codes: "at",
      Comments: "",
    },
    {
      Subquadrat: 11,
      Tag: 2,
      SpCode: "species",
      DBH: 10,
      Htmeas: 1.5,
      Codes: "at",
      Comments: "",
    },
  ];

  const [formData] = useState(hardCodedFormData);
  const columnHeaders = useMemo(() => columns, []);
  const data = useMemo(() => mockCensusData, []);

  return (
    <>
      <h1>Old Trees Form</h1>
      <QuadratMetadataEntryForm />
      <QuadratDataEntryForm columns={columnHeaders} initialData={data} />
      <button
        type="submit"
        onClick={() => {
          insertStems(formData).catch((error) => setErrors(error));
        }}
      >
        Submit
      </button>
      <ul>
        {errors.map((error: any) => (
          <li>
            There was an error on the tree branch identified by subquadrat{" "}
            {error.Subquadrat}, tag {error.Tag} and stem {error.StemTag}:{" "}
            {error.Error}
          </li>
        ))}
      </ul>
    </>
  );
};

New.defaultName = "New";
