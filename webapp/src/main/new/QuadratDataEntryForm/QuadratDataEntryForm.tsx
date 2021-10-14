import { Column } from "react-table";
import { EditableTable } from "../../../components/editableTable";

import { Stem } from "../../../types";
import { ValidationErrorMap } from "../../../validation/validationError";

interface QuadratDataEntryFormProps {
  columns: Column[];
  data: Stem[];
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
    <EditableTable
      columns={columns}
      data={data}
      updateData={updateHandler}
      validationErrors={validationErrors}
    />
  );
}

QuadratDataEntryForm.defaultName = "QuadratDataEntryForm";
