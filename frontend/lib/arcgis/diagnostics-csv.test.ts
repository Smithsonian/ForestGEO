import { describe, it, expect } from 'vitest';
import { warningsToCsv } from './diagnostics-csv';
import type { TransformWarning } from './types';

describe('warningsToCsv', () => {
  it('emits the header even when there are no warnings', () => {
    expect(warningsToCsv([])).toBe('type,sheet,rowIndex,globalId,value,message');
  });

  it('renders one quoted row per warning with all fields', () => {
    const warnings: TransformWarning[] = [{ type: 'TAG_MISMATCH', message: 'parent tag used', globalId: 'S1', sheet: 'stems', rowIndex: 3, value: '999' }];
    const csv = warningsToCsv(warnings);
    const lines = csv.split('\n');
    expect(lines[0]).toBe('type,sheet,rowIndex,globalId,value,message');
    expect(lines[1]).toBe('"TAG_MISMATCH","stems","3","S1","999","parent tag used"');
  });

  it('escapes embedded commas and double quotes in a field', () => {
    const warnings: TransformWarning[] = [
      { type: 'MISSING_REQUIRED', message: 'missing "tag", row kept', globalId: null, sheet: 'trees', rowIndex: 0, value: 'tag' }
    ];
    const line = warningsToCsv(warnings).split('\n')[1];
    expect(line).toBe('"MISSING_REQUIRED","trees","0","","tag","missing ""tag"", row kept"');
  });

  it('renders null/undefined fields as empty strings', () => {
    const warnings: TransformWarning[] = [{ type: 'BLANK_QUADRAT', message: 'blank', globalId: null, sheet: 'trees', rowIndex: null }];
    const line = warningsToCsv(warnings).split('\n')[1];
    expect(line).toBe('"BLANK_QUADRAT","trees","","","","blank"');
  });
});
