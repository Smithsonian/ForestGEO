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
import { ChangelogOperation, normalizeBitColumns, recordMutation, type ChangelogRowState } from '@/lib/changelog/record-mutation';

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

const VALIDATION_ID_COLUMN = 'validationid';
const POSITIVE_INTEGER_PATTERN = /^[1-9]\d*$/;

/** A positive integer id from the request body; anything else (true, 1.5, "1 OR 1") is refused. */
function parseValidationID(value: unknown): number | undefined {
  const text = typeof value === 'number' || typeof value === 'string' ? String(value) : '';
  const parsed = POSITIVE_INTEGER_PATTERN.test(text) ? Number(text) : NaN;
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

function invalidValidationID(): NextResponse {
  return NextResponse.json({ error: 'validationID must be a positive integer' }, { status: HTTPResponses.INVALID_REQUEST });
}

/**
 * The mapper turns `validationID` into `ValIDationID`, which MySQL matches to the
 * ValidationID column case-insensitively; every spelling is dropped so a client can
 * never choose or move a primary key.
 */
function withoutValidationID(mappedData: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(mappedData).filter(([column]) => column.toLowerCase() !== VALIDATION_ID_COLUMN));
}

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
  return rows[0] ? normalizeBitColumns(rows[0]) : undefined;
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

    const insertQuery = format('INSERT INTO ?? SET ?', [`${schema}.sitespecificvalidations`, withoutValidationID(mappedData)]);
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
  const validationID = parseValidationID(validationProcedure.validationID);
  if (validationID === undefined) return invalidValidationID();
  const connectionManager = ConnectionManager.getInstance();
  const transactionID = await connectionManager.beginTransaction();
  try {
    const priorRow = await readValidationRow(connectionManager, schema, validationID, transactionID);
    if (!priorRow) {
      await connectionManager.rollbackTransaction(transactionID);
      return validationNotFound(validationID);
    }

    const mapper = MapperFactory.getMapper<ValidationProceduresRDS, any>('sitespecificvalidations');
    const [mappedData] = mapper.demapData([validationProcedure]);

    const updateQuery = format('UPDATE ?? SET ? WHERE ValidationID = ?', [`${schema}.sitespecificvalidations`, withoutValidationID(mappedData), validationID]);
    await connectionManager.executeQuery(updateQuery, [], transactionID);
    const updatedRow = await readValidationRow(connectionManager, schema, validationID, transactionID);
    if (!updatedRow) throw new Error(`Validation ${validationID} vanished during its own update`);
    await recordMutation({
      tx: toTxExecutor(connectionManager, transactionID),
      schema,
      tableName: VALIDATIONS_TABLE_NAME,
      recordID: validationID,
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
  const validationID = parseValidationID(validationProcedure.validationID);
  if (validationID === undefined) return invalidValidationID();
  const connectionManager = ConnectionManager.getInstance();
  const transactionID = await connectionManager.beginTransaction();
  try {
    const priorRow = await readValidationRow(connectionManager, schema, validationID, transactionID);
    if (!priorRow) {
      await connectionManager.rollbackTransaction(transactionID);
      return validationNotFound(validationID);
    }

    const deleteQuery = format('DELETE FROM ?? WHERE ValidationID = ?', [`${schema}.sitespecificvalidations`, validationID]);
    await connectionManager.executeQuery(deleteQuery, [], transactionID);
    await recordMutation({
      tx: toTxExecutor(connectionManager, transactionID),
      schema,
      tableName: VALIDATIONS_TABLE_NAME,
      recordID: validationID,
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
