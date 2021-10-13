/* eslint-disable react/jsx-props-no-spreading */
import { useState, useEffect, useMemo } from "react";
import { useTable, Column, Cell, TableOptions, Row } from "react-table";

import { mockCensusData } from "../../../mockData/mockCensusData";

interface EditableCellProps {
  row: Row;
  column: Column;
  updateData: Function;
  cell: Cell;
}

const EditableCell = ({ row, column, updateData, cell }: EditableCellProps) => {
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
  };

  // Respond to any external changes in the input field
  // (I don't know if we actually need this)
  useEffect(() => {
    setValue(cell.value);
  }, [cell.value]);

  return <input value={value} onChange={onChange} onBlur={onBlur} />;
};

// React Table uses this definition to make all of the columns for the table,
// Unless otherwise specified.
const defaultColumn = {
  Cell: EditableCell,
};

interface TableProps {
  columns: Column[];
  data: any;
  updateData: Function;
}

function Table({ columns, data, updateData }: TableProps) {
  const { getTableProps, getTableBodyProps, headerGroups, rows, prepareRow } =
    useTable({
      // Everything specified here will be available to the child Cell renderers
      columns,
      data,
      defaultColumn,
      updateData,
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
              <th {...column.getHeaderProps()}>{column.render("Header")}</th>
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

export function QuadratDataEntryForm() {
  const columns = useMemo(
    () => [
      {
        Header: "Tag",
        accessor: "Tag",
      },
      {
        Header: "Subquadrat",
        accessor: "Subquadrat",
      },
      {
        Header: "SpCode",
        accessor: "SpCode",
      },
      {
        Header: "DBH",
        accessor: "DBH",
      },
      {
        Header: "Htmeas",
        accessor: "Htmeas",
      },
      {
        Header: "Codes",
        accessor: "Codes",
      },
      {
        Header: "Comments",
        accessor: "Comments",
      },
    ],
    []
  );

  const [data, setData] = useState(useMemo(() => mockCensusData, []));

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

  return <Table columns={columns} data={data} updateData={updateData} />;
}
QuadratDataEntryForm.defaultName = "QuadratDataEntryForm";
