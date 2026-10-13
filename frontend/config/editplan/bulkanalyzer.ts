import ConnectionManager from '@/lib/db/connectionmanager';
import { buildInPlaceholders, safeFormatQuery } from '@/lib/db/sqlsecurity';
import {
  BulkEditPlan,
  DuplicateDeletion,
  EditPlan,
  EditPlanDataType,
  Effect,
  PreviewError,
  RowPlan,
  SEVERITY_RANK,
  Severity,
  SpeciesCorrectionGroup,
  TreeStemResolutionPreviewError
} from './types';
import { AnalyzeEditOptions, RoleForbiddenFieldError, TargetNotFoundError, analyzeEdit, isRoleForbiddenPreviewError } from './analyzer';
import { applyDuplicateRules } from './rules/duplicates';
import { canonicalizeRowForHash } from './canonicalrow';
import { hashPlan } from './planhash';
import { SpeciesNotFoundError } from './rules/context';
import { analyzeBulkSpeciesCorrections, BulkSpeciesGroupRow, compareTreeStemResolutionErrors, isSpeciesCorrectionEffect } from './bulkspeciesgroups';

export class BulkPlanUnapplicableError extends Error {
  constructor(public readonly blockingErrors: PreviewError[]) {
    super(`Bulk edit plan has ${blockingErrors.length} blocking error(s)`);
    this.name = 'BulkPlanUnapplicableError';
  }
}

export interface BulkInput {
  matched: Array<{
    rowIndex: number;
    targetID: number;
    newRow: Record<string, unknown>;
    /**
     * The species code the CSV row explicitly supplied (null/absent when
     * unspecified), carried separately from `newRow` because `computeDiff`
     * drops unchanged/blank cells. The batch grouping stage uses it to
     * detect a sibling row that explicitly contradicts a tree correction.
     */
    explicitSpeciesCode?: string | null;
  }>;
  newRows: Array<{ rowIndex: number; newRow: Record<string, unknown> }>;
  invalid: Array<{ rowIndex: number; reason: string }>;
  duplicateMeasurementIDsToDelete: DuplicateDeletion[];
}

/**
 * A matched row that survived `analyzeEdit` (i.e. did NOT throw
 * `TargetNotFoundError`/`SpeciesNotFoundError`), carrying everything phase 2
 * (batch-level grouping) and phase 3 (the demotion survival gate) need.
 * `dataBlockers` is computed once here — the same filter the pre-#427 code
 * ran inline — so neither later phase has to re-derive it.
 */
interface AnalyzedMatchedRow {
  rowIndex: number;
  targetID: number;
  plan: EditPlan;
  explicitSpeciesCode?: string | null;
  dataBlockers: TreeStemResolutionPreviewError[];
}

/**
 * A matched row whose `analyzeEdit` threw and can never apply, but whose own
 * `explicitSpeciesCode` must still reach phase 2's group conflict checks
 * (B2): a sibling row may contradict it even though it never got a `plan`.
 */
interface ThrownMatchedRow {
  rowIndex: number;
  targetID: number;
  explicitSpeciesCode?: string | null;
}

/**
 * Narrows `plan.errors` to blocking, non-role errors. Role-forbidden errors
 * stay on the plan unconditionally (see the comment at the call site below);
 * everything else a rule module can produce is `TreeStemResolutionPreviewError`
 * (the only other member of the `PreviewError` union), so this predicate both
 * filters AND narrows the array's element type to give phase 3 access to
 * `.reason` without a cast.
 */
function isBlockingDataError(error: PreviewError): error is TreeStemResolutionPreviewError {
  return error.blocking && error.kind !== 'RoleForbiddenField';
}

/**
 * True only for a blocking #427 batch-level group error (reasons prefixed
 * `group_`: species conflict, identity overlap, member deletion, field
 * conflict) — reuses `isBlockingDataError`'s narrowing (and its narrowed
 * type) rather than duplicating it, so callers get `.reason`/`.rowIndexes`
 * access on the narrowed `TreeStemResolutionPreviewError` without a cast.
 */
export function isGroupBlockingPreviewError(error: PreviewError): error is TreeStemResolutionPreviewError {
  return isBlockingDataError(error) && error.reason.startsWith('group_');
}

/**
 * The `TreeStemResolutionPreviewError.reason` values that ONLY arise from the
 * #427 species-correction path (`rules/species.ts#applySpeciesRules`'s
 * `mixed_identity`/`destination_exists`/`inconsistent_scope` branches — see
 * `rules/treestem.ts`, which emits only `missing`/`inactive`/
 * `different_quadrat`/`cannot_create`). A row blocked by one of these reasons
 * is never an ordinary "this row can't apply" case; it is a correction the
 * user explicitly asked for that failed its own precondition, so silently
 * reducing it to a skipped/invalid row (as the generic treestem reasons are)
 * would discard the correction request instead of surfacing why it failed.
 */
