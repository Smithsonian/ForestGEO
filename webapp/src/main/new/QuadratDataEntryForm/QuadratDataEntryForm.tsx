import { useState, useMemo } from "react";
import { Column } from "react-table";
import { EditableTable } from "../../../components/editableTable";

import { Stem } from "../../../types";
import { PostValidationError } from "../../../validation/postValidation";

interface QuadratDataEntryFormProps {
  columns: Column[];
  data: Stem[];
  updateHandler: Function;
  postValidationErrors: PostValidationError[];
}
export function QuadratDataEntryForm({
  columns,
  data,
  updateHandler,
  postValidationErrors,
}: QuadratDataEntryFormProps) {
  return (
    <EditableTable
      columns={columns}
      data={data}
      updateData={updateHandler}
      postValidationErrors={postValidationErrors}
    />
  );
}

QuadratDataEntryForm.defaultName = "QuadratDataEntryForm";
