import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { FormType, SourceFormat } from '@/config/macros/formdetails';
import { mappingApplies, seedMapping, validateMapping } from '@/lib/column-mapping/mapping';
import type { ColumnMapping } from '@/lib/column-mapping/types';
import { UploadMode } from '@/config/uploadmodes';
import { FileWithStream, MAX_SINGLE_REQUEST_FILE_SIZE_BYTES, MAX_SINGLE_REQUEST_FILE_SIZE_MB } from '@/config/macros/uploadsystemmacros';
import { DelimiterIssueCode, type DelimiterIssue } from '@/components/uploadsystemhelpers/delimiterdetection';
import { MAX_UPLOAD_FILE_BYTES, uploadFileSizeSelectionIssue } from '@/lib/uploads/upload-request-limits';
import UploadParseFiles from './uploadparsefiles';

// Per-test validation events: map from file name to the status the mock should report.
// Tests populate this before rendering; the mock fires one useEffect call per entry.
const fileValidationEvents: Map<string, { isValid: boolean; issues: DelimiterIssue[]; headers: string[] }> = new Map();

// FileListEnhanced reads actual File blobs and does CSV parsing; in unit tests we just need it to
// fire onValidationStatusChange so the component's per-file state is populated.
// The callback is fired in useEffect (not during render) to avoid the React invariant that
// prohibits setState on a parent while a child is rendering.
vi.mock('@/components/uploadsystemhelpers/filelistenhanced', async () => {
  const { useEffect } = await import('react');
  return {
    FileListEnhanced: ({
      onValidationStatusChange
    }: {
      onValidationStatusChange: (name: string, isValid: boolean, issues: DelimiterIssue[], headers: string[]) => void;
    }) => {
      useEffect(() => {
        fileValidationEvents.forEach(({ isValid, issues, headers }, name) => {
          onValidationStatusChange(name, isValid, issues, headers);
        });
      }, [onValidationStatusChange]);
      return null;
    }
  };
});

vi.mock('@/components/uploadsystemhelpers/dropzonecompact', () => ({
  DropzoneCompact: () => null
}));