const CORRECTION_SPECIFIC_BLOCKING_REASONS = new Set<TreeStemResolutionPreviewError['reason']>(['mixed_identity', 'destination_exists', 'inconsistent_scope']);

/** Canonical `FieldChange.field` name for a requested species correction (B3). */
const SPECIES_CODE_FIELD = 'SpeciesCode';

/**
 * True when `row.plan.fieldChanges` itself requests a `SpeciesCode` change
 * (B3) — the row asked for a correction, so a generic `missing`/`inactive`
 * source-row blocker must not silently demote/discard that request.
 */
function requestedSpeciesCodeChange(row: AnalyzedMatchedRow): boolean {
  return row.plan.fieldChanges.some(change => change.field === SPECIES_CODE_FIELD);
}

/**
 * True when `row` must keep its `plan` (and therefore its blocking errors) on
 * the bulk plan instead of being demoted to an invalid rowPlan, even though it
 * has one or more blocking `dataBlockers`. Four independent reasons, any one
 * of which is sufficient:
 *
 *   (a) `plan.speciesCorrection` is present — this row IS a tree correction;
 *       demoting it would discard the correction itself, not just a
 *       formatting problem with the row.
 *   (b) one of its blockers has a `CORRECTION_SPECIFIC_BLOCKING_REASONS`
 *       reason — these reasons only arise from the #427 species-correction
 *       path (see the constant's own comment) and must not be reduced to a
 *       skipped row.
 *   (c) its `rowIndex` is implicated in a batch-level group blocker
 *       (`groupImplicatedRowIndexes`). Both `app/api/revisionupload/route.ts`
 *       and `.../apply/route.ts` re-run `analyzeBulk` on the SURVIVING
 *       matched rows only, once per the match/apply flow's own demotion pass.
 *       If a row that a group blocker names were dropped here, the survivor
 *       re-analysis would never see it again, so the group blocker it
 *       contributed to would silently vanish on the next pass and a batch
 *       that actually contradicts itself could apply.
 *   (d) `requestedSpeciesCodeChange(row)` — the row itself asked for a
 *       `SpeciesCode` change, so a generic source-row blocker (`missing`/
 *       `inactive`) must not silently demote/discard that request (B3).
 */
function mustSurviveDemotion(row: AnalyzedMatchedRow, groupImplicatedRowIndexes: ReadonlySet<number>): boolean {
  if (row.plan.speciesCorrection) return true;
  if (row.dataBlockers.some(error => CORRECTION_SPECIFIC_BLOCKING_REASONS.has(error.reason))) return true;
  if (requestedSpeciesCodeChange(row)) return true;
  return groupImplicatedRowIndexes.has(row.rowIndex);
}

function buildMatchedRowPlan(row: AnalyzedMatchedRow): RowPlan {
  return {
    rowIndex: row.rowIndex,
    targetID: row.targetID,
    plan: row.plan,
    status: row.plan.fieldChanges.length ? 'matched' : 'unchanged'
  };
}

function buildSpeciesCorrectionGroupKey(treeID: number, censusID: number): string {
  return `${treeID}:${censusID}`;
}

/** Canonical `FieldChange.field`/canonical-row key for a tree's identity tag (#427 batch identity-overlap check). */
const TREE_TAG_FIELD = 'TreeTag';

/** Bounds each identity-overlap query's `UNION ALL` candidate list so a several-thousand-row upload cannot build one unbounded statement. */
const IDENTITY_OVERLAP_CANDIDATE_CHUNK_SIZE = 500;

/**
 * One batch row that could collide with a correction group's TreeTag: a
 * brand-new row inserting a tree under that tag, or an outsider matched row
 * renaming some other tree to it. `rowIndex` is the row's OWN index space
 * (new-row CSV index or matched array position) — never merged with the
 * other space until `buildBatchIdentityOverlapErrors` splits them back out.
 */
interface BatchIdentityOverlapCandidate {
  tag: string;
  source: 'new' | 'matched';
  rowIndex: number;
}

/**
 * The minimal shape `buildBatchIdentityOverlapQuery`/`findBatchIdentityOverlapHits`
 * actually need: just the TreeTag to match against `trees`. `BatchIdentityOverlapCandidate`
 * satisfies this, and so does B4's own candidate-group list (mapped to `{ tag }`),
 * letting both call sites share one query/hit implementation.
 */
type TagOnlyIdentityOverlapCandidate = Pick<BatchIdentityOverlapCandidate, 'tag'>;

