/**
 * UploadParseFiles — quadrat reference-corner preflight
 *
 * Covers the Task 10 surface added to the active upload screen: the ReferenceCornerSelect only
 * appearing for Quadrats uploads, and the client-side geometry preflight that blocks Continue on
 * scalar or collection issues. Task 11 (server-side enforcement) is out of scope here.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React, { useState } from 'react';
import { FormType, SourceFormat } from '@/config/macros/formdetails';
import { UploadMode } from '@/config/uploadmodes';
import { FileWithStream, type UploadParseFilesProps } from '@/config/macros/uploadsystemmacros';
import { DEFAULT_REFERENCE_CORNER } from '@/lib/provisioning/coordinate-reference-corner';
import type { QuadratReferenceCorner } from '@/lib/provisioning/types';
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
  DropzoneCompact: () => null
}));

const QUADRAT_HEADER_ROW = 'quadrat,startx,starty,dimx,dimy,area,quadratshape';

function buildQuadratFile(fileName: string, dataRow: string): FileWithStream {
  const raw = new File([`${QUADRAT_HEADER_ROW}\n${dataRow}\n`], fileName, { type: 'text/csv' });
  return new FileWithStream(raw, false);
}

// Controlled-corner wrapper: UploadParseFiles receives coordinateReferenceCorner/setter as props
// (owned by UploadParent in production); this reproduces that contract for the test.
function Harness(props: Partial<UploadParseFilesProps> & { initialCorner?: QuadratReferenceCorner }) {
  const [corner, setCorner] = useState<QuadratReferenceCorner>(props.initialCorner ?? DEFAULT_REFERENCE_CORNER);
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
    coordinateReferenceCorner: corner,
    setCoordinateReferenceCorner: setCorner,
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

describe('ReferenceCornerSelect visibility', () => {
  it('renders for a quadrats upload and defaults to south-west', () => {
    render(<Harness uploadForm={FormType.quadrats} />);
    expect(screen.getByRole('combobox', { name: /which corner does each row.*startx\/starty identify/i })).toBeInTheDocument();
    // Joy Select's visible button renders no text without an explicit renderValue; the underlying
    // native <input> mirrors the selected value and is what actually reaches the form/onChange
    // machinery, so assert against that rather than visual text content.
    expect(screen.getByDisplayValue(DEFAULT_REFERENCE_CORNER)).toBeInTheDocument();
  });

  it('does not render for a non-quadrats upload (e.g. measurements)', () => {
    render(<Harness uploadForm={FormType.measurements} />);
    expect(screen.queryByRole('combobox', { name: /which corner does each row.*startx\/starty identify/i })).toBeNull();
    expect(screen.queryByText(/which corner does each row/i)).toBeNull();
  });

  it('does not render for a non-quadrats upload (e.g. attributes)', () => {
    render(<Harness uploadForm={FormType.attributes} />);
    expect(screen.queryByText(/which corner does each row/i)).toBeNull();
  });
});

describe('quadrat geometry preflight — collection issues (reference-corner dependent)', () => {
  // Q0001 at StartX=90, StartY=90, 20x20 in a 100x100 plot: read as south-west it extends past the
  // plot edge (90+20=110 > 100). Read as north-east (the file's actual declared corner), it
  // normalizes to StartX=70, StartY=70 and fits entirely inside the plot.
  const fileName = 'quadrats-ne.csv';

  it('blocks Continue with a bounds issue under the default south-west corner', async () => {
    const file = buildQuadratFile(fileName, 'Q0001,90,90,20,20,400,square');

    await act(async () => {
      render(<Harness uploadForm={FormType.quadrats} acceptedFiles={[file]} selectedDelimiters={{ [fileName]: ',' }} />);
    });

    await waitFor(() => {
      expect(screen.getByText(/extends past plot dimension/i)).toBeInTheDocument();
    });

    expect(continueButton()).toBeDisabled();
  });

  it('clears the issue and enables Continue once north-east is selected', async () => {
    const file = buildQuadratFile(fileName, 'Q0001,90,90,20,20,400,square');

    await act(async () => {
      render(<Harness uploadForm={FormType.quadrats} acceptedFiles={[file]} selectedDelimiters={{ [fileName]: ',' }} />);
    });

    await waitFor(() => {
      expect(screen.getByText(/extends past plot dimension/i)).toBeInTheDocument();
    });

    const combobox = screen.getByRole('combobox', { name: /which corner does each row.*startx\/starty identify/i });
    await act(async () => {
      fireEvent.click(combobox);
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('option', { name: /north-east/i }));
    });

    await waitFor(() => {
      expect(screen.queryByText(/extends past plot dimension/i)).toBeNull();
    });

    await waitFor(() => {
      expect(continueButton()).not.toBeDisabled();
    });
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
  it('warns that geometry could not be validated and blocks Continue when the plot has no dimensions on record', async () => {
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
