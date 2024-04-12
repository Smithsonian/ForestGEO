import {getData, setData, clearAllIDBData, clearDataByKey} from '@/config/db';
import '@testing-library/jest-dom';

describe('IndexedDB operations', () => {
  const testKey = 'testKey';
  const testData = {name: 'Test Data'};

  beforeEach(async () => {
    await clearAllIDBData();
  });

  it('should store and retrieve data correctly', async () => {
    await setData(testKey, testData);
    const result = await getData(testKey);
    expect(result).toEqual(testData);
  });

  it('should clear data by key', async () => {
    await setData(testKey, testData);
    await clearDataByKey(testKey);
    const result = await getData(testKey);
    expect(result).toBeUndefined();
  });

  it('should clear all data', async () => {
    await setData(testKey, testData);
    await clearAllIDBData();
    const result = await getData(testKey);
    expect(result).toBeUndefined();
  });

  it('should handle setting null data gracefully', async () => {
    await setData(testKey, null);
    const result = await getData(testKey);
    expect(result).toBeNull();
  });

  it('should not throw error when clearing non-existent key', async () => {
    await expect(clearDataByKey('nonExistentKey')).resolves.not.toThrow();
  });
});