/**
 * New rows carrying a (canonical, already-trimmed) `TreeTag`, plus outsider
 * matched rows — rows whose `targetID` is NOT among any group's
 * `affectedCoreMeasurementIDs` — whose own `fieldChanges` rename `TreeTag`.
 * An in-group row's `TreeTag` change is already caught by
 * `bulkspeciesgroups.ts`'s `detectIdentityOverlap`; this is the batch-level
 * gap that check cannot see (#427).
 */
function collectBatchIdentityOverlapCandidates(
  newRows: BulkInput['newRows'],
  analyzedRows: AnalyzedMatchedRow[],
  groupAffectedCoreMeasurementIDs: ReadonlySet<number>
): BatchIdentityOverlapCandidate[] {
  const candidates: BatchIdentityOverlapCandidate[] = [];

  for (const newRow of newRows) {
    const tag = newRow.newRow[TREE_TAG_FIELD];
    if (typeof tag !== 'string') continue;
    const trimmedTag = tag.trim();
    if (trimmedTag === '') continue;
    candidates.push({ tag: trimmedTag, source: 'new', rowIndex: newRow.rowIndex });
  }

  for (const row of analyzedRows) {
    if (groupAffectedCoreMeasurementIDs.has(row.targetID)) continue;
    const change = row.plan.fieldChanges.find(fieldChange => fieldChange.field === TREE_TAG_FIELD);
    if (!change || typeof change.to !== 'string') continue;
    const trimmedTag = change.to.trim();
    if (trimmedTag === '') continue;
    candidates.push({ tag: trimmedTag, source: 'matched', rowIndex: row.rowIndex });
  }

  return candidates;
}

/**
 * One `(candidates[start..end), treeIDs)` chunk of the identity-overlap
 * query: a derived table of `(Tag, CandidateKey)` literals joined against
 * `trees` by TreeTag, bounded to the groups' own TreeIDs — never a
 * census-wide scan. `CandidateKey` is the candidate's own index into the
 * FULL (unchunked) candidate array, so a hit from any chunk maps back
 * unambiguously without renumbering.
 */
function buildBatchIdentityOverlapQuery(
  schema: string,
  candidates: TagOnlyIdentityOverlapCandidate[],
  chunkStart: number,
  chunkEnd: number,
  treeIDs: number[]
): { sql: string; params: unknown[] } {
  const chunk = candidates.slice(chunkStart, chunkEnd);
  const candidateUnion = chunk.map(() => 'SELECT ? AS Tag, ? AS CandidateKey').join(' UNION ALL ');
  const treeIDPlaceholders = buildInPlaceholders(treeIDs.length);

  const sql = safeFormatQuery(
    schema,
    `SELECT t.TreeID AS TreeID, c.CandidateKey AS CandidateKey
     FROM ??.trees t
     JOIN (${candidateUnion}) c ON c.Tag = t.TreeTag
     WHERE t.TreeID IN (${treeIDPlaceholders})`
  );
  // c.Tag is a derived-table literal, which has higher collation
  // coercibility than the t.TreeTag column, so MySQL resolves c.Tag = t.TreeTag
  // under trees.TreeTag's own collation -- the same comparison its UNIQUE key enforces.

  const params: unknown[] = [];
  chunk.forEach((candidate, offset) => params.push(candidate.tag, chunkStart + offset));
  params.push(...treeIDs);
  return { sql, params };
}

interface BatchIdentityOverlapHit {
  treeID: number;
  candidateKey: number;
}

async function findBatchIdentityOverlapHits(
  cm: ConnectionManager,
  schema: string,
  candidates: TagOnlyIdentityOverlapCandidate[],
  treeIDs: number[],
  transactionID?: string
): Promise<BatchIdentityOverlapHit[]> {
  const hits: BatchIdentityOverlapHit[] = [];
  for (let chunkStart = 0; chunkStart < candidates.length; chunkStart += IDENTITY_OVERLAP_CANDIDATE_CHUNK_SIZE) {
    const chunkEnd = Math.min(chunkStart + IDENTITY_OVERLAP_CANDIDATE_CHUNK_SIZE, candidates.length);
    const { sql, params } = buildBatchIdentityOverlapQuery(schema, candidates, chunkStart, chunkEnd, treeIDs);
    const rows = (await cm.executeQuery(sql, params, transactionID)) as Array<{ TreeID: number; CandidateKey: number }>;
    for (const row of rows) hits.push({ treeID: Number(row.TreeID), candidateKey: Number(row.CandidateKey) });
  }
  return hits;
}

