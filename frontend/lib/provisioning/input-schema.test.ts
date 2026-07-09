import { describe, it, expect } from 'vitest';
import { ProvisioningQuadratsSchema } from './input-schema';

describe('ProvisioningQuadratsSchema', () => {
  it('accepts grid mode', () => {
    const result = ProvisioningQuadratsSchema.safeParse({ mode: 'grid', quadratSizeX: 20, quadratSizeY: 20, namingPattern: 'sequential' });
    expect(result.success).toBe(true);
  });

  it('accepts csv mode with at least one row', () => {
    const result = ProvisioningQuadratsSchema.safeParse({
      mode: 'csv',
      rows: [{ quadratName: 'C01', startX: 0, startY: 0, dimensionX: 20, dimensionY: 20 }]
    });
    expect(result.success).toBe(true);
  });

  it('accepts none mode (create no quadrats now)', () => {
    const result = ProvisioningQuadratsSchema.safeParse({ mode: 'none' });
    expect(result.success).toBe(true);
  });

  it('rejects an unknown mode', () => {
    const result = ProvisioningQuadratsSchema.safeParse({ mode: 'auto' });
    expect(result.success).toBe(false);
  });
});
