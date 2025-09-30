import { NextRequest, NextResponse } from 'next/server';
import { deleteCookie } from '@/app/actions/cookiemanager';
import ailogger from '@/ailogger';

// Force Node.js runtime for database and Azure SDK compatibility
// mysql2 and @azure/storage-* are not compatible with Edge Runtime
export const runtime = 'nodejs';

export async function POST(_request: NextRequest) {
  ailogger.info('site closure! Removing all stored cookies...');
  await deleteCookie('censusID');
  ailogger.info('censusID cookie deleted');
  await deleteCookie('plotID');
  ailogger.info('plotID cookie deleted');
  await deleteCookie('schema');
  ailogger.info('schema cookie deleted');
  await deleteCookie('quadratID');
  ailogger.info('quadratID cookie deleted');
  await deleteCookie('user');
  ailogger.info('user cookie deleted');
  await deleteCookie('censusList');
  ailogger.info('censusList cookie deleted');
  ailogger.info('site closure! All stored cookies removed.');
  return NextResponse.json({ cleared: true }, { status: 200 });
}
