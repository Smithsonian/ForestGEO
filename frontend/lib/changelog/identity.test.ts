import { describe, expect, it } from 'vitest';
import { authenticatedSessionIdentity, CHANGED_BY_MAX_LENGTH } from './identity';

const ANONYMOUS_CHANGED_BY = 'authenticated-user';

/**
 * `authenticatedSessionIdentity` feeds `unifiedchangelog.ChangedBy`, a
 * varchar(64). These tests pin BOTH halves of that contract: the preference
 * order the sqlpacketload upload path has always used (email > name > id >
 * anonymous fallback), and the length guard that keeps an over-length identity
 * from raising ER_DATA_TOO_LONG and rolling back the caller's transaction.
 */
describe('authenticatedSessionIdentity', () => {
  describe('preference order (unchanged sqlpacketload behaviour)', () => {
    it('prefers email over every other key', () => {
      const identity = authenticatedSessionIdentity({
        email: 'first@example.org',
        name: 'Ignored Name',
        id: 'ignored-id'
      });
      expect(identity).toBe('first@example.org');
    });

    it('falls back to name when email is absent', () => {
      expect(authenticatedSessionIdentity({ name: 'Jess Researcher', id: 'ignored-id' })).toBe('Jess Researcher');
    });

    it('falls back to id when email and name are absent', () => {
      expect(authenticatedSessionIdentity({ id: 'azure-oid-1234' })).toBe('azure-oid-1234');
    });

    it('skips blank and non-string values rather than returning them', () => {
      // A whitespace-only email must not win over a real name — otherwise
      // ChangedBy silently becomes an empty string.
      expect(authenticatedSessionIdentity({ email: '   ', name: 'Real Name' })).toBe('Real Name');
      expect(authenticatedSessionIdentity({ email: 42, name: 'Real Name' })).toBe('Real Name');
    });

    it('trims surrounding whitespace', () => {
      expect(authenticatedSessionIdentity({ email: '  spaced@example.org  ' })).toBe('spaced@example.org');
    });

    it.each([
      ['null', null],
      ['undefined', undefined],
      ['a non-object', 'not-an-object'],
      ['an array', ['email@example.org']],
      ['an object with no identity keys', { role: 'admin' }],
      ['an object with only empty identity keys', { email: '', name: '', id: '' }]
    ])('returns the anonymous fallback for %s', (_label, sessionUser) => {
      expect(authenticatedSessionIdentity(sessionUser)).toBe(ANONYMOUS_CHANGED_BY);
    });
  });

  describe('ChangedBy length guard', () => {
    it('truncates a 100-character email to the varchar(64) column width', () => {
      const localPart = 'a'.repeat(100 - '@si.edu'.length);
      const longEmail = `${localPart}@si.edu`;
      expect(longEmail).toHaveLength(100);

      const identity = authenticatedSessionIdentity({ email: longEmail });

      expect(identity).toHaveLength(CHANGED_BY_MAX_LENGTH);
      expect(identity).toBe(longEmail.slice(0, CHANGED_BY_MAX_LENGTH));
    });

    it('leaves an identity at exactly the column width intact', () => {
      const exact = 'b'.repeat(CHANGED_BY_MAX_LENGTH);
      expect(authenticatedSessionIdentity({ email: exact })).toBe(exact);
    });

    it('truncates after trimming, so leading whitespace does not consume budget', () => {
      const padded = `   ${'c'.repeat(CHANGED_BY_MAX_LENGTH)}   `;
      expect(authenticatedSessionIdentity({ name: padded })).toBe('c'.repeat(CHANGED_BY_MAX_LENGTH));
    });

    it('applies the guard to the name and id branches too, not just email', () => {
      const long = 'd'.repeat(120);
      expect(authenticatedSessionIdentity({ name: long })).toHaveLength(CHANGED_BY_MAX_LENGTH);
      expect(authenticatedSessionIdentity({ id: long })).toHaveLength(CHANGED_BY_MAX_LENGTH);
    });
  });
});
