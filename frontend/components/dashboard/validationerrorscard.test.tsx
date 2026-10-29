import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import ValidationErrorsCard from './validationerrorscard';
import { CENSUS_OVERVIEW_TEXT, type CensusOverviewSummary, type ErrorTypeCount } from '@/config/censusoverview';
import { ERRORS_EXPLORER_MESSAGE_PARAM, ERRORS_EXPLORER_VIEW_ALL_HREF } from '@/config/errorsexplorer';

const URL_BASE = 'http://localhost';
const ERROR_TYPE_ROW_TEST_ID = 'census-overview-error-type-row';
const ERROR_OVERVIEW_TEST_ID = 'census-overview-error-overview';
const ATTRIBUTE_CODE_MESSAGE = 'Attribute code does not exist in attributes table';
const DBH_SHRINKAGE_MESSAGE = 'DBH shrinkage exceeds maximum rate of 5 percent';
const MESSAGE_WITH_URL_SYNTAX = 'Flagged; different species & genus?';

function errorTypes(count: number): ErrorTypeCount[] {
  return Array.from({ length: count }, (_, index) => ({ message: `Error type ${index + 1}`, count: 10 - index }));
}

function buildErrorOverview(overrides: Partial<CensusOverviewSummary['errorOverview']> = {}): CensusOverviewSummary['errorOverview'] {
  return {
    affectedMeasurements: 21,
    totalActiveMeasurements: 88,
    topErrorTypes: [
      { message: ATTRIBUTE_CODE_MESSAGE, count: 3 },
      { message: DBH_SHRINKAGE_MESSAGE, count: 2 }
    ],
    remainingErrorTypeCount: 0,
    ...overrides
  };
}

function rowCells(row: HTMLElement): string[] {
  return within(row)
    .getAllByRole('cell')
    .map(cell => cell.textContent ?? '');
}

function loggedRows(): string[][] {
  const rows = screen.getAllByTestId(ERROR_TYPE_ROW_TEST_ID).map(rowCells);
  console.log(`[option A validation errors] rows ${JSON.stringify(rows)}`);
  return rows;
}

describe('ValidationErrorsCard', () => {
  it('is titled Validation Errors and states the affected count against the active total', () => {
    render(<ValidationErrorsCard errorOverview={buildErrorOverview()} />);
    expect(screen.getByRole('heading', { name: CENSUS_OVERVIEW_TEXT.validationErrorsTitle })).toBeInTheDocument();
    const overview = screen.getByTestId(ERROR_OVERVIEW_TEST_ID);
    expect(within(overview).getByText('21')).toBeInTheDocument();
    expect(within(overview).getByText('of 88 measurements · 23.9%')).toBeInTheDocument();
  });

  it('lists each error type with its row count and its share of the active measurements', () => {
    render(<ValidationErrorsCard errorOverview={buildErrorOverview()} />);
    const headings = screen.getAllByRole('columnheader').map(header => header.textContent);
    expect(headings).toEqual(['Error type', 'Rows', 'Share of 88 active']);
    expect(loggedRows()).toEqual([
      [ATTRIBUTE_CODE_MESSAGE, '3', '3.4%'],
      [DBH_SHRINKAGE_MESSAGE, '2', '2.3%']
    ]);
  });

  it('shows a dash instead of a share when there are no active measurements to divide by', () => {
    render(
      <ValidationErrorsCard
        errorOverview={buildErrorOverview({
          affectedMeasurements: 3,
          totalActiveMeasurements: 0,
          topErrorTypes: [{ message: ATTRIBUTE_CODE_MESSAGE, count: 3 }]
        })}
      />
    );
    expect(loggedRows()).toEqual([[ATTRIBUTE_CODE_MESSAGE, '3', '—']]);
    expect(screen.getByTestId(ERROR_OVERVIEW_TEST_ID).textContent).not.toContain('%');
  });

  it('never shows a share above 100% when more rows are affected than are active', () => {
    render(
      <ValidationErrorsCard
        errorOverview={buildErrorOverview({
          affectedMeasurements: 30,
          totalActiveMeasurements: 20,
          topErrorTypes: [{ message: ATTRIBUTE_CODE_MESSAGE, count: 25 }]
        })}
      />
    );
    expect(loggedRows()).toEqual([[ATTRIBUTE_CODE_MESSAGE, '25', '—']]);
    expect(screen.getByTestId(ERROR_OVERVIEW_TEST_ID).textContent).not.toMatch(/\d+\.\d%/);
  });

  it('says how many error types are not listed, plus the overlap note', () => {
    render(<ValidationErrorsCard errorOverview={buildErrorOverview({ topErrorTypes: errorTypes(5), remainingErrorTypeCount: 2 })} />);
    expect(screen.getAllByTestId(ERROR_TYPE_ROW_TEST_ID)).toHaveLength(5);
    expect(screen.getByText('Plus 2 more error types. One measurement can carry several errors.')).toBeInTheDocument();
  });

  it('shows only the overlap note when every type is listed', () => {
    render(<ValidationErrorsCard errorOverview={buildErrorOverview()} />);
    expect(screen.getByText(CENSUS_OVERVIEW_TEXT.multipleErrorsNote)).toBeInTheDocument();
    expect(screen.queryByText(/^Plus /)).toBeNull();
  });

  it('links each full error message to View Errors filtered by that message', () => {
    render(<ValidationErrorsCard errorOverview={buildErrorOverview({ topErrorTypes: [{ message: MESSAGE_WITH_URL_SYNTAX, count: 2 }] })} />);
    const link = screen.getByRole('link', { name: MESSAGE_WITH_URL_SYNTAX });
    const href = new URL(link.getAttribute('href') ?? '', URL_BASE);
    console.log(`[option A validation errors] message link ${href.pathname}${href.search}`);
    expect(href.searchParams.get(ERRORS_EXPLORER_MESSAGE_PARAM)).toBe(MESSAGE_WITH_URL_SYNTAX);
  });

  it('links "View all errors" to the view-all deep link', () => {
    render(<ValidationErrorsCard errorOverview={buildErrorOverview()} />);
    expect(screen.getByRole('link', { name: CENSUS_OVERVIEW_TEXT.viewAllErrors })).toHaveAttribute('href', ERRORS_EXPLORER_VIEW_ALL_HREF);
  });

  it('says there are no unresolved errors, with no table, when nothing is affected', () => {
    render(<ValidationErrorsCard errorOverview={buildErrorOverview({ affectedMeasurements: 0, topErrorTypes: [] })} />);
    expect(screen.getByText(CENSUS_OVERVIEW_TEXT.noUnresolvedErrors)).toBeInTheDocument();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('says there are no measurements yet for an empty census', () => {
    render(<ValidationErrorsCard errorOverview={buildErrorOverview({ affectedMeasurements: 0, totalActiveMeasurements: 0, topErrorTypes: [] })} />);
    expect(screen.getByText(CENSUS_OVERVIEW_TEXT.noMeasurementsYet)).toBeInTheDocument();
  });

  it('shows the title but no numbers or table while the summary loads', () => {
    render(<ValidationErrorsCard errorOverview={null} />);
    expect(screen.getByRole('heading', { name: CENSUS_OVERVIEW_TEXT.validationErrorsTitle })).toBeInTheDocument();
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.queryByTestId(ERROR_OVERVIEW_TEST_ID)).toBeNull();
  });
});
