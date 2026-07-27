/**
 * UploadParseFiles — quadrat geometry preflight
 *
 * Covers the quadrat surface of the active upload screen: the south-west coordinate advisory
 * shown only for Quadrats uploads, and the client-side geometry preflight that blocks Continue
 * on scalar or collection issues. Server-side enforcement is out of scope here.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React, { useState } from 'react';
import { FormType, SourceFormat } from '@/config/macros/formdetails';
import { UploadMode } from '@/config/uploadmodes';
import { FileWithStream, type UploadParseFilesProps } from '@/config/macros/uploadsystemmacros';
import { MAX_GENERATED_QUADRATS } from '@/lib/provisioning/grid-generator';
import type { QuadratOverlapAcknowledgment } from '@/lib/provisioning/types';
import UploadParseFiles, { parseQuadratFileRows } from './uploadparsefiles';

// tests/mocks/platform-mocks.ts stubs '@/lib/db/definitions/zones' with an empty module for
// unrelated suites; this component now calls the real validateQuadratsRow, so unmock it here
// (matching lib/db/definitions/zones.test.ts's pattern).
vi.unmock('@/lib/db/definitions/zones');

// Mutable so individual tests (e.g. missing plot dimensions) can override the plot context
// per-render without re-declaring the whole vi.mock factory. Reset in afterEach so a mutation in
// one test never bleeds into the next.
const DEFAULT_MOCK_PLOT_CONTEXT = { plotID: 1, plotName: 'Test Plot', dimensionX: 100, dimensionY: 100 };
const mockPlotContext = vi.hoisted(() => ({
  current: { plotID: 1, plotName: 'Test Plot', dimensionX: 100 as number | undefined, dimensionY: 100 as number | undefined }
}));

vi.mock('@/app/contexts/compat-hooks', () => ({
  usePlotContext: () => mockPlotContext.current,
  useOrgCensusContext: () => ({ dateRanges: [{ censusID: 1 }] })
}));

afterEach(() => {
  mockPlotContext.current = { ...DEFAULT_MOCK_PLOT_CONTEXT };
});

// FileListEnhanced does real header/delimiter validation independent of the quadrat geometry
// preflight under test; report every file as header-valid so allFilesValid never masks the
// preflight's own Continue-button gating.
vi.mock('@/components/uploadsystemhelpers/filelistenhanced', async () => {
  const { useEffect } = await import('react');
  return {
    FileListEnhanced: ({
      acceptedFiles,
      onValidationStatusChange
    }: {
      acceptedFiles: { name: string }[];
      onValidationStatusChange: (name: string, isValid: boolean, issues: unknown[], headers: string[]) => void;
    }) => {
      useEffect(() => {
        acceptedFiles.forEach(file => onValidationStatusChange(file.name, true, [], ['quadrat', 'startx', 'starty', 'dimx', 'dimy', 'area', 'quadratshape']));
      }, [acceptedFiles, onValidationStatusChange]);
      return null;
    }
  };
});

vi.mock('@/components/uploadsystemhelpers/dropzonecompact', () => ({
  DropzoneCompact: ({ allowMultipleFiles }: { allowMultipleFiles?: boolean }) => (
    <div data-testid="dropzone-file-mode">{allowMultipleFiles === false ? 'single' : 'multiple'}</div>
  )
}));

const QUADRAT_HEADER_ROW = 'quadrat,startx,starty,dimx,dimy,area,quadratshape';

function buildQuadratFile(fileName: string, dataRow: string): FileWithStream {
  const raw = new File([`${QUADRAT_HEADER_ROW}\n${dataRow}\n`], fileName, { type: 'text/csv' });
  return new FileWithStream(raw, false);
}

// UploadParseFiles receives the overlap acknowledgment and its setter as props (owned by
// UploadParent in production); this reproduces that contract for the test.
function Harness(props: Partial<UploadParseFilesProps>) {
  const [overlapAcknowledgment, setOverlapAcknowledgment] = useState<QuadratOverlapAcknowledgment | null>(null);
  const defaults: UploadParseFilesProps = {
    uploadForm: FormType.quadrats,
    uploadMode: UploadMode.CLEAN_REUPLOAD,
    sourceFormat: SourceFormat.csv,
    acceptedFiles: [],
    dataViewActive: 0,
    setDataViewActive: () => {},
    selectedDelimiters: {},
    setSelectedDelimiters: () => {},
    columnMappings: {},
    setColumnMappingForFile: () => {},
    quadratOverlapAcknowledgment: overlapAcknowledgment,
    setQuadratOverlapAcknowledgment: setOverlapAcknowledgment,
    serverQuadratOverlapSummaries: [],
    clearServerQuadratOverlapSummaries: () => {},
    handleInitialSubmit: async () => {},
    handleAddFile: () => {},
    handleRemoveFile: () => {},
    handleReplaceFile: () => {}
  };
  return <UploadParseFiles {...defaults} {...props} />;
}

function continueButton() {
  return screen.getByRole('button', { name: /continue upload|fix validation errors to continue|analyzing files/i });
}

describe('quadrat preflight parser cancellation', () => {
  it('rejects immediately with AbortError when the owning effect is already cancelled', async () => {
    const file = new File([`${QUADRAT_HEADER_ROW}\nQ0001,0,0,20,20,400,square\n`], 'cancelled.csv', { type: 'text/csv' });
    const controller = new AbortController();
    controller.abort();

    await expect(parseQuadratFileRows(file, ',', controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
  });
});

describe('south-west coordinate advisory', () => {
  it('tells a quadrats uploader which corner StartX/StartY must identify', () => {
    render(<Harness uploadForm={FormType.quadrats} />);
    expect(screen.getByText(/south-west \(lower-left\) corner/i)).toBeInTheDocument();
  });

  it('offers no control for choosing a different corner', () => {
    render(<Harness uploadForm={FormType.quadrats} />);
    expect(screen.queryByRole('combobox', { name: /which corner does each row.*startx\/starty identify/i })).toBeNull();
  });

  it('does not render for a non-quadrats upload (e.g. measurements)', () => {
    render(<Harness uploadForm={FormType.measurements} />);
    expect(screen.queryByText(/south-west \(lower-left\) corner/i)).toBeNull();
  });

  it('does not render for a non-quadrats upload (e.g. attributes)', () => {
    render(<Harness uploadForm={FormType.attributes} />);
    expect(screen.queryByText(/south-west \(lower-left\) corner/i)).toBeNull();
  });
});

describe('quadrat geometry preflight — collection issues', () => {
  it('blocks Continue for a file recorded against the north-east corner', async () => {
    // Q0001 at StartX=90, StartY=90, 20x20 in a 100x100 plot: as south-west coordinates it
    // extends past the plot edge (90+20=110 > 100). There is no corner to re-declare — the
    // researcher converts the file — so this stays blocked.
    const fileName = 'quadrats-ne.csv';
    const file = buildQuadratFile(fileName, 'Q0001,90,90,20,20,400,square');

    await act(async () => {
      render(<Harness uploadForm={FormType.quadrats} acceptedFiles={[file]} selectedDelimiters={{ [fileName]: ',' }} />);
    });

    await waitFor(() => {
      expect(screen.getByText(/extends past plot dimension/i)).toBeInTheDocument();
    });

    expect(continueButton()).toBeDisabled();
  });

  it('enables Continue for the same footprint once its south-west corner is recorded', async () => {
    const fileName = 'quadrats-sw.csv';
    const file = buildQuadratFile(fileName, 'Q0001,70,70,20,20,400,square');

    await act(async () => {
      render(<Harness uploadForm={FormType.quadrats} acceptedFiles={[file]} selectedDelimiters={{ [fileName]: ',' }} />);
    });

    await waitFor(() => {
      expect(continueButton()).not.toBeDisabled();
    });
    expect(screen.queryByText(/extends past plot dimension/i)).toBeNull();
  });
});

describe('quadrat geometry preflight — overlap acknowledgment', () => {
  it('surfaces an overlap as a warning with a checkbox, and Continue enables only after acknowledgment', async () => {
    const fileName = 'quadrats-overlap-ack.csv';
    // Two in-bounds rows that overlap: warn-and-acknowledge, never the red "geometry problems" refusal.
    const file = buildQuadratFile(fileName, 'Q0001,10,10,10,10,100,square\nQ0002,15,15,10,10,100,square');

    await act(async () => {
      render(<Harness uploadForm={FormType.quadrats} acceptedFiles={[file]} selectedDelimiters={{ [fileName]: ',' }} />);
    });

    await waitFor(() => {
      expect(screen.getByText(/overlapping quadrat footprints detected/i)).toBeInTheDocument();
    });
    // Overlaps alone must not fire the blocking danger alert.
    expect(screen.queryByText(/quadrat geometry problem/i)).toBeNull();
    expect(continueButton()).toBeDisabled();

    const acknowledgmentCheckbox = screen.getByRole('checkbox', { name: /acknowledge quadrat overlaps/i });
    await act(async () => {
      fireEvent.click(acknowledgmentCheckbox);
    });

    await waitFor(() => {
      expect(continueButton()).not.toBeDisabled();
    });

    // Unchecking re-blocks: the confirmation is load-bearing, not a one-way latch.
    await act(async () => {
      fireEvent.click(acknowledgmentCheckbox);
    });
    await waitFor(() => {
      expect(continueButton()).toBeDisabled();
    });
  });

  it('does not show the overlap acknowledgment checkbox for a non-overlapping file', async () => {
    const fileName = 'quadrats-no-overlap.csv';
    const file = buildQuadratFile(fileName, 'Q0001,10,10,10,10,100,square\nQ0002,30,30,10,10,100,square');

    await act(async () => {
      render(<Harness uploadForm={FormType.quadrats} acceptedFiles={[file]} selectedDelimiters={{ [fileName]: ',' }} />);
    });

    await waitFor(() => {
      expect(continueButton()).not.toBeDisabled();
    });
    expect(screen.queryByRole('checkbox', { name: /acknowledge quadrat overlaps/i })).toBeNull();
  });

  it('configures the quadrat dropzone for exactly one file', () => {
    render(<Harness uploadForm={FormType.quadrats} />);
    expect(screen.getByTestId('dropzone-file-mode')).toHaveTextContent('single');
  });

  it('surfaces a server-discovered existing-layout overlap and allows an explicit retry acknowledgment', async () => {
    const fileName = 'quadrats-server-overlap.csv';
    const file = buildQuadratFile(fileName, 'NEW,40,40,10,10,100,square');
    const serverSummary = {
      layoutSignature: 'quadrat-layout-v1-0123456789abcdef',
      reportedPairCount: 1,
      minimumPairCount: 1,
      truncated: false,
      pairs: [{ key: 'pair-1', message: 'Quadrat "NEW" overlaps quadrat "EXISTING".' }]
    };

    render(<Harness acceptedFiles={[file]} selectedDelimiters={{ [fileName]: ',' }} serverQuadratOverlapSummaries={[serverSummary]} />);

    await waitFor(() => expect(screen.getByText(/NEW.*overlaps.*EXISTING/i)).toBeInTheDocument());
    expect(continueButton()).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox', { name: /acknowledge quadrat overlaps/i }));
    await waitFor(() => expect(continueButton()).not.toBeDisabled());
  });

  it('invalidates an acknowledgment when a replacement file changes the reviewed layout signature', async () => {
    // The acknowledgment is bound to the exact layout the uploader reviewed, not to "overlaps
    // were confirmed once" — swapping in a different overlapping file must re-block Continue.
    const firstFileName = 'quadrats-overlap-first.csv';
    const firstFile = buildQuadratFile(firstFileName, 'A,30,30,20,20,400,square\nB,40,40,20,20,400,square');
    const { rerender } = render(<Harness acceptedFiles={[firstFile]} selectedDelimiters={{ [firstFileName]: ',' }} />);

    const checkbox = await screen.findByRole('checkbox', { name: /acknowledge quadrat overlaps/i });
    fireEvent.click(checkbox);
    await waitFor(() => expect(continueButton()).not.toBeDisabled());

    const secondFileName = 'quadrats-overlap-second.csv';
    const secondFile = buildQuadratFile(secondFileName, 'A,10,10,20,20,400,square\nB,20,20,20,20,400,square');
    await act(async () => {
      rerender(<Harness acceptedFiles={[secondFile]} selectedDelimiters={{ [secondFileName]: ',' }} />);
    });

    await waitFor(() => expect(screen.getByRole('checkbox', { name: /acknowledge quadrat overlaps/i })).not.toBeChecked());
    expect(continueButton()).toBeDisabled();
  });
});

describe('quadrat geometry preflight — scalar issues (blank/missing coordinates)', () => {
  it('blocks Continue when StartX is blank rather than treating it as zero', async () => {
    const fileName = 'quadrats-blank-startx.csv';
    const file = buildQuadratFile(fileName, 'Q0002,,50,10,10,100,square');

    await act(async () => {
      render(<Harness uploadForm={FormType.quadrats} acceptedFiles={[file]} selectedDelimiters={{ [fileName]: ',' }} />);
    });

    await waitFor(() => {
      expect(screen.getByText(/startx is required and must be numeric/i)).toBeInTheDocument();
    });

    expect(continueButton()).toBeDisabled();
  });

  it('blocks Continue when the quadrat name is missing', async () => {
    const fileName = 'quadrats-missing-name.csv';
    const file = buildQuadratFile(fileName, ',10,10,10,10,100,square');

    await act(async () => {
      render(<Harness uploadForm={FormType.quadrats} acceptedFiles={[file]} selectedDelimiters={{ [fileName]: ',' }} />);
    });

    await waitFor(() => {
      expect(screen.getByText(/quadrat name is required/i)).toBeInTheDocument();
    });

    expect(continueButton()).toBeDisabled();
  });
});

describe('quadrat geometry preflight — plot dimensions unavailable', () => {
  it('warns that bounds could not be validated but allows Continue when the plot has no dimensions on record', async () => {
    mockPlotContext.current = { plotID: 1, plotName: 'Test Plot', dimensionX: undefined, dimensionY: undefined };

    const fileName = 'quadrats-no-plot-dims.csv';
    // A row that would otherwise pass every row-level check cleanly — the only thing standing
    // between this file and "all clear" is the missing plot dimensions collection validation needs.
    const file = buildQuadratFile(fileName, 'Q0001,10,10,10,10,100,square');

    await act(async () => {
      render(<Harness uploadForm={FormType.quadrats} acceptedFiles={[file]} selectedDelimiters={{ [fileName]: ',' }} />);
    });

    await waitFor(() => {
      expect(screen.getByText(/quadrat geometry could not be validated/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/no dimensionx\/dimensiony on record/i)).toBeInTheDocument();

    // This is "we could not check", not "your file is wrong" — the ordinary geometry-issues alert
    // must not also fire for this otherwise-clean row.
    expect(screen.queryByText(/quadrat geometry problem/i)).toBeNull();

    expect(continueButton()).not.toBeDisabled();
  });

  it('treats NULL plot dimensions like missing ones instead of flagging every row as out of bounds', async () => {
    // The DB columns are nullable and detransform maps NULL to null, not undefined. A
    // presence-only (!== undefined) guard let null through, and validating against null
    // bounds coerces them to 0 — flagging every valid row as "extends past plot dimensionX".
    mockPlotContext.current = {
      plotID: 1,
      plotName: 'Test Plot',
      dimensionX: null as unknown as number | undefined,
      dimensionY: null as unknown as number | undefined
    };

    const fileName = 'quadrats-null-plot-dims.csv';
    const file = buildQuadratFile(fileName, 'Q0001,10,10,10,10,100,square');

    await act(async () => {
      render(<Harness uploadForm={FormType.quadrats} acceptedFiles={[file]} selectedDelimiters={{ [fileName]: ',' }} />);
    });

    await waitFor(() => {
      expect(screen.getByText(/quadrat geometry could not be validated/i)).toBeInTheDocument();
    });
    expect(screen.queryByText(/extends past plot/i)).toBeNull();
    expect(screen.queryByText(/quadrat geometry problem/i)).toBeNull();
    expect(continueButton()).not.toBeDisabled();
  });

  it('still reports an overlap between rows when plot dimensions are unavailable', async () => {
    // Degraded (bounds-less) preflight is not NO preflight: overlap and duplicate-name
    // checks need no plot dimensions and must keep running.
    mockPlotContext.current = { plotID: 1, plotName: 'Test Plot', dimensionX: undefined, dimensionY: undefined };

    const fileName = 'quadrats-overlap-no-dims.csv';
    const file = buildQuadratFile(fileName, 'Q0001,10,10,10,10,100,square\nQ0002,15,15,10,10,100,square');

    await act(async () => {
      render(<Harness uploadForm={FormType.quadrats} acceptedFiles={[file]} selectedDelimiters={{ [fileName]: ',' }} />);
    });

    await waitFor(() => {
      expect(screen.getAllByText(/overlaps quadrat/i).length).toBeGreaterThan(0);
    });
    expect(continueButton()).toBeDisabled();
  });
});

describe('quadrat geometry preflight — usable-row parity', () => {
  it('ignores delimiter-only padding rows when a usable quadrat row is present', async () => {
    const fileName = 'quadrats-with-padding.csv';
    const file = buildQuadratFile(fileName, ',,,,,,\nQ0001,10,10,10,10,100,square');

    render(<Harness acceptedFiles={[file]} selectedDelimiters={{ [fileName]: ',' }} />);

    await waitFor(() => expect(continueButton()).not.toBeDisabled());
    expect(screen.queryByText(/quadrat geometry problem/i)).toBeNull();
  });

  it('blocks a file containing only delimiter padding rows', async () => {
    const fileName = 'quadrats-only-padding.csv';
    const file = buildQuadratFile(fileName, ',,,,,,');

    render(<Harness acceptedFiles={[file]} selectedDelimiters={{ [fileName]: ',' }} />);

    await waitFor(() => expect(screen.getByText(/contains no usable quadrat rows/i)).toBeInTheDocument());
    expect(continueButton()).toBeDisabled();
  });

  it('blocks more than the maximum number of usable quadrat rows', async () => {
    const fileName = 'quadrats-too-many.csv';
    const dataRows = Array.from({ length: MAX_GENERATED_QUADRATS + 1 }, (_, index) => `Q${index},${index},0,1,1,1,square`).join('\n');
    const file = buildQuadratFile(fileName, dataRows);

    render(<Harness acceptedFiles={[file]} selectedDelimiters={{ [fileName]: ',' }} />);

    await waitFor(() => expect(screen.getByText(new RegExp(`maximum is ${MAX_GENERATED_QUADRATS}`, 'i'))).toBeInTheDocument(), { timeout: 10_000 });
    expect(continueButton()).toBeDisabled();
  });
});

describe('quadrat geometry preflight — large issue set is not clipped', () => {
  it('shows a total count and caps rendered lines instead of rendering every issue', async () => {
    const fileName = 'quadrats-many-issues.csv';
    const totalIssueCount = 25;
    const dataRows = Array.from({ length: totalIssueCount }, (_, i) => `Q${String(i + 1).padStart(4, '0')},,10,10,10,100,square`).join('\n');
    const file = buildQuadratFile(fileName, dataRows);

    await act(async () => {
      render(<Harness uploadForm={FormType.quadrats} acceptedFiles={[file]} selectedDelimiters={{ [fileName]: ',' }} />);
    });

    await waitFor(() => {
      expect(screen.getByText(new RegExp(`${totalIssueCount} quadrat geometry problems found`, 'i'))).toBeInTheDocument();
    });

    // The first issue line renders...
    expect(screen.getByText(/Q0001: startx is required and must be numeric/i)).toBeInTheDocument();
    // ...but the list is capped well below the full 25, so a late row's line must not be rendered,
    // and the panel must say so rather than silently truncating.
    expect(screen.queryByText(/Q0025: startx is required and must be numeric/i)).toBeNull();
    expect(screen.getByText(/showing the first 20 of 25 issues for this file/i)).toBeInTheDocument();

    expect(continueButton()).toBeDisabled();
  });
});
