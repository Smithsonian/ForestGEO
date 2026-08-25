/**
 * The async-upload rollout gate decides who can reach a worker that stages,
 * ingests, and replaces census data. An empty user/schema allow-list used to
 * mean "everyone, everywhere" the moment ASYNC_UPLOAD_ENABLED flipped to true —
 * so a misconfiguration and a full rollout were indistinguishable states, while
 * the stated rollout was "one schema, one user".
 *
 * These tests pin the asymmetry that fixes it: users and schemas fail CLOSED
 * (empty = nobody, `*` opens up on purpose), forms stay fail-OPEN because that
 * list picks WHICH forms may go async for an already-permitted operator rather
 * than bounding the blast radius.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isAsyncUploadEnabledFor } from './feature-gate';

/** The only value that opens a fail-closed list. */
const WILDCARD = '*';

const ENV_KEYS = ['ASYNC_UPLOAD_ENABLED', 'ASYNC_UPLOAD_ALLOWED_USERS', 'ASYNC_UPLOAD_ALLOWED_SCHEMAS', 'ASYNC_UPLOAD_ALLOWED_FORMS'] as const;

const ROLLOUT_SCHEMA = 'forestgeo_harvard';
const ROLLOUT_USER = 'rollout.user@forestgeo.test';
const OTHER_SCHEMA = 'forestgeo_serc';
const OTHER_USER = 'someone.else@forestgeo.test';
const FORM_TYPE = 'measurements';
const OTHER_FORM_TYPE = 'species';

const originalEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};

/** The single-schema, single-user rollout the feature is supposed to be in. */
function configureRollout(overrides: Partial<Record<(typeof ENV_KEYS)[number], string>> = {}) {
  const config = {
    ASYNC_UPLOAD_ENABLED: 'true',
    ASYNC_UPLOAD_ALLOWED_USERS: ROLLOUT_USER,
    ASYNC_UPLOAD_ALLOWED_SCHEMAS: ROLLOUT_SCHEMA,
    ...overrides
  } as Record<string, string>;
  for (const key of ENV_KEYS) {
    if (key in config) process.env[key] = config[key];
    else delete process.env[key];
  }
}

function askFor(overrides: { schema?: string | null; formType?: string | null; userIds?: string[] } = {}) {
  return isAsyncUploadEnabledFor({ schema: ROLLOUT_SCHEMA, formType: FORM_TYPE, userIds: [ROLLOUT_USER], ...overrides });
}

beforeEach(() => {
  for (const key of ENV_KEYS) originalEnv[key] = process.env[key];
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
});

describe('isAsyncUploadEnabledFor', () => {
  it('is off entirely unless ASYNC_UPLOAD_ENABLED is exactly "true"', () => {
    configureRollout({ ASYNC_UPLOAD_ENABLED: 'false' });
    expect(askFor()).toBe(false);

    configureRollout({ ASYNC_UPLOAD_ENABLED: 'TRUE' });
    expect(askFor(), 'the flag is compared literally; only lowercase "true" enables').toBe(false);
  });

  it('allows the configured rollout user on the configured rollout schema', () => {
    configureRollout();
    expect(askFor()).toBe(true);
  });

  describe('user allow-list fails closed', () => {
    it('denies everyone when the list is unset', () => {
      configureRollout();
      delete process.env.ASYNC_UPLOAD_ALLOWED_USERS;
      expect(askFor()).toBe(false);
    });

    it('denies everyone when the list is empty or only separators', () => {
      configureRollout({ ASYNC_UPLOAD_ALLOWED_USERS: '' });
      expect(askFor()).toBe(false);

      configureRollout({ ASYNC_UPLOAD_ALLOWED_USERS: ' , , ' });
      expect(askFor()).toBe(false);
    });

    it('denies a user who is not on the list', () => {
      configureRollout();
      expect(askFor({ userIds: [OTHER_USER] })).toBe(false);
    });

    it('denies a request that carries no user at all', () => {
      configureRollout();
      expect(askFor({ userIds: [] })).toBe(false);
      expect(askFor({ userIds: undefined })).toBe(false);
    });

    it('opens up only on an explicit wildcard', () => {
      configureRollout({ ASYNC_UPLOAD_ALLOWED_USERS: WILDCARD });
      expect(askFor({ userIds: [OTHER_USER] })).toBe(true);
    });

    it('matches case-insensitively and ignores surrounding whitespace', () => {
      configureRollout({ ASYNC_UPLOAD_ALLOWED_USERS: `  ${ROLLOUT_USER.toUpperCase()}  , ${OTHER_USER}` });
      expect(askFor({ userIds: [` ${ROLLOUT_USER} `] })).toBe(true);
    });

    it('allows a request whose ANY identity is listed', () => {
      configureRollout();
      expect(askFor({ userIds: [OTHER_USER, ROLLOUT_USER] })).toBe(true);
    });
  });

  describe('schema allow-list fails closed', () => {
    it('denies every schema when the list is unset or empty', () => {
      configureRollout();
      delete process.env.ASYNC_UPLOAD_ALLOWED_SCHEMAS;
      expect(askFor()).toBe(false);

      configureRollout({ ASYNC_UPLOAD_ALLOWED_SCHEMAS: '' });
      expect(askFor()).toBe(false);
    });

    it('denies a schema that is not on the list', () => {
      configureRollout();
      expect(askFor({ schema: OTHER_SCHEMA })).toBe(false);
    });

    it('denies a request with no schema', () => {
      configureRollout();
      expect(askFor({ schema: null })).toBe(false);
      expect(askFor({ schema: undefined })).toBe(false);
    });

    it('opens up only on an explicit wildcard', () => {
      configureRollout({ ASYNC_UPLOAD_ALLOWED_SCHEMAS: WILDCARD });
      expect(askFor({ schema: OTHER_SCHEMA })).toBe(true);
    });
  });

  describe('form allow-list stays fail-open', () => {
    it('permits any form when the list is unset — it is not the blast-radius control', () => {
      configureRollout();
      expect(askFor({ formType: OTHER_FORM_TYPE })).toBe(true);
      expect(askFor({ formType: null })).toBe(true);
    });

    it('restricts to the named forms once the list is populated', () => {
      configureRollout({ ASYNC_UPLOAD_ALLOWED_FORMS: FORM_TYPE });
      expect(askFor({ formType: FORM_TYPE })).toBe(true);
      expect(askFor({ formType: OTHER_FORM_TYPE })).toBe(false);
      expect(askFor({ formType: null }), 'a populated list cannot be satisfied by an absent form type').toBe(false);
    });

    it('honours a wildcard in the form list', () => {
      configureRollout({ ASYNC_UPLOAD_ALLOWED_FORMS: WILDCARD });
      expect(askFor({ formType: OTHER_FORM_TYPE })).toBe(true);
    });
  });

  it('requires every dimension to pass, not any of them', () => {
    configureRollout({ ASYNC_UPLOAD_ALLOWED_FORMS: FORM_TYPE });
    expect(askFor({ schema: OTHER_SCHEMA })).toBe(false);
    expect(askFor({ userIds: [OTHER_USER] })).toBe(false);
    expect(askFor({ formType: OTHER_FORM_TYPE })).toBe(false);
    expect(askFor()).toBe(true);
  });
});
