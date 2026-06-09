import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { SourceFormat } from '@/config/macros/formdetails';
import { mappingApplies, seedMapping, validateMapping } from '@/lib/column-mapping/mapping';
import type { ColumnMapping, CsvSourceMetadata } from '@/lib/column-mapping/types';
import { UploadMode } from '@/config/uploadmodes';
import { FileWithStream } from '@/config/macros/uploadsystemmacros';
import UploadParseFiles from './uploadparsefiles';

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
      onValidationStatusChange: (name: string, isValid: boolean, issues: string[], headers: string[]) => void;
    }) => {
      useEffect(() => {
        onValidationStatusChange('survey_data.csv', false, ['Missing required columns: tag'], ['tag', 'spcode', 'quadrat', 'lx', 'ly', 'date']);
      }, [onValidationStatusChange]);
      return null;
    }
  };
});

vi.mock('@/components/uploadsystemhelpers/dropzonecompact', () => ({
  DropzoneCompact: () => null
}));

// Pure-logic guard that mirrors the component's gating rule, so the rule is regression-protected
// even though full render wiring depends on the concrete header source.
// Helpers that mirror the component's effectiveMappingFor / mappingValidForFile logic so we can
// test the per-file derivation without rendering the full component.
function effectiveMappingFor(
  fileName: string,
  fileValidationStatuses: Record<string, { detectedHeaders: string[] }>,
  columnMappings: Record<string, ColumnMapping>
): ColumnMapping | null {
  const status = fileValidationStatuses[fileName];
  if (!status || status.detectedHeaders.length === 0) return null;
  const meta: CsvSourceMetadata = { format: SourceFormat.csv, headers: status.detectedHeaders };
  const stored = columnMappings[fileName];
  if (stored && mappingApplies(stored, meta.headers)) return stored;
  return seedMapping(meta);
}

function mappingValidForFile(
  fileName: string,
  fileValidationStatuses: Record<string, { detectedHeaders: string[] }>,
  columnMappings: Record<string, ColumnMapping>
): boolean {
  const status = fileValidationStatuses[fileName];
  if (!status || status.detectedHeaders.length === 0) return false;
  const meta: CsvSourceMetadata = { format: SourceFormat.csv, headers: status.detectedHeaders };
  const effective = effectiveMappingFor(fileName, fileValidationStatuses, columnMappings);
  if (!effective) return false;
  return validateMapping(effective, meta).valid;
}

describe('per-file mapping derivation (effectiveMappingFor)', () => {
  const fileAHeaders = ['TreeNo', 'Sp', 'Q', 'X', 'Y', 'When'];
  const fileBHeaders = ['tag', 'spcode', 'quadrat', 'lx', 'ly', 'date'];

  it('returns a seeded mapping (not stored) when no mapping is recorded for the file', () => {
    const statuses = {
      'fileA.csv': { detectedHeaders: fileAHeaders }
    };
    const mapping = effectiveMappingFor('fileA.csv', statuses, {});
    expect(mapping).not.toBeNull();
    // The seeded mapping should be stamped with fileA's header signature
    expect(mappingApplies(mapping!, fileAHeaders)).toBe(true);
    expect(mappingApplies(mapping!, fileBHeaders)).toBe(false);
  });

  it('returns the stored mapping when it applies to the file', () => {
    const statuses = {
      'fileA.csv': { detectedHeaders: fileAHeaders }
    };
    const stored = seedMapping({ format: SourceFormat.csv, headers: fileAHeaders });
    const columnMappings: Record<string, ColumnMapping> = { 'fileA.csv': stored };
    const mapping = effectiveMappingFor('fileA.csv', statuses, columnMappings);
    expect(mapping).toBe(stored);
  });

  it('falls back to a fresh seed when a stored mapping was built for different headers', () => {
    const statuses = {
      'fileA.csv': { detectedHeaders: fileAHeaders }
    };
    // mapping built for fileB headers, stored under fileA key (simulates stale scenario)
    const stalMapping = seedMapping({ format: SourceFormat.csv, headers: fileBHeaders });
    const columnMappings: Record<string, ColumnMapping> = { 'fileA.csv': stalMapping };
    const mapping = effectiveMappingFor('fileA.csv', statuses, columnMappings);
    // Must NOT be the stale mapping
    expect(mapping).not.toBe(stalMapping);
    // Must apply to fileA's actual headers
    expect(mappingApplies(mapping!, fileAHeaders)).toBe(true);
  });

  it('each file independently validates against its own effective mapping', () => {
    const statuses = {
      'fileA.csv': { detectedHeaders: fileAHeaders },
      'fileB.csv': { detectedHeaders: fileBHeaders }
    };
    const columnMappings: Record<string, ColumnMapping> = {};
    // fileA has no canonical aliases → required fields unmapped → invalid
    expect(mappingValidForFile('fileA.csv', statuses, columnMappings)).toBe(false);
    // fileB has exact canonical headers → valid
    expect(mappingValidForFile('fileB.csv', statuses, columnMappings)).toBe(true);
  });

  it('a confirmed mapping for fileA does not bleed into fileB validation', () => {
    const statuses = {
      'fileA.csv': { detectedHeaders: fileAHeaders },
      'fileB.csv': { detectedHeaders: fileBHeaders }
    };
    // Manually craft a confirmed mapping for fileA using fileA's aliases
    const confirmedA = seedMapping({ format: SourceFormat.csv, headers: ['tag', 'spcode', 'quadrat', 'lx', 'ly', 'date'] });
    const columnMappings: Record<string, ColumnMapping> = { 'fileA.csv': confirmedA };
    // confirmedA was built from different headers than fileA's actual headers → falls back to stale seed
    const effectiveA = effectiveMappingFor('fileA.csv', statuses, columnMappings);
    expect(mappingApplies(effectiveA!, fileAHeaders)).toBe(true); // seeded fresh for fileA
    // fileB is unaffected; derives independently from fileBHeaders
    const effectiveB = effectiveMappingFor('fileB.csv', statuses, columnMappings);
    expect(mappingApplies(effectiveB!, fileBHeaders)).toBe(true);
  });
});

