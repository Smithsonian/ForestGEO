import React from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ERROR_TILE_TEXT, VIEW_ERRORS_TEXT, type ErrorCensusTotals } from '@/config/errorsexplorer';
import ErrorsTotalsTiles from './errorstotalstiles';

const TOTALS: ErrorCensusTotals = {
  affectedMeasurements: 21,
  activeMeasurements: 88,
  errorTypeCount: 4,
  validation: 12,
  ingestion: 9,
  failedMeasurements: 7,
  contradictions: 3,
  duplicateTagStem: 2,
  sameBatchConflict: 1
};
const TILE_IDS = ['errors-tile-affected', 'errors-tile-validation', 'errors-tile-failed', 'errors-tile-contradictions'];

describe('ErrorsTotalsTiles', () => {
  it('shows the census totals with the spec captions', () => {
    render(<ErrorsTotalsTiles totals={TOTALS} status="ready" isStale={false} onRetry={vi.fn()} />);
    const affected = within(screen.getByTestId('errors-tile-affected'));
    console.log('[view-errors tiles]', screen.getByTestId('errors-tile-affected').textContent);
    expect(affected.getByText('21')).toBeInTheDocument();
    expect(affected.getByText('of 88')).toBeInTheDocument();
    expect(affected.getByText('23.9% of active measurements')).toBeInTheDocument();
    expect(affected.getByRole('progressbar')).toBeInTheDocument();
    expect(within(screen.getByTestId('errors-tile-validation')).getByText(ERROR_TILE_TEXT.validation.caption)).toBeInTheDocument();
    expect(within(screen.getByTestId('errors-tile-failed')).getByText('7')).toBeInTheDocument();
    expect(within(screen.getByTestId('errors-tile-failed')).getByText(ERROR_TILE_TEXT.failed.caption)).toBeInTheDocument();
    expect(within(screen.getByTestId('errors-tile-contradictions')).getByText('2 duplicate tag/stem · 1 same-batch species')).toBeInTheDocument();
  });

  it('shows spinners on the first load and never 0', () => {
    render(<ErrorsTotalsTiles totals={null} status="loading" isStale={false} onRetry={vi.fn()} />);
    for (const id of TILE_IDS) {
      expect(within(screen.getByTestId(id)).getByRole('progressbar'), id).toBeInTheDocument();
      expect(within(screen.getByTestId(id)).queryByText('0'), id).toBeNull();
    }
  });

  it('shows "—" and one alert with Retry when the first load failed', async () => {
    const onRetry = vi.fn();
    render(<ErrorsTotalsTiles totals={null} status="error" isStale={false} onRetry={onRetry} />);
    for (const id of TILE_IDS) expect(within(screen.getByTestId(id)).getByText(VIEW_ERRORS_TEXT.unavailable), id).toBeInTheDocument();
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(screen.getByRole('alert')).toHaveTextContent(VIEW_ERRORS_TEXT.totalsLoadFailed);
    await userEvent.click(screen.getByRole('button', { name: VIEW_ERRORS_TEXT.retry }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('keeps old numbers with a stale note after a failed refresh', () => {
    render(<ErrorsTotalsTiles totals={TOTALS} status="error" isStale onRetry={vi.fn()} />);
    expect(screen.getByRole('alert')).toHaveTextContent(VIEW_ERRORS_TEXT.totalsStale);
    expect(within(screen.getByTestId('errors-tile-affected')).getByText('21')).toBeInTheDocument();
  });
});
