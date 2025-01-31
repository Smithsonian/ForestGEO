import { SpecialProcessingProps } from '@/config/macros';

export async function processFinalizeCensus(props: Readonly<SpecialProcessingProps>): Promise<void> {
  const { connectionManager, rowData, schema, plot, census } = props;
  if (!plot || !census) {
    console.error('Missing required parameters: plotID or censusID');
    throw new Error('Process Census: Missing plotID or censusID');
  }

  // Update Census Start/End Dates
  const combinedQuery = `
    UPDATE ${schema}.census c
      JOIN (SELECT CensusID, MIN(MeasurementDate) AS FirstMeasurementDate, MAX(MeasurementDate) AS LastMeasurementDate
            FROM ${schema}.coremeasurements
            WHERE CensusID = ${census.dateRanges[0].censusID}
            GROUP BY CensusID) m ON c.CensusID = m.CensusID
    SET c.StartDate = m.FirstMeasurementDate,
        c.EndDate   = m.LastMeasurementDate
    WHERE c.CensusID = ${census.dateRanges[0].censusID};`;

  await connectionManager.executeQuery(combinedQuery);
}
