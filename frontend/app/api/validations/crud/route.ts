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

const POSITIVE_INTEGER_PATTERN = /^[1-9]\d*$/;
const NON_OBJECT_BODY_MESSAGE = 'Request body must be a JSON object';
const INVALID_VALIDATION_ID_MESSAGE = 'validationID must be a positive integer';
const NO_WRITABLE_FIELD_MESSAGE = 'No writable validation fields were provided';
/** The only columns a client may set; ValidationID is the database's to assign and never moves. */
const WRITABLE_VALIDATION_COLUMNS: ReadonlySet<string> = new Set([
  'ProcedureName',
  'Description',
  'Criteria',
  'Definition',
  'ChangelogDefinition',
  'IsEnabled'
]);

/** A positive integer id from the request body; anything else (true, 1.5, "1 OR 1") is refused. */
function parseValidationID(value: unknown): number | undefined {
  const text = typeof value === 'number' || typeof value === 'string' ? String(value) : '';
  const parsed = POSITIVE_INTEGER_PATTERN.test(text) ? Number(text) : NaN;
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

function invalidRequest(message: string): NextResponse {
  return NextResponse.json({ error: message }, { status: HTTPResponses.INVALID_REQUEST });
}

async function readValidationBody(request: NextRequest): Promise<ValidationProceduresRDS | undefined> {
  try {
    const body: unknown = await request.json();
    return body !== null && typeof body === 'object' && !Array.isArray(body) ? (body as ValidationProceduresRDS) : undefined;
  } catch {
    return undefined;
  }
}

/** Keeps only the exact writable column names the mapper produced, so no spelling of a key can reach SET. */
function writableValidationColumns(validationProcedure: ValidationProceduresRDS): Record<string, unknown> {
  const [mappedData] = MapperFactory.getMapper<ValidationProceduresRDS, Record<string, unknown>>('sitespecificvalidations').demapData([validationProcedure]);
  return Object.fromEntries(Object.entries(mappedData).filter(([column]) => WRITABLE_VALIDATION_COLUMNS.has(column)));
}

function validationNotFound(validationID: unknown): NextResponse {
  return NextResponse.json({ error: `Validation ${String(validationID)} not found` }, { status: HTTPResponses.NOT_FOUND });
}

async function readValidationRows(
  connectionManager: ConnectionManager,
  schema: string,
  validationID: unknown,
  transactionID: string
): Promise<ChangelogRowState[]> {
  const rows: ChangelogRowState[] = await connectionManager.executeQuery(safeFormatQuery(schema, SELECT_VALIDATION_FOR_UPDATE), [validationID], transactionID);
  return rows.map(normalizeBitColumns);
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

  const validationProcedure = await readValidationBody(request);
  if (!validationProcedure) return invalidRequest(NON_OBJECT_BODY_MESSAGE);
  const schema = getValidatedSchema(request);
  if (typeof schema !== 'string') return schema;
  const writableColumns = writableValidationColumns(validationProcedure);
  if (Object.keys(writableColumns).length === 0) return invalidRequest(NO_WRITABLE_FIELD_MESSAGE);
  const connectionManager = ConnectionManager.getInstance();
  const transactionID = await connectionManager.beginTransaction();
  try {
    const insertQuery = format('INSERT INTO ?? SET ?', [`${schema}.sitespecificvalidations`, writableColumns]);
    const results = await connectionManager.executeQuery(insertQuery, [], transactionID);
    const insertID = results.insertId;
    const [insertedRow] = await readValidationRows(connectionManager, schema, insertID, transactionID);
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

  const validationProcedure = await readValidationBody(request);
  if (!validationProcedure) return invalidRequest(NON_OBJECT_BODY_MESSAGE);
  const schema = getValidatedSchema(request);
  if (typeof schema !== 'string') return schema;
  const validationID = parseValidationID(validationProcedure.validationID);
  if (validationID === undefined) return invalidRequest(INVALID_VALIDATION_ID_MESSAGE);
  const writableColumns = writableValidationColumns(validationProcedure);
  if (Object.keys(writableColumns).length === 0) return invalidRequest(NO_WRITABLE_FIELD_MESSAGE);
  const connectionManager = ConnectionManager.getInstance();
  const transactionID = await connectionManager.beginTransaction();
  try {
    const [priorRow] = await readValidationRows(connectionManager, schema, validationID, transactionID);
    if (!priorRow) {
      await connectionManager.rollbackTransaction(transactionID);
      return validationNotFound(validationID);
    }

    const updateQuery = format('UPDATE ?? SET ? WHERE ValidationID = ?', [`${schema}.sitespecificvalidations`, writableColumns, validationID]);
    await connectionManager.executeQuery(updateQuery, [], transactionID);
    const [updatedRow] = await readValidationRows(connectionManager, schema, validationID, transactionID);
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

  const validationProcedure = await readValidationBody(request);
  if (!validationProcedure) return invalidRequest(NON_OBJECT_BODY_MESSAGE);
  const schema = getValidatedSchema(request);
  if (typeof schema !== 'string') return schema;
  const validationID = parseValidationID(validationProcedure.validationID);
  if (validationID === undefined) return invalidRequest(INVALID_VALIDATION_ID_MESSAGE);
  const connectionManager = ConnectionManager.getInstance();
  const transactionID = await connectionManager.beginTransaction();
  try {
    const [priorRow] = await readValidationRows(connectionManager, schema, validationID, transactionID);
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