function buildBatchIdentityOverlapError(
  group: SpeciesCorrectionGroup,
  rowIndexes: number[] | undefined,
  newRowIndexes: number[] | undefined
): TreeStemResolutionPreviewError {
  return {
    kind: 'TreeStemResolution',
    subject: 'tree',
    reason: 'group_identity_overlap',
    field: TREE_TAG_FIELD,
    message:
      `Tree T#${group.treeID} (TreeTag "${group.correction.treeTag}") is being corrected in this batch, but another row in the same batch introduces or ` +
      `renames a tree to that same TreeTag "${group.correction.treeTag}". The correction's tree membership would become ambiguous; split this upload so ` +
      `TreeTag "${group.correction.treeTag}" is introduced or renamed in a separate batch from its species correction.`,
    severity: 'destructive',
    blocking: true,
    treeID: group.treeID,
    ...(rowIndexes && rowIndexes.length > 0 ? { rowIndexes } : {}),
    ...(newRowIndexes && newRowIndexes.length > 0 ? { newRowIndexes } : {})
  };
}

/**
 * The batch-level counterpart of `bulkspeciesgroups.ts`'s `detectIdentityOverlap`
 * (#427): that check only sees IN-GROUP rows changing identity; this one sees a
 * NEW row inserting a tree under a group's TreeTag, or an OUTSIDER matched row
 * renaming some other tree to it. Both make the group's precomputed membership
 * ambiguous (the `trees` table enforces a UNIQUE (TreeTag, SpeciesID, CensusID)
 * key under TreeTag's own collation), so the comparison runs in the database
 * rather than in JS (see `buildBatchIdentityOverlapQuery`'s comment).
 *
 * Issues ZERO queries when there are no groups or no candidates — every
 * existing `bulkanalyzer.test.ts` fixture passes a throwing ConnectionManager
 * stub, so a no-candidate batch must never touch `cm` at all.
 */
async function detectBatchIdentityOverlaps(
  cm: ConnectionManager,
  schema: string,
  groups: SpeciesCorrectionGroup[],
  newRows: BulkInput['newRows'],
  analyzedRows: AnalyzedMatchedRow[],
  transactionID?: string
): Promise<TreeStemResolutionPreviewError[]> {
  if (groups.length === 0) return [];

  const groupAffectedCoreMeasurementIDs = new Set<number>();
  for (const group of groups) for (const id of group.affectedCoreMeasurementIDs) groupAffectedCoreMeasurementIDs.add(id);

  const candidates = collectBatchIdentityOverlapCandidates(newRows, analyzedRows, groupAffectedCoreMeasurementIDs);
  if (candidates.length === 0) return [];

  const treeIDs = Array.from(new Set(groups.map(group => group.treeID)));
  const hits = await findBatchIdentityOverlapHits(cm, schema, candidates, treeIDs, transactionID);
  if (hits.length === 0) return [];

  const groupsByTreeID = new Map<number, SpeciesCorrectionGroup[]>();
  for (const group of groups) {
    const list = groupsByTreeID.get(group.treeID) ?? [];
    list.push(group);
    groupsByTreeID.set(group.treeID, list);
  }

  const matchedRowIndexesByGroupKey = new Map<string, Set<number>>();
  const newRowIndexesByGroupKey = new Map<string, Set<number>>();

  for (const hit of hits) {
    const candidate = candidates[hit.candidateKey];
    if (!candidate) continue;
    for (const group of groupsByTreeID.get(hit.treeID) ?? []) {
      const key = buildSpeciesCorrectionGroupKey(group.treeID, group.censusID);
      const targetMap = candidate.source === 'new' ? newRowIndexesByGroupKey : matchedRowIndexesByGroupKey;
      const set = targetMap.get(key) ?? new Set<number>();
      set.add(candidate.rowIndex);
      targetMap.set(key, set);
    }
  }

  const errors: TreeStemResolutionPreviewError[] = [];
  for (const group of groups) {
    const key = buildSpeciesCorrectionGroupKey(group.treeID, group.censusID);
    const matchedSet = matchedRowIndexesByGroupKey.get(key);
    const newSet = newRowIndexesByGroupKey.get(key);
    if (!matchedSet && !newSet) continue;

    errors.push(
      buildBatchIdentityOverlapError(
        group,
        matchedSet ? Array.from(matchedSet).sort((a, b) => a - b) : undefined,
        newSet ? Array.from(newSet).sort((a, b) => a - b) : undefined
      )
    );
  }

  return errors;
}

function buildDestinationGroupKey(newSpeciesID: number, censusID: number): string {
  return `${newSpeciesID}:${censusID}`;
}

