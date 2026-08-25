import { NextRequest, NextResponse } from 'next/server';
import ConnectionManager from '@/lib/db/connectionmanager';
import MapperFactory from '@/config/datamapper';
import { HTTPResponses } from '@/config/macros';
import { auth } from '@/auth';
import { requireAdmin } from '@/lib/auth-helpers';
import { invalidatePermissions } from '@/lib/permissionscache';
import { format } from 'mysql2/promise';
import ailogger from '@/ailogger';

// Force Node.js runtime for database and Azure SDK compatibility
// mysql2 and @azure/storage-* are not compatible with Edge Runtime
export const runtime = 'nodejs';

const ADMIN_RESOURCE_TYPES = new Set(['users', 'sites', 'usersiterelations']);
const USER_STATUSES = new Set(['global', 'db admin', 'lead technician', 'field crew']);

function invalidResourceType(type: string): NextResponse | null {
  return ADMIN_RESOURCE_TYPES.has(type)
    ? null
    : NextResponse.json({ message: 'Unsupported administrative resource' }, { status: HTTPResponses.INVALID_REQUEST });
}

function parseNewUser(value: unknown): { firstName: string; lastName: string; email: string; notifications: boolean; userStatus: string } | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  const firstName = typeof row.firstName === 'string' ? row.firstName.trim() : '';
  const lastName = typeof row.lastName === 'string' ? row.lastName.trim() : '';
  const email = typeof row.email === 'string' ? row.email.trim().toLowerCase() : '';
  const userStatus = typeof row.userStatus === 'string' ? row.userStatus.trim().toLowerCase() : '';
  const notifications = row.notifications === true;
  if (!firstName || !lastName || firstName.length > 100 || lastName.length > 100) return null;
  if (email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  if (!USER_STATUSES.has(userStatus)) return null;
  if (row.notifications !== undefined && typeof row.notifications !== 'boolean') return null;
  return { firstName, lastName, email, notifications, userStatus };
}

function getEmailFromRow(row: unknown): string | undefined {
  if (!row || typeof row !== 'object') return undefined;
  const candidate = row as { email?: unknown; Email?: unknown };
  const email = candidate.email ?? candidate.Email;
  return typeof email === 'string' && email.trim() ? email : undefined;
}

function invalidateAdminPermissionsChange(type: string, oldRow?: unknown, newRow?: unknown): void {
  if (type === 'users') {
    const emails = new Set([getEmailFromRow(oldRow), getEmailFromRow(newRow)].filter((email): email is string => Boolean(email)));
    if (emails.size === 0) {
      invalidatePermissions();
      return;
    }
    for (const email of emails) invalidatePermissions(email);
    return;
  }

  if (type === 'sites' || type === 'usersiterelations') {
    invalidatePermissions();
  }
}

async function rollbackIfStarted(connectionManager: ConnectionManager, transactionID: string | undefined): Promise<void> {
  if (!transactionID) return;
  try {
    await connectionManager.rollbackTransaction(transactionID);
  } catch (error) {
    ailogger.error('Failed to roll back administrative catalog transaction', error instanceof Error ? error : new Error(String(error)));
  }
}

export async function GET(request: NextRequest, props: { params: Promise<{ type: string }> }) {
  const session = await auth();
  const authError = requireAdmin(session);
  if (authError) return authError;

  const { type } = await props.params;
  const typeError = invalidResourceType(type);
  if (typeError) return typeError;
  const connectionManager = ConnectionManager.getInstance();

  // The ?email= query param is a UI/format flag, not auth. When present,
  // the IsolatedDataGridCommons grid expects the paginated response shape
  // { output, totalCount, finishedQuery }. Auth is enforced above via
  // requireAdmin(await auth()).
  const usePaginatedFormat = request.nextUrl.searchParams.has('email');

  try {
    let query = '';
    switch (type) {
      case 'users':
      case 'sites':
        query = `SELECT * FROM catalog.${type};`;
        break;
      case 'usersiterelations':
        query = `SELECT usr.UserSiteRelationID as UserSiteRelationID,
                        u.UserID as UserID,
                        CONCAT(u.FirstName, ' ', u.LastName) as UserName,
                        s.SiteName as SiteName,
                        s.SiteID as SiteID
                        FROM catalog.usersiterelations usr
                        JOIN catalog.users u on usr.UserID = u.UserID
                        JOIN catalog.sites s on usr.SiteID = s.SiteID;`;
    }
    const results = await connectionManager.executeQuery(query);

    const mappedData = MapperFactory.getMapper<any, any>(type).mapData(results);

    if (usePaginatedFormat) {
      return new NextResponse(
        JSON.stringify({
          output: mappedData,
          totalCount: mappedData.length,
          finishedQuery: query
        }),
        { status: HTTPResponses.OK }
      );
    }
    return new NextResponse(JSON.stringify(mappedData), { status: HTTPResponses.OK });
  } catch {
    return new NextResponse(JSON.stringify({ message: 'BREAKAGE' }), { status: HTTPResponses.CONFLICT });
  }
}

