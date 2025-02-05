import { NextResponse } from 'next/server';
import ConnectionManager from '@/config/connectionmanager';
import MapperFactory from '@/config/datamapper';
import { SitesRDS, SitesResult } from '@/config/sqlrdsdefinitions/zones';

export async function POST(req: Request) {
  const { email } = await req.json();
  const connectionManager = ConnectionManager.getInstance();

  try {
    const query = `SELECT UserID, UserStatus FROM catalog.users WHERE Email = ? LIMIT 1`;
    const results = await connectionManager.executeQuery(query, [email]);

    if (results.length === 0) {
      return NextResponse.json({ error: 'User not found' }, { status: 401 });
    }

    const userID = results[0].UserID;
    const userStatus = results[0].UserStatus;

    const allSites = MapperFactory.getMapper<SitesRDS, SitesResult>('sites').mapData(await connectionManager.executeQuery(`SELECT * FROM catalog.sites`));

    const allowedSites = MapperFactory.getMapper<SitesRDS, SitesResult>('sites').mapData(
      await connectionManager.executeQuery(
        `SELECT s.* FROM catalog.sites AS s JOIN catalog.usersiterelations AS usr ON s.SiteID = usr.SiteID WHERE usr.UserID = ?`,
        [userID]
      )
    );

    return NextResponse.json({
      userStatus,
      allSites,
      allowedSites
    });
  } catch (error) {
    console.error('Database error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
