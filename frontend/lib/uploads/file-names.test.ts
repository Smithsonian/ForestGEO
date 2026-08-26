/**
 * The canonical file name IS the job's file identity — `files[].fileName`, the
 * key of the payload maps the worker looks up delimiters and column mappings
 * by, and the ArcGIS pre-flight cross-check all use it. Sanitizing is lossy, so
 * two different selected files can collapse onto one identity; and blob
 * allocation used to be "probe with exists(), then write", which two concurrent
 * attempts can both win.
 */
import { describe, expect, it } from 'vitest';
import {
  attemptScopedBlobName,
  describeUploadFileNameCollisions,
  findUploadFileNameCollisions,
  isValidUploadAttemptID,
  MAX_MEASUREMENT_FILE_ID_LENGTH,
  measurementFileIDLength,
  measurementFileIDValidationError,
  sanitizeUploadFileName
} from './file-names';

const ATTEMPT_ID = 'attempt-0123456789ab';

describe('sanitizeUploadFileName', () => {
  it('leaves an already-safe name untouched', () => {
    expect(sanitizeUploadFileName('Harvard_Forest_2014.csv')).toBe('Harvard_Forest_2014.csv');
  });

  it('replaces every unsafe character and strips any directory part', () => {
    expect(sanitizeUploadFileName('sub/dir/Harvard Forest (2014).csv')).toBe('Harvard_Forest__2014_.csv');
  });

  it('normalizes to NFC so the same name from macOS and elsewhere agree', () => {
    // macOS hands filenames to the browser decomposed: "é" as e + U+0301.
    // Without normalization the combining mark is not [a-zA-Z0-9._-] and becomes
    // an underscore, so the same file picked on two machines gets two different
    // identities — and the second upload looks like a different file.
    const composed = 'café.csv';
    const decomposed = 'café.csv';
    expect(decomposed.normalize('NFC')).toBe(composed);

    expect(sanitizeUploadFileName(decomposed)).toBe(sanitizeUploadFileName(composed));
    expect(sanitizeUploadFileName(decomposed)).toBe('caf_.csv');
  });

  it('is idempotent — sanitizing a canonical name changes nothing', () => {
    const once = sanitizeUploadFileName('a b(1).csv');
    expect(sanitizeUploadFileName(once)).toBe(once);
  });
});

describe('measurement FileID length contract', () => {
  it('accepts 50 characters and rejects 51 with an actionable message', () => {
    expect(measurementFileIDValidationError('a'.repeat(MAX_MEASUREMENT_FILE_ID_LENGTH))).toBeNull();

    const error = measurementFileIDValidationError('a'.repeat(MAX_MEASUREMENT_FILE_ID_LENGTH + 1));
    expect(error).toContain('50 characters or fewer');
    expect(error).toContain('received 51');
  });

  it('counts Unicode characters rather than UTF-16 code units', () => {
    expect(measurementFileIDLength('🌳'.repeat(25))).toBe(25);
    expect(measurementFileIDValidationError('🌳'.repeat(50))).toBeNull();
    expect(measurementFileIDLength('e\u0301')).toBe(2);
  });
});

describe('findUploadFileNameCollisions', () => {
  it('finds nothing when every canonical name is distinct', () => {
    expect(findUploadFileNameCollisions(['one.csv', 'two.csv', 'three.csv'])).toEqual([]);
  });

  it('catches two names that sanitize to the same identity', () => {
    const collisions = findUploadFileNameCollisions(['a b.csv', 'a_b.csv']);

    expect(collisions).toEqual([{ canonicalName: 'a_b.csv', originalNames: ['a b.csv', 'a_b.csv'] }]);
  });

  it('catches NFC/NFD forms of the same name', () => {
    const collisions = findUploadFileNameCollisions(['café.csv', 'café.csv']);

    expect(collisions).toHaveLength(1);
    expect(collisions[0].originalNames).toHaveLength(2);
  });

  it('catches names differing only in case, because the job identity check is case-insensitive too', () => {
    // These would upload to two distinct blobs (Azure blob names are
    // case-sensitive) and then be rejected as one duplicated job file.
    const collisions = findUploadFileNameCollisions(['Measurements.csv', 'measurements.csv']);

    expect(collisions).toHaveLength(1);
  });

  it('reports every clashing group, and every original within a group', () => {
    const collisions = findUploadFileNameCollisions(['a b.csv', 'a_b.csv', 'a-b.csv', 'x y.csv', 'x_y.csv', 'unique.csv']);

    expect(collisions).toHaveLength(2);
    expect(collisions[0].originalNames).toEqual(['a b.csv', 'a_b.csv']);
    expect(collisions[1].originalNames).toEqual(['x y.csv', 'x_y.csv']);
  });

  it('names both originals in the message the user sees', () => {
    const message = describeUploadFileNameCollisions(findUploadFileNameCollisions(['a b.csv', 'a_b.csv']));

    expect(message).toContain('"a b.csv"');
    expect(message).toContain('"a_b.csv"');
    expect(message).toContain('a_b.csv');
  });
});

describe('attemptScopedBlobName', () => {
  it('places the file under its attempt', () => {
    expect(attemptScopedBlobName(ATTEMPT_ID, 'measurements.csv')).toBe(`${ATTEMPT_ID}/measurements.csv`);
  });

  it('keeps two attempts of the same file on disjoint paths', () => {
    const first = attemptScopedBlobName('attempt-aaaaaaaaaaaa', 'measurements.csv');
    const second = attemptScopedBlobName('attempt-bbbbbbbbbbbb', 'measurements.csv');

    // The whole point: no probe, no suffix search, no way for one attempt's
    // cleanup to reach the other's blob.
    expect(first).not.toBe(second);
  });
});

describe('isValidUploadAttemptID', () => {
  it('accepts the ids the client actually generates', () => {
    expect(isValidUploadAttemptID('3f2504e0-4f89-11d3-9a0c-0305e82c3301'), 'crypto.randomUUID()').toBe(true);
    expect(isValidUploadAttemptID('1721428800000-k3j4h5g6f7'), 'the non-crypto fallback').toBe(true);
  });

  it('rejects anything that could escape the attempt prefix or break blob metadata', () => {
    expect(isValidUploadAttemptID('attempt/../../etc'), 'path traversal').toBe(false);
    expect(isValidUploadAttemptID('attempt id'), 'whitespace').toBe(false);
    expect(isValidUploadAttemptID('attempt.id'), 'dot — could form a path segment').toBe(false);
    expect(isValidUploadAttemptID('short'), 'too short to be unguessable').toBe(false);
    expect(isValidUploadAttemptID('a'.repeat(65)), 'too long').toBe(false);
    expect(isValidUploadAttemptID(''), 'empty').toBe(false);
  });
});
