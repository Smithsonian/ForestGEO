import { NextRequest, NextResponse } from 'next/server';
import { ValidationProceduresRDS } from '@/lib/db/definitions/validations';
import { format } from 'mysql2/promise';
import { HTTPResponses } from '@/config/macros';
import MapperFactory from '@/config/datamapper';
import ConnectionManager from '@/lib/db/connectionmanager';
import ailogger from '@/ailogger';
import { auth } from '@/auth';
import { requireAdmin } from '@/lib/auth-helpers';
import { safeFormatQuery, validateSchemaOrThrow } from '@/lib/db/sqlsecurity';
import { toTxExecutor } from '@/config/utils';
import { authenticatedSessionIdentity } from '@/lib/changelog/identity';
import { ChangelogOperation, recordMutation, type ChangelogRowState } from '@/lib/changelog/record-mutation';

// Force Node.js runtime for database and Azure SDK compatibility
// mysql2 and @azure/storage-* are not compatible with Edge Runtime
export const runtime = 'nodejs';

function getValidatedSchema(request: NextRequest): string | NextResponse {
  const schema = request.nextUrl.searchParams.get('schema');
  if (!schema) {
    return NextResponse.json({ error: 'No schema variable provided' }, { status: HTTPResponses.INVALID_REQUEST });
  }
  try {
    validateSchemaOrThrow(schema);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Invalid schema';
    return NextResponse.json({ error: message }, { status: HTTPResponses.INVALID_REQUEST });
  }
  return schema;
}

const VALIDATIONS_TABLE_NAME = 'sitespecificvalidations';
const SELECT_VALIDATION_FOR_UPDATE = 'SELECT * FROM ??.sitespecificvalidations WHERE ValidationID = ? FOR UPDATE';

function validationNotFound(validationID: unknown): NextResponse {
  return NextResponse.json({ error: `Validation ${String(validationID)} not found` }, { status: HTTPResponses.NOT_FOUND });
}

async function readValidationRow(
  connectionManager: ConnectionManager,
  schema: string,
  validationID: unknown,
  transactionID: string
): Promise<ChangelogRowState | undefined> {
  const rows: ChangelogRowState[] = await connectionManager.executeQuery(safeFormatQuery(schema, SELECT_VALIDATION_FOR_UPDATE), [validationID], transactionID);
  return rows[0];
}

export async function GET(request: NextRequest) {
  const authError = requireAdmin(await auth());
  if (authError) return authError;

  const connectionManager = ConnectionManager.getInstance();
  const schema = getValidatedSchema(request);
  if (typeof schema !== 'string') return schema;
  try {
    const query = format('SELECT * FROM ??.sitespecificvalidations;', [schema]);
    const results = await connectionManager.executeQuery(query);
    return new NextResponse(JSON.stringify(MapperFactory.getMapper<any, any>('sitespecificvalidations').mapData(results)), { status: HTTPResponses.OK });
  } catch (error: any) {
    ailogger.error('Error:', error);
    return NextResponse.json({}, { status: HTTPResponses.CONFLICT });
  } finally {
    await connectionManager.closeConnection();
  }
}

export async function POST(request: NextRequest) {
  const session = await auth();
  const authError = requireAdmin(session);
  if (authError) return authError;

  const validationProcedure: ValidationProceduresRDS = await request.json();
  const schema = getValidatedSchema(request);
  if (typeof schema !== 'string') return schema;
  const connectionManager = ConnectionManager.getInstance();
  const transactionID = await connectionManager.beginTransaction();
  try {
    const mapper = MapperFactory.getMapper<ValidationProceduresRDS, any>('sitespecificvalidations');
    const [mappedData] = mapper.demapData([validationProcedure]);

    // Remove ValidationID - let the database auto-increment handle it
    delete mappedData['ValidationID'];

    const insertQuery = format('INSERT INTO ?? SET ?', [`${schema}.sitespecificvalidations`, mappedData]);
    const results = await connectionManager.executeQuery(insertQuery, [], transactionID);
    const insertID = results.insertId;
    const insertedRow = await readValidationRow(connectionManager, schema, insertID, transactionID);
    if (!insertedRow) throw new Error(`Validation ${insertID} vanished immediately after its own insert`);
    await recordMutation({
      tx: toTxExecutor(connectionManager, transactionID),
      schema,
      tableName: VALIDATIONS_TABLE_NAME,
      recordID: insertID,
      operation: ChangelogOperation.INSERT,
      newRowState: insertedRow,
      changedBy: authenticatedSessionIdentity(session?.user)
    });
    await connectionManager.commitTransaction(transactionID);
    return NextResponse.json({ insertID, validationID: insertID }, { status: HTTPResponses.OK });
  } catch (error: any) {
    ailogger.error('Error:', error);
    await connectionManager.rollbackTransaction(transactionID);
    return NextResponse.json({}, { status: HTTPResponses.CONFLICT });
  } finally {
    await connectionManager.closeConnection();
  }
}

