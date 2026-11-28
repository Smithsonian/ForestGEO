import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ValidationOverrideModal, { NO_ELIGIBLE_ROWS_MESSAGE, performValidationOverride } from './validationoverridemodal';
import { HTTPResponses } from '@/config/macros';
import { INTERNAL_SERVER_ERROR_MESSAGE } from '@/lib/errorhelpers';
import { TRANSACTION_COMMIT_OUTCOME_UNKNOWN_CODE } from '@/lib/db/transactionerrors';
import {
  VALIDATION_OVERRIDE_ENDPOINT,
  VALIDATION_OVERRIDE_FAILED_MESSAGE,
  VALIDATION_SCOPE_ACTION_CODES,
  VALIDATION_SCOPE_ADMIN_REQUIRED_MESSAGE,
  VALIDATION_SCOPE_BUSY_MESSAGE,
  VALIDATION_SCOPE_UNCONFIRMED_MESSAGE
} from '@/config/validationscopeactions';

const SCHEMA = 'forestgeo_testing';
const PLOT_ID = 7;
const CENSUS_ID = 42;

vi.mock('@/app/contexts/compat-hooks', () => ({
  useSiteContext: () => ({ schemaName: 'forestgeo_testing' }),
  usePlotContext: () => ({ plotID: 7 }),
  useOrgCensusContext: () => ({ plotCensusNumber: 3, dateRanges: [{ censusID: 42 }] })
}));

vi.mock('@/ailogger', () => ({ default: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));

interface SentRequest {
  url: string;
  body: Record<string, unknown>;
}

function jsonResponse(body: unknown, status: number = HTTPResponses.OK) {
  return new Response(JSON.stringify(body), { status });
}

function mockFetch(respond: () => Response | Promise<Response>) {
  const sent: SentRequest[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      sent.push({ url, body: JSON.parse(init.body as string) });
      return respond();
    })
  );
  return sent;
}

function overridden(count: number) {
  return jsonResponse({ overriddenMeasurementCount: count, removedValidationErrorCount: count });
}

describe('performValidationOverride', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends one structured request (schema, plot, census) to the override route and no SQL', async () => {
    const sent = mockFetch(() => overridden(3));
    const result = await performValidationOverride(SCHEMA, PLOT_ID, CENSUS_ID);
    console.log('[override request]', JSON.stringify(sent));
    expect(result).toBe(3);
    expect(sent).toEqual([{ url: VALIDATION_OVERRIDE_ENDPOINT, body: { schema: SCHEMA, plotID: PLOT_ID, censusID: CENSUS_ID } }]);
  });

  it.each([
    ['a busy census (423)', jsonResponse({ code: VALIDATION_SCOPE_ACTION_CODES.scopeBusy }, HTTPResponses.LOCKED), VALIDATION_SCOPE_BUSY_MESSAGE],
    [
      'a non-admin (403)',
      jsonResponse({ code: VALIDATION_SCOPE_ACTION_CODES.adminRequired }, HTTPResponses.FORBIDDEN),
      VALIDATION_SCOPE_ADMIN_REQUIRED_MESSAGE
    ],
    [
      'a server failure (500)',
      jsonResponse({ error: INTERNAL_SERVER_ERROR_MESSAGE, code: VALIDATION_SCOPE_ACTION_CODES.failed }, HTTPResponses.INTERNAL_SERVER_ERROR),
      VALIDATION_OVERRIDE_FAILED_MESSAGE
    ],
    [
      'an unknown COMMIT outcome',
      jsonResponse({ code: TRANSACTION_COMMIT_OUTCOME_UNKNOWN_CODE }, HTTPResponses.INTERNAL_SERVER_ERROR),
      VALIDATION_SCOPE_UNCONFIRMED_MESSAGE
    ],
    ['a 200 without counts', jsonResponse({}), VALIDATION_SCOPE_UNCONFIRMED_MESSAGE]
  ])('rejects %s with the message for it', async (_label, response, expectedMessage) => {
    mockFetch(() => response);
    await expect(performValidationOverride(SCHEMA, PLOT_ID, CENSUS_ID)).rejects.toThrow(expectedMessage);
  });

  it('reports a dropped connection as unconfirmed, never as nothing changed', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('network down');
      })
    );
    await expect(performValidationOverride(SCHEMA, PLOT_ID, CENSUS_ID)).rejects.toThrow(VALIDATION_SCOPE_UNCONFIRMED_MESSAGE);
  });
});

describe('ValidationOverrideModal', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  async function confirm() {
    await userEvent.click(await screen.findByRole('button', { name: /confirm/i }));
  }

  it("sends the active census's ID and closes with overridePerformed=true after a successful override", async () => {
    const sent = mockFetch(() => overridden(1));
    const onClose = vi.fn(async () => undefined);
    render(<ValidationOverrideModal isValidationOverrideModalOpen handleValidationOverrideModalClose={onClose} />);

    await confirm();

    await waitFor(() => expect(onClose).toHaveBeenCalledWith(true));
    expect(sent[0].body).toEqual({ schema: SCHEMA, plotID: PLOT_ID, censusID: CENSUS_ID });
  });

  it('shows the no-op message and does not report an override when nothing was eligible', async () => {
    mockFetch(() => overridden(0));
    const onClose = vi.fn(async () => undefined);
    render(<ValidationOverrideModal isValidationOverrideModalOpen handleValidationOverrideModalClose={onClose} />);

    await confirm();

    expect(await screen.findByText(NO_ELIGIBLE_ROWS_MESSAGE)).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalledWith(true);
  });

  it('tells the user the census is busy on 423 and never reports success', async () => {
    mockFetch(() => jsonResponse({ error: VALIDATION_SCOPE_BUSY_MESSAGE, code: VALIDATION_SCOPE_ACTION_CODES.scopeBusy }, HTTPResponses.LOCKED));
    const onClose = vi.fn(async () => undefined);
    render(<ValidationOverrideModal isValidationOverrideModalOpen handleValidationOverrideModalClose={onClose} />);

    await confirm();

    expect(await screen.findByRole('alert')).toHaveTextContent(VALIDATION_SCOPE_BUSY_MESSAGE);
    expect(onClose).not.toHaveBeenCalledWith(true);
  });

  it('shows the generic failure and never the server text on a 500', async () => {
    mockFetch(() => jsonResponse({ error: INTERNAL_SERVER_ERROR_MESSAGE, code: VALIDATION_SCOPE_ACTION_CODES.failed }, HTTPResponses.INTERNAL_SERVER_ERROR));
    const onClose = vi.fn(async () => undefined);
    render(<ValidationOverrideModal isValidationOverrideModalOpen handleValidationOverrideModalClose={onClose} />);

    await confirm();

    expect(await screen.findByRole('alert')).toHaveTextContent(VALIDATION_OVERRIDE_FAILED_MESSAGE);
    expect(onClose).not.toHaveBeenCalledWith(true);
  });
});
