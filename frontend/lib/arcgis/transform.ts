import type { FileRow } from '@/config/macros/formdetails';
import { excelSerialToISODate } from './excel-date';
import { CODE_COLUMN_PREFIX, CODE_JOIN_SEPARATOR, NULL_CODE_TOKEN, resolveColumn } from './schema';
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
  let duplicateTreeTags = 0;
  let duplicateGlobalIds = 0;
  let missingRequired = 0;

  const field = (row: ArcgisRow, name: string): ArcgisCell => resolveColumn(row, name) as ArcgisCell;

  // Build the GlobalID -> tree index; first occurrence wins (Map.set on a later dup would overwrite,
  // so we skip already-seen ids) and any repeat GlobalID is reported as a duplicate.
  const treeIndex = new Map<string, ArcgisRow>();
  trees.forEach((tree, rowIndex) => {
    const globalId = cellToString(field(tree, 'GlobalID'));
    if (!globalId) return;
    if (treeIndex.has(globalId)) {
      duplicateGlobalIds += 1;
      warnings.push({
        type: 'DUPLICATE_GLOBAL_ID',
        message: `Tree GlobalID ${globalId} appears more than once; the first occurrence wins for stem joins.`,
        globalId,
        sheet: 'trees',
        rowIndex,
        value: globalId
      });
      return;
    }
    treeIndex.set(globalId, tree);
  });

  const seenTreeTags = new Set<string>();

  trees.forEach((tree, rowIndex) => {
    const globalId = cellToString(field(tree, 'GlobalID'));
    const quadrat = cellToString(field(tree, 'quadrat'));
    const tag = cellToString(field(tree, 'tag'));
    const spcode = cellToString(field(tree, 'spcode'));

    if (quadrat === null) {
      blankQuadratCount += 1;
      warnings.push({
        type: 'BLANK_QUADRAT',
        message: `Tree ${globalId ?? '(no GlobalID)'} has a blank quadrat label; passed through blank.`,
        globalId,
        sheet: 'trees',
        rowIndex,
        value: null
      });
    }

    if (tag === null) {
      missingRequired += 1;
      warnings.push({
        type: 'MISSING_REQUIRED',
        message: `Tree ${globalId ?? '(no GlobalID)'} is missing a required tag; row still emitted for downstream validation.`,
        globalId,
        sheet: 'trees',
        rowIndex,
        value: 'tag'
      });
    } else {
      if (seenTreeTags.has(tag)) {
        duplicateTreeTags += 1;
        warnings.push({
          type: 'DUPLICATE_TREE_TAG',
          message: `Tree tag ${tag} appears more than once across tree rows.`,
          globalId,
          sheet: 'trees',
          rowIndex,
          value: tag
        });
      }
      seenTreeTags.add(tag);
    }

    if (spcode === null) {
      missingRequired += 1;
      warnings.push({
        type: 'MISSING_REQUIRED',
        message: `Tree ${globalId ?? '(no GlobalID)'} is missing a required spcode; row still emitted for downstream validation.`,
        globalId,
        sheet: 'trees',
        rowIndex,
        value: 'spcode'
      });
    }

    rows.push(
      toFileRow({
        tag,
        stemtag: cellToString(field(tree, 'StemTag')),
        spcode,
        quadrat,
        lx: cellToString(field(tree, 'lx')),
        ly: cellToString(field(tree, 'ly')),
        dbh: cellToString(field(tree, 'DBH_CURRENT')),
        hom: cellToString(field(tree, 'HOM')),
        date: dateToIso(field(tree, 'Date_measured')),
        codes: joinCodes(tree),
        comments: cellToString(field(tree, 'notes'))
      })
    );
  });

  stems.forEach((stem, rowIndex) => {
    const stemGlobalId = cellToString(field(stem, 'GlobalID'));
    const parentGlobalId = cellToString(field(stem, 'ParentGlobalID'));
    const parent = parentGlobalId ? treeIndex.get(parentGlobalId) : undefined;

    if (!parent) {
      orphanStemsDropped += 1;
      warnings.push({
        type: 'ORPHAN_STEM',
        message: `Stem ${stemGlobalId ?? '(no GlobalID)'} references parent ${parentGlobalId ?? '(none)'} with no matching tree; dropped.`,
        globalId: stemGlobalId,
        sheet: 'stems',
        rowIndex,
        value: parentGlobalId
      });
      return;
    }

    stemsJoined += 1;
    const parentTag = cellToString(field(parent, 'tag'));
    const stemOwnTag = cellToString(field(stem, 'tag'));
    if (stemOwnTag && parentTag && stemOwnTag !== parentTag) {
      tagMismatchCount += 1;
      warnings.push({
        type: 'TAG_MISMATCH',
        message: `Stem ${stemGlobalId ?? '(no GlobalID)'} tag ${stemOwnTag} differs from parent tree tag ${parentTag}; parent tag used.`,
        globalId: stemGlobalId,
        sheet: 'stems',
        rowIndex,
        value: stemOwnTag
      });
    }

    const quadrat = cellToString(field(parent, 'quadrat'));
    if (quadrat === null) {
      blankQuadratCount += 1;
      warnings.push({
        type: 'BLANK_QUADRAT',
        message: `Stem ${stemGlobalId ?? '(no GlobalID)'} inherits a blank quadrat from its parent tree.`,
        globalId: stemGlobalId,
        sheet: 'stems',
        rowIndex,
        value: null
      });
    }

    const spcode = cellToString(field(stem, 'spcode'));
    if (spcode === null) {
      missingRequired += 1;
      warnings.push({
        type: 'MISSING_REQUIRED',
        message: `Stem ${stemGlobalId ?? '(no GlobalID)'} is missing a required spcode; row still emitted for downstream validation.`,
        globalId: stemGlobalId,
        sheet: 'stems',
        rowIndex,
        value: 'spcode'
      });
    }

    rows.push(
      toFileRow({
        tag: parentTag,
        stemtag: cellToString(field(stem, 'StemTag')),
        spcode,
        quadrat,
        lx: cellToString(field(parent, 'lx')),
        ly: cellToString(field(parent, 'ly')),
        dbh: cellToString(field(stem, 'DBH_CURRENT')),
        hom: cellToString(field(stem, 'HOM')),
        date: dateToIso(field(stem, 'Date_measured')),
        codes: joinCodes(stem),
        comments: cellToString(field(stem, 'notes'))
      })
    );
  });

  return {
    rows,
    warnings,
    summary: {
      treesTransformed: trees.length,
      stemsJoined,
      blankQuadratCount,
      tagMismatchCount,
      orphanStemsDropped,
      duplicateTreeTags,
      duplicateGlobalIds,
      missingRequired,
      totalRows: rows.length
    }
  };
}