export async function POST(request: NextRequest, props: { params: Promise<{ type: string }> }) {
  const session = await auth();
  const authError = requireAdmin(session);
  if (authError) return authError;

  const { type } = await props.params;
  const typeError = invalidResourceType(type);
  if (typeError) return typeError;
  const connectionManager = ConnectionManager.getInstance();

  let newRow: unknown;
  try {
    ({ newRow } = (await request.json()) as { newRow?: unknown });
  } catch {
    return NextResponse.json({ message: 'Request body must be valid JSON' }, { status: HTTPResponses.INVALID_REQUEST });
  }
  let user: ReturnType<typeof parseNewUser> = null;
  if (type === 'users') {
    user = parseNewUser(newRow);
    if (!user) {
      return NextResponse.json({ message: 'First name, last name, a valid email, and a valid role are required' }, { status: HTTPResponses.INVALID_REQUEST });
    }
  } else if (!newRow || typeof newRow !== 'object' || Array.isArray(newRow)) {
    return NextResponse.json({ message: 'A row object is required' }, { status: HTTPResponses.INVALID_REQUEST });
  }
  let transactionID: string | undefined;
  try {
    transactionID = await connectionManager.beginTransaction();
    if (user) {
      const result = await connectionManager.executeQuery(
        'INSERT INTO catalog.users (FirstName, LastName, Email, Notifications, UserStatus) VALUES (?, ?, ?, ?, ?)',
        [user.firstName, user.lastName, user.email, user.notifications, user.userStatus],
        transactionID
      );
      const userID = Number(result.insertId);
      if (!Number.isInteger(userID) || userID <= 0) throw new Error('User insert did not return a valid identifier');
      await connectionManager.commitTransaction(transactionID);
      invalidateAdminPermissionsChange(type, undefined, user);
      return NextResponse.json({ message: 'Successfully inserted', userID }, { status: HTTPResponses.OK });
    }
    // Grid rows arrive camelCase with grid-only scaffold fields; demap to the
    // PascalCase column names (demapData drops `id`; `isNew` is grid state).
    const { isNew: _isNew, ...rowFields } = newRow as Record<string, unknown>;
    const mappedRow = MapperFactory.getMapper<any, any>(type).demapData([rowFields])[0];
    const insertQuery = format(`INSERT INTO ?? SET ?`, [`catalog.${type}`, mappedRow]);
    await connectionManager.executeQuery(insertQuery, undefined, transactionID);
    await connectionManager.commitTransaction(transactionID);
    invalidateAdminPermissionsChange(type, undefined, newRow);
  } catch (error) {
    await rollbackIfStarted(connectionManager, transactionID);
    ailogger.error(`Administrative insertion failed for ${type}`, error instanceof Error ? error : new Error(String(error)));
    return NextResponse.json({ message: `Insertion into catalog.${type} failed` }, { status: HTTPResponses.INVALID_REQUEST });
  }
  return new NextResponse(JSON.stringify({ message: 'Successfully inserted' }), { status: HTTPResponses.OK });
}

