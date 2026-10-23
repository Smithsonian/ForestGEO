import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import PostValidationRow from './postvalidationrow';
import { formatInstant } from '@/config/dateformats';
import type { PostValidationQueriesRDS } from '@/lib/db/definitions/validations';

vi.mock('@/components/client/codeeditor', () => ({
  default: () => <div data-testid="code-editor" />
}));

function renderRow(lastRunAt: unknown) {
  const postValidation = {
    queryID: 1,
    queryName: 'Q1',
    description: 'desc',
    queryDefinition: 'SELECT 1',
    lastRunAt,
    lastRunStatus: 'success'
  } as unknown as PostValidationQueriesRDS;
  return render(
    <table>
      <tbody>
        <PostValidationRow
          postValidation={postValidation}
          selectedResults={[]}
          schemaDetails={[]}
          expanded={false}
          isDarkMode={false}
          expandedQuery={null}
          replacements={{ schema: 'forestgeo_test', currentPlotID: 1, currentCensusID: 1 }}
          handleExpandClick={vi.fn()}
          handleExpandResultsClick={vi.fn()}
          handleSelectResult={vi.fn()}
        />
      </tbody>
    </table>
  );
}

// The expected text is computed with the same zone the process runs in, so the assertion holds
// under TZ=UTC, TZ=America/Los_Angeles and TZ=Pacific/Auckland without mutating process.env.TZ.
describe('PostValidationRow Last Run At', () => {
  it('shows an ISO instant converted once to the viewer zone', () => {
    renderRow('2026-10-20T15:30:00.000Z');
    expect(screen.getByText(formatInstant('2026-10-20T15:30:00.000Z')!)).toBeInTheDocument();
  });

  it('reads a zone-less database datetime as UTC and shows the same instant as its ISO form', () => {
    renderRow('2026-10-20 15:30:00');
    expect(screen.getByText(formatInstant('2026-10-20T15:30:00.000Z')!)).toBeInTheDocument();
  });

  it('does not shift an offset-bearing ISO timestamp twice', () => {
    renderRow('2026-10-20T08:30:00-07:00');
    expect(screen.getByText(formatInstant('2026-10-20T15:30:00.000Z')!)).toBeInTheDocument();
  });

  it('says "Never run" for null, missing and invalid values', () => {
    for (const value of [null, undefined, '', 'not a date']) {
      const { unmount } = renderRow(value);
      expect(screen.getByText('Never run')).toBeInTheDocument();
      unmount();
    }
  });
});
