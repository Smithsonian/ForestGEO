-- =====================================================================================
-- Remove Foreign Key Constraint from CMAttributes.Code
-- =====================================================================================
-- This migration removes the foreign key constraint that prevents invalid attribute
-- codes from being stored in cmattributes. This allows users to see and correct
-- incorrect attribute codes in the failed measurements interface.
-- =====================================================================================

-- Note: Replace 'schema_name' with your actual schema name when running this migration
-- Example: ALTER TABLE stable_bci.cmattributes DROP FOREIGN KEY CMAttributes_Attributes_Code_fk;

-- Check if the constraint exists before dropping it
SET @schema_name = DATABASE();
SET @table_name = 'cmattributes';
SET @constraint_name = 'CMAttributes_Attributes_Code_fk';

-- Prepare the statement to drop the constraint if it exists
SET @drop_fk_query = CONCAT(
    'ALTER TABLE ', @schema_name, '.', @table_name,
    ' DROP FOREIGN KEY ', @constraint_name
);

-- Check if the constraint exists
SELECT COUNT(*) INTO @constraint_exists
FROM information_schema.TABLE_CONSTRAINTS
WHERE CONSTRAINT_SCHEMA = @schema_name
  AND TABLE_NAME = @table_name
  AND CONSTRAINT_NAME = @constraint_name
  AND CONSTRAINT_TYPE = 'FOREIGN KEY';

-- Execute the drop statement only if the constraint exists
SET @sql = IF(@constraint_exists > 0, @drop_fk_query, 'SELECT "Constraint does not exist" AS message');

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Verification query
SELECT
    CASE
        WHEN @constraint_exists > 0 THEN 'Foreign key constraint CMAttributes_Attributes_Code_fk has been removed'
        ELSE 'Foreign key constraint CMAttributes_Attributes_Code_fk did not exist'
    END AS result;
