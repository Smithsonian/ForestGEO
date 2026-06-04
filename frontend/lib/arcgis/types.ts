import type { FileRow } from '@/config/macros/formdetails';

export type ArcgisCell = string | number | null;
export type ArcgisRow = Record<string, ArcgisCell>;

export interface ArcgisWorkbook {
  trees: ArcgisRow[];
  stems: ArcgisRow[];
}

export type TransformWarningType = 'BLANK_QUADRAT' | 'TAG_MISMATCH' | 'ORPHAN_STEM';

export interface TransformWarning {
  type: TransformWarningType;
  message: string;
  globalId: string | null;
}

export interface TransformSummary {
  treesTransformed: number;
  stemsJoined: number;
  blankQuadratCount: number;
  tagMismatchCount: number;
  orphanStemsDropped: number;
  totalRows: number;
}

export interface TransformResult {
  rows: FileRow[];
  warnings: TransformWarning[];
  summary: TransformSummary;
}
