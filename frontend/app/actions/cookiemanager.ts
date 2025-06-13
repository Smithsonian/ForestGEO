'use server';

import { cookies } from 'next/headers';

export async function submitCookie(name: string, value: string) {
  (await cookies()).set(name, value);
}

export async function getCookie(name: string) {
  if ((await cookies()).has(name)) return (await cookies()).get(name)?.value;
  else throw new Error(`Cookie ${name} not found`);
}

export async function deleteCookie(name: string) {
  (await cookies()).delete(name);
}
