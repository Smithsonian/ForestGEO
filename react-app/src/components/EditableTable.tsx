/* eslint-disable @typescript-eslint/ban-types */
/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable react/jsx-props-no-spreading */
/* eslint react/prop-types: 0 */

import React from 'react';
import styled from 'styled-components';
import { useTable, usePagination } from 'react-table';

import makeData from './makeData';

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

export interface EditableCellProps {
  value: any;
  row: any;
  column: any;
  updateMyData: Function;
}

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

const defaultColumn = {
  Cell: EditableCell,
};
export interface TableProps {
  columns: any;
  data: any;
  updateMyData: any;
}

function Table({ columns, data, updateMyData }: TableProps) {
  const { getTableProps, getTableBodyProps, headerGroups, prepareRow, rows } =
    useTable(
      {
        columns,
        data,
        defaultColumn,
        updateMyData,
      },
      usePagination
    );

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

  const updateMyData = (
    rowIndex: string | number,
    columnId: any,
    value: any
  ) => {
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
      <Table columns={columns} data={data} updateMyData={updateMyData} />
    </Styles>
  );
}

export default EditableTable;
