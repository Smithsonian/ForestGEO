import { describe, it, expect } from 'vitest';
import { assertUploadableArcgisSession, ArcgisImportSessionError } from './import-session';
import { HTTPResponses } from '@/config/macros';

const baseSession = { user_id: 'u1', plot_id: 1, census_id: 2, file_id: 'f.xlsx', state: 'preflight' };
const scope = { userId: 'u1', plotID: 1, censusID: 2, fileName: 'f.xlsx' };

describe('assertUploadableArcgisSession', () => {
  it('passes for a matching preflight session', () => {
    expect(() => assertUploadableArcgisSession(baseSession, scope)).not.toThrow();
  });

  it('rejects a committing session now that the state machine is collapsed', () => {
    try {
      assertUploadableArcgisSession({ ...baseSession, state: 'committing' }, scope);
      throw new Error('expected throw');
    } catch (e) {
      expect(e).toBeInstanceOf(ArcgisImportSessionError);
      expect((e as ArcgisImportSessionError).status).toBe(HTTPResponses.CONFLICT);
      expect((e as ArcgisImportSessionError).message).toContain('uploadable');
    }
  });

  it('rejects a missing session with 404 NOT_FOUND', () => {
    try {
      assertUploadableArcgisSession(null, scope);
      throw new Error('expected throw');
    } catch (e) {
      expect(e).toBeInstanceOf(ArcgisImportSessionError);
      expect((e as ArcgisImportSessionError).status).toBe(HTTPResponses.NOT_FOUND);
      expect((e as ArcgisImportSessionError).message).toContain('not found');
    }
  });

  it('rejects a foreign user with 403 FORBIDDEN', () => {
    try {
      assertUploadableArcgisSession({ ...baseSession, user_id: 'other' }, scope);
      throw new Error('expected throw');
    } catch (e) {
      expect(e).toBeInstanceOf(ArcgisImportSessionError);
      expect((e as ArcgisImportSessionError).status).toBe(HTTPResponses.FORBIDDEN);
      expect((e as ArcgisImportSessionError).message).toContain('belong');
    }
  });

  it('rejects a plot scope mismatch with 409 CONFLICT', () => {
    try {
      assertUploadableArcgisSession({ ...baseSession, plot_id: 99 }, scope);
      throw new Error('expected throw');
    } catch (e) {
      expect(e).toBeInstanceOf(ArcgisImportSessionError);
      expect((e as ArcgisImportSessionError).status).toBe(HTTPResponses.CONFLICT);
      expect((e as ArcgisImportSessionError).message).toContain('scope');
    }
  });

  it('rejects a census scope mismatch with 409 CONFLICT', () => {
    try {
      assertUploadableArcgisSession({ ...baseSession, census_id: 99 }, scope);
      throw new Error('expected throw');
    } catch (e) {
      expect(e).toBeInstanceOf(ArcgisImportSessionError);
      expect((e as ArcgisImportSessionError).status).toBe(HTTPResponses.CONFLICT);
      expect((e as ArcgisImportSessionError).message).toContain('scope');
    }
  });

  it('rejects a file mismatch with 409 CONFLICT', () => {
    try {
      assertUploadableArcgisSession({ ...baseSession, file_id: 'other.xlsx' }, scope);
      throw new Error('expected throw');
    } catch (e) {
      expect(e).toBeInstanceOf(ArcgisImportSessionError);
      expect((e as ArcgisImportSessionError).status).toBe(HTTPResponses.CONFLICT);
      expect((e as ArcgisImportSessionError).message).toContain('file');
    }
  });

  it('rejects a non-uploadable state with 409 CONFLICT', () => {
    try {
      assertUploadableArcgisSession({ ...baseSession, state: 'committed' }, scope);
      throw new Error('expected throw');
    } catch (e) {
      expect(e).toBeInstanceOf(ArcgisImportSessionError);
      expect((e as ArcgisImportSessionError).status).toBe(HTTPResponses.CONFLICT);
      expect((e as ArcgisImportSessionError).message).toContain('uploadable');
    }
  });
});
