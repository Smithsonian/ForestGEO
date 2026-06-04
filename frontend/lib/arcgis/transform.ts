import type { FileRow } from '@/config/macros/formdetails';
import { excelSerialToISODate } from './excel-date';
import { CODE_COLUMN_PREFIX, CODE_JOIN_SEPARATOR, NULL_CODE_TOKEN, normalizeHeader, resolveColumn } from './schema';
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

const NORMALIZED_CODE_PREFIX = normalizeHeader(CODE_COLUMN_PREFIX);

function joinCodes(row: ArcgisRow): string {
  const codes: string[] = [];
  for (const [key, value] of Object.entries(row)) {
    if (!normalizeHeader(key).startsWith(NORMALIZED_CODE_PREFIX)) continue;
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

// Canonical fields the bulkingestionprocess stored procedure treats as required (recording a
// failure when null/blank): tree/stem tags, species code, measurement date, and quadrat-local
// coordinates (the null-coordinate rule added in a sibling SP task). `quadrat` is intentionally
// EXCLUDED here: blank quadrats are already surfaced via the BLANK_QUADRAT warning/count, so
// folding them into missing-required too would double-count the same row.
const SP_REQUIRED_FIELDS = ['tag', 'stemtag', 'spcode', 'date', 'lx', 'ly'] as const;

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
  let orphanStemsEmitted = 0;
  let stemsJoined = 0;
  let duplicateTreeTags = 0;
  let duplicateGlobalIds = 0;
  let missingRequired = 0;

  const field = (row: ArcgisRow, name: string): ArcgisCell => resolveColumn(row, name) as ArcgisCell;

  // Forecast the SP's missing-required failures on the EMITTED canonical row (post-inheritance),
  // pushing one MISSING_REQUIRED warning per blank required field and bumping the shared count.
  // This is a PREVIEW only: the row is still emitted; the SP records it as the actual failure.
  const collectMissingRequired = (row: FileRow, sheet: 'trees' | 'stems', rowIndex: number, globalId: string | null) => {
    for (const key of SP_REQUIRED_FIELDS) {
      const value = row[key];
      if (value === null || value === '') {
        missingRequired += 1;
        warnings.push({
          type: 'MISSING_REQUIRED',
          message: `${sheet === 'trees' ? 'Tree' : 'Stem'} ${globalId ?? '(no GlobalID)'} is missing a required ${key}; row still emitted for downstream validation.`,
          globalId,
          sheet,
          rowIndex,
          value: key
        });
      }
    }
  };

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

    if (tag !== null) {
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

    const row = toFileRow({
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
    });
    collectMissingRequired(row, 'trees', rowIndex, globalId);
    rows.push(row);
  });

  stems.forEach((stem, rowIndex) => {
    const stemGlobalId = cellToString(field(stem, 'GlobalID'));
    const parentGlobalId = cellToString(field(stem, 'ParentGlobalID'));
    const parent = parentGlobalId ? treeIndex.get(parentGlobalId) : undefined;

    if (!parent) {
      // Orphan by GlobalID: emit a canonical row from the stem's OWN values (no parent to inherit
      // from, so no coordinates). The SP resolves stems to trees by TreeTag, so this may still
      // resolve by tag; if not, it is recorded as a failure downstream. We never silently drop it.
      orphanStemsEmitted += 1;
      warnings.push({
        type: 'ORPHAN_STEM',
        message: `Stem ${stemGlobalId ?? '(no GlobalID)'} references parent ${parentGlobalId ?? '(none)'} with no matching tree row; emitted with its own tag/quadrat and no coordinates — will be resolved by tag or recorded as a failure downstream.`,
        globalId: stemGlobalId,
        sheet: 'stems',
        rowIndex,
        value: parentGlobalId
      });

      const orphanQuadrat = cellToString(field(stem, 'quadrat'));
      if (orphanQuadrat === null) {
        blankQuadratCount += 1;
        warnings.push({
          type: 'BLANK_QUADRAT',
          message: `Stem ${stemGlobalId ?? '(no GlobalID)'} has a blank quadrat label; passed through blank.`,
          globalId: stemGlobalId,
          sheet: 'stems',
          rowIndex,
          value: null
        });
      }

      const orphanRow = toFileRow({
        tag: cellToString(field(stem, 'tag')),
        stemtag: cellToString(field(stem, 'StemTag')),
        spcode: cellToString(field(stem, 'spcode')),
        quadrat: orphanQuadrat,
        lx: null,
        ly: null,
        dbh: cellToString(field(stem, 'DBH_CURRENT')),
        hom: cellToString(field(stem, 'HOM')),
        date: dateToIso(field(stem, 'Date_measured')),
        codes: joinCodes(stem),
        comments: cellToString(field(stem, 'notes'))
      });
      collectMissingRequired(orphanRow, 'stems', rowIndex, stemGlobalId);
      rows.push(orphanRow);
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

    const row = toFileRow({
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
    });
    collectMissingRequired(row, 'stems', rowIndex, stemGlobalId);
    rows.push(row);
  });

  return {
    rows,
    warnings,
    summary: {
      treesTransformed: trees.length,
      stemsJoined,
      blankQuadratCount,
      tagMismatchCount,
      orphanStemsEmitted,
      duplicateTreeTags,
      duplicateGlobalIds,
      missingRequired,
      totalRows: rows.length
    }
  };
}