export async function PATCH(request: NextRequest) {
  const session = await auth();
  const authError = requireAdmin(session);
  if (authError) return authError;

  const validationProcedure: ValidationProceduresRDS = await request.json();
  const schema = getValidatedSchema(request);
  if (typeof schema !== 'string') return schema;
  const connectionManager = ConnectionManager.getInstance();
  const transactionID = await connectionManager.beginTransaction();
  try {
    const priorRow = await readValidationRow(connectionManager, schema, validationProcedure.validationID, transactionID);
    if (!priorRow) {
      await connectionManager.rollbackTransaction(transactionID);
      return validationNotFound(validationProcedure.validationID);
    }

    const mapper = MapperFactory.getMapper<ValidationProceduresRDS, any>('sitespecificvalidations');
    const [mappedData] = mapper.demapData([validationProcedure]);

    // Remove ValidationID from the update data (it's the WHERE clause, not SET)
    delete mappedData['ValidationID'];

    const updateQuery = format('UPDATE ?? SET ? WHERE ValidationID = ?', [`${schema}.sitespecificvalidations`, mappedData, validationProcedure.validationID]);
    await connectionManager.executeQuery(updateQuery, [], transactionID);
    const updatedRow = await readValidationRow(connectionManager, schema, validationProcedure.validationID, transactionID);
    if (!updatedRow) throw new Error(`Validation ${validationProcedure.validationID} vanished during its own update`);
    await recordMutation({
      tx: toTxExecutor(connectionManager, transactionID),
      schema,
      tableName: VALIDATIONS_TABLE_NAME,
      recordID: Number(priorRow.ValidationID),
      operation: ChangelogOperation.UPDATE,
      oldRowState: priorRow,
      newRowState: updatedRow,
      changedBy: authenticatedSessionIdentity(session?.user)
    });
    await connectionManager.commitTransaction(transactionID);
    return NextResponse.json({}, { status: HTTPResponses.OK });
  } catch (error: any) {
    ailogger.error('Error:', error);
    await connectionManager.rollbackTransaction(transactionID);
    return NextResponse.json({}, { status: HTTPResponses.CONFLICT });
  } finally {
    await connectionManager.closeConnection();
  }
}

export async function DELETE(request: NextRequest) {
  const session = await auth();
  const authError = requireAdmin(session);
  if (authError) return authError;

  const validationProcedure: ValidationProceduresRDS = await request.json();
  const schema = getValidatedSchema(request);
  if (typeof schema !== 'string') return schema;
  const connectionManager = ConnectionManager.getInstance();
  const transactionID = await connectionManager.beginTransaction();
  try {
    const priorRow = await readValidationRow(connectionManager, schema, validationProcedure.validationID, transactionID);
    if (!priorRow) {
      await connectionManager.rollbackTransaction(transactionID);
      return validationNotFound(validationProcedure.validationID);
    }

    const deleteQuery = format('DELETE FROM ?? WHERE ValidationID = ?', [`${schema}.sitespecificvalidations`, validationProcedure.validationID]);
    await connectionManager.executeQuery(deleteQuery, [], transactionID);
    await recordMutation({
      tx: toTxExecutor(connectionManager, transactionID),
      schema,
      tableName: VALIDATIONS_TABLE_NAME,
      recordID: Number(priorRow.ValidationID),
      operation: ChangelogOperation.DELETE,
      oldRowState: priorRow,
      changedBy: authenticatedSessionIdentity(session?.user)
    });
    await connectionManager.commitTransaction(transactionID);
    return NextResponse.json({}, { status: HTTPResponses.OK });
  } catch (error: any) {
    ailogger.error('Error:', error);
    await connectionManager.rollbackTransaction(transactionID);
    return NextResponse.json({}, { status: HTTPResponses.CONFLICT });
  } finally {
    await connectionManager.closeConnection();
  }
}
