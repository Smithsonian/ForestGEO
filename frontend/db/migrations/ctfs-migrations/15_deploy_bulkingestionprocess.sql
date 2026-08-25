-- =====================================================================================
-- RETIRED 2026-07-29 — this file no longer deploys anything.
-- =====================================================================================
-- It used to carry a second, hand-maintained copy of `bulkingestionprocess` and
-- DROP+CREATE it. That copy drifted: by the time it was retired it lacked the
-- STRAIGHT_JOIN join-order fix (which is what keeps sub-batch ingestion from
-- going 8s -> 1500s+ as a census fills) and the entire
-- DUPLICATE_TAG_CONFLICT_EXISTING feature. No runner in this repository executed
-- it, so nothing regressed in production — but sourcing it by hand would have
-- silently installed an obsolete procedure over a current one.
--
-- The procedure has exactly ONE source: db/sql/storedprocedures.sql. There is no
-- second copy to keep in sync, by design.
--
-- To deploy the procedures to a schema:
--
--   MYSQL_PWD='<password>' mysql -h <host> -u <user> --ssl \
--     -D forestgeo_<site> < db/sql/storedprocedures.sql
--
-- In-app provisioning and branch refresh run that same canonical file.
-- =====================================================================================

SELECT CONCAT(
    'Migration 15 is retired. bulkingestionprocess is deployed from ',
    'db/sql/storedprocedures.sql only; this file installs nothing.'
) AS Status;
