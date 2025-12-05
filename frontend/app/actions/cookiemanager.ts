'use server';

import { cookies } from 'next/headers';

/**
 * Set a cookie value
 * @param name - Cookie name
 * @param value - Cookie value
 */
export async function submitCookie(name: string, value: string): Promise<void> {
  (await cookies()).set(name, value);
}

/**
 * Get a cookie value
 * @param name - Cookie name
 * @returns Cookie value or undefined if not found
 *
 * Note: Returns undefined (not empty string) when cookie doesn't exist.
 * This allows callers to distinguish between "no cookie" and "empty value".
 */
export async function getCookie(name: string): Promise<string | undefined> {
  return (await cookies()).get(name)?.value;
}

/**
 * Get a cookie value with a default fallback
 * @param name - Cookie name
 * @param defaultValue - Value to return if cookie doesn't exist
 * @returns Cookie value or default value
 */
export async function getCookieOrDefault(name: string, defaultValue: string): Promise<string> {
  return (await cookies()).get(name)?.value ?? defaultValue;
}

/**
 * Check if a cookie exists
 * @param name - Cookie name
 * @returns True if cookie exists
 */
export async function hasCookie(name: string): Promise<boolean> {
  return (await cookies()).has(name);
}

/**
 * Delete a cookie
 * @param name - Cookie name
 */
export async function deleteCookie(name: string): Promise<void> {
  (await cookies()).delete(name);
}

// Legacy compatibility - returns empty string for backwards compatibility
// Deprecated: Use getCookie() which returns undefined for missing cookies
export async function getCookieLegacy(name: string): Promise<string> {
  return (await cookies()).get(name)?.value ?? '';
}
