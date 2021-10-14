import { useState, useMemo } from "react";

import { QuadratDataEntryForm } from "./QuadratDataEntryForm";
import { QuadratMetadataEntryForm } from "./QuadratMetadataEntryForm";
import { Stem } from "../../types";
import { insertStems } from "./dataService";
import { columns } from "./QuadratDataEntryForm/columnHeaders";
import { mockCensusData } from "../../mockData/mockCensusData";
import { preValidate } from "../../validation/preValidation";
import { postValidate } from "../../validation/postValidation";
import {
  ValidationError,
  ValidationErrorMap,
} from "../../validation/validationError";

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
  const [validationErrors, setValidationErrors] = useState(
    new ValidationErrorMap()
  );

  const updateData = (rowIndex: number, columnId: string, value: any) => {
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

    // This is the callback that will do pre-validation (easy stuff e.g. regex)
    const preValidationErrors = preValidate(rowIndex, columnId, value);
    if (preValidationErrors.size > 0) {
      validationErrors.addPreValidationErrors(
        rowIndex,
        columnId,
        preValidationErrors
      );
    } else {
      validationErrors.removePreValidationErrorsForCell(rowIndex, columnId);
    }
  };

  return (
    <>
      <h1>Old Trees Form</h1>
      <QuadratMetadataEntryForm />
      <QuadratDataEntryForm
        columns={columnHeaders}
        data={data}
        updateHandler={updateData}
        validationErrors={validationErrors}
      />
      <button
        type="submit"
        onClick={() => {
          const postErrors = postValidate(data);
          validationErrors.setPostValidationErrors(postErrors);
          if (validationErrors.size === 0) {
            // FIXME: revise this conditional to use ValidationErrorMap
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
