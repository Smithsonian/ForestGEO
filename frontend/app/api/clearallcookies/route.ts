import { NextRequest, NextResponse } from 'next/server';
import { deleteCookie } from '@/app/actions/cookiemanager';

export async function POST(_request: NextRequest) {
  console.log('site closure! Removing all stored cookies...');
  await deleteCookie('censusID');
  console.log('censusID cookie deleted');
  await deleteCookie('plotID');
  console.log('plotID cookie deleted');
  await deleteCookie('schema');
  console.log('schema cookie deleted');
  await deleteCookie('quadratID');
  console.log('quadratID cookie deleted');
  await deleteCookie('user');
  console.log('user cookie deleted');
  await deleteCookie('censusList');
  console.log('censusList cookie deleted');
  console.log('site closure! All stored cookies removed.');
  return NextResponse.json({ cleared: true }, { status: 200 });
}
