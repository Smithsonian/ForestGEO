/**
 * Utility functions for converting between bit fields and booleans.
 *
 * These functions are extracted to avoid circular dependencies and
 * to prevent importing heavy dependencies in middleware/edge runtime.
 */

import { Buffer } from 'buffer';

export function bitToBoolean(bitField: any): boolean {
  if (Buffer.isBuffer(bitField)) {
    // Ensure non-zero bytes are considered `true`
    return bitField[0] !== 0;
  } else if (bitField instanceof Uint8Array) {
    return bitField[0] !== 0;
  } else {
    return Boolean(bitField);
  }
}

export const booleanToBit = (value: boolean | undefined): number => (value ? 1 : 0);
