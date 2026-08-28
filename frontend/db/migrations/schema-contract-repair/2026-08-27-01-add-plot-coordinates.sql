-- =====================================================================================
-- Migration 2026-08-27-01: add plot-coordinate columns
-- =====================================================================================
-- px/py are site-supplied plot coordinates. They are OPTIONAL and NULLABLE: NULL means
-- "not supplied", never zero. They are SIGNED: a stem west of the plot origin, or mapped
-- just outside its assigned quadrat, legitimately carries a negative offset.
--
-- Five homes, deliberately:
--   temporarymeasurements.PlotX/PlotY  — staging, so the value survives to the procedure
--   stems.PlotX/PlotY                  — canonical current-census stem value
--   coremeasurements.RawPlotX/RawPlotY — per-row upload snapshot, preserved even when the
--                                        row fails or several rows resolve to one stem
--   measurementssummary.StemPlotX/StemPlotY — materialized summary read model
--   viewfulltable.StemPlotX/StemPlotY         — materialized full-table read model
--
-- Each of the ten columns below is probed independently: a manually repaired or
-- interrupted schema may contain X without Y, so one axis is never used as a proxy
-- for its pair. Missing means add. Exact means no-op. Any other existing shape is
-- an operator-visible contract collision, never a silent success.
--
-- MySQL rejects SIGNAL inside a prepared statement ("This command is not supported
-- in the prepared statement protocol yet"), and the branch to take can only be
-- decided at runtime (from information_schema), which outside a stored program
-- requires dynamic SQL. So the conflict branch below routes through CALL to this
-- temporary helper procedure, which performs the SIGNAL natively; it is dropped
-- again once every column has been probed. SIGNAL MESSAGE_TEXT is capped at 128
-- characters by MySQL itself (a longer value fails with its own unrelated "Data
-- too long" error instead of the intended message), so the composed message is
-- defensively trimmed to 120.
DROP PROCEDURE IF EXISTS mig_2026_08_27_01_raise_contract_conflict;
CREATE PROCEDURE mig_2026_08_27_01_raise_contract_conflict(IN conflict_message VARCHAR(120))
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = conflict_message;
END;

-- ---- temporarymeasurements.PlotX ----------------------------------------------------
SET @column_type := (SELECT LOWER(COLUMN_TYPE) FROM information_schema.COLUMNS
                     WHERE TABLE_SCHEMA = DATABASE()
                       AND TABLE_NAME = 'temporarymeasurements'
                       AND COLUMN_NAME = 'PlotX');
SET @is_nullable := (SELECT IS_NULLABLE FROM information_schema.COLUMNS
                     WHERE TABLE_SCHEMA = DATABASE()
                       AND TABLE_NAME = 'temporarymeasurements'
                       AND COLUMN_NAME = 'PlotX');
SET @msg := LEFT(CONCAT('Plot-coordinate schema contract conflict: temporarymeasurements.PlotX must be decimal(12,6) NULL, found ',
                        COALESCE(@column_type, '<missing>'), ' ', COALESCE(@is_nullable, '<missing>')), 120);
SET @sql := CASE
  WHEN @column_type IS NULL THEN
    'ALTER TABLE temporarymeasurements ADD COLUMN PlotX decimal(12,6) NULL'
  WHEN @column_type = 'decimal(12,6)' AND @is_nullable = 'YES' THEN
    'DO 0'
  ELSE
    CONCAT('CALL mig_2026_08_27_01_raise_contract_conflict(', QUOTE(@msg), ')')
END;
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- ---- temporarymeasurements.PlotY ----------------------------------------------------
SET @column_type := (SELECT LOWER(COLUMN_TYPE) FROM information_schema.COLUMNS
                     WHERE TABLE_SCHEMA = DATABASE()
                       AND TABLE_NAME = 'temporarymeasurements'
                       AND COLUMN_NAME = 'PlotY');
SET @is_nullable := (SELECT IS_NULLABLE FROM information_schema.COLUMNS
                     WHERE TABLE_SCHEMA = DATABASE()
                       AND TABLE_NAME = 'temporarymeasurements'
                       AND COLUMN_NAME = 'PlotY');
SET @msg := LEFT(CONCAT('Plot-coordinate schema contract conflict: temporarymeasurements.PlotY must be decimal(12,6) NULL, found ',
                        COALESCE(@column_type, '<missing>'), ' ', COALESCE(@is_nullable, '<missing>')), 120);
SET @sql := CASE
  WHEN @column_type IS NULL THEN
    'ALTER TABLE temporarymeasurements ADD COLUMN PlotY decimal(12,6) NULL'
  WHEN @column_type = 'decimal(12,6)' AND @is_nullable = 'YES' THEN
    'DO 0'
  ELSE
    CONCAT('CALL mig_2026_08_27_01_raise_contract_conflict(', QUOTE(@msg), ')')
END;
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- ---- stems.PlotX ----------------------------------------------------------------------
SET @column_type := (SELECT LOWER(COLUMN_TYPE) FROM information_schema.COLUMNS
                     WHERE TABLE_SCHEMA = DATABASE()
                       AND TABLE_NAME = 'stems'
                       AND COLUMN_NAME = 'PlotX');
SET @is_nullable := (SELECT IS_NULLABLE FROM information_schema.COLUMNS
                     WHERE TABLE_SCHEMA = DATABASE()
                       AND TABLE_NAME = 'stems'
                       AND COLUMN_NAME = 'PlotX');
SET @msg := LEFT(CONCAT('Plot-coordinate schema contract conflict: stems.PlotX must be decimal(12,6) NULL, found ',
                        COALESCE(@column_type, '<missing>'), ' ', COALESCE(@is_nullable, '<missing>')), 120);
SET @sql := CASE
  WHEN @column_type IS NULL THEN
    'ALTER TABLE stems ADD COLUMN PlotX decimal(12,6) NULL'
  WHEN @column_type = 'decimal(12,6)' AND @is_nullable = 'YES' THEN
    'DO 0'
  ELSE
    CONCAT('CALL mig_2026_08_27_01_raise_contract_conflict(', QUOTE(@msg), ')')
END;
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- ---- stems.PlotY ----------------------------------------------------------------------
SET @column_type := (SELECT LOWER(COLUMN_TYPE) FROM information_schema.COLUMNS
                     WHERE TABLE_SCHEMA = DATABASE()
                       AND TABLE_NAME = 'stems'
                       AND COLUMN_NAME = 'PlotY');
SET @is_nullable := (SELECT IS_NULLABLE FROM information_schema.COLUMNS
                     WHERE TABLE_SCHEMA = DATABASE()
                       AND TABLE_NAME = 'stems'
                       AND COLUMN_NAME = 'PlotY');
SET @msg := LEFT(CONCAT('Plot-coordinate schema contract conflict: stems.PlotY must be decimal(12,6) NULL, found ',
                        COALESCE(@column_type, '<missing>'), ' ', COALESCE(@is_nullable, '<missing>')), 120);
SET @sql := CASE
  WHEN @column_type IS NULL THEN
    'ALTER TABLE stems ADD COLUMN PlotY decimal(12,6) NULL'
  WHEN @column_type = 'decimal(12,6)' AND @is_nullable = 'YES' THEN
    'DO 0'
  ELSE
    CONCAT('CALL mig_2026_08_27_01_raise_contract_conflict(', QUOTE(@msg), ')')
END;
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- ---- coremeasurements.RawPlotX ---------------------------------------------------------
SET @column_type := (SELECT LOWER(COLUMN_TYPE) FROM information_schema.COLUMNS
                     WHERE TABLE_SCHEMA = DATABASE()
                       AND TABLE_NAME = 'coremeasurements'
                       AND COLUMN_NAME = 'RawPlotX');
SET @is_nullable := (SELECT IS_NULLABLE FROM information_schema.COLUMNS
                     WHERE TABLE_SCHEMA = DATABASE()
                       AND TABLE_NAME = 'coremeasurements'
                       AND COLUMN_NAME = 'RawPlotX');
SET @msg := LEFT(CONCAT('Plot-coordinate schema contract conflict: coremeasurements.RawPlotX must be decimal(12,6) NULL, found ',
                        COALESCE(@column_type, '<missing>'), ' ', COALESCE(@is_nullable, '<missing>')), 120);
SET @sql := CASE
  WHEN @column_type IS NULL THEN
    'ALTER TABLE coremeasurements ADD COLUMN RawPlotX decimal(12,6) NULL'
  WHEN @column_type = 'decimal(12,6)' AND @is_nullable = 'YES' THEN
    'DO 0'
  ELSE
    CONCAT('CALL mig_2026_08_27_01_raise_contract_conflict(', QUOTE(@msg), ')')
END;
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- ---- coremeasurements.RawPlotY ---------------------------------------------------------
SET @column_type := (SELECT LOWER(COLUMN_TYPE) FROM information_schema.COLUMNS
                     WHERE TABLE_SCHEMA = DATABASE()
                       AND TABLE_NAME = 'coremeasurements'
                       AND COLUMN_NAME = 'RawPlotY');
SET @is_nullable := (SELECT IS_NULLABLE FROM information_schema.COLUMNS
                     WHERE TABLE_SCHEMA = DATABASE()
                       AND TABLE_NAME = 'coremeasurements'
                       AND COLUMN_NAME = 'RawPlotY');
SET @msg := LEFT(CONCAT('Plot-coordinate schema contract conflict: coremeasurements.RawPlotY must be decimal(12,6) NULL, found ',
                        COALESCE(@column_type, '<missing>'), ' ', COALESCE(@is_nullable, '<missing>')), 120);
SET @sql := CASE
  WHEN @column_type IS NULL THEN
    'ALTER TABLE coremeasurements ADD COLUMN RawPlotY decimal(12,6) NULL'
  WHEN @column_type = 'decimal(12,6)' AND @is_nullable = 'YES' THEN
    'DO 0'
  ELSE
    CONCAT('CALL mig_2026_08_27_01_raise_contract_conflict(', QUOTE(@msg), ')')
END;
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- ---- measurementssummary.StemPlotX ------------------------------------------------------
SET @column_type := (SELECT LOWER(COLUMN_TYPE) FROM information_schema.COLUMNS
                     WHERE TABLE_SCHEMA = DATABASE()
                       AND TABLE_NAME = 'measurementssummary'
                       AND COLUMN_NAME = 'StemPlotX');
SET @is_nullable := (SELECT IS_NULLABLE FROM information_schema.COLUMNS
                     WHERE TABLE_SCHEMA = DATABASE()
                       AND TABLE_NAME = 'measurementssummary'
                       AND COLUMN_NAME = 'StemPlotX');
SET @msg := LEFT(CONCAT('Plot-coordinate schema contract conflict: measurementssummary.StemPlotX must be decimal(12,6) NULL, found ',
                        COALESCE(@column_type, '<missing>'), ' ', COALESCE(@is_nullable, '<missing>')), 120);
SET @sql := CASE
  WHEN @column_type IS NULL THEN
    'ALTER TABLE measurementssummary ADD COLUMN StemPlotX decimal(12,6) NULL'
  WHEN @column_type = 'decimal(12,6)' AND @is_nullable = 'YES' THEN
    'DO 0'
  ELSE
    CONCAT('CALL mig_2026_08_27_01_raise_contract_conflict(', QUOTE(@msg), ')')
END;
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- ---- measurementssummary.StemPlotY ------------------------------------------------------
SET @column_type := (SELECT LOWER(COLUMN_TYPE) FROM information_schema.COLUMNS
                     WHERE TABLE_SCHEMA = DATABASE()
                       AND TABLE_NAME = 'measurementssummary'
                       AND COLUMN_NAME = 'StemPlotY');
SET @is_nullable := (SELECT IS_NULLABLE FROM information_schema.COLUMNS
                     WHERE TABLE_SCHEMA = DATABASE()
                       AND TABLE_NAME = 'measurementssummary'
                       AND COLUMN_NAME = 'StemPlotY');
SET @msg := LEFT(CONCAT('Plot-coordinate schema contract conflict: measurementssummary.StemPlotY must be decimal(12,6) NULL, found ',
                        COALESCE(@column_type, '<missing>'), ' ', COALESCE(@is_nullable, '<missing>')), 120);
SET @sql := CASE
  WHEN @column_type IS NULL THEN
    'ALTER TABLE measurementssummary ADD COLUMN StemPlotY decimal(12,6) NULL'
  WHEN @column_type = 'decimal(12,6)' AND @is_nullable = 'YES' THEN
    'DO 0'
  ELSE
    CONCAT('CALL mig_2026_08_27_01_raise_contract_conflict(', QUOTE(@msg), ')')
END;
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- ---- viewfulltable.StemPlotX -------------------------------------------------------------
SET @column_type := (SELECT LOWER(COLUMN_TYPE) FROM information_schema.COLUMNS
                     WHERE TABLE_SCHEMA = DATABASE()
                       AND TABLE_NAME = 'viewfulltable'
                       AND COLUMN_NAME = 'StemPlotX');
SET @is_nullable := (SELECT IS_NULLABLE FROM information_schema.COLUMNS
                     WHERE TABLE_SCHEMA = DATABASE()
                       AND TABLE_NAME = 'viewfulltable'
                       AND COLUMN_NAME = 'StemPlotX');
SET @msg := LEFT(CONCAT('Plot-coordinate schema contract conflict: viewfulltable.StemPlotX must be decimal(12,6) NULL, found ',
                        COALESCE(@column_type, '<missing>'), ' ', COALESCE(@is_nullable, '<missing>')), 120);
SET @sql := CASE
  WHEN @column_type IS NULL THEN
    'ALTER TABLE viewfulltable ADD COLUMN StemPlotX decimal(12,6) NULL'
  WHEN @column_type = 'decimal(12,6)' AND @is_nullable = 'YES' THEN
    'DO 0'
  ELSE
    CONCAT('CALL mig_2026_08_27_01_raise_contract_conflict(', QUOTE(@msg), ')')
END;
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- ---- viewfulltable.StemPlotY -------------------------------------------------------------
SET @column_type := (SELECT LOWER(COLUMN_TYPE) FROM information_schema.COLUMNS
                     WHERE TABLE_SCHEMA = DATABASE()
                       AND TABLE_NAME = 'viewfulltable'
                       AND COLUMN_NAME = 'StemPlotY');
SET @is_nullable := (SELECT IS_NULLABLE FROM information_schema.COLUMNS
                     WHERE TABLE_SCHEMA = DATABASE()
                       AND TABLE_NAME = 'viewfulltable'
                       AND COLUMN_NAME = 'StemPlotY');
SET @msg := LEFT(CONCAT('Plot-coordinate schema contract conflict: viewfulltable.StemPlotY must be decimal(12,6) NULL, found ',
                        COALESCE(@column_type, '<missing>'), ' ', COALESCE(@is_nullable, '<missing>')), 120);
SET @sql := CASE
  WHEN @column_type IS NULL THEN
    'ALTER TABLE viewfulltable ADD COLUMN StemPlotY decimal(12,6) NULL'
  WHEN @column_type = 'decimal(12,6)' AND @is_nullable = 'YES' THEN
    'DO 0'
  ELSE
    CONCAT('CALL mig_2026_08_27_01_raise_contract_conflict(', QUOTE(@msg), ')')
END;
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

DROP PROCEDURE IF EXISTS mig_2026_08_27_01_raise_contract_conflict;

SELECT 'Migration 2026-08-27-01 complete: PlotX/PlotY columns present on temporarymeasurements, stems, coremeasurements (Raw-prefixed), measurementssummary, and viewfulltable (Stem-prefixed).' AS Status;