function buildGroupDestinationCollisionError(groupA: SpeciesCorrectionGroup, groupB: SpeciesCorrectionGroup): TreeStemResolutionPreviewError {
  const [primary, secondary] = groupA.treeID <= groupB.treeID ? [groupA, groupB] : [groupB, groupA];
  const rowIndexes = Array.from(new Set([...primary.members.map(member => member.rowIndex), ...secondary.members.map(member => member.rowIndex)])).sort(
    (a, b) => a - b
  );

  return {
    kind: 'TreeStemResolution',
    subject: 'tree',
    reason: 'group_identity_overlap',
    field: TREE_TAG_FIELD,
    message:
      `Tree T#${primary.treeID} (TreeTag "${primary.correction.treeTag}") and Tree T#${secondary.treeID} (TreeTag "${secondary.correction.treeTag}") are ` +
      `both being corrected to species "${primary.correction.newSpeciesCode}" in census ${primary.censusID} in this batch. Their TreeTags resolve to the ` +
      `same value under the database's collation, so applying both corrections would collide on the same (TreeTag, Species, Census) identity. Split this ` +
      `upload so only one of Tree T#${primary.treeID} / Tree T#${secondary.treeID} is corrected to "${primary.correction.newSpeciesCode}" in census ${primary.censusID}.`,
    severity: 'destructive',
    blocking: true,
    treeID: primary.treeID,
    rowIndexes
  };
}

/**
 * B4: two DISTINCT correction groups whose own requested TreeTags are equal
 * under the database's collation, both targeting the SAME destination
 * species in the SAME census, would collide on `trees`' UNIQUE (TreeTag,
 * SpeciesID, CensusID) key the moment BOTH writes land -- a collision
 * neither group's own "does the destination already exist" precondition
 * check can see, since neither destination exists until the OTHER group's
 * write lands. Pre-filters to (newSpeciesID, censusID) buckets with at
 * least two groups before issuing any query: groups targeting different
 * destinations can never collide on the UNIQUE key regardless of TreeTag.
 */
async function detectProspectiveGroupDestinationCollisions(
  cm: ConnectionManager,
  schema: string,
  groups: SpeciesCorrectionGroup[],
  transactionID?: string
): Promise<TreeStemResolutionPreviewError[]> {
  if (groups.length < 2) return [];

  const groupsByDestinationKey = new Map<string, SpeciesCorrectionGroup[]>();
  for (const group of groups) {
    const key = buildDestinationGroupKey(group.correction.newSpeciesID, group.censusID);
    const list = groupsByDestinationKey.get(key) ?? [];
    list.push(group);
    groupsByDestinationKey.set(key, list);
  }

  const candidateGroups: SpeciesCorrectionGroup[] = [];
  for (const sameDestinationGroups of groupsByDestinationKey.values()) {
    if (sameDestinationGroups.length >= 2) candidateGroups.push(...sameDestinationGroups);
  }
  if (candidateGroups.length < 2) return [];

  // `candidateGroups` order is preserved one-to-one so `hit.candidateKey`
  // (an index into this array, per `buildBatchIdentityOverlapQuery`'s own
  // comment) still resolves back to the right group below -- reuses the
  // SAME tag-only query/hit helpers as `detectBatchIdentityOverlaps`
  // (#427), not a cross-group copy of them.
  const candidateTagsOnly: TagOnlyIdentityOverlapCandidate[] = candidateGroups.map(group => ({ tag: group.correction.treeTag }));
  const treeIDs = Array.from(new Set(candidateGroups.map(group => group.treeID)));

  const hits = await findBatchIdentityOverlapHits(cm, schema, candidateTagsOnly, treeIDs, transactionID);
  if (hits.length === 0) return [];

  const candidateGroupByTreeID = new Map<number, SpeciesCorrectionGroup>();
  for (const group of candidateGroups) candidateGroupByTreeID.set(group.treeID, group);

  const reportedPairKeys = new Set<string>();
  const errors: TreeStemResolutionPreviewError[] = [];

  for (const hit of hits) {
    const originGroup = candidateGroups[hit.candidateKey];
    if (!originGroup) continue;
    const hitGroup = candidateGroupByTreeID.get(hit.treeID);
    if (!hitGroup || hitGroup.treeID === originGroup.treeID) continue;
    // Pooling every eligible bucket into one query means a hit could land on
    // a tree from a DIFFERENT bucket whose TreeTag happens to also
    // collation-match; that tree poses no real UNIQUE-key risk to this
    // candidate, so it must not be reported.
    if (hitGroup.correction.newSpeciesID !== originGroup.correction.newSpeciesID || hitGroup.censusID !== originGroup.censusID) continue;

    const pairKey = [originGroup.treeID, hitGroup.treeID].sort((a, b) => a - b).join(':');
    if (reportedPairKeys.has(pairKey)) continue;
    reportedPairKeys.add(pairKey);

    errors.push(buildGroupDestinationCollisionError(originGroup, hitGroup));
  }

  return errors.sort(compareTreeStemResolutionErrors);
}

