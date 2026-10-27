import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ValidationOverrideModal, { NO_ELIGIBLE_ROWS_MESSAGE, performValidationOverride } from './validationoverridemodal';
import { buildMeasurementOverrideEligibleSql } from '@/config/measurementstatefilters';

vi.mock('@/app/contexts/compat-hooks', () => ({
  useSiteContext: () => ({ schemaName: 'myschema' }),
  usePlotContext: () => ({ plotID: 7 }),
  useOrgCensusContext: () => ({ plotCensusNumber: 3 })
}));

vi.mock('@/ailogger', () => ({ default: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));

interface SentRequest {
  query: string;
  params: number[];
}

function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body } as Response;
}

function mockFetch(handler: (request: SentRequest, index: number) => Response) {
  const sent: SentRequest[] = [];
  const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
    const request = JSON.parse(init.body as string) as SentRequest;
    sent.push(request);
    return handler(request, sent.length - 1);
  });
  vi.stubGlobal('fetch', fetchMock);
  return { sent, fetchMock };
}

describe('performValidationOverride', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it('counts, clears validation logs, then marks eligible rows validated, all with the same predicate and scope', async () => {
    const { sent } = mockFetch((request, index) =>
      index === 0 ? jsonResponse([{ EligibleCount: 4 }]) : index === 2 ? jsonResponse({ affectedRows: 3 }) : jsonResponse({ affectedRows: 0 })
    );

    const result = await performValidationOverride('myschema', 7, 3);

    expect(result).toBe(3); // actual UPDATE affectedRows, not the pre-count of 4
    expect(sent).toHaveLength(3);
    const eligible = buildMeasurementOverrideEligibleSql('myschema', 'cm');
    expect(sent[0].query).toContain('SELECT COUNT(*)');
    expect(sent[1].query).toContain('DELETE mel');
    expect(sent[2].query).toContain('UPDATE myschema.coremeasurements');
    for (const request of sent) {
      expect(request.query).toContain(eligible);
      expect(request.params).toEqual([7, 3, 7]);
    }
  });

  it('still marks pending rows validated when zero validation-log rows were deleted (affectedRows 0 is not an error)', async () => {
    const { sent } = mockFetch((_request, index) => (index === 0 ? jsonResponse([{ EligibleCount: 2 }]) : jsonResponse({ affectedRows: index === 2 ? 2 : 0 })));

    await expect(performValidationOverride('myschema', 7, 3)).resolves.toBe(2);
    expect(sent[2].query).toContain('SET cm.IsValidated = TRUE');
  });

  it('issues no write statement when zero rows are eligible', async () => {
    const { sent } = mockFetch(() => jsonResponse([{ EligibleCount: 0 }]));

    await expect(performValidationOverride('myschema', 7, 3)).resolves.toBe(0);
    expect(sent).toHaveLength(1);
    expect(sent[0].query).toContain('SELECT COUNT(*)');
  });

  it('scopes to the requested census via params so another census is not touched', async () => {
    const { sent } = mockFetch(() => jsonResponse([{ EligibleCount: 0 }]));

    await performValidationOverride('myschema', 7, 99);
    expect(sent[0].params).toEqual([7, 99, 7]);
  });

  it('throws and stops before the UPDATE when the clear request fails (no row marked validated)', async () => {
    const { sent } = mockFetch((_request, index) => {
      if (index === 0) return jsonResponse([{ EligibleCount: 3 }]);
      return jsonResponse({ error: 'Only administrators may execute write SQL' }, false, 403);
    });

    await expect(performValidationOverride('myschema', 7, 3)).rejects.toThrow(/Clearing validation logs failed \(HTTP 403\).*administrators/);
    expect(sent).toHaveLength(2);
  });
});

describe('performValidationOverride final UPDATE result', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns 0 (no-op) when the UPDATE affects no rows although the pre-count was positive', async () => {
    mockFetch((_request, index) => (index === 0 ? jsonResponse([{ EligibleCount: 5 }]) : jsonResponse({ affectedRows: 0 })));
    await expect(performValidationOverride('myschema', 7, 3)).resolves.toBe(0);
  });

  it.each([[[]], [{}], [{ affectedRows: '3' }], [null], [{ affectedRows: -1 }]])('throws on a malformed UPDATE response %j', async body => {
    mockFetch((_request, index) => (index === 0 ? jsonResponse([{ EligibleCount: 5 }]) : jsonResponse(body)));
    await expect(performValidationOverride('myschema', 7, 3)).rejects.toThrow(/unexpected response/);
  });
});

describe('ValidationOverrideModal', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  async function confirm() {
    await userEvent.click(await screen.findByRole('button', { name: /confirm/i }));
  }

  it('closes with overridePerformed=true after a successful override', async () => {
    mockFetch((_request, index) => (index === 0 ? jsonResponse([{ EligibleCount: 1 }]) : jsonResponse({ affectedRows: 1 })));
    const onClose = vi.fn(async () => undefined);
    render(<ValidationOverrideModal isValidationOverrideModalOpen handleValidationOverrideModalClose={onClose} />);

    await confirm();

    await waitFor(() => expect(onClose).toHaveBeenCalledWith(true));
  });

  it('shows a clear no-op message and does not report an override when nothing is eligible', async () => {
    const { sent } = mockFetch(() => jsonResponse([{ EligibleCount: 0 }]));
    const onClose = vi.fn(async () => undefined);
    render(<ValidationOverrideModal isValidationOverrideModalOpen handleValidationOverrideModalClose={onClose} />);

    await confirm();

    expect(await screen.findByText(NO_ELIGIBLE_ROWS_MESSAGE)).toBeInTheDocument();
    expect(sent).toHaveLength(1);
    expect(onClose).not.toHaveBeenCalledWith(true);
  });

  it('shows the no-op message and no success when the UPDATE affects 0 rows after a positive pre-count', async () => {
    mockFetch((_request, index) => (index === 0 ? jsonResponse([{ EligibleCount: 2 }]) : jsonResponse({ affectedRows: 0 })));
    const onClose = vi.fn(async () => undefined);
    render(<ValidationOverrideModal isValidationOverrideModalOpen handleValidationOverrideModalClose={onClose} />);

    await confirm();

    expect(await screen.findByText(NO_ELIGIBLE_ROWS_MESSAGE)).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalledWith(true);
  });

  it('shows an error and no success when the UPDATE response is malformed', async () => {
    mockFetch((_request, index) => (index === 0 ? jsonResponse([{ EligibleCount: 2 }]) : jsonResponse([])));
    const onClose = vi.fn(async () => undefined);
    render(<ValidationOverrideModal isValidationOverrideModalOpen handleValidationOverrideModalClose={onClose} />);

    await confirm();

    expect(await screen.findByRole('alert')).toHaveTextContent(/Validation override failed.*unexpected response/);
    expect(onClose).not.toHaveBeenCalledWith(true);
  });

  it('reports a request failure visibly and never reports success', async () => {
    mockFetch((_request, index) => (index === 0 ? jsonResponse([{ EligibleCount: 2 }]) : jsonResponse({ error: 'boom' }, false, 500)));
    const onClose = vi.fn(async () => undefined);
    render(<ValidationOverrideModal isValidationOverrideModalOpen handleValidationOverrideModalClose={onClose} />);

    await confirm();

    expect(await screen.findByRole('alert')).toHaveTextContent(/Validation override failed.*HTTP 500.*boom/);
    expect(onClose).not.toHaveBeenCalledWith(true);
  });
});
