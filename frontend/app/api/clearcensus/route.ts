import { NextRequest, NextResponse } from 'next/server';
import { HTTPResponses } from '@/config/macros';
import ConnectionManager from '@/config/connectionmanager';

export async function GET(request: NextRequest) {
  const schema = request.nextUrl.searchParams.get('schema');
  const censusIDParam = request.nextUrl.searchParams.get('censusID');
  if (!schema || !censusIDParam) {
    return new NextResponse('Missing required parameters', { status: HTTPResponses.SERVICE_UNAVAILABLE });
  }
  const censusID = parseInt(censusIDParam);
  const connectionManager = ConnectionManager.getInstance();
  const transactionID = await connectionManager.beginTransaction();
  try {
    let query = `DELETE FROM ${schema}.cmverrors WHERE CoreMeasurementID IN (SELECT CoreMeasurementID FROM ${schema}.coremeasurements WHERE CensusID = ${censusID});`;
    await connectionManager.executeQuery(query);
    query = `DELETE FROM ${schema}.cmattributes WHERE CoreMeasurementID IN (SELECT CoreMeasurementID FROM ${schema}.coremeasurements WHERE CensusID = ${censusID});`;
    await connectionManager.executeQuery(query);
    query = `DELETE FROM ${schema}.coremeasurements WHERE CensusID = ${censusID};`;
    await connectionManager.executeQuery(query);
    query = `DELETE FROM ${schema}.quadratpersonnel WHERE PersonnelID IN (SELECT PersonnelID FROM ${schema}.personnel WHERE CensusID = ${censusID});`;
    await connectionManager.executeQuery(query);
    query = `DELETE FROM ${schema}.personnel WHERE CensusID = ${censusID};`;
    await connectionManager.executeQuery(query);
    query = `DELETE FROM ${schema}.specieslimits WHERE CensusID = ${censusID};`;
    await connectionManager.executeQuery(query);
    query = `DELETE FROM ${schema}.censusquadrat WHERE CensusID = ${censusID};`;
    await connectionManager.executeQuery(query);
    query = `DELETE FROM ${schema}.quadrats WHERE QuadratID IN (SELECT QuadratID FROM ${schema}.censusquadrat WHERE CensusID = ${censusID});`;
    await connectionManager.executeQuery(query);
    query = `DELETE FROM ${schema}.census WHERE CensusID = ${censusID};`;
    await connectionManager.executeQuery(query);
    query = `ALTER TABLE ${schema}.cmverrors AUTO_INCREMENT = 1;`;
    await connectionManager.executeQuery(query);
    query = `ALTER TABLE ${schema}.cmattributes AUTO_INCREMENT = 1;`;
    await connectionManager.executeQuery(query);
    query = `ALTER TABLE ${schema}.coremeasurements AUTO_INCREMENT = 1;`;
    await connectionManager.executeQuery(query);
    query = `ALTER TABLE ${schema}.quadratpersonnel AUTO_INCREMENT = 1;`;
    await connectionManager.executeQuery(query);
    query = `ALTER TABLE ${schema}.personnel AUTO_INCREMENT = 1;`;
    await connectionManager.executeQuery(query);
    query = `ALTER TABLE ${schema}.specieslimits AUTO_INCREMENT = 1;`;
    await connectionManager.executeQuery(query);
    query = `ALTER TABLE ${schema}.censusquadrat AUTO_INCREMENT = 1;`;
    await connectionManager.executeQuery(query);
    query = `ALTER TABLE ${schema}.quadrats AUTO_INCREMENT = 1;`;
    await connectionManager.executeQuery(query);
    query = `ALTER TABLE ${schema}.census AUTO_INCREMENT = 1;`;
    await connectionManager.executeQuery(query);
    await connectionManager.commitTransaction(transactionID);
    return NextResponse.json({ message: 'Census cleared successfully' }, { status: HTTPResponses.OK });
  } catch (e: any) {
    await connectionManager.rollbackTransaction(transactionID);
    return new NextResponse(e.message, { status: HTTPResponses.SERVICE_UNAVAILABLE });
  }
}
