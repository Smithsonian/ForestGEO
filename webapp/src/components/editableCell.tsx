import { useState, useEffect } from "react";
import { Column, Cell, Row } from "react-table";
import { ValidationErrorMap } from "../validation/validationError";

interface EditableCellProps {
  row: Row;
  column: Column;
  updateData: Function;
  cell: Cell;
  validationErrors: ValidationErrorMap;
}

export const EditableCell = ({
  row,
  column,
  updateData,
  cell,
  validationErrors,
}: EditableCellProps) => {
  const errorStyle = { border: "1px solid red" };
  const notAnErrorStyle = { border: "1px solid black" };

  const [value, setValue] = useState(cell.value);

  // Make the input field reflect changes as we type
  const onChange = (e: React.FormEvent<HTMLInputElement>) => {
    if (e && e.currentTarget) {
      setValue(e.currentTarget.value);
    }
  };

  // Respond to any external changes in the input field
  // (I don't know if we actually need this)
  useEffect(() => {
    setValue(cell.value);
  }, [cell.value]);

  // Wait to actually update the table state when we unfocus the input field
  const onBlur = () => {
    console.log(row.index, column.Header, value);
    updateData(row.index, column.Header, value);
  };

  function applyValidationErrorStyles(): Object {
    console.log("handlepostvalidate");

    // FIXME: Force unwrapping the header could cause null reference
    // errors if it is not populated. Should add a safe access operator.
    const cellErrors = validationErrors.getValidationErrors(
      row.index,
      column.Header!.toString()
    );

    let style = {};
    if (cellErrors.size > 0) {
      style = errorStyle;
    } else {
      style = notAnErrorStyle;
    }

    return style;
  }

  return (
    <input
      value={value}
      onChange={onChange}
      onBlur={onBlur}
      style={applyValidationErrorStyles()}
    />
  );
};

EditableCell.defaultName = "EditableCell";
