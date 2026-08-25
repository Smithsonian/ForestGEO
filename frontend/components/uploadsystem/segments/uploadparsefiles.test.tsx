import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { SourceFormat } from '@/config/macros/formdetails';
import { mappingApplies, seedMapping, validateMapping } from '@/lib/column-mapping/mapping';
import type { ColumnMapping } from '@/lib/column-mapping/types';
import { UploadMode } from '@/config/uploadmodes';
import { FileWithStream } from '@/config/macros/uploadsystemmacros';
import { DelimiterIssueCode, type DelimiterIssue } from '@/components/uploadsystemhelpers/delimiterdetection';
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

function renderUploadParseFiles(files: FileWithStream[], setColumnMappingForFile: ReturnType<typeof vi.fn>) {
  render(
    <UploadParseFiles
      uploadForm="measurements"
      uploadMode={UploadMode.NEW}
      sourceFormat={SourceFormat.csv}
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
