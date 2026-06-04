import type { FileRow } from '@/config/macros/formdetails';

export type ArcgisCell = string | number | null;
export type ArcgisRow = Record<string, ArcgisCell>;

export interface ArcgisWorkbook {
  trees: ArcgisRow[];
  stems: ArcgisRow[];
}

export type TransformWarningType = 'BLANK_QUADRAT' | 'TAG_MISMATCH' | 'ORPHAN_STEM' | 'DUPLICATE_TREE_TAG' | 'DUPLICATE_GLOBAL_ID' | 'MISSING_REQUIRED';

export interface TransformWarning {
  type: TransformWarningType;
  message: string;
  globalId: string | null;
  sheet: 'trees' | 'stems';
  rowIndex: number | null; // 0-based index within that sheet's row array
  value?: string | null; // the offending value, when relevant (e.g. the mismatched tag, the duplicate key, the missing field name)
}

export interface TransformSummary {
  treesTransformed: number;
  stemsJoined: number;
  blankQuadratCount: number;
  tagMismatchCount: number;
  /** Stems whose ParentGlobalID matched no tree row; emitted with their own tag/quadrat and null coordinates (not joined). */
  orphanStemsEmitted: number;
  duplicateTreeTags: number;
  duplicateGlobalIds: number;
  missingRequired: number;
  totalRows: number;
}

export interface TransformResult {
  rows: FileRow[];
  warnings: TransformWarning[];
  summary: TransformSummary;
}
