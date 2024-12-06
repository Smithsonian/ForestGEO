import { SpecialProcessingProps } from '@/config/macros';

export async function processFinalizeCensus(props: Readonly<SpecialProcessingProps>): Promise<void> {
  const { connectionManager, rowData, schema, plotID, censusID } = props;
  if (!plotID || !censusID) {
    console.error('Missing required parameters: plotID or censusID');
    throw new Error('Process Census: Missing plotID or censusID');
  }

  // Update Census Start/End Dates
  const combinedQuery = `
      UPDATE ${schema}.census c
      JOIN (
        SELECT CensusID, MIN(MeasurementDate) AS FirstMeasurementDate, MAX(MeasurementDate) AS LastMeasurementDate
        FROM ${schema}.coremeasurements
        WHERE CensusID = ${censusID}
        GROUP BY CensusID
      ) m ON c.CensusID = m.CensusID
      SET c.StartDate = m.FirstMeasurementDate, c.EndDate = m.LastMeasurementDate
      WHERE c.CensusID = ${censusID};`;

  await connectionManager.executeQuery(combinedQuery);
}
