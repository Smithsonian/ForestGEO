import { HTTPResponses } from '@/config/macros';
import { NextRequest, NextResponse } from 'next/server';
import ConnectionManager from '@/config/connectionmanager';
import ailogger from '@/ailogger';
import moment from 'moment';
import { isValidSchema, safeFormatQuery } from '@/config/utils/sqlsecurity';

// Force Node.js runtime for database and Azure SDK compatibility
// mysql2 and @azure/storage-* are not compatible with Edge Runtime
export const runtime = 'nodejs';

// Valid view names for refresh operations
const VALID_VIEWS = ['viewfulltable', 'measurementssummary'] as const;
type ValidView = (typeof VALID_VIEWS)[number];

function isValidView(view: string): view is ValidView {
  return VALID_VIEWS.includes(view as ValidView);
}

async function refreshMeasurementsSummaryForScope(
  connectionManager: typeof ConnectionManager.prototype,
  schema: string,
  plotID: number,
  censusID: number,
  transactionID?: string
): Promise<void> {
  const deleteQuery = safeFormatQuery(schema, 'DELETE FROM ??.measurementssummary WHERE PlotID = ? AND CensusID = ?');
  await connectionManager.executeQuery(deleteQuery, [plotID, censusID], transactionID);

  const insertQuery = safeFormatQuery(
    schema,
    `INSERT IGNORE INTO ??.measurementssummary (CoreMeasurementID,
                                                StemGUID,
                                                TreeID,
                                                SpeciesID,
                                                QuadratID,
                                                PlotID,
                                                CensusID,
                                                SpeciesName,
                                                SubspeciesName,
                                                SpeciesCode,
                                                TreeTag,
                                                StemTag,
                                                StemLocalX,
                                                StemLocalY,
                                                QuadratName,
                                                MeasurementDate,
                                                MeasuredDBH,
                                                MeasuredHOM,
                                                IsValidated,
                                                Description,
                                                Attributes,
                                                UserDefinedFields,
                                                Errors)
     SELECT cm.CoreMeasurementID                                 AS CoreMeasurementID,
            COALESCE(st.StemGUID, cm.StemGUID)                   AS StemGUID,
            t.TreeID                                             AS TreeID,
            sp.SpeciesID                                         AS SpeciesID,
            q.QuadratID                                          AS QuadratID,
            COALESCE(q.PlotID, c.PlotID, 0)                      AS PlotID,
            COALESCE(cm.CensusID, 0)                             AS CensusID,
            sp.SpeciesName                                       AS SpeciesName,
            sp.SubspeciesName                                    AS SubspeciesName,
            COALESCE(sp.SpeciesCode, cm.RawSpCode)               AS SpeciesCode,
            COALESCE(t.TreeTag, cm.RawTreeTag)                   AS TreeTag,
            COALESCE(st.StemTag, cm.RawStemTag)                  AS StemTag,
            COALESCE(st.LocalX, cm.RawX)                         AS StemLocalX,
            COALESCE(st.LocalY, cm.RawY)                         AS StemLocalY,
            COALESCE(q.QuadratName, cm.RawQuadrat)               AS QuadratName,
            cm.MeasurementDate                                   AS MeasurementDate,
            cm.MeasuredDBH                                       AS MeasuredDBH,
            cm.MeasuredHOM                                       AS MeasuredHOM,
            cm.IsValidated                                       AS IsValidated,
            cm.Description                                       AS Description,
            attr_summary.Attributes                              AS Attributes,
            cm.UserDefinedFields                                 AS UserDefinedFields,
            validation_errors.Errors                             AS Errors
     FROM ??.coremeasurements cm
              JOIN ??.census c ON cm.CensusID = c.CensusID
              LEFT JOIN ??.stems st ON cm.StemGUID = st.StemGUID AND st.CensusID = c.CensusID
              LEFT JOIN ??.trees t ON t.CensusID = c.CensusID AND t.TreeID = st.TreeID
              LEFT JOIN ??.species sp ON t.SpeciesID = sp.SpeciesID
              LEFT JOIN ??.quadrats q ON q.QuadratID = st.QuadratID
              LEFT JOIN (
                  SELECT ca.CoreMeasurementID,
                         GROUP_CONCAT(DISTINCT a.Code SEPARATOR '; ') AS Attributes
                  FROM ??.cmattributes ca
                           LEFT JOIN ??.attributes a ON a.Code = ca.Code
                  GROUP BY ca.CoreMeasurementID
              ) attr_summary ON attr_summary.CoreMeasurementID = cm.CoreMeasurementID
              LEFT JOIN (
                  SELECT mel.MeasurementID,
                         GROUP_CONCAT(
                                 COALESCE(
                                         NULLIF(CONCAT_WS(' -> ', NULLIF(vp.ProcedureName, ''), NULLIF(vp.Description, '')), ''),
                                         me.ErrorMessage
                                 )
                                 ORDER BY me.ErrorCode SEPARATOR ';'
                         ) AS Errors
                  FROM ??.measurement_error_log mel
                           JOIN ??.measurement_errors me ON me.ErrorID = mel.ErrorID
                           LEFT JOIN ??.sitespecificvalidations vp ON me.ErrorCode = CAST(vp.ValidationID AS CHAR)
                  WHERE mel.IsResolved = FALSE
                  GROUP BY mel.MeasurementID
              ) validation_errors ON validation_errors.MeasurementID = cm.CoreMeasurementID
     WHERE c.PlotID = ?
       AND cm.CensusID = ?`
  );

  await connectionManager.executeQuery(insertQuery, [plotID, censusID], transactionID);
}

