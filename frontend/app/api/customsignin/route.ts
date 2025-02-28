import { NextRequest, NextResponse } from 'next/server';
import MapperFactory from '@/config/datamapper';
import { SitesRDS, SitesResult } from '@/config/sqlrdsdefinitions/zones';
import { Connection, createConnection, RowDataPacket } from 'mysql2/promise';

export const runtime = 'nodejs';
export const config = {
  runtime: 'nodejs'
};

export async function GET(req: NextRequest) {
  const email = req.nextUrl.searchParams.get('email');

  let connection: Connection | null = null;

  try {
    connection = await createConnection({
      host: process.env.AZURE_SQL_SERVER || 'localhost',
      port: Number(process.env.AZURE_SQL_PORT) || 3306,
      user: process.env.AZURE_SQL_USER || 'root',
      password: process.env.AZURE_SQL_PASSWORD || '',
      database: process.env.AZURE_SQL_CATALOG_SCHEMA || 'catalog'
    });
    const [userRows] = await connection.execute<RowDataPacket[]>(`SELECT UserID, UserStatus FROM users WHERE Email = ? LIMIT 1`, [email]);

    if (!Array.isArray(userRows) || userRows.length === 0) {
      return NextResponse.json({ error: 'User not found' }, { status: 401 });
    }

    const { UserID: userID, UserStatus: userStatus } = userRows[0] as { UserID: number; UserStatus: string };

    const [allSitesRows] = await connection.execute<RowDataPacket[]>(`SELECT * FROM sites`);

    // Query allowed sites for the user
    const [allowedSitesRows] = await connection.execute<RowDataPacket[]>(
      `SELECT s.* FROM sites AS s JOIN usersiterelations AS usr ON s.SiteID = usr.SiteID WHERE usr.UserID = ?`,
      [userID]
    );

    const allSites = MapperFactory.getMapper<SitesRDS, SitesResult>('sites').mapData(allSitesRows as SitesResult[]);

    const allowedSites = MapperFactory.getMapper<SitesRDS, SitesResult>('sites').mapData(allowedSitesRows as SitesResult[]);

    return NextResponse.json({
      userStatus,
      allSites,
      allowedSites
    });
  } catch (error) {
    console.error('Database error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  } finally {
    if (connection) await connection.end();
  }
}
