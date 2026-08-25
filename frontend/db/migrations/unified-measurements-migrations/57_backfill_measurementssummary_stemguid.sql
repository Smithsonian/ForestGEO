-- =====================================================================================
-- Migration Script 57: Backfill measurementssummary.StemGUID drift + procedure collation fix
-- =====================================================================================
-- Purpose:
--   `measurementssummary` is rebuilt by RefreshMeasurementsSummary (TRUNCATE +
--   INSERT IGNORE), but the procedure isn't re-run after every operation that
--   nulls coremeasurements.StemGUID (e.g. cleanup paths, manual repair).
--   Result: ms.StemGUID can stay non-null while cm.StemGUID is NULL — the row
--   is technically a hard failure but the materialized view still points at a
--   stem.
--
--   This drift broke View Errors row editing: errorsexplorer used the stale
--   ms.StemGUID to choose between the measurementssummary and
--   failedmeasurements edit surfaces, then the analyzer's StemGUID-aware
--   loadCurrentRow filtered the row out and threw TargetNotFoundError.
--
--   Live verification on forestgeo_testing_mason at audit time:
--     - 2,125 rows with cm.StemGUID IS NULL
--     - Only 11 rows with ms.StemGUID IS NULL
--     - 2,114 row drift
--
--   Procedure collation bug:
--   The shipped procedure compares `me.ErrorCode = CAST(vp.ValidationID AS CHAR)`.
--   On schemas where the procedure was created with collation_connection
--   utf8mb4_unicode_ci while the columns are utf8mb4_0900_ai_ci, the JOIN
--   throws "Illegal mix of collations". This patch adds an explicit COLLATE
--   so the CAST result matches the column collation.
--
--   Fix:
--   1. Drop and recreate RefreshMeasurementsSummary with explicit COLLATE on
--      the CAST so the JOIN doesn't fail under the schema's column collation.
--   2. Call the procedure (TRUNCATE + INSERT IGNORE rebuilds from
--      coremeasurements, the authoritative source of truth).
-- =====================================================================================

DROP PROCEDURE IF EXISTS RefreshMeasurementsSummary;

DELIMITER $$

CREATE PROCEDURE RefreshMeasurementsSummary()
BEGIN
    SET foreign_key_checks = 0;
    TRUNCATE measurementssummary;
    INSERT IGNORE INTO measurementssummary (CoreMeasurementID,
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
                                            RawCodes,
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
           cm.RawCodes                                          AS RawCodes,
           cm.UserDefinedFields                                 AS UserDefinedFields,
           validation_errors.Errors                             AS Errors
    FROM coremeasurements cm
             JOIN census c ON cm.CensusID = c.CensusID
             LEFT JOIN stems st ON cm.StemGUID = st.StemGUID AND st.CensusID = c.CensusID
             LEFT JOIN trees t ON t.CensusID = c.CensusID AND t.TreeID = st.TreeID
             LEFT JOIN species sp ON t.SpeciesID = sp.SpeciesID
             LEFT JOIN quadrats q ON q.QuadratID = st.QuadratID
             LEFT JOIN (
                 SELECT ca.CoreMeasurementID,
                        GROUP_CONCAT(DISTINCT a.Code SEPARATOR '; ') AS Attributes
                 FROM cmattributes ca
                          LEFT JOIN attributes a ON a.Code = ca.Code
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
                 FROM measurement_error_log mel
                          JOIN measurement_errors me ON me.ErrorID = mel.ErrorID
                          LEFT JOIN sitespecificvalidations vp
                                 ON me.ErrorCode = CAST(vp.ValidationID AS CHAR) COLLATE utf8mb4_0900_ai_ci
                 WHERE mel.IsResolved = FALSE
                 GROUP BY mel.MeasurementID
             ) validation_errors ON validation_errors.MeasurementID = cm.CoreMeasurementID;
    SET foreign_key_checks = 1;
END $$

DELIMITER ;

-- Step 2: Full rebuild — TRUNCATE + INSERT IGNORE re-derives every column
-- from coremeasurements, the authoritative source. Idempotent.
CALL RefreshMeasurementsSummary();
