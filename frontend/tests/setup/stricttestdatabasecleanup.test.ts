import { beforeEach, describe, expect, it, vi } from 'vitest';
import mysql from 'mysql2/promise';
import { createTestDatabaseStrict, teardownTestDatabaseStrict } from './stricttestdatabasecleanup';

vi.mock('mysql2/promise', () => ({ default: { createConnection: vi.fn() } }));
const config = { host: 'localhost', user: 'fake', password: 'fake', port: 3306, database: 'forestgeo_test_strict', multipleStatements: true };
const query = vi.fn();
const end = vi.fn();
const changeUser = vi.fn();
const connection = { query, end, changeUser };

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(mysql.createConnection).mockResolvedValue(connection as never);
  query.mockResolvedValue([[], []]);
  end.mockResolvedValue(undefined);
  changeUser.mockResolvedValue(undefined);
});

describe('strict owned database lifecycle', () => {
  it('drops then closes on success', async () => {
    await teardownTestDatabaseStrict(connection as never, config.database);
    expect(query).toHaveBeenCalledOnce();
    expect(end).toHaveBeenCalledOnce();
  });
  it('retains both drop and close failures by identity', async () => {
    const drop = new Error('drop sentinel');
    const close = new Error('close sentinel');
    query.mockRejectedValue(drop);
    end.mockRejectedValue(close);
    const error = await teardownTestDatabaseStrict(connection as never, config.database).catch(e => e);
    expect(error.errors).toEqual([drop, close]);
    expect(error.errors[0]).toBe(drop);
    expect(error.errors[1]).toBe(close);
    expect(end).toHaveBeenCalledOnce();
  });
  it('surfaces close failure after successful drop', async () => {
    const close = new Error('close');
    end.mockRejectedValue(close);
    const error = await teardownTestDatabaseStrict(connection as never, config.database).catch(e => e);
    expect(error.errors).toEqual([close]);
  });
  it('refuses an unowned name and still closes', async () => {
    await expect(teardownTestDatabaseStrict(connection as never, 'other')).rejects.toBeInstanceOf(AggregateError);
    expect(query).not.toHaveBeenCalled();
    expect(end).toHaveBeenCalledOnce();
  });
  it('retains setup, drop and close failures in order', async () => {
    const setup = new Error('setup');
    const drop = new Error('drop');
    const close = new Error('close');
    changeUser.mockRejectedValue(setup);
    query.mockResolvedValueOnce([[], []]).mockResolvedValueOnce([[], []]).mockRejectedValueOnce(drop);
    end.mockRejectedValue(close);
    const error = await createTestDatabaseStrict(config).catch(e => e);
    expect(error.errors).toEqual([setup, drop, close]);
    expect(error.errors[0]).toBe(setup);
    expect(error.errors[1]).toBe(drop);
    expect(error.errors[2]).toBe(close);
    expect(end).toHaveBeenCalledOnce();
  });
  it('preserves the setup error when cleanup succeeds', async () => {
    const setup = new Error('setup');
    changeUser.mockRejectedValue(setup);
    await expect(createTestDatabaseStrict(config)).rejects.toBe(setup);
    expect(query).toHaveBeenCalledTimes(3);
    expect(end).toHaveBeenCalledOnce();
  });
  it('rejects remote hosts and invalid names before connection', async () => {
    await expect(createTestDatabaseStrict({ ...config, host: 'remote' })).rejects.toThrow();
    await expect(createTestDatabaseStrict({ ...config, database: 'forestgeo_test_bad-name' })).rejects.toThrow();
    expect(mysql.createConnection).not.toHaveBeenCalled();
  });
  it('retains connection options and selects the owned database', async () => {
    await createTestDatabaseStrict(config);
    expect(mysql.createConnection).toHaveBeenCalledWith(expect.objectContaining({ timezone: 'Z', charset: 'UTF8MB4_0900_AI_CI', multipleStatements: true }));
    expect(changeUser).toHaveBeenCalledWith({ database: config.database });
    await teardownTestDatabaseStrict(connection as never, config.database);
  });
});
