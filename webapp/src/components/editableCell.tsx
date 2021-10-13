import { useState, useEffect } from "react";
import { Column, Cell, Row } from "react-table";
import { PostValidationError } from "../validation/postValidation";

import { preValidate } from "../validation/preValidation";

interface EditableCellProps {
  row: Row;
  column: Column;
  updateData: Function;
  cell: Cell;
  postValidationErrors: PostValidationError[];
}

export const EditableCell = ({
  row,
  column,
  updateData,
  cell,
  postValidationErrors,
}: EditableCellProps) => {
  const [appliedStyle, setAppliedStyle] = useState({});
  const errorStyle = { border: "1px solid red" };
  const notAnErrorStyle = { border: "1px solid black" };

  const [value, setValue] = useState(cell.value);

  // Make the input field reflect changes as we type
  const onChange = (e: React.FormEvent<HTMLInputElement>) => {
    if (e && e.currentTarget) {
      setValue(e.currentTarget.value);
    }
  };

  // Wait to actually update the table state when we unfocus the input field
  const onBlur = () => {
    updateData(row.index, column.Header, value);

    // This is the callback that will do in-line validation
    const errors = preValidate(value);

    if (errors.length > 0) {
      setAppliedStyle(errorStyle);
      // Show errors in any other way cuz of pre-validation
    }
  };

  function applyPostValidationErrors() {
    console.log("handlepostvalidate");
    setAppliedStyle(notAnErrorStyle); // FIXME: This erases regex errors. Maybe we need just one source of errors

    postValidationErrors.forEach((e) => {
      if (e.index === row.index && e.column === column.Header?.toString()) {
        console.log("post validation error hit");
        setAppliedStyle(errorStyle);
      }
    });
  }

  // Respond to any external changes in the input field
  // (I don't know if we actually need this)
  useEffect(() => {
    setValue(cell.value);
  }, [cell.value]);

  useEffect(() => {
    applyPostValidationErrors();
  }, [postValidationErrors]);

  return (
    <input
      value={value}
      onChange={onChange}
      onBlur={onBlur}
      style={appliedStyle}
    />
  );
};

EditableCell.defaultName = "EditableCell";
