import { useState } from "react";

import { QuadratDataEntryForm } from "./QuadratDataEntryForm";
import { QuadratMetadataEntryForm } from "./QuadratMetadataEntryForm";
import { Stem } from "../../types";

export const New = () => {
  const [errors, setErrors] = useState<any>([]);

  const hardCodedFormData: Stem[] = [
    {
      Subquadrat: "11",
      Tag: 1,
      StemTag: 1,
      SpCode: "species",
      DBH: 10,
      Codes: "at",
      Comments: "",
    },
    {
      Subquadrat: "11",
      Tag: 2,
      StemTag: 1,
      SpCode: "species",
      DBH: 10,
      Codes: "at",
      Comments: "",
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
          // handle form submission
          fetch(
            "https://treedataapi.azurewebsites.net/api/treedata?code=ruBIe/cx1E6tB6s1Foa4iq7SwDBuXprPzg55d1m786pMjUrB4ePraQ==",
            { method: "POST", body: JSON.stringify(formData) }
          )
            .then((response) => response.json())
            .then((errorData) => {
              setErrors(errorData);
            });
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
