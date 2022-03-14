/* eslint-disable @typescript-eslint/ban-types */
/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable react/jsx-props-no-spreading */
/* eslint react/prop-types: 0 */

import React from 'react';
import styled from 'styled-components';
import { useTable } from 'react-table';

import makeData from './makeData';
// From DefinitelyTyped
declare module 'react-table' {
  interface TableOptions<D extends object> {
    updateMyData: (rowIndex: number, columnId: string, value: any) => void;
  }
}

const Styles = styled.div`
  padding: 1rem;

  table {
    border-spacing: 0;
    border: 1px solid black;

    tr {
      :last-child {
        td {
          border-bottom: 0;
        }
      }
    }

    th,
    td {
      margin: 0;
      padding: 0.5rem;
      border-bottom: 1px solid black;
      border-right: 1px solid black;

      :last-child {
        border-right: 0;
      }

      input {
        font-size: 1rem;
        padding: 0;
        margin: 0;
        border: 0;
      }
    }
  }
`;
// Added types
export interface EditableCellProps {
  value: any;
  row: number;
  column: number;
  updateMyData: Function;
}

// Checked
const EditableCell = ({
  value: initialValue,
  row: { index },
  column: { id },
  updateMyData,
}: EditableCellProps) => {
  const [value, setValue] = React.useState(initialValue);

  const onChange = (e: { target: { value: any } }) => {
    setValue(e.target.value);
  };

  const onBlur = () => {
    updateMyData(index, id, value);
  };

  React.useEffect(() => {
    setValue(initialValue);
  }, [initialValue]);

  return <input value={value} onChange={onChange} onBlur={onBlur} />;
};
// Checked
const defaultColumn = {
  Cell: EditableCell,
};
export interface TableProps {
  columns: any;
  data: any;
  updateMyData: any;
}

// const EnhancedTable = ({
//   columns,
//   data,
//   setData,
//   updateMyData,
//   skipPageReset,
// }) => {
//   const {
//     getTableProps,
//     headerGroups,
//     prepareRow,
//     page,
//     gotoPage,
//     setPageSize,
//     preGlobalFilteredRows,
//     setGlobalFilter,
//     state: { pageIndex, pageSize, selectedRowIds, globalFilter },
//   } = useTable(
//     {
//       columns,
//       data,
//       defaultColumn,
//       autoResetPage: !skipPageReset,
//       // updateMyData isn't part of the API, but
//       // anything we put into these options will
//       // automatically be available on the instance.
//       // That way we can call this function from our
//       // cell renderer!
//       updateMyData,
//     },
//     useGlobalFilter,
//     useSortBy,
//     usePagination,
//     useRowSelect,
//     hooks => {
//       hooks.allColumns.push(columns => [
//         // Let's make a column for selection
//         {
//           id: 'selection',
//           // The header can use the table's getToggleAllRowsSelectedProps method
//           // to render a checkbox.  Pagination is a problem since this will select all
//           // rows even though not all rows are on the current page.  The solution should
//           // be server side pagination.  For one, the clients should not download all
//           // rows in most cases.  The client should only download data for the current page.
//           // In that case, getToggleAllRowsSelectedProps works fine.
//           Header: ({ getToggleAllRowsSelectedProps }) => (
//             <div>
//               <IndeterminateCheckbox {...getToggleAllRowsSelectedProps()} />
//             </div>
//           ),
//           // The cell can use the individual row's getToggleRowSelectedProps method
//           // to the render a checkbox
//           Cell: ({ row }) => (
//             <div>
//               <IndeterminateCheckbox {...row.getToggleRowSelectedProps()} />
//             </div>
//           ),
//         },
//         ...columns,
//       ])
//     }
//   )

function Table({ columns, data, updateMyData }: TableProps) {
  const { getTableProps, getTableBodyProps, headerGroups, prepareRow, rows } =
    useTable({
      columns,
      data,
      defaultColumn,
      updateMyData,
    });

  return (
    <>
      <table {...getTableProps()}>
        <thead>
          {headerGroups.map((headerGroup) => (
            <tr {...headerGroup.getHeaderGroupProps()}>
              {headerGroup.headers.map((column) => (
                <th {...column.getHeaderProps()}>{column.render('Header')}</th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody {...getTableBodyProps()}>
          {rows.map((row) => {
            prepareRow(row);
            return (
              <tr {...row.getRowProps()}>
                {row.cells.map((cell) => {
                  return (
                    <td {...cell.getCellProps()}>{cell.render('Cell')}</td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </>
  );
}

function EditableTable() {
  const columns = React.useMemo(
    () => [
      {
        Header: 'Tree Tag',
        accessor: 'tag', // accessor is the "key" in the data
      },
      {
        Header: 'Sub-quadrat',
        accessor: 'subquadrat',
      },
      {
        Header: 'Species Code',
        accessor: 'spcode',
      },
      {
        Header: 'Diameter',
        accessor: 'dbh',
      },
      {
        Header: 'Height',
        accessor: 'hom',
      },
      {
        Header: 'Codes',
        accessor: 'codes',
      },
    ],
    []
  );

  const [data, setData] = React.useState(() => makeData(20));
  const [skipPageReset, setSkipPageReset] = React.useState(false);

  const updateMyData = (
    rowIndex: string | number,
    columnId: any,
    value: any
  ) => {
    setSkipPageReset(true);
    setData((old: any[]) =>
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
    <Styles>
      <Table
        columns={columns}
        data={data}
        updateMyData={updateMyData}
        skipPageReset={skipPageReset}
      />
    </Styles>
  );
}

export default EditableTable;
