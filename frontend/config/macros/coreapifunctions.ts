import { NextRequest, NextResponse } from 'next/server';
import ConnectionManager from '@/config/connectionmanager';
import { AllTaxonomiesViewQueryConfig, handleUpsertForSlices } from '@/components/processors/processorhelperfunctions';
import MapperFactory from '@/config/datamapper';
import { getUpdatedValues, handleUpsert } from '@/config/utils';
import { format } from 'mysql2/promise';
import { HTTPResponses } from '@/config/macros';
import { handleError } from '@/utils/errorhandler';
import { FamilyResult, GenusResult, SpeciesResult } from '@/config/sqlrdsdefinitions/taxonomies';
import { getCookie } from '@/app/actions/cookiemanager';
import { CMAttributesResult } from '@/config/sqlrdsdefinitions/core';
import ailogger from '@/ailogger';
import { insertIngestionFailureRows, refreshIngestionErrorsForMeasurement } from '@/config/measurementerrors';

// Mapping from dataType to primary key column name
const PRIMARY_KEY_MAP: Record<string, string> = {
  failedmeasurements: 'FailedMeasurementID',
  coremeasurements: 'CoreMeasurementID',
  attributes: 'Code',
  census: 'CensusID',
  cmattributes: 'CMAID',
  family: 'FamilyID',
  genus: 'GenusID',
  personnel: 'PersonnelID',
  plots: 'PlotID',
  quadrats: 'QuadratID',
  species: 'SpeciesID',
  stems: 'StemGUID',
  trees: 'TreeID',
  rolemapping: 'RoleMappingID',
  roles: 'RoleID',
  sites: 'SiteID'
};

type MeasurementSummaryStructure = {
  TreeTag?: string | null;
  CensusID?: number | null;
  SpeciesID?: number | null;
  TreeID?: number | null;
  StemTag?: string | null;
  StemGUID?: number | null;
  QuadratID?: number | null;
  StemLocalX?: number | null;
  StemLocalY?: number | null;
  PlotID?: number | null;
  QuadratName?: string | null;
};

function toPositiveNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function normalizeMeasurementSummaryDate(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date && !isNaN(value.getTime())) {
    return value.toISOString().split('T')[0];
  }
  if (typeof value === 'string') {
    if (!value.includes('T')) return value;
    const parsed = new Date(value);
    if (!isNaN(parsed.getTime())) {
      return parsed.toISOString().split('T')[0];
    }
  }
  return null;
}

type TreeStemStateLabel = 'old tree' | 'multi stem' | 'new recruit';

async function computeTreeStemState(
  connectionManager: ConnectionManager,
  schema: string,
  treeTag: string,
  stemTag: string,
  currentCensusID: number,
  plotID: number,
  transactionID?: string
): Promise<TreeStemStateLabel> {
  // Find the previous census for this plot (same logic as bulkingestionprocess Stage 4)
  const prevCensusRows = await connectionManager.executeQuery(
    `SELECT c_prev.CensusID
     FROM ${schema}.census c_curr
     INNER JOIN ${schema}.census c_prev
       ON c_prev.PlotID = c_curr.PlotID
       AND c_prev.PlotCensusNumber = c_curr.PlotCensusNumber - 1
       AND c_prev.IsActive = 1
     WHERE c_curr.CensusID = ?
       AND c_curr.PlotID = ?
       AND c_curr.IsActive = 1
     ORDER BY c_prev.CensusID DESC
     LIMIT 1`,
    [currentCensusID, plotID],
    transactionID
  );

  if (prevCensusRows.length === 0) {
    // No previous census exists — every row is a new recruit
    return 'new recruit';
  }

  const previousCensusID = prevCensusRows[0].CensusID;

  // Check for previous stem match (TreeTag + StemTag in the previous census)
  const prevStemMatch = await connectionManager.executeQuery(
    `SELECT COUNT(*) AS MatchCount
     FROM ${schema}.stems s
     INNER JOIN ${schema}.trees t
       ON s.TreeID = t.TreeID AND s.CensusID = t.CensusID
     WHERE t.TreeTag = ?
       AND s.StemTag = ?
       AND t.CensusID = ?
       AND t.IsActive = 1
       AND s.IsActive = 1`,
    [treeTag, stemTag, previousCensusID],
    transactionID
  );

  if (prevStemMatch[0]?.MatchCount > 0) {
    return 'old tree';
  }

  // Check for previous tree match (TreeTag only in the previous census)
  const prevTreeMatch = await connectionManager.executeQuery(
    `SELECT COUNT(*) AS MatchCount
     FROM ${schema}.trees t
     WHERE t.TreeTag = ?
       AND t.CensusID = ?
       AND t.IsActive = 1`,
    [treeTag, previousCensusID],
    transactionID
  );

  if (prevTreeMatch[0]?.MatchCount > 0) {
    return 'multi stem';
  }

  return 'new recruit';
}

