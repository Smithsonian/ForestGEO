import { render } from '@testing-library/react';
import React from 'react';
import data from '../data.json';
import '../stories/ValidationTable.css';

export interface ValidationTableProps {
  error: boolean;
  errorMessage: { [index: number]: string };
}

const headers = [
  { label: 'Tag' },
  { label: 'Subquadrat' },
  { label: 'SpCode' },
  { label: 'DBH' },
  { label: 'Htmeas' },
  { label: 'Codes' },
  { label: 'Comments' },
];

export default function ValidationTable({
  error,
  errorMessage,
}: ValidationTableProps) {
  return (
    <div>
      {
        <>
          <table>
            <thead>
              <tr>
                {headers.map((row) => {
                  // display headers in table row using html array map
                  return <td>{row.label}</td>;
                })}
              </tr>
            </thead>
          </table>

          <div>
            {data.map((data, index) => {
              return (
                <table>
                  <tr>
                    <td>{data.Tag}</td>
                    <td>{data.Subquadrat}</td>
                    <td>{data.SpCode}</td>
                    <td>{data.DBH}</td>
                    <td>{data.Htmeas}</td>
                    <td>{data.Codes}</td>
                    <td>{data.Comments}</td>
                  </tr>
                  <tr className="errorMessage">{errorMessage[index]}</tr>
                </table>
              );
            })}
          </div>
        </>
      }
    </div>
  );
}
