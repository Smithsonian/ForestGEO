import '../CSS/ValidationTable.css';

export interface ValidationTableProps {
  error: boolean;
  errorMessage: { [index: number]: string };
  uploadedData: dataStructure[];
}

export interface dataStructure {
  Tag: string;
  Subquadrat: string;
  SpCode: string;
  DBH: string;
  Htmeas: string;
  Codes: string;
  Comments: string;
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
  uploadedData,
}: ValidationTableProps) {
  return (
    <div>
      {
        <>
          <table>
            <thead>
              <tr>
                {headers.map((row, index) => {
                  return <td key={'header' + index}>{row.label}</td>;
                })}
              </tr>
            </thead>
          </table>

          <div>
            {uploadedData.map((uploadedData: dataStructure, index) => {
              return (
                <table key={'table' + index}>
                  <tbody key={'tbody' + index}>
                    <tr key={index}>
                      <td key={'Tag' + index}>{uploadedData.Tag}</td>
                      <td key={'Subquadrat' + index}>
                        {uploadedData.Subquadrat}
                      </td>
                      <td key={'SpCode' + index}>{uploadedData.SpCode}</td>
                      <td key={'DBH' + index}>{uploadedData.DBH}</td>
                      <td key={'Htmeas' + index}>{uploadedData.Htmeas}</td>
                      <td key={'Codes' + index}>{uploadedData.Codes}</td>
                      <td key={'Comments' + index}>{uploadedData.Comments}</td>
                    </tr>
                    <tr className="errorMessage">
                      <td className="errorMessage">{errorMessage[index]}</td>
                    </tr>
                  </tbody>
                </table>
              );
            })}
          </div>
        </>
      }
    </div>
  );
}
