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
            {uploadedData.map((data: dataStructure, index) => {
              return (
                <table key={'table' + index}>
                  <tbody key={'tbody' + index}>
                    <tr key={index}>
                      <td key={'Tag' + index}>{data.Tag}</td>
                      <td key={'Subquadrat' + index}>{data.Subquadrat}</td>
                      <td key={'SpCode' + index}>{data.SpCode}</td>
                      <td key={'DBH' + index}>{data.DBH}</td>
                      <td key={'Htmeas' + index}>{data.Htmeas}</td>
                      <td key={'Codes' + index}>{data.Codes}</td>
                      <td key={'Comments' + index}>{data.Comments}</td>
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
