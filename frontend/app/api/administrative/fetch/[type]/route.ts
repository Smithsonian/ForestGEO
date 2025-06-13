import { NextRequest, NextResponse } from 'next/server';
import ConnectionManager from '@/config/connectionmanager';
import { getCookie } from '@/app/actions/cookiemanager';
import MapperFactory from '@/config/datamapper';
import { HTTPResponses } from '@/config/macros';

export async function GET(_request: NextRequest, props: { params: Promise<{ type: string }> }) {
  const { type } = await props.params;
  const connectionManager = ConnectionManager.getInstance();

  try {
    let query = '';
    switch (type) {
      case 'users':
        query = `SELECT u.UserID as UserID, 
                        u.LastName as LastName, 
                        u.FirstName as FirstName, 
                        u.Email as Email, 
                        u.IsAdmin as Notifications, 
                        u.UserStatus as UserStatus, 
                        GROUP_CONCAT(s.SiteID ORDER BY s.SiteID SEPARATOR ';') AS UserSites 
                 FROM catalog.users u 
                   LEFT JOIN catalog.usersiterelations ur ON u.UserID = ur.UserID 
                 LEFT JOIN catalog.sites s ON ur.SiteID = s.SiteID 
                 GROUP BY u.UserID;`;
        break;
      case 'sites':
        query = `SELECT * FROM catalog.sites`;
        break;
    }
    const results = await connectionManager.executeQuery(query);
    return new NextResponse(JSON.stringify(MapperFactory.getMapper<any, any>(type).mapData(results)), { status: HTTPResponses.OK });
  } catch (e) {
    return new NextResponse(JSON.stringify({ message: 'BREAKAGE' }), { status: HTTPResponses.CONFLICT });
  }
}

export async function POST(request: NextRequest, props: { params: Promise<{ type: string }> }) {
  const { type } = await props.params;
  const connectionManager = ConnectionManager.getInstance();
  const email = request.nextUrl.searchParams.get('email') ?? (await getCookie('user'));
  if (!email) throw new Error('no email found in cookies.');

  const { newRow } = await request.json();
  let transactionID: string | undefined;
  try {
    transactionID = await connectionManager.beginTransaction();
    await connectionManager.executeQuery(`INSERT IGNORE INTO ?? SET ?`, [`catalog.${type}`, newRow]);
    await connectionManager.commitTransaction(transactionID);
  } catch (e) {
    if (transactionID) await connectionManager.rollbackTransaction(transactionID);
    return NextResponse.json({ message: `Insertion into catalog.${type} failed` }, { status: HTTPResponses.INVALID_REQUEST });
  }
  return new NextResponse(JSON.stringify({ message: 'Successfully inserted' }), { status: HTTPResponses.OK });
}

export async function PATCH(request: NextRequest, props: { params: Promise<{ type: string }> }) {
  const { type } = await props.params;
  const connectionManager = ConnectionManager.getInstance();
  const email = request.nextUrl.searchParams.get('email') ?? (await getCookie('user'));
  if (!email) throw new Error('no email found in cookies.');

  const gridID = type === 'sites' ? 'SiteID' : 'UserID';
  const { oldRow, newRow } = await request.json();
  const { oldUserSites, ...oldRowRemaining } = oldRow;
  const { newUserSites, ...newRowRemaining } = newRow;
  const mappedOldRow = MapperFactory.getMapper<any, any>(type).demapData([oldRowRemaining])[0];
  const mappedNewRow = MapperFactory.getMapper<any, any>(type).demapData([newRowRemaining])[0];
  let transactionID: string | undefined;
  try {
    transactionID = await connectionManager.beginTransaction();
    if (oldUserSites || newUserSites) {
      // user assignment changes
      // extract new set of sites assigned to the user
      const updatedSites = Array.from(new Set([...oldUserSites.map((s: any) => s.siteID!), ...newUserSites.map((s: any) => s.siteID!)])).map(i => [
        newRowRemaining.userID,
        i
      ]);
      // remove the old connections
      await connectionManager.executeQuery(`DELETE FROM ?? WHERE UserID = ?`, [`catalog.usersiterelations`, newRowRemaining.userID]);
      // add new connections
      await connectionManager.executeQuery('INSERT INTO ?? (UserID, SiteID) VALUES ?', ['catalog.usersiterelations', updatedSites]);
    }
    await connectionManager.executeQuery(`UPDATE ?? SET ? WHERE ?? = ?`, [`catalog.${type}`, mappedNewRow, gridID, mappedOldRow[gridID]]);
    await connectionManager.commitTransaction(transactionID);
  } catch (e) {
    if (transactionID) await connectionManager.rollbackTransaction(transactionID);
    return NextResponse.json({ message: `Update of catalog.${type} failed` }, { status: HTTPResponses.INVALID_REQUEST });
  }
  return new NextResponse(JSON.stringify({ message: 'Successfully updated' }), { status: HTTPResponses.OK });
}

export async function DELETE(request: NextRequest, props: { params: Promise<{ type: string }> }) {
  const { type } = await props.params;
  const connectionManager = ConnectionManager.getInstance();
  const email = await getCookie('user');
  if (!email) throw new Error('no email found in cookies.');
  const gridID = type === 'sites' ? 'SiteID' : type == 'users' ? 'UserID' : 'UserSiteRelationID';
  const { newRow } = await request.json();

  if (type === 'sites') throw new Error('Site deletion is not allowed!');
  let transactionID: string | undefined;
  try {
    transactionID = await connectionManager.beginTransaction();
    await connectionManager.executeQuery(`DELETE FROM ?? WHERE ?? = ?`, [`catalog.${type}`, gridID, newRow[gridID]]);
    await connectionManager.commitTransaction(transactionID);
    return new NextResponse(JSON.stringify({ message: 'Successfully deleted' }), { status: HTTPResponses.OK });
  } catch (e) {
    if (transactionID) await connectionManager.commitTransaction(transactionID);
    return NextResponse.json({ message: `Deletion failed` }, { status: HTTPResponses.INVALID_REQUEST });
  }
}