async function resolveMeasurementSummaryQuadratID(
  connectionManager: ConnectionManager,
  schema: string,
  quadratData: Pick<MeasurementSummaryStructure, 'QuadratID' | 'QuadratName' | 'PlotID'>,
  transactionID?: string
): Promise<number> {
  const quadratID = toPositiveNumber(quadratData.QuadratID);
  if (quadratID !== null) return quadratID;

  const plotID = toPositiveNumber(quadratData.PlotID);
  const quadratName = quadratData.QuadratName?.trim();
  if (!plotID) throw new Error('Plot not found for quadrat lookup');
  if (!quadratName) throw new Error('Quadrat not found for stem resolution');

  const quadratSearchResults = await connectionManager.executeQuery(
    `SELECT QuadratID
     FROM ${schema}.quadrats
     WHERE LOWER(QuadratName) = LOWER(?)
       AND PlotID = ?
       AND IsActive = 1
     ORDER BY QuadratID
     LIMIT 1`,
    [quadratName, plotID],
    transactionID
  );
  if (quadratSearchResults.length === 0) throw new Error('Quadrat not found');
  return quadratSearchResults[0].QuadratID;
}

async function resolveMeasurementSummaryTree(
  connectionManager: ConnectionManager,
  schema: string,
  treeData: Pick<MeasurementSummaryStructure, 'TreeTag' | 'SpeciesID' | 'CensusID'>,
  transactionID?: string
): Promise<number> {
  const { TreeTag, SpeciesID, CensusID } = treeData;
  if (!TreeTag) throw new Error('TreeTag not found for tree resolution');
  const normalizedSpeciesID = toPositiveNumber(SpeciesID);
  const normalizedCensusID = toPositiveNumber(CensusID);
  if (normalizedSpeciesID === null) throw new Error('Species not found for tree resolution');
  if (normalizedCensusID === null) throw new Error('Census not found for tree resolution');

  const matchingTreeRows = await connectionManager.executeQuery(
    `SELECT TreeID, IsActive
     FROM ${schema}.trees
     WHERE TreeTag = ? AND SpeciesID = ? AND CensusID = ?
     ORDER BY TreeID
     LIMIT 1`,
    [TreeTag, normalizedSpeciesID, normalizedCensusID],
    transactionID
  );
  if (matchingTreeRows.length > 0) {
    const matchingTree = matchingTreeRows[0];
    if (!matchingTree.IsActive) throw new Error(`Tree resolution failed: matching tree exists but is inactive for TreeTag "${TreeTag}"`);
    return matchingTree.TreeID;
  }

  const insertResult = await connectionManager.executeQuery(
    format(`INSERT INTO ?? SET ?`, [`${schema}.trees`, { TreeTag, SpeciesID: normalizedSpeciesID, CensusID: normalizedCensusID, IsActive: 1 }]),
    [],
    transactionID
  );
  return insertResult.insertId;
}

async function resolveMeasurementSummaryStem(
  connectionManager: ConnectionManager,
  schema: string,
  stemData: Pick<MeasurementSummaryStructure, 'TreeID' | 'TreeTag' | 'CensusID' | 'StemTag' | 'QuadratID' | 'StemLocalX' | 'StemLocalY'>,
  transactionID?: string
): Promise<number> {
  const { TreeID, TreeTag, CensusID, StemTag, QuadratID, StemLocalX, StemLocalY } = stemData;
  const normalizedTreeID = toPositiveNumber(TreeID);
  const normalizedCensusID = toPositiveNumber(CensusID);
  const normalizedQuadratID = toPositiveNumber(QuadratID);
  if (normalizedTreeID === null) throw new Error('Tree not found for stem resolution');
  if (normalizedCensusID === null) throw new Error('Census not found for stem resolution');
  if (!StemTag) throw new Error('StemTag not found for stem resolution');
  if (normalizedQuadratID === null) throw new Error('Quadrat not found for stem resolution');

  const exactActiveStemRows = await connectionManager.executeQuery(
    `SELECT StemGUID
     FROM ${schema}.stems
     WHERE TreeID = ? AND CensusID = ? AND StemTag <=> ? AND QuadratID <=> ? AND IsActive = 1
     LIMIT 1`,
    [normalizedTreeID, normalizedCensusID, StemTag, normalizedQuadratID],
    transactionID
  );
  if (exactActiveStemRows.length > 0) return exactActiveStemRows[0].StemGUID;

  const blockingStemRows = await connectionManager.executeQuery(
    `SELECT StemGUID, QuadratID, IsActive
     FROM ${schema}.stems
     WHERE TreeID = ? AND CensusID = ? AND StemTag <=> ?
     ORDER BY StemGUID
     LIMIT 1`,
    [normalizedTreeID, normalizedCensusID, StemTag],
    transactionID
  );
  if (blockingStemRows.length > 0) {
    const blockingStem = blockingStemRows[0];
    if (!blockingStem.IsActive) {
      throw new Error(`Stem resolution failed: matching TreeID ${normalizedTreeID} / StemTag "${StemTag}" exists but is inactive for this census`);
    }
    if (blockingStem.QuadratID !== normalizedQuadratID) {
      throw new Error(
        `Stem resolution failed: TreeTag "${TreeTag ?? normalizedTreeID}" / StemTag "${StemTag}" already exists in a different quadrat for this census`
      );
    }
    return blockingStem.StemGUID;
  }

  const insertResult = await connectionManager.executeQuery(
    format(`INSERT INTO ?? SET ?`, [
      `${schema}.stems`,
      {
        TreeID: normalizedTreeID,
        QuadratID: normalizedQuadratID,
        CensusID: normalizedCensusID,
        StemTag,
        LocalX: StemLocalX ?? null,
        LocalY: StemLocalY ?? null,
        IsActive: 1
      }
    ]),
    [],
    transactionID
  );
  return insertResult.insertId;
}

