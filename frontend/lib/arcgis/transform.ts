import type { FileRow } from '@/config/macros/formdetails';
import { excelSerialToISODate } from './excel-date';
import { CODE_COLUMN_PREFIX, CODE_JOIN_SEPARATOR, NULL_CODE_TOKEN } from './columns';
import type { ArcgisCell, ArcgisRow, ArcgisWorkbook, TransformResult, TransformWarning } from './types';

function cellToString(value: ArcgisCell): string | null {
  if (value === null || value === undefined) return null;
  const text = typeof value === 'number' ? String(value) : value.trim();
  return text === '' ? null : text;
}

function dateToIso(value: ArcgisCell): string | null {
  const isBlank = value === null || value === undefined || (typeof value === 'string' && value.trim() === '');
  return isBlank ? null : excelSerialToISODate(value);
}

function joinCodes(row: ArcgisRow): string {
  const codes: string[] = [];
  for (const [key, value] of Object.entries(row)) {
    if (!key.startsWith(CODE_COLUMN_PREFIX)) continue;
    const text = cellToString(value);
    if (text && text.toUpperCase() !== NULL_CODE_TOKEN) codes.push(text);
  }
  return codes.join(CODE_JOIN_SEPARATOR);
}

interface CanonicalInput {
  tag: string | null;
  stemtag: string | null;
  spcode: string | null;
  quadrat: string | null;
  lx: string | null;
  ly: string | null;
  dbh: string | null;
  hom: string | null;
  date: string | null;
  codes: string;
  comments: string | null;
}

function toFileRow(input: CanonicalInput): FileRow {
  return {
    tag: input.tag,
    stemtag: input.stemtag,
    spcode: input.spcode,
    quadrat: input.quadrat,
    lx: input.lx,
    ly: input.ly,
    dbh: input.dbh,
    hom: input.hom,
    date: input.date,
    codes: input.codes,
    comments: input.comments
  };
}

export function transformArcgisWorkbook({ trees, stems }: ArcgisWorkbook): TransformResult {
  const rows: FileRow[] = [];
  const warnings: TransformWarning[] = [];
  let blankQuadratCount = 0;
  let tagMismatchCount = 0;
  let orphanStemsDropped = 0;
  let stemsJoined = 0;

  const treeIndex = new Map<string, ArcgisRow>();
  for (const tree of trees) {
    const globalId = cellToString(tree.GlobalID);
    if (globalId) treeIndex.set(globalId, tree);
  }

  for (const tree of trees) {
    const globalId = cellToString(tree.GlobalID);
    const quadrat = cellToString(tree.quadrat);
    if (quadrat === null) {
      blankQuadratCount += 1;
      warnings.push({ type: 'BLANK_QUADRAT', message: `Tree ${globalId ?? '(no GlobalID)'} has a blank quadrat label; passed through blank.`, globalId });
    }
    rows.push(
      toFileRow({
        tag: cellToString(tree.tag),
        stemtag: cellToString(tree.StemTag),
        spcode: cellToString(tree.spcode),
        quadrat,
        lx: cellToString(tree.lx),
        ly: cellToString(tree.ly),
        dbh: cellToString(tree.DBH_CURRENT),
        hom: cellToString(tree.HOM),
        date: dateToIso(tree.Date_measured),
        codes: joinCodes(tree),
        comments: cellToString(tree.notes)
      })
    );
  }

  for (const stem of stems) {
    const stemGlobalId = cellToString(stem.GlobalID);
    const parentGlobalId = cellToString(stem.ParentGlobalID);
    const parent = parentGlobalId ? treeIndex.get(parentGlobalId) : undefined;

    if (!parent) {
      orphanStemsDropped += 1;
      warnings.push({
        type: 'ORPHAN_STEM',
        message: `Stem ${stemGlobalId ?? '(no GlobalID)'} references parent ${parentGlobalId ?? '(none)'} with no matching tree; dropped.`,
        globalId: stemGlobalId
      });
      continue;
    }

    stemsJoined += 1;
    const parentTag = cellToString(parent.tag);
    const stemOwnTag = cellToString(stem.tag);
    if (stemOwnTag && parentTag && stemOwnTag !== parentTag) {
      tagMismatchCount += 1;
      warnings.push({
        type: 'TAG_MISMATCH',
        message: `Stem ${stemGlobalId ?? '(no GlobalID)'} tag ${stemOwnTag} differs from parent tree tag ${parentTag}; parent tag used.`,
        globalId: stemGlobalId
      });
    }

    const quadrat = cellToString(parent.quadrat);
    if (quadrat === null) {
      blankQuadratCount += 1;
      warnings.push({
        type: 'BLANK_QUADRAT',
        message: `Stem ${stemGlobalId ?? '(no GlobalID)'} inherits a blank quadrat from its parent tree.`,
        globalId: stemGlobalId
      });
    }

    rows.push(
      toFileRow({
        tag: parentTag,
        stemtag: cellToString(stem.StemTag),
        spcode: cellToString(stem.spcode),
        quadrat,
        lx: cellToString(parent.lx),
        ly: cellToString(parent.ly),
        dbh: cellToString(stem.DBH_CURRENT),
        hom: cellToString(stem.HOM),
        date: dateToIso(stem.Date_measured),
        codes: joinCodes(stem),
        comments: cellToString(stem.notes)
      })
    );
  }

  return {
    rows,
    warnings,
    summary: {
      treesTransformed: trees.length,
      stemsJoined,
      blankQuadratCount,
      tagMismatchCount,
      orphanStemsDropped,
      totalRows: rows.length
    }
  };
}