export async function PATCH(request: NextRequest, props: { params: Promise<{ type: string }> }) {
  const session = await auth();
  const authError = requireAdmin(session);
  if (authError) return authError;

  const { type } = await props.params;
  const typeError = invalidResourceType(type);
  if (typeError) return typeError;
  const connectionManager = ConnectionManager.getInstance();

  const gridID = type === 'sites' ? 'SiteID' : 'UserID';
  let oldRow: Record<string, any>;
  let newRow: Record<string, any>;
  try {
    const body = (await request.json()) as { oldRow?: unknown; newRow?: unknown };
    if (!body.oldRow || typeof body.oldRow !== 'object' || !body.newRow || typeof body.newRow !== 'object') throw new Error('Invalid row payload');
    oldRow = body.oldRow as Record<string, any>;
    newRow = body.newRow as Record<string, any>;
  } catch {
    return NextResponse.json({ message: 'oldRow and newRow objects are required' }, { status: HTTPResponses.INVALID_REQUEST });
  }
  const oldUserSites = oldRow.userSites;
  const newUserSites = newRow.userSites;
  const { notifications: oldNotifications, userSites: _, ...oldRowRemaining } = oldRow;
  const { notifications: newNotifications, userSites: __, ...newRowRemaining } = newRow;
  // Only include notifications for users table, not sites
  if (type === 'users') {
    oldRowRemaining.notifications = oldNotifications;
    newRowRemaining.notifications = newNotifications;
  }
  const mappedOldRow = MapperFactory.getMapper<any, any>(type).demapData([oldRowRemaining])[0];
  const mappedNewRow = MapperFactory.getMapper<any, any>(type).demapData([newRowRemaining])[0];
  let transactionID: string | undefined;
  try {
    transactionID = await connectionManager.beginTransaction();
    if (Array.isArray(oldUserSites) || Array.isArray(newUserSites)) {
      const newSites = Array.isArray(newUserSites) ? newUserSites : [];
      const updatedSites = Array.from(new Set(newSites.map((s: any) => s.siteID!))).map(i => [newRowRemaining.userID, i]);
      const deleteQuery = format(`DELETE FROM ?? WHERE UserID = ?`, [`catalog.usersiterelations`, newRowRemaining.userID]);
      await connectionManager.executeQuery(deleteQuery, undefined, transactionID);
      if (updatedSites.length > 0) {
        const insertQuery = format('INSERT INTO ?? (UserID, SiteID) VALUES ?', ['catalog.usersiterelations', updatedSites]);
        await connectionManager.executeQuery(insertQuery, undefined, transactionID);
      }
    }
    const { UserSites, [gridID]: _gridIdValue, ...remaining } = mappedNewRow;
    const updateQuery = format(`UPDATE ?? SET ? WHERE ?? = ?`, [`catalog.${type}`, remaining, gridID, mappedOldRow[gridID]]);
    await connectionManager.executeQuery(updateQuery, undefined, transactionID);
    await connectionManager.commitTransaction(transactionID);
    invalidateAdminPermissionsChange(type, oldRow, newRow);
  } catch (error) {
    await rollbackIfStarted(connectionManager, transactionID);
    ailogger.error(`Administrative update failed for ${type}`, error instanceof Error ? error : new Error(String(error)));
    return NextResponse.json({ message: `Update of catalog.${type} failed` }, { status: HTTPResponses.INVALID_REQUEST });
  }
  return new NextResponse(JSON.stringify({ message: 'Successfully updated' }), { status: HTTPResponses.OK });
}

export async function DELETE(request: NextRequest, props: { params: Promise<{ type: string }> }) {
  const session = await auth();
  const authError = requireAdmin(session);
  if (authError) return authError;

  const { type } = await props.params;
  const typeError = invalidResourceType(type);
  if (typeError) return typeError;
  const connectionManager = ConnectionManager.getInstance();

  const gridID = type === 'sites' ? 'SiteID' : type == 'users' ? 'UserID' : 'UserSiteRelationID';
  if (type === 'sites') return NextResponse.json({ message: 'Site deletion is not allowed' }, { status: HTTPResponses.METHOD_NOT_ALLOWED });
  let newRow: Record<string, unknown>;
  try {
    const body = (await request.json()) as { newRow?: unknown };
    if (!body.newRow || typeof body.newRow !== 'object') throw new Error('Invalid row payload');
    newRow = body.newRow as Record<string, unknown>;
  } catch {
    return NextResponse.json({ message: 'newRow object is required' }, { status: HTTPResponses.INVALID_REQUEST });
  }
  // Grid rows are MapperFactory-mapped, so the identifier arrives camelCase
  // (userID / userSiteRelationID); accept the raw column name too.
  const camelGridID = gridID.charAt(0).toLowerCase() + gridID.slice(1);
  const rowID = Number(newRow[gridID] ?? newRow[camelGridID]);
  if (!Number.isInteger(rowID) || rowID <= 0) {
    return NextResponse.json({ message: `${gridID} must be a positive integer` }, { status: HTTPResponses.INVALID_REQUEST });
  }
  let transactionID: string | undefined;
  try {
    transactionID = await connectionManager.beginTransaction();
    const deleteQuery = format(`DELETE FROM ?? WHERE ?? = ?`, [`catalog.${type}`, gridID, rowID]);
    await connectionManager.executeQuery(deleteQuery, undefined, transactionID);
    await connectionManager.commitTransaction(transactionID);
    invalidateAdminPermissionsChange(type, newRow, undefined);
    return new NextResponse(JSON.stringify({ message: 'Successfully deleted' }), { status: HTTPResponses.OK });
  } catch (error) {
    await rollbackIfStarted(connectionManager, transactionID);
    ailogger.error(`Administrative deletion failed for ${type}`, error instanceof Error ? error : new Error(String(error)));
    return NextResponse.json({ message: `Deletion failed` }, { status: HTTPResponses.INVALID_REQUEST });
  }
}
