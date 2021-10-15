import { Column } from "react-table";
import { EditableTable } from "../../../components/editableTable";

import { ValidationErrorMap } from "../../../validation/validationError";
import { Tree } from "../../../types";

interface QuadratDataEntryFormProps {
  columns: Column[];
  data: Tree[];
  updateHandler: Function;
  validationErrors: ValidationErrorMap;
}
export function QuadratDataEntryForm({
  columns,
  data,
  updateHandler,
  validationErrors,
}: QuadratDataEntryFormProps) {
  return (
    <>
      <EditableTable
        columns={columns}
        data={data}
        updateData={updateHandler}
        validationErrors={validationErrors}
      />
      <div>
        {validationErrors.size !== 0 ? (
          validationErrors
            .getAllValidationErrors()
            .map((v) => (
              <div style={{ color: "red" }}>
                {`Validation error found in tag ${v.tag}, subquadrat ${v.subquadrat}: ${v.errorMessage}`}
              </div>
            ))
        ) : (
          <></>
        )}
      </div>
    </>
  );
}

QuadratDataEntryForm.defaultName = "QuadratDataEntryForm";