/**
 * Execute all enabled post-validation queries for a given plot and census
 * Updates each query's lastRunAt, lastRunResult, and lastRunStatus
 */
async function _executePostValidationQueries(
  connectionManager: typeof ConnectionManager.prototype,
  schema: string,
  plotID: number,
  censusID: number
): Promise<{ executed: number; success: number; failed: number }> {
  const stats = { executed: 0, success: 0, failed: 0 };

  // Validate schema before any SQL operations
  if (!isValidSchema(schema)) {
    ailogger.error(`Invalid schema in _executePostValidationQueries: ${schema}`);
    return stats;
  }

  try {
    // Fetch all enabled post-validation queries using safe formatting
    const query = safeFormatQuery(schema, 'SELECT QueryID, QueryDefinition FROM ??.postvalidationqueries WHERE IsEnabled IS TRUE');
    const queriesResult = await connectionManager.executeQuery(query);

    if (!queriesResult || queriesResult.length === 0) {
      return stats;
    }

    const replacements: Record<string, string | number> = {
      schema: schema,
      currentPlotID: plotID,
      currentCensusID: censusID
    };

    // Execute each query and update its status
    for (const queryRow of queriesResult) {
      stats.executed++;
      const queryID = queryRow.QueryID;
      const currentTime = moment().format('YYYY-MM-DD HH:mm:ss');

      try {
        // Replace placeholders in query definition with undefined check
        const formattedQuery = queryRow.QueryDefinition.replace(/\${(.*?)}/g, (_match: string, p1: string) => {
          const value = replacements[p1];
          if (value === undefined) {
            throw new Error(`Unknown template variable: ${p1}`);
          }
          return String(value);
        });

        // Execute the validation query
        const queryResults = await connectionManager.executeQuery(formattedQuery);

        if (queryResults && queryResults.length > 0) {
          // Query succeeded with results - use parameterized query
          const successResults = JSON.stringify(queryResults);
          const updateQuery = safeFormatQuery(
            schema,
            'UPDATE ??.postvalidationqueries SET LastRunAt = ?, LastRunResult = ?, LastRunStatus = ? WHERE QueryID = ?'
          );
          await connectionManager.executeQuery(updateQuery, [currentTime, successResults, 'success', queryID]);
          stats.success++;
        } else {
          // Query succeeded but returned no results (treated as failure/no issues found)
          const updateQuery = safeFormatQuery(
            schema,
            'UPDATE ??.postvalidationqueries SET LastRunAt = ?, LastRunResult = NULL, LastRunStatus = ? WHERE QueryID = ?'
          );
          await connectionManager.executeQuery(updateQuery, [currentTime, 'failure', queryID]);
          stats.failed++;
        }
      } catch (queryError) {
        // Query execution failed
        ailogger.error(`Post-validation query ${queryID} failed:`, queryError instanceof Error ? queryError : undefined);
        const updateQuery = safeFormatQuery(schema, 'UPDATE ??.postvalidationqueries SET LastRunAt = ?, LastRunStatus = ? WHERE QueryID = ?');
        await connectionManager.executeQuery(updateQuery, [currentTime, 'failure', queryID]);
        stats.failed++;
      }
    }
  } catch (error) {
    ailogger.error('Error executing post-validation queries:', error instanceof Error ? error : undefined);
  }

  return stats;
}

