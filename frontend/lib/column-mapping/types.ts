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
}

export interface MappingValidation {
  valid: boolean;
  missingRequired: string[];
  missingSourceColumns: string[];
  ignoredSourceColumns: string[];
  missingSheetRoles?: string[];
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
