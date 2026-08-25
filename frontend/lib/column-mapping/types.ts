import { SourceFormat } from '@/config/macros/formdetails';

export type MappingScope = 'file' | 'trees' | 'stems' | 'both';

/** The role a workbook sheet plays during scope-aware header resolution. */
export type SheetRole = 'trees' | 'stems';

export interface CanonicalFieldDef {
  canonicalField: string;
  required: boolean;
  scope: MappingScope;
  multiSource: boolean;
  explanation?: string;
}

// LIMITATION: a single canonicalField cannot map to DIFFERENT source columns per sheet. `scope`
// selects WHICH sheet(s) a field's explicit sourceColumns apply to; it does not support per-sheet
// source-header variation. Alias auto-detection IS scope-filtered (via mapping-declared field scope /
// aliasFieldScopes). An unsatisfiable per-sheet
// expectation surfaces as a per-sheet missingRequired in validateMapping rather than mis-resolving.
export interface ColumnMappingField {
  canonicalField: string;
  sourceColumns: string[];
  scope: MappingScope;
}

export interface ColumnMapping {
  version: 1;
  format: SourceFormat.csv | SourceFormat.arcgis_xlsx;
  fields: ColumnMappingField[];
  sheetRoles?: {
    treesSheetName?: string;
    stemsSheetName?: string;
  };
  /** Signature of the headers this mapping was built from; a mapping never applies to other headers. */
  headerSignature?: string;
}

export interface MappingValidation {
  valid: boolean;
  missingRequired: string[];
  missingSourceColumns: string[];
  /** Source columns assigned to more than one field (or twice to one field). */
  duplicateSourceColumns: string[];
  /** Canonical fields named by the mapping that do not exist in this format's schema. */
  unknownFields: string[];
  ignoredSourceColumns: string[];
  missingSheetRoles?: string[];
  /** True when the trees and stems roles name the same sheet. */
  sheetRoleConflict?: boolean;
}

export interface CsvSourceMetadata {
  format: SourceFormat.csv;
  headers: string[];
}

export interface ArcgisSheetMetadata {
  name: string;
  columns: string[];
}

export interface ArcgisSourceMetadata {
  format: SourceFormat.arcgis_xlsx;
  sheets: ArcgisSheetMetadata[];
  detectedTreesSheet?: string;
  detectedStemsSheet?: string;
}

export type SourceMetadata = CsvSourceMetadata | ArcgisSourceMetadata;
