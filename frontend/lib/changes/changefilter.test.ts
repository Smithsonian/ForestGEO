import { describe, expect, it } from 'vitest';
import { buildChangeFilter } from '@/lib/changes/changefilter';
import type { RecentChangesServerFilters } from '@/config/recentchangesexplorer';

const PLOT_ID = 1;
const PLOT_SCOPE_SQL = '(uc.PlotID = ? OR uc.PlotID IS NULL)';
const QUICK_SEARCH_TEXT_TERM_COUNT = 5;

function serverFilters(overrides: Partial<RecentChangesServerFilters> = {}): RecentChangesServerFilters {
  return { operation: 'all', changedBy: '', tableName: '', quickSearch: '', changedFrom: '', changedTo: '', ...overrides };
}

describe('buildChangeFilter', () => {
  it('returns the plot scope alone, with its binding, when no filter is set', () => {
    expect(buildChangeFilter(PLOT_ID, serverFilters())).toEqual({ sql: PLOT_SCOPE_SQL, params: [PLOT_ID] });
  });

  it('binds operation, user and table in clause order after the plot', () => {
    const filter = buildChangeFilter(PLOT_ID, serverFilters({ operation: 'DELETE', changedBy: 'mason@si.edu', tableName: 'trees' }));
    expect(filter.sql).toBe(`${PLOT_SCOPE_SQL} AND uc.Operation = ? AND uc.ChangedBy = ? AND uc.TableName = ?`);
    expect(filter.params).toEqual([PLOT_ID, 'DELETE', 'mason@si.edu', 'trees']);
  });

  it('keeps the five LIKE terms for a text search and adds no ChangeID term', () => {
    const filter = buildChangeFilter(PLOT_ID, serverFilters({ quickSearch: 'TREE-7' }));
    expect(filter.sql).not.toContain('uc.ChangeID = ?');
    expect(filter.params).toEqual([PLOT_ID, ...Array.from({ length: QUICK_SEARCH_TEXT_TERM_COUNT }, () => '%TREE-7%')]);
  });

  it.each([
    { term: '4821', changeID: 4821 },
    { term: '#4821', changeID: 4821 },
    { term: '  #4821 ', changeID: 4821 }
  ])('also matches ChangeID exactly for the numeric term "$term" (D7)', ({ term, changeID }) => {
    const filter = buildChangeFilter(PLOT_ID, serverFilters({ quickSearch: term }));
    expect(filter.sql, filter.sql).toContain('OR uc.ChangeID = ?)');
    expect(filter.params).toEqual([PLOT_ID, ...Array.from({ length: QUICK_SEARCH_TEXT_TERM_COUNT }, () => `%${term}%`), changeID]);
  });

  it.each(['48a21', '#', '4821#', '12345678901'])('adds no ChangeID term for "%s"', term => {
    expect(buildChangeFilter(PLOT_ID, serverFilters({ quickSearch: term })).sql).not.toContain('uc.ChangeID = ?');
  });

  it('adds each date bound independently, the upper bound covering its whole day', () => {
    const fromOnly = buildChangeFilter(PLOT_ID, serverFilters({ changedFrom: '2026-11-01' }));
    const toOnly = buildChangeFilter(PLOT_ID, serverFilters({ changedTo: '2026-11-05' }));
    const both = buildChangeFilter(PLOT_ID, serverFilters({ changedFrom: '2026-11-01', changedTo: '2026-11-05' }));

    expect(fromOnly).toEqual({ sql: `${PLOT_SCOPE_SQL} AND uc.ChangeTimestamp >= ?`, params: [PLOT_ID, '2026-11-01'] });
    expect(toOnly).toEqual({ sql: `${PLOT_SCOPE_SQL} AND uc.ChangeTimestamp < DATE_ADD(?, INTERVAL 1 DAY)`, params: [PLOT_ID, '2026-11-05'] });
    expect(both.params).toEqual([PLOT_ID, '2026-11-01', '2026-11-05']);
  });

  it('has exactly one binding per placeholder for every filter at once', () => {
    const filter = buildChangeFilter(
      PLOT_ID,
      serverFilters({ operation: 'UPDATE', changedBy: 'a', tableName: 'b', quickSearch: '#9', changedFrom: '2026-11-01', changedTo: '2026-11-05' })
    );
    const placeholderCount = filter.sql.split('?').length - 1;
    expect(filter.params, `sql: ${filter.sql}`).toHaveLength(placeholderCount);
  });
});