export async function PATCH(request: NextRequest, props: { params: Promise<{ dataType: string; slugs?: string[] }> }) {
  const { dataType, slugs } = await props.params;
  const [schema, gridID] = slugs ?? [];
  if (!schema || !gridID) throw new Error('no schema or gridID provided');

  const connectionManager = ConnectionManager.getInstance();
  // Get the primary key column name for this dataType, or fallback to capitalized gridID
  const primaryKeyColumn = PRIMARY_KEY_MAP[dataType] || gridID.charAt(0).toUpperCase() + gridID.substring(1);
  const demappedGridID = primaryKeyColumn;
  const { newRow, oldRow } = await request.json();
  let updateIDs: Record<string, number> = {};
  let transactionID: string | undefined = undefined;

  try {
    transactionID = await connectionManager.beginTransaction();

    if (dataType === 'alltaxonomiesview') {
      let queryConfig;
      switch (dataType) {
        case 'alltaxonomiesview':
          queryConfig = AllTaxonomiesViewQueryConfig;
          break;
        default:
          throw new Error('Incorrect view call');
      }

      updateIDs = await handleUpsertForSlices(connectionManager, schema, { ...oldRow, ...newRow }, queryConfig);
    } else {
      if (dataType === 'measurementssummary') {
        const mappedOldRow = MapperFactory.getMapper<any, any>('measurementssummary').demapData([oldRow])[0];
        const mappedUpdatedRow = MapperFactory.getMapper<any, any>('measurementssummary').demapData([
          {
            ...Object.fromEntries(Object.entries(oldRow).filter(([, val]) => val !== undefined && val !== null)),
            ...Object.fromEntries(Object.entries(newRow).filter(([, val]) => val !== undefined && val !== null))
          }
        ])[0];
        let changesFound = false;
        const updatedFields = {
          ...Object.fromEntries(Object.entries(getUpdatedValues(mappedOldRow, mappedUpdatedRow)).filter(([, val]: any) => val !== undefined && val !== null))
        };
        const normalizedMeasurementDate = normalizeMeasurementSummaryDate(mappedUpdatedRow.MeasurementDate ?? mappedOldRow.MeasurementDate ?? null);
        const hasUpdatedField = (field: string) => Object.prototype.hasOwnProperty.call(updatedFields, field);
        const shouldResolveTree = hasUpdatedField('SpeciesCode') || hasUpdatedField('TreeTag');
        const previousTreeID = toPositiveNumber(mappedOldRow.TreeID ?? mappedUpdatedRow.TreeID);
        // Full stem resolution (find-or-create) only when the stem identity
        // changes: TreeTag, QuadratName, or StemTag. A species-code-only change
        // still needs destination-stem resolution so we never mutate an
        // existing stem row into a conflicting destination tree.
        const needsFullStemResolution = hasUpdatedField('TreeTag') || hasUpdatedField('QuadratName') || hasUpdatedField('StemTag');

        if (hasUpdatedField('SpeciesCode')) {
          changesFound = true;
          const speciesSearchResults = await connectionManager.executeQuery(
            `SELECT SpeciesID
             FROM ${schema}.species
             WHERE LOWER(SpeciesCode) = LOWER(?)
               AND IsActive = 1
             ORDER BY SpeciesID
             LIMIT 1`,
            [updatedFields.SpeciesCode],
            transactionID
          );
          if (speciesSearchResults.length === 0) throw new Error('Species not found');
          mappedUpdatedRow.SpeciesID = speciesSearchResults[0].SpeciesID;
          if (hasUpdatedField('SpeciesName') || hasUpdatedField('SubspeciesName')) {
            await connectionManager.executeQuery(
              'UPDATE ?? SET ? WHERE SpeciesID = ?',
              [
                `${schema}.species`,
                {
                  SpeciesName: updatedFields.SpeciesName ?? mappedUpdatedRow.SpeciesName,
                  SubspeciesName: updatedFields.SubspeciesName ?? mappedUpdatedRow.SubspeciesName
                },
                mappedUpdatedRow.SpeciesID
              ],
              transactionID
            );
          }
        }
        if (hasUpdatedField('TreeTag')) {
          changesFound = true;
        }

        if (hasUpdatedField('QuadratName')) {
          changesFound = true;
          mappedUpdatedRow.QuadratID = await resolveMeasurementSummaryQuadratID(
            connectionManager,
            schema,
            {
              QuadratID: null,
              QuadratName: updatedFields.QuadratName,
              PlotID: mappedUpdatedRow.PlotID ?? mappedOldRow.PlotID
            },
            transactionID
          );
        }

        if (shouldResolveTree) {
          mappedUpdatedRow.TreeID = await resolveMeasurementSummaryTree(
            connectionManager,
            schema,
            {
              TreeTag: mappedUpdatedRow.TreeTag ?? mappedOldRow.TreeTag,
              SpeciesID: mappedUpdatedRow.SpeciesID ?? mappedOldRow.SpeciesID,
              CensusID: mappedUpdatedRow.CensusID ?? mappedOldRow.CensusID
            },
            transactionID
          );
        }

        const resolvedTreeID = toPositiveNumber(mappedUpdatedRow.TreeID ?? mappedOldRow.TreeID);
        const needsStemResolution = needsFullStemResolution || (resolvedTreeID !== null && resolvedTreeID !== previousTreeID);

        if (needsStemResolution) {
          changesFound = true;
          const resolvedQuadratID = await resolveMeasurementSummaryQuadratID(
            connectionManager,
            schema,
            {
              QuadratID: mappedUpdatedRow.QuadratID ?? mappedOldRow.QuadratID,
              QuadratName: mappedUpdatedRow.QuadratName ?? mappedOldRow.QuadratName,
              PlotID: mappedUpdatedRow.PlotID ?? mappedOldRow.PlotID
            },
            transactionID
          );
          mappedUpdatedRow.QuadratID = resolvedQuadratID;
          const resolvedStemGUID = await resolveMeasurementSummaryStem(
            connectionManager,
            schema,
            {
              TreeID: mappedUpdatedRow.TreeID ?? mappedOldRow.TreeID,
              TreeTag: mappedUpdatedRow.TreeTag ?? mappedOldRow.TreeTag,
              CensusID: mappedUpdatedRow.CensusID ?? mappedOldRow.CensusID,
              StemTag: mappedUpdatedRow.StemTag ?? mappedOldRow.StemTag,
              QuadratID: resolvedQuadratID,
              StemLocalX: hasUpdatedField('StemLocalX') ? updatedFields.StemLocalX : mappedUpdatedRow.StemLocalX,
              StemLocalY: hasUpdatedField('StemLocalY') ? updatedFields.StemLocalY : mappedUpdatedRow.StemLocalY
            },
            transactionID
          );
          if (resolvedStemGUID !== mappedUpdatedRow.StemGUID) {
            await connectionManager.executeQuery(
              format(`UPDATE ?? SET ? WHERE ?? = ?`, [
                `${schema}.coremeasurements`,
                { StemGUID: resolvedStemGUID },
                'CoreMeasurementID',
                mappedUpdatedRow.CoreMeasurementID
              ]),
              [],
              transactionID
            );
          }
          mappedUpdatedRow.StemGUID = resolvedStemGUID;

          // Recompute treestemstate — hard-failed rows never got this during
          // ingestion (they fail before Stage 4 classification), so corrected
          // rows would remain hidden in View Data without it.
          const resolvedTreeTag = String(mappedUpdatedRow.TreeTag ?? mappedOldRow.TreeTag ?? '');
          const resolvedStemTag = String(mappedUpdatedRow.StemTag ?? mappedOldRow.StemTag ?? '');
          const resolvedCensusID = toPositiveNumber(mappedUpdatedRow.CensusID ?? mappedOldRow.CensusID);
          const resolvedPlotID = toPositiveNumber(mappedUpdatedRow.PlotID ?? mappedOldRow.PlotID);
          const coreMeasurementID = mappedUpdatedRow.CoreMeasurementID;

          if (resolvedTreeTag && resolvedStemTag && resolvedCensusID && resolvedPlotID && coreMeasurementID) {
            const treeStemState = await computeTreeStemState(
              connectionManager,
              schema,
              resolvedTreeTag,
              resolvedStemTag,
              resolvedCensusID,
              resolvedPlotID,
              transactionID
            );

            // Read existing UserDefinedFields and merge treestemstate
            const existingUDFRows = await connectionManager.executeQuery(
              `SELECT UserDefinedFields FROM ${schema}.coremeasurements WHERE CoreMeasurementID = ?`,
              [coreMeasurementID],
              transactionID
            );
            const rawUDF = existingUDFRows?.[0]?.UserDefinedFields;
            const currentFields: Record<string, unknown> = rawUDF ? (typeof rawUDF === 'string' ? JSON.parse(rawUDF) : rawUDF) : {};
            currentFields.treestemstate = treeStemState;

            await connectionManager.executeQuery(
              format(`UPDATE ?? SET ? WHERE ?? = ?`, [
                `${schema}.coremeasurements`,
                { UserDefinedFields: JSON.stringify(currentFields) },
                'CoreMeasurementID',
                coreMeasurementID
              ]),
              [],
              transactionID
            );
          }
        }

        if (hasUpdatedField('StemLocalX') || hasUpdatedField('StemLocalY')) {
          changesFound = true;
          await connectionManager.executeQuery(
            format(`UPDATE ?? SET ? WHERE ?? = ?`, [
              `${schema}.stems`,
              {
                LocalX: hasUpdatedField('StemLocalX') ? updatedFields.StemLocalX : mappedUpdatedRow.StemLocalX,
                LocalY: hasUpdatedField('StemLocalY') ? updatedFields.StemLocalY : mappedUpdatedRow.StemLocalY
              },
              'StemGUID',
              mappedUpdatedRow.StemGUID
            ]),
            [],
            transactionID
          );
        }

        if (updatedFields.MeasuredDBH || updatedFields.MeasuredHOM || updatedFields.MeasurementDate) {
          changesFound = true;
          await connectionManager.executeQuery(
            format(`UPDATE ?? SET ? WHERE ?? = ?`, [
              `${schema}.coremeasurements`,
              {
                MeasuredDBH: updatedFields.MeasuredDBH ?? mappedUpdatedRow.MeasuredDBH,
                MeasuredHOM: updatedFields.MeasuredHOM ?? mappedUpdatedRow.MeasuredHOM,
                MeasurementDate: normalizedMeasurementDate
              },
              'CoreMeasurementID',
              mappedUpdatedRow.CoreMeasurementID
            ]),
            [],
            transactionID
          );
        }

        if (updatedFields.Attributes) {
          changesFound = true;
          const parsedCodes = updatedFields.Attributes.split(';')
            .map((code: string) => code.trim())
            .filter(Boolean);
          await connectionManager.executeQuery(
            `DELETE FROM ?? WHERE ?? = ?`,
            [`${schema}.cmattributes`, `CoreMeasurementID`, mappedOldRow.CoreMeasurementID],
            transactionID
          );
          if (parsedCodes.length === 0) {
            ailogger.error('No valid attribute codes found:', updatedFields.Attributes);
          } else {
            for (const code of parsedCodes) {
              await handleUpsert<CMAttributesResult>(
                connectionManager,
                schema,
                'cmattributes',
                {
                  CoreMeasurementID: mappedOldRow.CoreMeasurementID,
                  Code: code
                },
                'CMAID',
                transactionID
              );
            }
          }
        }

        if (
          hasUpdatedField('TreeTag') ||
          hasUpdatedField('StemTag') ||
          hasUpdatedField('SpeciesCode') ||
          hasUpdatedField('QuadratName') ||
          hasUpdatedField('StemLocalX') ||
          hasUpdatedField('StemLocalY') ||
          hasUpdatedField('MeasuredDBH') ||
          hasUpdatedField('MeasuredHOM') ||
          hasUpdatedField('MeasurementDate') ||
          hasUpdatedField('Description') ||
          hasUpdatedField('Attributes')
        ) {
          changesFound = true;
          await connectionManager.executeQuery(
            format(`UPDATE ?? SET ? WHERE ?? = ?`, [
              `${schema}.coremeasurements`,
              {
                RawTreeTag: mappedUpdatedRow.TreeTag ?? mappedOldRow.TreeTag ?? null,
                RawStemTag: mappedUpdatedRow.StemTag ?? mappedOldRow.StemTag ?? null,
                RawSpCode: mappedUpdatedRow.SpeciesCode ?? mappedOldRow.SpeciesCode ?? null,
                RawQuadrat: mappedUpdatedRow.QuadratName ?? mappedOldRow.QuadratName ?? null,
                RawX: mappedUpdatedRow.StemLocalX ?? mappedOldRow.StemLocalX ?? null,
                RawY: mappedUpdatedRow.StemLocalY ?? mappedOldRow.StemLocalY ?? null,
                RawCodes: mappedUpdatedRow.Attributes ?? mappedOldRow.Attributes ?? null,
                RawComments: mappedUpdatedRow.Description ?? mappedOldRow.Description ?? null,
                Description: mappedUpdatedRow.Description ?? mappedOldRow.Description ?? null,
                MeasurementDate: normalizedMeasurementDate,
                MeasuredDBH: mappedUpdatedRow.MeasuredDBH ?? mappedOldRow.MeasuredDBH ?? null,
                MeasuredHOM: mappedUpdatedRow.MeasuredHOM ?? mappedOldRow.MeasuredHOM ?? null
              },
              'CoreMeasurementID',
              mappedUpdatedRow.CoreMeasurementID
            ]),
            [],
            transactionID
          );
        }

        if (changesFound) {
          const measurementID = Number(mappedUpdatedRow.CoreMeasurementID ?? mappedOldRow.CoreMeasurementID ?? 0);
          const censusID = Number(mappedUpdatedRow.CensusID ?? mappedOldRow.CensusID ?? 0);

          if (measurementID > 0 && censusID > 0) {
            await refreshIngestionErrorsForMeasurement(
              connectionManager,
              schema,
              measurementID,
              censusID,
              {
                Tag: mappedUpdatedRow.TreeTag ?? mappedOldRow.TreeTag ?? null,
                StemTag: mappedUpdatedRow.StemTag ?? mappedOldRow.StemTag ?? null,
                SpCode: mappedUpdatedRow.SpeciesCode ?? mappedOldRow.SpeciesCode ?? null,
                Quadrat: mappedUpdatedRow.QuadratName ?? mappedOldRow.QuadratName ?? null,
                X: mappedUpdatedRow.StemLocalX ?? mappedOldRow.StemLocalX ?? null,
                Y: mappedUpdatedRow.StemLocalY ?? mappedOldRow.StemLocalY ?? null,
                DBH: mappedUpdatedRow.MeasuredDBH ?? mappedOldRow.MeasuredDBH ?? null,
                HOM: mappedUpdatedRow.MeasuredHOM ?? mappedOldRow.MeasuredHOM ?? null,
                Date: normalizedMeasurementDate,
                Codes: mappedUpdatedRow.Attributes ?? mappedOldRow.Attributes ?? null,
                Comments: mappedUpdatedRow.Description ?? mappedOldRow.Description ?? null
              },
              transactionID
            );
          }

          const deleteErrorsQuery = format(
            `DELETE mel
             FROM ??.measurement_error_log mel
             JOIN ??.measurement_errors me ON me.ErrorID = mel.ErrorID
             WHERE mel.MeasurementID = ? AND me.ErrorSource = 'validation'`,
            [schema, schema]
          );
          await connectionManager.executeQuery(deleteErrorsQuery, [mappedUpdatedRow.CoreMeasurementID], transactionID);

          const resetValidationQuery = format('/* skip_changelog */ UPDATE ?? SET ?? = ? WHERE ?? = ?', [
            `${schema}.coremeasurements`,
            'IsValidated',
            null,
            'CoreMeasurementID',
            mappedUpdatedRow.CoreMeasurementID
          ]);
          await connectionManager.executeQuery(resetValidationQuery, [], transactionID);
        }
      } else {
        const mapper = MapperFactory.getMapper<any, any>(dataType);
        const oldRowData = mapper.demapData([oldRow])[0];
        const newRowData = mapper.demapData([{ ...oldRow, ...newRow }])[0];
        const previousGridIDKey = oldRowData?.[demappedGridID];
        const { [demappedGridID]: updatedGridIDKey, ...remainingProperties } = newRowData;

        let dataToUpdate;
        const censusID = parseInt((await getCookie('censusID')) ?? '0');

        if (dataType === 'failedmeasurements') {
          const { Hash_ID, ...failedTrimmed } = newRowData;
          if (failedTrimmed['CurrentFailureReasons'] == null && failedTrimmed['FailureReasons'] != null) {
            failedTrimmed['CurrentFailureReasons'] = failedTrimmed['FailureReasons'];
          }
          if (failedTrimmed['FailureReasons'] == null && failedTrimmed['CurrentFailureReasons'] != null) {
            failedTrimmed['FailureReasons'] = failedTrimmed['CurrentFailureReasons'];
          }
          failedTrimmed['LastValidatedAt'] = null;
          // Convert Date from ISO format to MySQL format (YYYY-MM-DD)
          if (failedTrimmed['Date']) {
            const date = new Date(failedTrimmed['Date']);
            if (!isNaN(date.getTime())) {
              // Format as YYYY-MM-DD for MySQL DATE column
              failedTrimmed['Date'] = date.toISOString().split('T')[0];
            }
          }
          const failedMeasurementID = Number(updatedGridIDKey);
          const updateFailedQuery = format(
            `UPDATE ??.coremeasurements
             SET RawTreeTag = ?, RawStemTag = ?, RawSpCode = ?, RawQuadrat = ?,
                 RawX = ?, RawY = ?, MeasuredDBH = ?, MeasuredHOM = ?, MeasurementDate = ?,
                 RawCodes = ?, RawComments = ?, Description = ?, UploadFileID = COALESCE(?, UploadFileID),
                 UploadBatchID = COALESCE(?, UploadBatchID), IsValidated = FALSE
             WHERE CoreMeasurementID = ? AND StemGUID IS NULL`,
            [schema]
          );
          await connectionManager.executeQuery(updateFailedQuery, [
            failedTrimmed['Tag'] ?? null,
            failedTrimmed['StemTag'] ?? null,
            failedTrimmed['SpCode'] ?? null,
            failedTrimmed['Quadrat'] ?? null,
            failedTrimmed['X'] ?? null,
            failedTrimmed['Y'] ?? null,
            failedTrimmed['DBH'] ?? null,
            failedTrimmed['HOM'] ?? null,
            failedTrimmed['Date'] ?? null,
            failedTrimmed['Codes'] ?? null,
            failedTrimmed['Comments'] ?? null,
            failedTrimmed['Comments'] ?? null,
            failedTrimmed['FileID'] ?? null,
            failedTrimmed['BatchID'] ?? null,
            failedMeasurementID
          ]);

          // Revalidate the edited row and refresh current ingestion errors
          // without destroying the row's historical error trail.
          const validationErrors = await refreshIngestionErrorsForMeasurement(
            connectionManager,
            schema,
            failedMeasurementID,
            censusID,
            {
              Tag: failedTrimmed['Tag'],
              StemTag: failedTrimmed['StemTag'],
              SpCode: failedTrimmed['SpCode'],
              Quadrat: failedTrimmed['Quadrat'],
              X: failedTrimmed['X'],
              Y: failedTrimmed['Y'],
              DBH: failedTrimmed['DBH'],
              HOM: failedTrimmed['HOM'],
              Date: failedTrimmed['Date'],
              Codes: failedTrimmed['Codes'],
              Comments: failedTrimmed['Comments']
            },
            transactionID
          );

          // Update Description with concatenated current failure reasons
          if (validationErrors.length > 0) {
            const descriptionText = validationErrors.map(e => e.errorMessage).join('; ');
            const updateDescQuery = format('UPDATE ??.coremeasurements SET Description = ? WHERE CoreMeasurementID = ?', [schema]);
            await connectionManager.executeQuery(updateDescQuery, [descriptionText, failedMeasurementID], transactionID);
          }

          updateIDs = { [dataType]: failedMeasurementID };
          await connectionManager.commitTransaction(transactionID ?? '');
          return NextResponse.json({ message: 'Update successful', updatedIDs: updateIDs }, { status: HTTPResponses.OK });
        } else if (dataType === 'plots') {
          const { NumQuadrats, ...plotTrimmed } = newRowData;
          dataToUpdate = plotTrimmed;
        } else if (dataType === 'attributes') {
          dataToUpdate = {
            [demappedGridID]: updatedGridIDKey,
            ...remainingProperties
          };
        } else if (['quadrats', 'species'].includes(dataType)) {
          const { CensusID, ...specTrimmed } = newRowData;
          dataToUpdate = specTrimmed;
        } else if (dataType === 'personnel') {
          const { CensusActive, ...personnelTrimmed } = newRowData;
          const hasCensusActiveFlag =
            Object.prototype.hasOwnProperty.call(oldRowData ?? {}, 'CensusActive') || Object.prototype.hasOwnProperty.call(newRowData, 'CensusActive');
          if (hasCensusActiveFlag) {
            if (!Number.isInteger(censusID) || censusID <= 0) {
              throw new Error('Census context required to update personnel census activity');
            }
            const query = CensusActive
              ? `INSERT IGNORE INTO ${schema}.censusactivepersonnel (CensusID, PersonnelID) VALUES (?, ?);`
              : `DELETE FROM ${schema}.censusactivepersonnel WHERE CensusID = ? AND PersonnelID = ?`;
            await connectionManager.executeQuery(query, [censusID, previousGridIDKey]);
          }
          dataToUpdate = personnelTrimmed;
        } else dataToUpdate = remainingProperties;

        const updateQuery = format(`UPDATE ?? SET ? WHERE ?? = ?`, [`${schema}.${dataType}`, dataToUpdate, demappedGridID, previousGridIDKey]);
        await connectionManager.executeQuery(`SET @CURRENT_CENSUS_ID = ?`, [censusID]);
        await connectionManager.executeQuery(updateQuery);

        updateIDs = { [dataType]: updatedGridIDKey };
      }
    }
    await connectionManager.commitTransaction(transactionID ?? '');
    return NextResponse.json({ message: 'Update successful', updatedIDs: updateIDs }, { status: HTTPResponses.OK });
  } catch (error: any) {
    return handleError(error, connectionManager, newRow, transactionID ?? undefined);
  } finally {
    await connectionManager.closeConnection();
  }
}