// The canonical headers seed a fully-valid mapping; isValid:false + a header-coverage issue means
// the "Map columns" button is rendered but fileEffectivelyValid resolves true once the mapping
// validates. The Apply button inside ColumnMappingDialog is enabled when validateMapping passes,
// so clicking it exercises the real onApply={m => setColumnMappingForFile?.(mappingFile, m)} wiring.
describe('setColumnMappingForFile wiring (render integration)', () => {
  const CANONICAL_HEADERS = ['tag', 'spcode', 'quadrat', 'lx', 'ly', 'date'];
  const FILE_NAME = 'survey_data.csv';

  function buildSurveyFile(): FileWithStream {
    const raw = new File(['tag,spcode,quadrat,lx,ly,date\n'], FILE_NAME, { type: 'text/csv' });
    return new FileWithStream(raw, false);
  }

  function renderComponent(setColumnMappingForFile: ReturnType<typeof vi.fn>) {
    const file = buildSurveyFile();
    render(
      <UploadParseFiles
        uploadForm="measurements"
        uploadMode={UploadMode.NEW}
        sourceFormat={SourceFormat.csv}
        acceptedFiles={[file]}
        dataViewActive={0}
        setDataViewActive={() => {}}
        selectedDelimiters={{}}
        setSelectedDelimiters={() => {}}
        columnMappings={{}}
        setColumnMappingForFile={setColumnMappingForFile}
        handleInitialSubmit={async () => {}}
        handleAddFile={() => {}}
        handleRemoveFile={() => {}}
        handleReplaceFile={() => {}}
      />
    );
  }

  it('calls setColumnMappingForFile with the file name and applied mapping when Apply is clicked', () => {
    const setColumnMappingForFile = vi.fn();

    act(() => {
      renderComponent(setColumnMappingForFile);
    });

    // The mock FileListEnhanced fires onValidationStatusChange synchronously on render, so the
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
    expect(calledFileName).toBe(FILE_NAME);
    // The mapping must be seeded from the file's actual headers.
    expect(calledMapping.headerSignature).toBe(seedMapping({ format: SourceFormat.csv, headers: CANONICAL_HEADERS }).headerSignature);
    expect(calledMapping.fields.find(f => f.canonicalField === 'tag')?.sourceColumns).toEqual(['tag']);
    expect(calledMapping.fields.find(f => f.canonicalField === 'lx')?.sourceColumns).toEqual(['lx']);
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
