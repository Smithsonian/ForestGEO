import { NextRequest, NextResponse } from 'next/server';
import ConnectionManager from '@/config/connectionmanager';
import MapperFactory from '@/config/datamapper';
import { HTTPResponses } from '@/config/macros';
import { auth } from '@/auth';
import { requireAdmin } from '@/lib/auth-helpers';
import { format } from 'mysql2/promise';

// Force Node.js runtime for database and Azure SDK compatibility
// mysql2 and @azure/storage-* are not compatible with Edge Runtime
export const runtime = 'nodejs';

export async function GET(request: NextRequest, props: { params: Promise<{ type: string }> }) {
  const authError = requireAdmin(await auth());
  if (authError) return authError;

  const { type } = await props.params;
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
  const authError = requireAdmin(await auth());
  if (authError) return authError;

  const { type } = await props.params;
  const connectionManager = ConnectionManager.getInstance();

  const { newRow } = await request.json();
  let transactionID: string | undefined;
  try {
    transactionID = await connectionManager.beginTransaction();
    const insertQuery = format(`INSERT IGNORE INTO ?? SET ?`, [`catalog.${type}`, newRow]);
    await connectionManager.executeQuery(insertQuery);
    await connectionManager.commitTransaction(transactionID);
  } catch {
    if (transactionID) await connectionManager.rollbackTransaction(transactionID);
    return NextResponse.json({ message: `Insertion into catalog.${type} failed` }, { status: HTTPResponses.INVALID_REQUEST });
  }
  return new NextResponse(JSON.stringify({ message: 'Successfully inserted' }), { status: HTTPResponses.OK });
}

export async function PATCH(request: NextRequest, props: { params: Promise<{ type: string }> }) {
  const authError = requireAdmin(await auth());
  if (authError) return authError;

  const { type } = await props.params;
  const connectionManager = ConnectionManager.getInstance();

  const gridID = type === 'sites' ? 'SiteID' : 'UserID';
  const { oldRow, newRow } = await request.json();
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
    if (oldUserSites || newUserSites) {
      const updatedSites = Array.from(new Set([...oldUserSites.map((s: any) => s.siteID!), ...newUserSites.map((s: any) => s.siteID!)])).map(i => [
        newRowRemaining.userID,
        i
      ]);
      const deleteQuery = format(`DELETE FROM ?? WHERE UserID = ?`, [`catalog.usersiterelations`, newRowRemaining.userID]);
      await connectionManager.executeQuery(deleteQuery);
      const insertQuery = format('INSERT INTO ?? (UserID, SiteID) VALUES ?', ['catalog.usersiterelations', updatedSites]);
      await connectionManager.executeQuery(insertQuery);
    }
    const { UserSites, [gridID]: _gridIdValue, ...remaining } = mappedNewRow;
    const updateQuery = format(`UPDATE ?? SET ? WHERE ?? = ?`, [`catalog.${type}`, remaining, gridID, mappedOldRow[gridID]]);
    await connectionManager.executeQuery(updateQuery);
    await connectionManager.commitTransaction(transactionID);
  } catch {
    if (transactionID) await connectionManager.rollbackTransaction(transactionID);
    return NextResponse.json({ message: `Update of catalog.${type} failed` }, { status: HTTPResponses.INVALID_REQUEST });
  }
  return new NextResponse(JSON.stringify({ message: 'Successfully updated' }), { status: HTTPResponses.OK });
}

export async function DELETE(request: NextRequest, props: { params: Promise<{ type: string }> }) {
  const authError = requireAdmin(await auth());
  if (authError) return authError;

  const { type } = await props.params;
  const connectionManager = ConnectionManager.getInstance();

  const gridID = type === 'sites' ? 'SiteID' : type == 'users' ? 'UserID' : 'UserSiteRelationID';
  const { newRow } = await request.json();

  if (type === 'sites') throw new Error('Site deletion is not allowed!');
  let transactionID: string | undefined;
  try {
    transactionID = await connectionManager.beginTransaction();
    const deleteQuery = format(`DELETE FROM ?? WHERE ?? = ?`, [`catalog.${type}`, gridID, newRow[gridID]]);
    await connectionManager.executeQuery(deleteQuery);
    await connectionManager.commitTransaction(transactionID);
    return new NextResponse(JSON.stringify({ message: 'Successfully deleted' }), { status: HTTPResponses.OK });
  } catch {
    if (transactionID) await connectionManager.rollbackTransaction(transactionID);
    return NextResponse.json({ message: `Deletion failed` }, { status: HTTPResponses.INVALID_REQUEST });
  }
}
