import { describe, expect, it } from 'vitest';
import { resolveDefaultTabValue } from './uploadrevisionmatch';

// The original chain was:
//   changes > 0 ? 'changes' : duplicates > 0 ? 'duplicates' : 'changes'
// which can never yield 'new'. A revision upload of only new rows therefore opened on
// an empty Changes tab, leaving "Confirm new row insertion" on a tab the user had to
// find, with the action reading "Apply 0 Revisions" and disabled. The same pattern
// would strand invalid-only and unchanged-only uploads, so those fall through too.

const NONE = { changes: 0, duplicates: 0, newRows: 0, invalid: 0, unchanged: 0 };

describe('resolveDefaultTabValue', () => {
  it('prefers changes when rows need updating', () => {
    expect(resolveDefaultTabValue({ ...NONE, changes: 3, duplicates: 2, newRows: 1 })).toBe('changes');
  });

  it('falls back to duplicates when there are no changes', () => {
    expect(resolveDefaultTabValue({ ...NONE, duplicates: 2, newRows: 1 })).toBe('duplicates');
  });

  it('opens on new rows when they are the only actionable content', () => {
    expect(resolveDefaultTabValue({ ...NONE, newRows: 1 })).toBe('new');
  });

  it('opens on invalid rows when nothing else is present', () => {
    expect(resolveDefaultTabValue({ ...NONE, invalid: 4 })).toBe('invalid');
  });

  it('opens on unchanged rows when that is all there is', () => {
    expect(resolveDefaultTabValue({ ...NONE, unchanged: 9 })).toBe('unchanged');
  });

  it('returns changes as the genuine empty state', () => {
    expect(resolveDefaultTabValue(NONE)).toBe('changes');
  });

  it('never selects a tab whose panel would not be rendered', () => {
    // Every non-'changes' tab is conditionally rendered on its own count being > 0.
    const shapes = [
      { ...NONE, newRows: 2, unchanged: 5 },
      { ...NONE, duplicates: 1, invalid: 3 },
      { ...NONE, invalid: 1, unchanged: 1 }
    ];

    for (const shape of shapes) {
      const resolved = resolveDefaultTabValue(shape);
      const countForResolved = {
        changes: shape.changes,
        duplicates: shape.duplicates,
        new: shape.newRows,
        invalid: shape.invalid,
        unchanged: shape.unchanged
      }[resolved];

      expect(resolved === 'changes' || countForResolved > 0, `${resolved} panel would not render`).toBe(true);
    }
  });
});
