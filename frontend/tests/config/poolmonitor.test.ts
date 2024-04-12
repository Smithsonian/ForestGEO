import {PoolMonitor} from '@/config/poolmonitor';
import mysql from 'mysql2/promise';
import '@testing-library/jest-dom';

jest.mock('mysql2/promise');

describe('PoolMonitor', () => {
  let poolMonitor: any;
  const mockPool = {
    on: jest.fn(),
    getConnection: jest.fn().mockResolvedValue('MockConnection'),
  };
  const poolConfig = {
    host: 'localhost',
    user: 'user',
    database: 'testdb',
  };

  beforeAll(() => {
    // Fix: Use jest.mock instead of trying to mock static method
    jest.mock('mysql2/promise', () => ({
      createPool: jest.fn(() => mockPool),
    }));
    poolMonitor = new PoolMonitor(poolConfig);
  });

  it('should create a pool with the provided configuration', () => {
    expect(mysql.createPool).toHaveBeenCalledWith(poolConfig);
    expect(poolMonitor).toHaveProperty('pool');
  });

  it('should increment activeConnections on acquire', () => {
    const mockConnection = {threadId: 123};
    mockPool.on.mock.calls.find(call => call[0] === 'acquire')[1](mockConnection);
    expect(poolMonitor.activeConnections).toBe(1);
  });

  it('should decrement activeConnections on release', () => {
    mockPool.on.mock.calls.find(call => call[0] === 'release')[1]();
    expect(poolMonitor.activeConnections).toBe(0);
  });

  it('should increment totalConnectionsCreated on connection', () => {
    const mockConnection = {threadId: 456};
    mockPool.on.mock.calls.find(call => call[0] === 'connection')[1](mockConnection);
    expect(poolMonitor.totalConnectionsCreated).toBe(1);
  });

  it('should increment waitingForConnection on enqueue', () => {
    mockPool.on.mock.calls.find(call => call[0] === 'enqueue')[1]();
    expect(poolMonitor.waitingForConnection).toBe(1);
  });

  it('should decrement waitingForConnection when getConnection is called', async () => {
    poolMonitor.waitingForConnection = 1; // Set it to 1 to test decrement
    await poolMonitor.getConnection();
    expect(poolMonitor.waitingForConnection).toBe(0);
  });

  it('getPoolStatus should return the correct status', () => {
    const status = poolMonitor.getPoolStatus();
    expect(status).toEqual({
      activeConnections: 0,
      totalConnectionsCreated: 1,
    });
  });
});