/**
 * B5: a batch-wide guard, not a per-tree one. The apply route commits a
 * #427 species correction's writes inside the shared new-row ingestion
 * pipeline's own transaction (see `storedprocedures.sql`'s
 * `bulkingestionprocess`), so once a batch also carries new rows the
 * correction can no longer be rolled back if a later step in the SAME
 * upload fails — the all-or-nothing guarantee #427 promises would break.
 * Rather than change which transaction owns the writes, this upload is
 * refused outright before any mutation runs. No `treeID` is set: the gate
 * only ever fires when `groups`/`identityOverlapErrors`/
 * `destinationCollisionErrors` collectively produced zero other errors, so
 * it is always the sole group error and `compareTreeStemResolutionErrors`
 * never has to disambiguate it against a sibling.
 */
function buildNewRowsRequireSeparateBatchError(groups: SpeciesCorrectionGroup[], newRows: BulkInput['newRows']): TreeStemResolutionPreviewError {
  const rowIndexes = Array.from(new Set(groups.flatMap(group => group.members.map(member => member.rowIndex)))).sort((a, b) => a - b);
  const newRowIndexes = Array.from(new Set(newRows.map(newRow => newRow.rowIndex))).sort((a, b) => a - b);

  return {
    kind: 'TreeStemResolution',
    subject: 'tree',
    reason: 'group_new_rows_require_separate_batch',
    field: SPECIES_CODE_FIELD,
    message:
      `This upload contains ${groups.length} tree species correction(s) and ${newRows.length} new measurement row(s). Submit species corrections and ` +
      `new measurement rows in separate uploads.`,
    severity: 'destructive',
    blocking: true,
    ...(rowIndexes.length > 0 ? { rowIndexes } : {}),
    ...(newRowIndexes.length > 0 ? { newRowIndexes } : {})
  };
}

