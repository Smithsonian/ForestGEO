/* eslint-disable react/jsx-props-no-spreading */
import { useTable, Column, TableOptions } from "react-table";
import { ValidationErrorMap } from "../validation/validationError";
import { EditableCell } from "./editableCell";

// React Table uses this definition to make all of the columns for the table,
// Unless otherwise specified.
const defaultColumn = {
  Cell: EditableCell,
};

interface EditableTableProps {
  columns: Column[];
  data: any;
  updateData: Function;
  validationErrors: ValidationErrorMap;
}

export function EditableTable({
  columns,
  data,
  updateData,
  validationErrors,
}: EditableTableProps) {
  const { getTableProps, getTableBodyProps, headerGroups, rows, prepareRow } =
    useTable({
      // Everything specified here will be available to the child Cell renderers
      columns,
      data,
      defaultColumn,
      updateData,
      validationErrors,
    } as TableOptions<any>);
  // Typescript won't allow us to pass the updateData function to useTable
  // because it isn't specified in the type definition...
  // Unless we explicitly cast the object literal as TableOptions.
  // Thanks https://stackoverflow.com/questions/31816061/why-am-i-getting-an-error-object-literal-may-only-specify-known-properties

  return (
    <table {...getTableProps}>
      <thead>
        {headerGroups.map((headerGroup) => (
          <tr {...headerGroup.getHeaderGroupProps()}>
            {headerGroup.headers.map((column) => (
              <th {...column.getHeaderProps()} id={column.Header?.toString()}>
                {column.render("Header")}
              </th>
            ))}
          </tr>
        ))}
      </thead>
      <tbody {...getTableBodyProps()}>
        {rows.map((row, i) => {
          prepareRow(row);
          return (
            <tr {...row.getRowProps()}>
              {row.cells.map((cell) => (
                <td {...cell.getCellProps()}>{cell.render("Cell")}</td>
              ))}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

EditableTable.defaultName = "EditableTable";
