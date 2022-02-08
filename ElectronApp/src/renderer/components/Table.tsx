import React from 'react';
import { useTable } from 'react-table';

export default function Table() {
  const data = React.useMemo(
    () => [
      {
        tag: '000001',
        subquadrat: '11',
        spcode: 'protte',
        dbh: '',
        hom: '1.3',
        codes: '',
        comments: '',
      },
      {
        tag: '000002',
        subquadrat: '11',
        spcode: 'coccpa',
        dbh: '',
        hom: '1.3',
        codes: '',
        comments: '',
      },
    ],
    []
  );

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
      {
        Header: 'Comments',
        accessor: 'comments',
      },
    ],
    []
  );

  const { getTableProps, getTableBodyProps, headerGroups, rows, prepareRow } =
    useTable({ columns, data });

  return (
    <table {...getTableProps()} style={{ border: 'solid 1px blue' }}>
      <thead>
        {headerGroups.map((headerGroup) => (
          <tr {...headerGroup.getHeaderGroupProps()}>
            {headerGroup.headers.map((column) => (
              <th
                {...column.getHeaderProps()}
                style={{
                  borderBottom: 'solid 3px red',
                  background: 'aliceblue',
                  color: 'black',
                  fontWeight: 'bold',
                }}
              >
                {column.render('Header')}
              </th>
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
                  <td
                    {...cell.getCellProps()}
                    style={{
                      padding: '10px',
                      border: 'solid 1px gray',
                      background: 'papayawhip',
                    }}
                  >
                    {cell.render('Cell')}
                  </td>
                );
              })}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
