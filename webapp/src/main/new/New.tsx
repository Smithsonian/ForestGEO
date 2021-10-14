import { useState, useMemo } from "react";

import { QuadratDataEntryForm } from "./QuadratDataEntryForm";
import { QuadratMetadataEntryForm } from "./QuadratMetadataEntryForm";
import { Stem } from "../../types";
import { insertStems } from "./dataService";
import { columns } from "./QuadratDataEntryForm/columnHeaders";
import { mockCensusData } from "../../mockData/mockCensusData";
import {
  postValidate,
  PostValidationError,
} from "../../validation/postValidation";

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

  // Table data has to be memoized for react-table performance
  const columnHeaders = useMemo(() => columns, []);
  const [data, setData] = useState(useMemo(() => mockCensusData, []));
  const [postValidationErrors, setPostValidationErrors] = useState<
    PostValidationError[]
  >([]);

  const updateData = (rowIndex: number, columnId: string, value: any) => {
    console.log(`set data for ${columnId} at row ${rowIndex} to ${value}`);

    setData((old) =>
      old.map((row, index) => {
        if (index === rowIndex) {
          return {
            ...old[rowIndex],
            [columnId]: value,
          };
        }
        return row;
      })
    );
  };

  return (
    <>
      <h1>Old Trees Form</h1>
      <QuadratMetadataEntryForm />
      <QuadratDataEntryForm
        columns={columnHeaders}
        data={data}
        updateHandler={updateData}
        postValidationErrors={postValidationErrors}
      />
      <button
        type="submit"
        onClick={() => {
          const postErrors = postValidate(data);
          setPostValidationErrors(postErrors);
          if (postErrors.length === 0) {
            insertStems(formData).catch((error) => setErrors(error));
          }
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