export async function POST(request: NextRequest, props: { params: Promise<{ view: string; schema: string }> }) {
  const params = await props.params;
  if (!params.schema || params.schema === 'undefined' || !params.view || params.view === 'undefined') {
    return new NextResponse(JSON.stringify({ error: 'Missing schema or view parameter' }), { status: HTTPResponses.INVALID_REQUEST });
  }

  const { view, schema } = params;

  // SQL Injection Prevention: Validate schema against whitelist
  if (!isValidSchema(schema)) {
    ailogger.warn(`Invalid schema attempted in refreshviews: ${schema}`);
    return new NextResponse(JSON.stringify({ error: 'Invalid schema' }), { status: HTTPResponses.INVALID_REQUEST });
  }

  // Validate view name against whitelist
  if (!isValidView(view)) {
    ailogger.warn(`Invalid view attempted: ${view}`);
    return new NextResponse(JSON.stringify({ error: 'Invalid view name' }), { status: HTTPResponses.INVALID_REQUEST });
  }

  // Parse optional plotID and censusID from request body for post-validation execution
  let _plotID: number | undefined;
  let _censusID: number | undefined;
  let _runPostValidation = false;

  try {
    const body = await request.json().catch(() => ({}));
    const parsedPlotID = Number(body.plotID);
    const parsedCensusID = Number(body.censusID);

    _plotID = Number.isInteger(parsedPlotID) ? parsedPlotID : undefined;
    _censusID = Number.isInteger(parsedCensusID) ? parsedCensusID : undefined;
    _runPostValidation = body.runPostValidation === true;
  } catch {
    // No body provided, that's fine
  }

  const connectionManager = ConnectionManager.getInstance();
  let transactionID: string | undefined = undefined;

  try {
    transactionID = await connectionManager.beginTransaction();

    // Execute the view refresh procedure - view is validated above against whitelist
    if (view === 'measurementssummary' && _plotID != null && _censusID != null) {
      await refreshMeasurementsSummaryForScope(connectionManager, schema, _plotID, _censusID, transactionID);
    } else {
      const procedureName = view === 'viewfulltable' ? 'RefreshViewFullTable' : 'RefreshMeasurementsSummary';
      const query = safeFormatQuery(schema, `CALL ??.${procedureName}()`);
      await connectionManager.executeQuery(query, undefined, transactionID);
    }

    await connectionManager.commitTransaction(transactionID ?? '');

    // TODO: Post-validation query execution temporarily disabled for refactoring
    // For measurementssummary refresh, automatically run post-validation queries if context is provided
    const postValidationStats = null;
    // if (view === 'measurementssummary' && runPostValidation && plotID && censusID) {
    //   postValidationStats = await executePostValidationQueries(connectionManager, schema, plotID, censusID);
    //   ailogger.info(
    //     `Post-validation queries executed: ${postValidationStats.executed} total, ${postValidationStats.success} success, ${postValidationStats.failed} failed`
    //   );
    // }

    return new NextResponse(
      JSON.stringify({
        success: true,
        postValidation: postValidationStats
      }),
      { status: HTTPResponses.OK }
    );
  } catch (e) {
    await connectionManager.rollbackTransaction(transactionID ?? '');
    ailogger.error('Error:', e instanceof Error ? e : undefined);
    throw new Error('Call failed: ' + (e instanceof Error ? e.message : String(e)));
  } finally {
    await connectionManager.closeConnection();
  }
}