export async function POST(request: NextRequest, props: { params: Promise<{ dataType: string; slugs?: string[] }> }) {
  const params = await props.params;
  if (!params.slugs) throw new Error('slugs not provided');
  const [schema, gridID, _plotIDParam, censusIDParam] = params.slugs;
  if (!schema || !gridID) throw new Error('no schema or gridID provided');

  const censusID = censusIDParam ? parseInt(censusIDParam) : undefined;

  const connectionManager = ConnectionManager.getInstance();
  const { newRow } = await request.json();
  let insertIDs: Record<string, number> = {};
  let transactionID: string | undefined = undefined;
  try {
    transactionID = await connectionManager.beginTransaction();

    if (Object.keys(newRow).includes('isNew')) delete newRow.isNew;

    const newRowData = MapperFactory.getMapper<any, any>(params.dataType).demapData([newRow])[0];
    const demappedGridID = gridID.charAt(0).toUpperCase() + gridID.substring(1);

    if (params.dataType === 'alltaxonomiesview') {
      const { Family } = newRowData;
      const { Genus, GenusAuthority } = newRowData;
      const { SpeciesCode, SpeciesName, SubspeciesName, IDLevel, SpeciesAuthority, SubspeciesAuthority, ValidCode, FieldFamily, Description } = newRowData;

      const { id: newFamilyID } = await handleUpsert<FamilyResult>(connectionManager, schema, 'family', { Family }, 'FamilyID', transactionID);

      const { id: newGenusID } = await handleUpsert<GenusResult>(
        connectionManager,
        schema,
        'genus',
        {
          Genus,
          GenusAuthority,
          FamilyID: newFamilyID
        },
        'GenusID',
        transactionID
      );

      await handleUpsert<SpeciesResult>(
        connectionManager,
        schema,
        'species',
        {
          GenusID: newGenusID,
          SpeciesCode,
          SpeciesName,
          SubspeciesName,
          IDLevel,
          SpeciesAuthority,
          SubspeciesAuthority,
          ValidCode,
          FieldFamily,
          Description
        },
        'SpeciesID',
        transactionID
      );
    } else if (['attributes', 'quadrats', 'personnel', 'species'].includes(params.dataType)) {
      if (params.dataType === 'attributes') {
        await connectionManager.executeQuery(format(`INSERT INTO ?? SET ?`, [`${schema}.${params.dataType}`, newRowData]));
      } else if (params.dataType === 'personnel') {
        await connectionManager.executeQuery(`INSERT IGNORE INTO ${schema}.censusactivepersonnel (CensusID, PersonnelID) VALUES (?, ?)`, [
          censusID ?? 0,
          newRowData.PersonnelID
        ]);
      } else {
        const { [demappedGridID]: demappedIDValue, ...remaining } = newRowData;
        const insertQuery = format(`INSERT INTO ?? SET ?`, [`${schema}.${params.dataType}`, remaining]);
        await connectionManager.executeQuery(insertQuery);
      }
    } else {
      delete newRowData[demappedGridID];
      if (params.dataType === 'plots') delete newRowData.NumQuadrats;
      if (params.dataType === 'personnel') delete newRowData.CensusActive;

      let insertQuery = '';
      if (params.dataType === 'failedmeasurements') {
        const inserted = await insertIngestionFailureRows(
          connectionManager,
          schema,
          [
            {
              plotID: Number(newRowData.PlotID ?? 0),
              censusID: Number(newRowData.CensusID ?? censusID ?? 0),
              tag: newRowData.Tag ?? null,
              stemTag: newRowData.StemTag ?? null,
              spCode: newRowData.SpCode ?? null,
              quadrat: newRowData.Quadrat ?? null,
              x: newRowData.X ?? null,
              y: newRowData.Y ?? null,
              dbh: newRowData.DBH ?? null,
              hom: newRowData.HOM ?? null,
              date: newRowData.Date ?? null,
              codes: newRowData.Codes ?? null,
              comments: newRowData.Comments ?? null,
              failureReason: newRowData.FailureReasons ?? null,
              fileID: newRowData.FileID ?? null,
              batchID: newRowData.BatchID ?? null,
              sourceRowIndex: newRowData.SourceRowIndex ?? null
            }
          ],
          transactionID
        );
        insertIDs = { [params.dataType]: inserted[0] ?? 0 };
      } else {
        insertQuery = format('INSERT INTO ?? SET ?', [`${schema}.${params.dataType}`, newRowData]);
        const results = await connectionManager.executeQuery(insertQuery);
        insertIDs = { [params.dataType]: results.insertId };
      }
    }
    await connectionManager.commitTransaction(transactionID ?? '');
    return NextResponse.json({ message: 'Insert successful', createdIDs: insertIDs }, { status: HTTPResponses.OK });
  } catch (error: any) {
    return handleError(error, connectionManager, newRow, transactionID ?? undefined);
  } finally {
    await connectionManager.closeConnection();
  }
}

