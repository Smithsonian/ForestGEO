import { useState } from "react";

import { QuadratDataEntryForm } from "./QuadratDataEntryForm";
import { QuadratMetadataEntryForm } from "./QuadratMetadataEntryForm";
import { Stem } from "../../types";
import { insertStems } from "./dataService";

export const New = () => {
  const [errors, setErrors] = useState<any>([]);

  const hardCodedFormData: Stem[] = [
    {
      siteId: 1,
      subquadrat: "11",
      tag: 1,
      stemTag: 1,
      spCode: "species",
      dbh: 10,
      codes: "at",
      comments: "",
    },
    {
      siteId: 1,
      subquadrat: "11",
      tag: 2,
      stemTag: 1,
      spCode: "species",
      dbh: 10,
      codes: "at",
      comments: "",
    },
  ];

  const [formData] = useState(hardCodedFormData);
  return (
    <>
      <h1>New Plant Form</h1>
      <QuadratMetadataEntryForm />
      <QuadratDataEntryForm />
      <button
        type="submit"
        onClick={() => {
          insertStems(formData).catch(error=>setErrors(error));
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