export async function analyzeBulk(
  cm: ConnectionManager,
  schema: string,
  dataType: EditPlanDataType,
  plotID: number,
  censusID: number,
  input: BulkInput,
  transactionID?: string,
  options: AnalyzeEditOptions = {}
): Promise<BulkEditPlan> {
  const rowPlans: RowPlan[] = [];

  // --- Phase 1: analyze, do not decide. ---
  // Every matched row is run through `analyzeEdit` and its data blockers are
  // computed, but NOTHING is demoted yet — demoting inline (as the pre-#427
  // code did) would hide a row from phase 2's batch-level grouping before it
  // ever got a chance to see it.
  const analyzedRows: AnalyzedMatchedRow[] = [];
  // Rows whose analyzeEdit threw (B2): never a group MEMBER, but still carry
  // `explicitSpeciesCode` into phase 2 so a sibling can't silently contradict them.
  const thrownMatchedRows: ThrownMatchedRow[] = [];

  for (const matched of input.matched) {
    // A matched row can become non-existent between match and apply (or be
    // deactivated while the user reviews). Converting TargetNotFoundError
    // into an invalid-row entry keeps the whole batch analyzable and forces
    // a plan-hash drift that the apply endpoint surfaces to the UI.
    try {
      const plan = await analyzeEdit(cm, schema, dataType, plotID, censusID, matched.targetID, matched.newRow, transactionID, options);
      const dataBlockers = (plan.errors ?? []).filter(isBlockingDataError);
      analyzedRows.push({ rowIndex: matched.rowIndex, targetID: matched.targetID, plan, explicitSpeciesCode: matched.explicitSpeciesCode, dataBlockers });
    } catch (err) {
      if (err instanceof TargetNotFoundError) {
        rowPlans.push({
          rowIndex: matched.rowIndex,
          targetID: matched.targetID,
          status: 'invalid',
          reason: `Measurement ${matched.targetID} is no longer active in this plot/census`
        });
        thrownMatchedRows.push({ rowIndex: matched.rowIndex, targetID: matched.targetID, explicitSpeciesCode: matched.explicitSpeciesCode });
        continue;
      }
      // SpeciesNotFoundError is a per-row issue: the user supplied a species
      // code that doesn't resolve in the species table (typo, deleted species,
      // or a placeholder like 'CHANGED'). Demoting it to an invalid rowPlan
      // lets the rest of the batch proceed and surfaces the offending row in
      // the upload review's "Invalid" tab — instead of failing the whole
      // bulk plan with a 422.
      if (err instanceof SpeciesNotFoundError) {
        rowPlans.push({
          rowIndex: matched.rowIndex,
          targetID: matched.targetID,
          status: 'invalid',
          reason: err.code === '' ? 'Species code is blank — species cannot be cleared' : `Species not found: ${err.code}`
        });
        thrownMatchedRows.push({ rowIndex: matched.rowIndex, targetID: matched.targetID, explicitSpeciesCode: matched.explicitSpeciesCode });
        continue;
      }
      throw err;
    }
  }

  // --- Phase 2: group and check. ---
  // Every analyzed row is handed to the #427 batch-grouping stage BEFORE any
  // demotion decision is made, using the status the row would get if it
  // survives (demoted rows are excluded from the group's own member list by
  // `buildSpeciesCorrectionGroups`, not by being withheld here).
  const matchedGroupRows: BulkSpeciesGroupRow[] = analyzedRows.map(row => ({
    rowIndex: row.rowIndex,
    targetID: row.targetID,
    status: row.plan.fieldChanges.length ? 'matched' : 'unchanged',
    plan: row.plan,
    explicitSpeciesCode: row.explicitSpeciesCode
  }));
  // B2: thrown rows carry no `plan` and stay `status:'invalid'` here, but
  // their `explicitSpeciesCode` still reaches Check A (`detectSpeciesDisagreement`).
  const thrownGroupRows: BulkSpeciesGroupRow[] = thrownMatchedRows.map(row => ({
    rowIndex: row.rowIndex,
    targetID: row.targetID,
    status: 'invalid',
    explicitSpeciesCode: row.explicitSpeciesCode
  }));
  const groupRows: BulkSpeciesGroupRow[] = [...matchedGroupRows, ...thrownGroupRows].sort((a, b) => a.rowIndex - b.rowIndex);
  const { groups, errors: groupErrors } = analyzeBulkSpeciesCorrections(groupRows, input.duplicateMeasurementIDsToDelete);

  // #427 batch-level identity-overlap check: a NEW row or an OUTSIDER matched
  // row (see `detectBatchIdentityOverlaps`'s own comment) can collide with a
  // group's TreeTag in ways `analyzeBulkSpeciesCorrections` cannot see, since
  // it only inspects IN-GROUP rows. Merged and re-sorted with the same
  // comparator BEFORE `groupImplicatedRowIndexes` is built, so a row this
  // check names also survives phase 3's demotion gate.
  const identityOverlapErrors = await detectBatchIdentityOverlaps(cm, schema, groups, input.newRows, analyzedRows, transactionID);
  // B4: distinct groups whose own TreeTags collide under the DB's collation
  // while targeting the same destination species/census -- see
  // `detectProspectiveGroupDestinationCollisions`'s own comment.
  const destinationCollisionErrors = await detectProspectiveGroupDestinationCollisions(cm, schema, groups, transactionID);
  const otherGroupErrors = [...groupErrors, ...identityOverlapErrors, ...destinationCollisionErrors];
  // B5: only guard against mixing corrections with new rows when nothing
  // more specific already blocks the batch — a redundant generic message
  // on top of an already-actionable one would just add noise (see
  // `buildNewRowsRequireSeparateBatchError`'s own comment).
  const newRowsRequireSeparateBatchErrors: TreeStemResolutionPreviewError[] =
    groups.length > 0 && input.newRows.length > 0 && otherGroupErrors.length === 0 ? [buildNewRowsRequireSeparateBatchError(groups, input.newRows)] : [];
  const mergedGroupErrors = [...otherGroupErrors, ...newRowsRequireSeparateBatchErrors].sort(compareTreeStemResolutionErrors);

  const groupImplicatedRowIndexes = new Set<number>();
  for (const groupError of mergedGroupErrors) {
    for (const rowIndex of groupError.rowIndexes ?? []) groupImplicatedRowIndexes.add(rowIndex);
  }

  // --- Phase 3: demote with the survival gate. ---
  for (const row of analyzedRows) {
    if (row.dataBlockers.length === 0) {
      rowPlans.push(buildMatchedRowPlan(row));
      continue;
    }

    if (mustSurviveDemotion(row, groupImplicatedRowIndexes)) {
      rowPlans.push(buildMatchedRowPlan(row));
      continue;
    }

    // Per-row data-validity blockers (TreeStemResolution: missing quadrat,
    // inactive tree, stem in different quadrat, etc.) are demoted to
    // status:'invalid' so the row can be surfaced in the upload review's
    // Invalid tab while the rest of the batch still applies. Role-forbidden
    // errors stay on the plan because they're a per-user authorization
    // concern — every spcode-changing row would have the same role error,
    // and the UI needs to show the role-block banner once at the plan level
    // rather than N times in the Invalid tab.
    rowPlans.push({
      rowIndex: row.rowIndex,
      targetID: row.targetID,
      status: 'invalid',
      reason: row.dataBlockers.map(error => error.message).join('; ')
    });
  }

  for (const newRow of input.newRows) {
    rowPlans.push({
      rowIndex: newRow.rowIndex,
      status: 'new',
      canonicalNewRow: canonicalizeRowForHash(newRow.newRow, 'revision-insert')
    });
  }

  for (const invalid of input.invalid) {
    rowPlans.push({ rowIndex: invalid.rowIndex, status: 'invalid', reason: invalid.reason });
  }

  const surfacedEffects: Effect[] = [];
  surfacedEffects.push(...applyDuplicateRules(input.duplicateMeasurementIDsToDelete));
  const errors: PreviewError[] = [];
  // A species-correction `Effect` is attached independently to EVERY
  // requesting sibling row's own `EditPlan` (each row's `analyzeEdit` call
  // re-derives the full tree membership), so surfacing one copy per rowPlan
  // here would double/triple-count the SAME tree correction in
  // `aggregateEffects`. `contributedSpeciesEffectGroupKeys` tracks which
  // (treeID, censusID) group has already contributed its one copy; every
  // row-local effect (anything `isSpeciesCorrectionEffect` doesn't match) is
  // still surfaced per row exactly as before.
  const contributedSpeciesEffectGroupKeys = new Set<string>();
  for (const rowPlan of rowPlans) {
    if (rowPlan.status === 'invalid') continue;
    if (rowPlan.plan) {
      for (const effect of rowPlan.plan.effects) {
        const owningGroup = groups.find(group => isSpeciesCorrectionEffect(effect, group.correction));
        if (owningGroup) {
          const groupKey = buildSpeciesCorrectionGroupKey(owningGroup.treeID, owningGroup.censusID);
          if (contributedSpeciesEffectGroupKeys.has(groupKey)) continue;
          contributedSpeciesEffectGroupKeys.add(groupKey);
        }
        surfacedEffects.push(effect);
      }
      errors.push(...(rowPlan.plan.errors ?? []).map(error => ({ ...error, rowIndex: rowPlan.rowIndex })));
    }
  }
  // Group errors already carry their own rowIndex/rowIndexes/treeID (set by
  // `bulkspeciesgroups.ts`) describing every row involved in the batch-level
  // blocker, so — unlike the per-row errors above — they must NOT be
  // remapped to a single rowPlan's rowIndex.
  errors.push(...mergedGroupErrors);

  const aggregateEffects = aggregateByRuleID(surfacedEffects);
  const effectSeverity = aggregateEffects.reduce<Severity>((max, e) => (SEVERITY_RANK[e.severity] > SEVERITY_RANK[max] ? e.severity : max), 'info');
  const errorSeverity = errors.reduce<Severity>((max, e) => (SEVERITY_RANK[e.severity] > SEVERITY_RANK[max] ? e.severity : max), 'info');
  const maxSeverity: Severity = SEVERITY_RANK[errorSeverity] > SEVERITY_RANK[effectSeverity] ? errorSeverity : effectSeverity;

  const plan: BulkEditPlan = {
    dataType,
    rowCount: rowPlans.length,
    rowPlans,
    aggregateEffects,
    errors,
    canApply: errors.length === 0,
    maxSeverity,
    planHash: '',
    generatedAt: new Date().toISOString(),
    duplicateDeletions: [...input.duplicateMeasurementIDsToDelete],
    ...(groups.length > 0 ? { speciesCorrectionGroups: groups } : {})
  };
  plan.planHash = hashPlan(plan);
  return plan;
}

