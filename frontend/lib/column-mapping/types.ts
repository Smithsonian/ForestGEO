import { SourceFormat } from '@/config/macros/formdetails';

export type MappingScope = 'file' | 'trees' | 'stems' | 'both';

export interface CanonicalFieldDef {
  canonicalField: string;
  required: boolean;
  scope: MappingScope;
  multiSource: boolean;
  explanation?: string;
}

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
