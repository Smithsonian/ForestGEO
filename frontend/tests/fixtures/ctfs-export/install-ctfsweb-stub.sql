-- Test stub for the CTFSWeb post-load helpers.
--
-- Suzanne shipped creating_ViewFullTable.sql which installs CreateFullView and
-- a handful of supporting procedures in the `ctfsweb_webuser` schema on every
-- destination MySQL server. The Stage 0 probe in csv-to-sql-v2 SIGNALs when
-- that procedure is missing, and the post-load step calls it.
--
-- For integration tests we install a minimal stub that satisfies both:
--   * information_schema.ROUTINES finds the procedure (probe passes).
--   * The CALL succeeds with a sentinel SELECT (post-load step passes).
--
-- This file is intentionally safe to source repeatedly across test runs:
--   * CREATE DATABASE IF NOT EXISTS
--   * DROP PROCEDURE IF EXISTS before CREATE
-- so any vitest worker can run it without interfering with the others.

CREATE DATABASE IF NOT EXISTS ctfsweb_webuser;

DROP PROCEDURE IF EXISTS ctfsweb_webuser.CreateFullView;

DELIMITER //
CREATE PROCEDURE ctfsweb_webuser.CreateFullView(IN db CHAR(100), IN newtbl CHAR(30))
BEGIN
  SELECT 'ctfsweb_webuser.CreateFullView (test stub)' AS scope,
         db AS database_name,
         newtbl AS table_name;
END //
DELIMITER ;