export function assertBulkPlanCanApply(plan: BulkEditPlan): void {
  const roleErrors = (plan.errors ?? []).filter(isRoleForbiddenPreviewError).filter(error => error.blocking);
  if (roleErrors.length > 0) {
    throw new RoleForbiddenFieldError(
      roleErrors.map(e => e.field),
      roleErrors[0].role
    );
  }
  if (plan.canApply === false) {
    throw new BulkPlanUnapplicableError((plan.errors ?? []).filter(e => e.blocking));
  }
}

function aggregateByRuleID(effects: Effect[]): Effect[] {
  const buckets = new Map<string, Effect[]>();
  for (const effect of effects) {
    const list = buckets.get(effect.id) ?? [];
    list.push(effect);
    buckets.set(effect.id, list);
  }
  const out: Effect[] = [];
  for (const [id, list] of buckets) {
    const sumRows = list.reduce((acc, e) => acc + e.affectedRowCount, 0);
    const maxSeverity = list.reduce<Severity>((m, e) => (SEVERITY_RANK[e.severity] > SEVERITY_RANK[m] ? e.severity : m), 'info');
    out.push({
      id,
      severity: maxSeverity,
      category: list[0].category,
      title: list[0].title,
      detail: `${list.length} row(s) affected · ${sumRows} downstream row(s)`,
      affectedTable: list[0].affectedTable,
      affectedRowCount: sumRows
    });
  }
  return out;
}
