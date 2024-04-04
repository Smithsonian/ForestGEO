import { generateHash } from '@/config/crypto-actions';
import SHA256 from 'crypto-js/sha256';
import '@testing-library/jest-dom';

describe('generateHash', () => {
  it('should generate a consistent hash for the same input', () => {
    const data = { key: 'value' };
    const hash1 = generateHash(data);
    const hash2 = generateHash(data);
    expect(hash1).toBe(hash2);
  });

  it('should generate different hashes for different inputs', () => {
    const data1 = { key: 'value1' };
    const data2 = { key: 'value2' };
    const hash1 = generateHash(data1);
    const hash2 = generateHash(data2);
    expect(hash1).not.toBe(hash2);
  });

  it('should handle an empty object', () => {
    const data = {};
    const hash = generateHash(data);
    expect(hash).toBeDefined();
    expect(hash).not.toBe('');
  });

  it('should handle null input gracefully', () => {
    const hash = generateHash(null);
    expect(hash).toBeDefined();
    expect(hash).not.toBe('');
  });

  it('should handle undefined input gracefully', () => {
    const hash = generateHash(undefined);
    expect(hash).toBeDefined();
    expect(hash).not.toBe('');
  });
});
