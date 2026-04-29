import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import UploadRevisionMatch from './uploadrevisionmatch';
import { EMPTY_REVISION_MATCH_COUNTS, RevisionMatchedRow, RevisionNewRowCandidate } from '@/config/revisionuploadtypes';
import { ReviewStates } from '@/config/macros/uploadsystemmacros';
import type { BulkEditPlan, Effect } from '@/config/editplan/types';

function buildBulkPlan(overrides: Partial<BulkEditPlan> = {}, effects: Effect[] = []): BulkEditPlan {
  return {
    dataType: 'measurementssummary',
    rowCount: 1,
    rowPlans: [{ rowIndex: 0, targetID: 101, status: 'matched' }],
    aggregateEffects: effects,
    maxSeverity: effects.reduce<BulkEditPlan['maxSeverity']>((m, e) => {
      const rank = { info: 0, warn: 1, destructive: 2 } as const;
      return rank[e.severity] > rank[m] ? e.severity : m;
    }, 'info'),
    planHash: 'test-plan-hash',
    generatedAt: '2026-04-20T00:00:00.000Z',
    ...overrides,
    duplicateDeletions: overrides.duplicateDeletions ?? []
  };
}

describe('UploadRevisionMatch', () => {
  // Pre-flight role warning: when uploadparent detects a non-admin user is
  // about to upload a revisions file with an spcode column, it passes a
  // warning string that the match screen surfaces above the role-blocked
  // banner. This is the early signal — server-side enforcement still backstops
  // at apply.
  it('renders the preflight warning banner when uploadparent supplies one', () => {
    render(
      <UploadRevisionMatch
        matchedRows={[]}
        newRows={[]}
        invalidRows={[]}
        counts={EMPTY_REVISION_MATCH_COUNTS}
        preflightWarning='File "fix.csv" contains a "spcode" column. Species-code changes require global or db admin role.'
        schema="forestgeo_testing"
        plotID={1}
        censusID={2}
        setReviewState={vi.fn<(state: ReviewStates) => void>()}
        onApply={vi.fn()}
        handleReturnToStart={vi.fn(async () => undefined)}
      />
    );
    const banner = screen.getByTestId('revision-preflight-warning');
    expect(banner).toBeInTheDocument();
    expect(banner.textContent).toContain('spcode');
  });

  it('shows the species role-blocked banner only when the bulk plan has RoleForbiddenField errors, not for unrelated blockers (regression: a TreeStemResolution failure on a non-spcode row was misleading global users into thinking the role check fired)', () => {
    const matchedRow: RevisionMatchedRow = {
      coreMeasurementID: 101,
      csvRow: { stemid: '101', quadrat: '999' },
      existingValues: {
        measuredDBH: 10,
        measuredHOM: 1.3,
        measurementDate: '2025-01-01',
        rawCodes: null,
        description: null
      },
      changes: { quadrat: { from: 'Q1', to: '999' } }
    };
    const bulkPlan: BulkEditPlan = {
      dataType: 'measurementssummary',
      rowCount: 1,
      rowPlans: [{ rowIndex: 0, targetID: 101, status: 'matched' }],
      aggregateEffects: [],
      maxSeverity: 'destructive',
      planHash: 'plan',
      generatedAt: '2026-04-20T00:00:00.000Z',
      duplicateDeletions: [],
      canApply: false,
      errors: [
        {
          kind: 'TreeStemResolution',
          subject: 'quadrat',
          reason: 'missing',
          field: 'QuadratName',
          message: 'Row 1: quadrat "999" was not found in this plot/census',
          severity: 'destructive',
          blocking: true,
          rowIndex: 0
        }
      ]
    };

    render(
      <UploadRevisionMatch
        matchedRows={[matchedRow]}
        newRows={[]}
        invalidRows={[]}
        counts={{ ...EMPTY_REVISION_MATCH_COUNTS, matched: 1, matchedWithChanges: 1, total: 1 }}
        bulkPlan={bulkPlan}
        schema="forestgeo_testing"
        plotID={1}
        censusID={2}
        setReviewState={vi.fn<(state: ReviewStates) => void>()}
        onApply={vi.fn()}
        handleReturnToStart={vi.fn(async () => undefined)}
      />
    );

    expect(screen.queryByTestId('revision-role-blocked')).not.toBeInTheDocument();
    const banner = screen.getByTestId('revision-blocking-errors');
    expect(banner.textContent).toContain('quadrat');
    expect(banner.textContent).toContain('999');
  });

  it('shows the species role-blocked banner when the bulk plan has a RoleForbiddenField error', () => {
    const matchedRow: RevisionMatchedRow = {
      coreMeasurementID: 101,
      csvRow: { stemid: '101', spcode: 'NEWSPC' },
      existingValues: {
        measuredDBH: 10,
        measuredHOM: 1.3,
        measurementDate: '2025-01-01',
        rawCodes: null,
        description: null
      },
      changes: { spcode: { from: 'AAA', to: 'NEWSPC' } }
    };
    const bulkPlan: BulkEditPlan = {
      dataType: 'measurementssummary',
      rowCount: 1,
      rowPlans: [{ rowIndex: 0, targetID: 101, status: 'matched' }],
      aggregateEffects: [],
      maxSeverity: 'destructive',
      planHash: 'plan',
      generatedAt: '2026-04-20T00:00:00.000Z',
      duplicateDeletions: [],
      canApply: false,
      errors: [
        {
          kind: 'RoleForbiddenField',
          field: 'spcode',
          role: 'field crew',
          message: 'Row 1: spcode can only be edited by global or db admin users.',
          severity: 'destructive',
          blocking: true,
          rowIndex: 0
        }
      ]
    };

    render(
      <UploadRevisionMatch
        matchedRows={[matchedRow]}
        newRows={[]}
        invalidRows={[]}
        counts={{ ...EMPTY_REVISION_MATCH_COUNTS, matched: 1, matchedWithChanges: 1, total: 1 }}
        bulkPlan={bulkPlan}
        schema="forestgeo_testing"
        plotID={1}
        censusID={2}
        setReviewState={vi.fn<(state: ReviewStates) => void>()}
        onApply={vi.fn()}
        handleReturnToStart={vi.fn(async () => undefined)}
      />
    );

    expect(screen.getByTestId('revision-role-blocked')).toBeInTheDocument();
    expect(screen.queryByTestId('revision-blocking-errors')).not.toBeInTheDocument();
  });

  it('omits the preflight warning banner when none is supplied', () => {
    render(
      <UploadRevisionMatch
        matchedRows={[]}
        newRows={[]}
        invalidRows={[]}
        counts={EMPTY_REVISION_MATCH_COUNTS}
        schema="forestgeo_testing"
        plotID={1}
        censusID={2}
        setReviewState={vi.fn<(state: ReviewStates) => void>()}
        onApply={vi.fn()}
        handleReturnToStart={vi.fn(async () => undefined)}
      />
    );
    expect(screen.queryByTestId('revision-preflight-warning')).not.toBeInTheDocument();
  });

  it('treats duplicate-only survivor rows as actionable revisions', async () => {
    const onApply = vi.fn();
    const handleReturnToStart = vi.fn(async () => undefined);
    const setReviewState = vi.fn<(state: ReviewStates) => void>();
    const matchedRows: RevisionMatchedRow[] = [
      {
        coreMeasurementID: 101,
        csvRow: {},
        duplicateMeasurementIDsToDelete: [55, 56],
        existingValues: {
          measuredDBH: 10.2,
          measuredHOM: 1.3,
          measurementDate: '2025-01-01',
          rawCodes: null,
          description: null
        },
        changes: {}
      }
    ];

    render(
      <UploadRevisionMatch
        matchedRows={matchedRows}
        newRows={[]}
        invalidRows={[]}
        counts={EMPTY_REVISION_MATCH_COUNTS}
        schema="forestgeo_testing"
        plotID={1}
        censusID={2}
        setReviewState={setReviewState}
        onApply={onApply}
        handleReturnToStart={handleReturnToStart}
      />
    );

    expect(screen.getByText('1 rows to deduplicate')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Duplicate Cleanup (1)' })).toBeInTheDocument();

    const applyButton = screen.getByRole('button', { name: 'Apply 1 Revisions' });
    expect(applyButton).toBeEnabled();

    const user = userEvent.setup();
    await user.click(applyButton);

    expect(onApply).toHaveBeenCalledWith(false);
  });

  it('surfaces a warning in the New Rows tab when a supplied stemid did not match any measurement in the census', async () => {
    const onApply = vi.fn();
    const handleReturnToStart = vi.fn(async () => undefined);
    const setReviewState = vi.fn<(state: ReviewStates) => void>();
    const newRows: RevisionNewRowCandidate[] = [
      {
        csvRow: { stemid: '9999999', tag: 'TREE-X', stemtag: '1', spcode: 'quas', quadrat: '01', lx: '1', ly: '1', dbh: '12.3', date: '2026-04-14' },
        csvIndex: 0,
        reason: 'stemid-not-found'
      },
      {
        csvRow: { tag: 'TREE-Y', stemtag: '1', spcode: 'quas', quadrat: '01', lx: '2', ly: '2', dbh: '8.1', date: '2026-04-14' },
        csvIndex: 1,
        reason: 'no-match-key-in-db'
      }
    ];

    render(
      <UploadRevisionMatch
        matchedRows={[]}
        newRows={newRows}
        invalidRows={[]}
        counts={{ ...EMPTY_REVISION_MATCH_COUNTS, new: 2, total: 2 }}
        schema="forestgeo_testing"
        plotID={1}
        censusID={2}
        setReviewState={setReviewState}
        onApply={onApply}
        handleReturnToStart={handleReturnToStart}
      />
    );

    const user = userEvent.setup();
    await user.click(screen.getByRole('tab', { name: 'New Rows (2)' }));

    expect(screen.getByText(/1 row supplied a stemid that was not found in this census/)).toBeInTheDocument();
    expect(screen.getByText(/stemid 9999999 not found/)).toBeInTheDocument();
    expect(screen.getByText(/no match in census/)).toBeInTheDocument();
  });

  it('opens ImpactSummary with aggregateEffects when Apply is clicked and a bulkPlan is supplied, forwarding onConfirm to the Apply flow', async () => {
    const onApply = vi.fn();
    const handleReturnToStart = vi.fn(async () => undefined);
    const setReviewState = vi.fn<(state: ReviewStates) => void>();
    const matchedRows: RevisionMatchedRow[] = [
      {
        coreMeasurementID: 101,
        csvRow: { stemid: '100', codes: 'B' },
        existingValues: {
          measuredDBH: 10.2,
          measuredHOM: 1.3,
          measurementDate: '2025-01-01',
          rawCodes: 'A',
          description: null
        },
        changes: { codes: { from: 'A', to: 'B' } }
      }
    ];
    const bulkPlan = buildBulkPlan({ rowCount: 1 }, [
      {
        id: 'R5',
        severity: 'info',
        category: 'field',
        title: 'Attribute codes will be rebuilt',
        detail: '1 row(s) affected',
        affectedTable: 'cmattributes',
        affectedRowCount: 1
      }
    ]);

    render(
      <UploadRevisionMatch
        matchedRows={matchedRows}
        newRows={[]}
        invalidRows={[]}
        counts={{ ...EMPTY_REVISION_MATCH_COUNTS, matched: 1, matchedWithChanges: 1, total: 1 }}
        bulkPlan={bulkPlan}
        schema="forestgeo_testing"
        plotID={1}
        censusID={2}
        setReviewState={setReviewState}
        onApply={onApply}
        handleReturnToStart={handleReturnToStart}
      />
    );

    const user = userEvent.setup();
    await user.click(screen.getByTestId('revision-match-apply'));

    expect(screen.getByTestId('impact-summary-effects')).toBeInTheDocument();
    expect(screen.getByText('Attribute codes will be rebuilt')).toBeInTheDocument();
    expect(screen.queryByTestId('impact-summary-typed-confirm')).not.toBeInTheDocument();

    await user.click(screen.getByTestId('impact-summary-apply'));
    expect(onApply).toHaveBeenCalledWith(false);
  });

  it('blocks the Apply button in ImpactSummary behind a typed-confirm prompt when bulkPlan.maxSeverity is destructive (R6 duplicate cleanup)', async () => {
    const onApply = vi.fn();
    const handleReturnToStart = vi.fn(async () => undefined);
    const setReviewState = vi.fn<(state: ReviewStates) => void>();
    const matchedRows: RevisionMatchedRow[] = [
      {
        coreMeasurementID: 101,
        csvRow: {},
        duplicateMeasurementIDsToDelete: [55],
        existingValues: {
          measuredDBH: 10.2,
          measuredHOM: 1.3,
          measurementDate: '2025-01-01',
          rawCodes: null,
          description: null
        },
        changes: {}
      }
    ];
    const bulkPlan = buildBulkPlan({ rowCount: 1 }, [
      {
        id: 'R6',
        severity: 'destructive',
        category: 'destructive',
        title: '1 duplicate measurement(s) will be deleted',
        detail: 'Survivor selection keeps one measurement per stem in this census; the rest are removed.',
        affectedTable: 'coremeasurements',
        affectedRowCount: 1
      }
    ]);

    render(
      <UploadRevisionMatch
        matchedRows={matchedRows}
        newRows={[]}
        invalidRows={[]}
        counts={{ ...EMPTY_REVISION_MATCH_COUNTS, matched: 1, total: 1 }}
        bulkPlan={bulkPlan}
        schema="forestgeo_testing"
        plotID={1}
        censusID={2}
        setReviewState={setReviewState}
        onApply={onApply}
        handleReturnToStart={handleReturnToStart}
      />
    );

    const user = userEvent.setup();
    await user.click(screen.getByTestId('revision-match-apply'));

    expect(screen.getByTestId('impact-summary-typed-confirm')).toBeInTheDocument();
    expect(screen.getByTestId('impact-summary-apply')).toBeDisabled();

    await user.type(screen.getByTestId('impact-summary-typed-confirm-input'), 'APPLY 1');
    expect(screen.getByTestId('impact-summary-apply')).toBeEnabled();

    await user.click(screen.getByTestId('impact-summary-apply'));
    expect(onApply).toHaveBeenCalledWith(false);
  });

  it('renders identity-field edits in the Changes tab so spcode/ly edits flow through the bulk plan', async () => {
    const onApply = vi.fn();
    const handleReturnToStart = vi.fn(async () => undefined);
    const setReviewState = vi.fn<(state: ReviewStates) => void>();
    const matchedRows: RevisionMatchedRow[] = [
      {
        coreMeasurementID: 700,
        csvRow: { stemid: '5283365', spcode: 'AAAAAA', ly: '1111' },
        existingValues: {
          measuredDBH: 44.0,
          measuredHOM: 1.3,
          measurementDate: '2026-03-14',
          rawCodes: 'Q;L',
          description: 'Broken and leaning'
        },
        changes: {
          spcode: { from: 'SLOATE', to: 'AAAAAA' },
          ly: { from: '2.4', to: '1111' }
        }
      }
    ];

    render(
      <UploadRevisionMatch
        matchedRows={matchedRows}
        newRows={[]}
        invalidRows={[]}
        counts={{ ...EMPTY_REVISION_MATCH_COUNTS, matched: 1, matchedWithChanges: 1, total: 1 }}
        schema="forestgeo_testing"
        plotID={1}
        censusID={2}
        setReviewState={setReviewState}
        onApply={onApply}
        handleReturnToStart={handleReturnToStart}
      />
    );

    expect(screen.queryByText(/ignored edits/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: /Ignored Edits/i })).not.toBeInTheDocument();

    const changesTab = screen.getByRole('tabpanel', { name: /Changes \(1\)/i });
    expect(within(changesTab).getByText('spcode')).toBeInTheDocument();
    expect(within(changesTab).getByText('SLOATE')).toBeInTheDocument();
    expect(within(changesTab).getByText('AAAAAA')).toBeInTheDocument();
    expect(within(changesTab).getByText('ly')).toBeInTheDocument();
    expect(within(changesTab).getByText('1111')).toBeInTheDocument();
  });
});
