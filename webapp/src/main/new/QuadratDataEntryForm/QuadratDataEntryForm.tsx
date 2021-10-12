import { useState } from "react";

const StemInput = () => (
  <tr>
    <td>
      <input type="text" />
    </td>
    <td>
      <input type="text" />
    </td>
    <td>
      <input type="text" />
    </td>
    <td>
      <input type="text" />
    </td>
    <td>
      <input type="text" />
    </td>
    <td>
      <input type="text" />
    </td>
    <td>
      <input type="text" />
    </td>
    <td>
      <button type="button">Remove</button>
    </td>
  </tr>
);

export const QuadratDataEntryForm = () => {
  const [stems, setStems] = useState<JSX.Element[]>([]);
  return (
    <>
      <table>
        <thead>
          <tr>
            <th>Subquadrat</th>
            <th>Tag</th>
            <th>StemTag</th>
            <th>SpCode</th>
            <th>DBH</th>
            <th>Codes</th>
            <th>Comments</th>
          </tr>
        </thead>
        <tbody>{stems}</tbody>
        <tfoot>
          <tr>
            <td>
              <button
                type="button"
                onClick={() => {
                  setStems([...stems, StemInput()]);
                }}
              >
                Add stem
              </button>
            </td>
          </tr>
        </tfoot>
      </table>
    </>
  );
};
QuadratDataEntryForm.defaultName = "QuadratDataEntryForm";