export async function DELETE(request: NextRequest, props: { params: Promise<{ dataType: string; slugs?: string[] }> }) {
  const params = await props.params;
  if (!params.slugs) throw new Error('slugs not provided');
  const [schema, gridID] = params.slugs;
  if (!schema || !gridID) throw new Error('no schema or gridID provided');
  const connectionManager = ConnectionManager.getInstance();
  // Get the primary key column name for this dataType, or fallback to capitalized gridID
  const primaryKeyColumn = PRIMARY_KEY_MAP[params.dataType] || gridID.charAt(0).toUpperCase() + gridID.substring(1);
  const demappedGridID = primaryKeyColumn;
  const { newRow } = await request.json();
  let transactionID: string | undefined = undefined;
  try {
    transactionID = await connectionManager.beginTransaction();

    const deleteRowData = MapperFactory.getMapper<any, any>(params.dataType).demapData([newRow])[0];
    const { [demappedGridID]: gridIDKey } = deleteRowData;
    if (params.dataType === 'alltaxonomiesview') {
      const { SpeciesID } = deleteRowData;
      await connectionManager.executeQuery(`DELETE FROM ${schema}.species WHERE SpeciesID = ?`, [SpeciesID]);
    } else if (params.dataType === 'failedmeasurements') {
      const deleteFailedQuery = format('DELETE FROM ??.coremeasurements WHERE CoreMeasurementID = ? AND StemGUID IS NULL', [schema]);
      await connectionManager.executeQuery(deleteFailedQuery, [gridIDKey]);
    } else if (params.dataType === 'measurementssummary') {
      await connectionManager.executeQuery(format('DELETE FROM ?? WHERE MeasurementID = ?', [`${schema}.measurement_error_log`]), [gridIDKey]);
      await connectionManager.executeQuery(format('DELETE FROM ?? WHERE ?? = ?', [`${schema}.cmattributes`, demappedGridID, gridIDKey]));
      await connectionManager.executeQuery(format('DELETE FROM ?? WHERE ?? = ?', [`${schema}.coremeasurements`, demappedGridID, gridIDKey]));
    } else {
      const softDelete = format(`DELETE FROM ?? WHERE ?? = ?`, [`${schema}.${params.dataType}`, demappedGridID, gridIDKey]);
      await connectionManager.executeQuery(softDelete);
    }
    await connectionManager.commitTransaction(transactionID ?? '');
    return NextResponse.json({ message: 'Delete successful' }, { status: HTTPResponses.OK });
  } catch (error: any) {
    if (error.code === 'ER_ROW_IS_REFERENCED_2') {
      await connectionManager.rollbackTransaction(transactionID ?? '');
      const referencingTableMatch = error.message.match(/CONSTRAINT `(.*?)` FOREIGN KEY \(`(.*?)`\) REFERENCES `(.*?)`/);
      const referencingTable = referencingTableMatch ? referencingTableMatch[3] : 'unknown';
      return NextResponse.json(
        {
          message: 'Foreign key conflict detected',
          referencingTable
        },
        { status: HTTPResponses.FOREIGN_KEY_CONFLICT }
      );
    } else return handleError(error, connectionManager, newRow);
  } finally {
    await connectionManager.closeConnection();
  }
}
