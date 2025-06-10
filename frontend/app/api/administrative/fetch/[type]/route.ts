import { NextRequest, NextResponse } from 'next/server';
import ConnectionManager from '@/config/connectionmanager';
import { getCookie } from '@/app/actions/cookiemanager';
import MapperFactory from '@/config/datamapper';
import { HTTPResponses } from '@/config/macros';

export async function GET(request: NextRequest, props: { params: Promise<{ type: string }> }) {
  const { type } = await props.params;
  const connectionManager = ConnectionManager.getInstance();
  const email = request.nextUrl.searchParams.get('email') ?? (await getCookie('user'));
  if (!email) throw new Error('no email found in cookies.');

  try {
    let query = '';
    switch (type) {
      case 'users':
        query = `SELECT u.*, GROUP_CONCAT(s.SiteName ORDER BY s.SiteName SEPARATOR ';') AS SiteNames 
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
  try {
    await connectionManager.executeQuery(`INSERT IGNORE INTO ?? SET ?`, [`catalog.${type}`, newRow]);
    return new NextResponse(JSON.stringify({ message: 'Successfully inserted' }), { status: HTTPResponses.OK });
  } catch (e) {
    return NextResponse.json({ message: `Insertion into catalog.${type} failed` }, { status: HTTPResponses.INVALID_REQUEST });
  }
}

export async function PATCH(request: NextRequest, props: { params: Promise<{ type: string }> }) {
  const { type } = await props.params;
  const connectionManager = ConnectionManager.getInstance();
  const email = request.nextUrl.searchParams.get('email') ?? (await getCookie('user'));
  if (!email) throw new Error('no email found in cookies.');

  const gridID = type === 'sites' ? 'SiteID' : type == 'users' ? 'UserID' : 'UserSiteRelationID';
  const { oldRow, newRow } = await request.json();
  const mappedOldRow = MapperFactory.getMapper<any, any>(type).demapData([oldRow])[0];
  const mappedNewRow = MapperFactory.getMapper<any, any>(type).demapData([newRow])[0];
  try {
    await connectionManager.executeQuery(`UPDATE ?? SET ? WHERE ?? = ?`, [`catalog.${type}`, mappedNewRow, gridID, mappedOldRow[gridID]]);
    return new NextResponse(JSON.stringify({ message: 'Successfully updated' }), { status: HTTPResponses.OK });
  } catch (e) {
    return NextResponse.json({ message: `Update of catalog.${type} failed` }, { status: HTTPResponses.INVALID_REQUEST });
  }
}

export async function DELETE(request: NextRequest, props: { params: Promise<{ type: string }> }) {
  const { type } = await props.params;
  const connectionManager = ConnectionManager.getInstance();
  const email = await getCookie('user');
  if (!email) throw new Error('no email found in cookies.');
  const gridID = type === 'sites' ? 'SiteID' : type == 'users' ? 'UserID' : 'UserSiteRelationID';
  const { newRow } = await request.json();

  if (type === 'sites') throw new Error('Site deletion is not allowed!');
  try {
    await connectionManager.executeQuery(`DELETE FROM ?? WHERE ?? = ?`, [`catalog.${type}`, gridID, newRow[gridID]]);
    return new NextResponse(JSON.stringify({ message: 'Successfully deleted' }), { status: HTTPResponses.OK });
  } catch (e) {
    return NextResponse.json({ message: `Deletion failed` }, { status: HTTPResponses.INVALID_REQUEST });
  }
}