// ---------------------------------------------------------------------------
// Per-file mapping derivation — tested through the real lib functions only,
// never through a mirror reimplementation of component logic.
// ---------------------------------------------------------------------------
describe('per-file mapping derivation (lib functions)', () => {
  const fileAHeaders = ['TreeNo', 'Sp', 'Q', 'X', 'Y', 'When'];
  const fileBHeaders = ['tag', 'spcode', 'quadrat', 'lx', 'ly', 'date'];
  const metaA = { format: SourceFormat.csv as const, headers: fileAHeaders };
  const metaB = { format: SourceFormat.csv as const, headers: fileBHeaders };

  it('seedMapping stamps a header signature that matches its own headers and not other files', () => {
    const mappingA = seedMapping(metaA);
    const mappingB = seedMapping(metaB);
    expect(mappingApplies(mappingA, fileAHeaders)).toBe(true);
    expect(mappingApplies(mappingA, fileBHeaders)).toBe(false);
    expect(mappingApplies(mappingB, fileBHeaders)).toBe(true);
    expect(mappingApplies(mappingB, fileAHeaders)).toBe(false);
  });

  it('a stored mapping that applies to its file is used as-is (identity check)', () => {
    const stored = seedMapping(metaA);
    // mappingApplies is the guard; confirm it passes for the same headers
    expect(mappingApplies(stored, fileAHeaders)).toBe(true);
  });

  it('a stored mapping built for different headers does NOT apply to the file (stale detection)', () => {
    const staleMapping = seedMapping(metaB); // built for fileBHeaders
    // staleMapping must not match fileAHeaders — this is the signature mismatch the warn path catches
    expect(mappingApplies(staleMapping, fileAHeaders)).toBe(false);
  });

  it('each file independently validates against a mapping seeded from its own headers', () => {
    // fileA has no canonical aliases → required fields unmapped → invalid
    expect(validateMapping(seedMapping(metaA), metaA).valid).toBe(false);
    // fileB has exact canonical headers → valid
    expect(validateMapping(seedMapping(metaB), metaB).valid).toBe(true);
  });

  it('a confirmed mapping for fileA does not affect fileB because signatures differ', () => {
    const confirmedA = seedMapping(metaA);
    // confirmedA does not apply to fileBHeaders
    expect(mappingApplies(confirmedA, fileBHeaders)).toBe(false);
    // fileB seeded independently is valid for its own headers
    const seededB = seedMapping(metaB);
    expect(mappingApplies(seededB, fileBHeaders)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Render integration — exercises component wiring end-to-end.
// ---------------------------------------------------------------------------

const CANONICAL_HEADERS = ['tag', 'spcode', 'quadrat', 'lx', 'ly', 'date'];
const SURVEY_FILE_NAME = 'survey_data.csv';

function buildFile(name: string): FileWithStream {
  const raw = new File([`${CANONICAL_HEADERS.join(',')}\n`], name, { type: 'text/csv' });
  return new FileWithStream(raw, false);
}

function renderUploadParseFiles(
  files: FileWithStream[],
  setColumnMappingForFile: ReturnType<typeof vi.fn>,
  uploadForm: FormType = FormType.measurements,
  sourceFormat: SourceFormat = SourceFormat.csv
) {
  render(
    <UploadParseFiles
      uploadForm={uploadForm}
      uploadMode={UploadMode.NEW}
      sourceFormat={sourceFormat}
      acceptedFiles={files}
      dataViewActive={0}
      setDataViewActive={() => {}}
      selectedDelimiters={{}}
      setSelectedDelimiters={() => {}}
      columnMappings={{}}
      setColumnMappingForFile={setColumnMappingForFile}
      quadratOverlapAcknowledgment={null}
      setQuadratOverlapAcknowledgment={() => {}}
      serverQuadratOverlapSummaries={[]}
      clearServerQuadratOverlapSummaries={() => {}}
      handleInitialSubmit={async () => {}}
      handleAddFile={() => {}}
      handleRemoveFile={() => {}}
      handleReplaceFile={() => {}}
    />
  );
}

// The canonical headers seed a fully-valid mapping; isValid:false + a header-coverage issue means
// the "Map columns" button is rendered but fileEffectivelyValid resolves true once the mapping
// validates. The Apply button inside ColumnMappingDialog is enabled when validateMapping passes,
// so clicking it exercises the real onApply={m => setColumnMappingForFile?.(mappingFile, m)} wiring.
describe('setColumnMappingForFile wiring (render integration)', () => {
  it('calls setColumnMappingForFile with the file name and applied mapping when Apply is clicked', () => {
    fileValidationEvents.clear();
    fileValidationEvents.set(SURVEY_FILE_NAME, {
      isValid: false,
      issues: [{ code: DelimiterIssueCode.MISSING_REQUIRED_COLUMNS, message: 'Missing required columns: tag' }],
      headers: CANONICAL_HEADERS
    });

    const setColumnMappingForFile = vi.fn();

    act(() => {
      renderUploadParseFiles([buildFile(SURVEY_FILE_NAME)], setColumnMappingForFile);
    });

    // The mock FileListEnhanced fires onValidationStatusChange in useEffect (after render), so the
    // component has detectedHeaders set. The "Map columns" button should now be present.
    const mapButton = screen.getByRole('button', { name: /map columns|review column mapping/i });
    expect(mapButton).not.toBeDisabled();

    act(() => {
      fireEvent.click(mapButton);
    });

    // ColumnMappingDialog is now open. The seeded mapping for canonical headers is fully valid,
    // so "Apply mapping" must be enabled.
    const applyButton = screen.getByRole('button', { name: /apply mapping/i });
    expect(applyButton).not.toBeDisabled();

    act(() => {
      fireEvent.click(applyButton);
    });

    // The component's onApply handler is: m => { setColumnMappingForFile?.(mappingFile, m); setMappingOpen(false); }
    // Removing that wiring would make this assertion fail.
    expect(setColumnMappingForFile).toHaveBeenCalledOnce();
    const [calledFileName, calledMapping] = setColumnMappingForFile.mock.calls[0] as [string, ColumnMapping];
    expect(calledFileName).toBe(SURVEY_FILE_NAME);
    // The mapping must be seeded from the file's actual headers.
    expect(calledMapping.headerSignature).toBe(seedMapping({ format: SourceFormat.csv, headers: CANONICAL_HEADERS }).headerSignature);
    expect(calledMapping.fields.find(f => f.canonicalField === 'tag')?.sourceColumns).toEqual(['tag']);
    expect(calledMapping.fields.find(f => f.canonicalField === 'lx')?.sourceColumns).toEqual(['lx']);
  });

  it('Map-columns button opens the dialog targeting the first file needing mapping, not the first file', () => {
    // alpha.csv: valid with canonical headers — does NOT need mapping.
    // bravo.csv: invalid with non-canonical headers — NEEDS mapping.
    // firstFileNeedingMapping must resolve to bravo.csv. If the implementation
    // degenerates to acceptedFiles[0].name it would open alpha.csv instead and
    // the dialog-title assertion below would fail.
    const ALPHA = 'alpha.csv';
    const BRAVO = 'bravo.csv';
    const BRAVO_HEADERS = ['TreeNo', 'Sp', 'Q', 'X_Coord', 'Y_Coord', 'date'];

    fileValidationEvents.clear();
    fileValidationEvents.set(ALPHA, {
      isValid: true,
      issues: [],
      headers: CANONICAL_HEADERS
    });
    fileValidationEvents.set(BRAVO, {
      isValid: false,
      issues: [{ code: DelimiterIssueCode.MISSING_REQUIRED_COLUMNS, message: 'Missing required columns: tag' }],
      headers: BRAVO_HEADERS
    });

    const setColumnMappingForFile = vi.fn();

    act(() => {
      renderUploadParseFiles([buildFile(ALPHA), buildFile(BRAVO)], setColumnMappingForFile);
    });

    const mapButton = screen.getByRole('button', { name: /map columns|review column mapping/i });
    expect(mapButton).not.toBeDisabled();

    act(() => {
      fireEvent.click(mapButton);
    });

    // The dialog must name bravo.csv, not alpha.csv.
    // ColumnMappingDialog renders "File: {fileName}" when the fileName prop is provided.
    expect(screen.getByText(`File: ${BRAVO}`)).toBeDefined();
    expect(screen.queryByText(`File: ${ALPHA}`)).toBeNull();
  });
});

// Rescue-eligibility must be determined by issue.code, never by matching against message text.
// A wording change in delimiterdetection must not silently break the mapping-rescue path.
describe('mapping rescue is wording-independent (code-based eligibility)', () => {
  it('Continue button is enabled when the only issue is MISSING_REQUIRED_COLUMNS regardless of message text', () => {
    fileValidationEvents.clear();
    fileValidationEvents.set(SURVEY_FILE_NAME, {
      isValid: false,
      issues: [{ code: DelimiterIssueCode.MISSING_REQUIRED_COLUMNS, message: 'totally reworded text that must not matter' }],
      headers: CANONICAL_HEADERS
    });

    const setColumnMappingForFile = vi.fn();

    act(() => {
      renderUploadParseFiles([buildFile(SURVEY_FILE_NAME)], setColumnMappingForFile);
    });

    // fileEffectivelyValid resolves true: canonical headers seed a valid mapping and the only issue
    // is a header-coverage code — Continue must be enabled regardless of the message wording.
    const continueButton = screen.getByRole('button', { name: /continue upload/i });
    expect(continueButton).not.toBeDisabled();
  });
});

// temporarymeasurements.FileID is varchar(50). Before this gate existed the upload ran to the
// staging INSERT and died on ER_DATA_TOO_LONG, which the UI surfaced as a hang — so the block must
// happen at selection time, and it must hold even when the file itself is otherwise perfectly valid.
describe('measurement file name length gate', () => {
  const overLengthName = `${'a'.repeat(47)}.csv`;

  it('blocks an otherwise-valid file whose name exceeds the FileID contract', () => {
    expect(overLengthName.length).toBeGreaterThan(50);
    fileValidationEvents.clear();
    fileValidationEvents.set(overLengthName, { isValid: true, issues: [], headers: CANONICAL_HEADERS });

    act(() => {
      renderUploadParseFiles([buildFile(overLengthName)], vi.fn());
    });

    // allFilesValid false swaps the CTA label, so assert the blocked state by its own wording.
    expect(screen.getByRole('button', { name: /fix validation errors to continue/i })).toBeDisabled();
    expect(screen.queryByRole('button', { name: /continue upload/i })).toBeNull();
    expect(screen.getByText(/50 characters or fewer/i)).toBeDefined();
  });

  it('allows a name exactly at the limit, so the gate is not off by one', () => {
    const atLimitName = `${'a'.repeat(46)}.csv`;
    expect(atLimitName).toHaveLength(50);
    fileValidationEvents.clear();
    fileValidationEvents.set(atLimitName, { isValid: true, issues: [], headers: CANONICAL_HEADERS });

    act(() => {
      renderUploadParseFiles([buildFile(atLimitName)], vi.fn());
    });

    expect(screen.getByRole('button', { name: /continue upload/i })).not.toBeDisabled();
    expect(screen.queryByText(/50 characters or fewer/i)).toBeNull();
  });

  it('blocks a short raw name whose sanitized storage identity exceeds the limit', () => {
    const fileName = `${'🌳'.repeat(25)}.csv`;
    expect(Array.from(fileName)).toHaveLength(29);
    fileValidationEvents.clear();
    fileValidationEvents.set(fileName, { isValid: true, issues: [], headers: CANONICAL_HEADERS });

    act(() => {
      renderUploadParseFiles([buildFile(fileName)], vi.fn());
    });

    expect(screen.getByRole('button', { name: /fix validation errors to continue/i })).toBeDisabled();
    expect(screen.getByText(/stored file name would be 54 characters/i)).toBeDefined();
  });
});

// When a confirmed mapping covers the header-coverage gap but a real STRUCTURAL issue still blocks
// the file, the issue panel must not keep showing the resolved coverage message beside the blocker.
describe('issue-list masking when a mapping resolves coverage gaps (M6)', () => {
  it('hides header-coverage messages the mapping resolved, showing only the structural blocker', () => {
    fileValidationEvents.clear();
    fileValidationEvents.set(SURVEY_FILE_NAME, {
      isValid: false,
      issues: [
        // Coverage gap — rescued by the canonical-header mapping.
        { code: DelimiterIssueCode.MISSING_REQUIRED_COLUMNS, message: 'Missing required columns: tag' },
        // Structural blocker — NOT a coverage issue, so the file still cannot validate.
        { code: DelimiterIssueCode.INCONSISTENT_COLUMNS, message: 'Inconsistent column counts across rows' }
      ],
      headers: CANONICAL_HEADERS
    });

    const setColumnMappingForFile = vi.fn();

    act(() => {
      renderUploadParseFiles([buildFile(SURVEY_FILE_NAME)], setColumnMappingForFile);
    });

    // The real structural blocker is still surfaced...
    expect(screen.getByText(/Inconsistent column counts across rows/i)).toBeDefined();
    // ...but the coverage message the mapping already resolved must NOT be shown.
    expect(screen.queryByText(/Missing required columns: tag/i)).toBeNull();
  });
});

// Issue #504: a header-only CSV was shown as "Valid" and submitted as a Clean Re-Upload, which
// then wiped the target census's existing measurements. NO_DATA_ROWS is a STRUCTURAL failure
// (unlike MISSING_REQUIRED_COLUMNS/TOO_FEW_COLUMNS), so applying a column mapping -- even a fully
// valid one seeded from canonical headers -- must never re-enable Continue. These assertions check
// the actual side effect (handleInitialSubmit never invoked, Continue absent/disabled) rather than
// just the rendered copy.
describe('structural empty-data failure cannot be rescued by column mapping (issue #504)', () => {
  it('keeps Continue disabled after applying a valid mapping when the blocking issue is NO_DATA_ROWS', () => {
    fileValidationEvents.clear();
    fileValidationEvents.set(SURVEY_FILE_NAME, {
      isValid: false,
      issues: [{ code: DelimiterIssueCode.NO_DATA_ROWS, message: 'The file appears to be empty: no data rows were found beyond the header.' }],
      // Canonical headers seed a fully-valid mapping -- if mapping could rescue structural
      // issues, this file would pass as soon as the mapping validated.
      headers: CANONICAL_HEADERS
    });

    const handleInitialSubmit = vi.fn(async () => {});
    const setColumnMappingForFile = vi.fn();

    act(() => {
      render(
        <UploadParseFiles
          uploadForm={FormType.measurements}
          uploadMode={UploadMode.CLEAN_REUPLOAD}
          sourceFormat={SourceFormat.csv}
          acceptedFiles={[buildFile(SURVEY_FILE_NAME)]}
          dataViewActive={0}
          setDataViewActive={() => {}}
          selectedDelimiters={{}}
          setSelectedDelimiters={() => {}}
          columnMappings={{}}
          setColumnMappingForFile={setColumnMappingForFile}
          quadratOverlapAcknowledgment={null}
          setQuadratOverlapAcknowledgment={() => {}}
          serverQuadratOverlapSummaries={[]}
          clearServerQuadratOverlapSummaries={() => {}}
          handleInitialSubmit={handleInitialSubmit}
          handleAddFile={() => {}}
          handleRemoveFile={() => {}}
          handleReplaceFile={() => {}}
        />
      );
    });

    // Before any mapping interaction: Continue must already be disabled/absent, and the
    // structural message must be visible.
    expect(screen.queryByRole('button', { name: /continue upload/i })).toBeNull();
    expect(screen.getByRole('button', { name: /fix validation errors to continue/i })).toBeDisabled();
    expect(screen.getByText(/no data rows were found/i)).toBeDefined();

    // Apply a mapping that fully validates against this file's (canonical) headers --
    // mirrors a user successfully completing the mapping dialog.
    const mapButton = screen.getByRole('button', { name: /map columns|review column mapping/i });
    act(() => {
      fireEvent.click(mapButton);
    });
    const applyButton = screen.getByRole('button', { name: /apply mapping/i });
    expect(applyButton).not.toBeDisabled();
    act(() => {
      fireEvent.click(applyButton);
    });
    expect(setColumnMappingForFile).toHaveBeenCalledOnce();

    // The structural failure must still block Continue even though the mapping is now valid.
    expect(screen.queryByRole('button', { name: /continue upload/i })).toBeNull();
    const fixButton = screen.getByRole('button', { name: /fix validation errors to continue/i });
    expect(fixButton).toBeDisabled();

    // Clicking the (disabled) button must not invoke the upload side effect.
    fireEvent.click(fixButton);
    expect(handleInitialSubmit).not.toHaveBeenCalled();
  });
});

describe('CSV mapping gating rule', () => {
  it('is invalid when a required field is unmapped', () => {
    const meta = { format: SourceFormat.csv as const, headers: ['X_Coord', 'Y_Coord', 'Sp', 'quadrat', 'date'] }; // no tag
    expect(validateMapping(seedMapping(meta), meta).valid).toBe(false);
  });

  it('is valid when all required fields map', () => {
    const meta = { format: SourceFormat.csv as const, headers: ['tag', 'Sp', 'quadrat', 'X_Coord', 'Y_Coord', 'date'] };
    expect(validateMapping(seedMapping(meta), meta).valid).toBe(true);
  });

  it('rejects a mapping whose source column is absent from a second file (per-file validation)', () => {
    const fileA = { format: SourceFormat.csv as const, headers: ['tag', 'Sp', 'quadrat', 'X_Coord', 'Y_Coord', 'date'] };
    const fileB = { format: SourceFormat.csv as const, headers: ['tag', 'Sp', 'quadrat', 'lx', 'ly', 'date'] }; // renamed coords
    const mapping = seedMapping(fileA);
    expect(validateMapping(mapping, fileA).valid).toBe(true);
    const vB = validateMapping(mapping, fileB);
    expect(vB.valid).toBe(false);
    expect(vB.missingSourceColumns).toEqual(expect.arrayContaining(['X_Coord', 'Y_Coord']));
  });
});

// ---------------------------------------------------------------------------
// Single-request file size guard — species/attributes/personnel/quadrats upload a
// whole file in ONE request. Reject oversized source files at selection; row
// counts are checked by the upload parser and the server separately.
// ---------------------------------------------------------------------------
describe('single-request upload size guard', () => {
  const SPECIES_FILE = 'species.csv';
  const SPECIES_HEADERS = ['spcode', 'family', 'genus', 'species'];

  function buildFileOfSize(name: string, byteCount: number): FileWithStream {
    const raw = new File(['x'.repeat(byteCount)], name, { type: 'text/csv' });
    expect(raw.size).toBe(byteCount);
    return new FileWithStream(raw, false);
  }

  function renderSpeciesUpload(file: FileWithStream) {
    fileValidationEvents.clear();
    fileValidationEvents.set(file.name, { isValid: true, issues: [], headers: SPECIES_HEADERS });
    act(() => {
      renderUploadParseFiles([file], vi.fn(), FormType.species);
    });
  }

  it('blocks a species file larger than the single-request limit and names the limit', () => {
    renderSpeciesUpload(buildFileOfSize(SPECIES_FILE, MAX_SINGLE_REQUEST_FILE_SIZE_BYTES + 1));

    expect(screen.getByText(new RegExp(`exceeds the ${MAX_SINGLE_REQUEST_FILE_SIZE_MB} MB limit for species uploads`))).toBeTruthy();
    expect(screen.getByRole('button', { name: /fix validation errors to continue/i })).toBeDisabled();
  });

  it('accepts a species file at the limit', () => {
    renderSpeciesUpload(buildFileOfSize(SPECIES_FILE, MAX_SINGLE_REQUEST_FILE_SIZE_BYTES));

    expect(screen.queryByText(/exceeds the .* limit for species uploads/)).toBeNull();
    expect(screen.getByRole('button', { name: /continue upload/i })).not.toBeDisabled();
  });

  it('does not apply the limit to measurements, which upload in chunks', () => {
    const file = buildFileOfSize('measurements.csv', MAX_SINGLE_REQUEST_FILE_SIZE_BYTES + 1);
    fileValidationEvents.clear();
    fileValidationEvents.set(file.name, { isValid: true, issues: [], headers: CANONICAL_HEADERS });
    act(() => {
      renderUploadParseFiles([file], vi.fn(), FormType.measurements);
    });

    expect(screen.queryByText(/exceeds the .* limit/)).toBeNull();
    expect(screen.getByRole('button', { name: /continue upload/i })).not.toBeDisabled();
  });
});

// Measurement uploads are bounded at MAX_UPLOAD_FILE_BYTES by the server (413). Block at selection
// so the uploader never waits for a doomed upload. The file reports its size through File.size,
// which is all the gate reads, so the fixture doesn't allocate 100 MB per test.
describe('measurement upload size gate', () => {
  function fileReportingSize(name: string, byteCount: number, type: string): FileWithStream {
    // FileWithStream re-wraps the raw File's bytes, so the size override must sit on the wrapper.
    const file = new FileWithStream(new File(['x'], name, { type }), false);
    Object.defineProperty(file, 'size', { value: byteCount });
    expect(file.size, 'the component reads size from the FileWithStream it receives').toBe(byteCount);
    return file;
  }

  function renderMeasurements(files: FileWithStream[], sourceFormat: SourceFormat) {
    fileValidationEvents.clear();
    files.forEach(file => fileValidationEvents.set(file.name, { isValid: true, issues: [], headers: CANONICAL_HEADERS }));
    act(() => {
      renderUploadParseFiles(files, vi.fn(), FormType.measurements, sourceFormat);
    });
  }

  it.each([
    [SourceFormat.csv, 'census2.csv', 'text/csv'],
    [SourceFormat.arcgis_xlsx, 'census2.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']
  ])('blocks a %s measurement file one byte over the limit with format-specific advice', (sourceFormat, name, type) => {
    const overLimit = MAX_UPLOAD_FILE_BYTES + 1;
    renderMeasurements([fileReportingSize(name, overLimit, type)], sourceFormat);

    // Issues render as `• {issue}` inside one Typography (uploadparsefiles.tsx, File Validation Issues).
    const expectedIssue = uploadFileSizeSelectionIssue(overLimit, sourceFormat);
    expect(screen.getByText(`• ${expectedIssue}`)).toBeTruthy();
    expect(screen.getByRole('button', { name: /fix validation errors to continue/i })).toBeDisabled();
  });

  it.each([
    [SourceFormat.csv, 'census2.csv', 'text/csv'],
    [SourceFormat.arcgis_xlsx, 'census2.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']
  ])('does not flag a %s measurement file exactly at the limit', (sourceFormat, name, type) => {
    renderMeasurements([fileReportingSize(name, MAX_UPLOAD_FILE_BYTES, type)], sourceFormat);

    expect(screen.queryByText(/exceeds the \d+ MB upload limit/)).toBeNull();
  });

  it('still rejects two ArcGIS workbooks, so size advice never implies multi-workbook selection', () => {
    const workbookType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    renderMeasurements([fileReportingSize('a.xlsx', 10, workbookType), fileReportingSize('b.xlsx', 10, workbookType)], SourceFormat.arcgis_xlsx);

    expect(screen.getByText(/accepts exactly one \.xlsx workbook/i)).toBeTruthy();
  });
});
