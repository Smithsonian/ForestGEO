-- Migration 24: Change measurement_error_log FK on ErrorID from CASCADE to RESTRICT
--
-- measurement_errors is a configuration/seed table. Accidentally deleting an error
-- definition should NOT cascade-delete all associated error logs. RESTRICT prevents
-- deletion of error definitions that are still referenced.

ALTER TABLE measurement_error_log
  DROP FOREIGN KEY measurement_error_log_errors_fk;

ALTER TABLE measurement_error_log
  ADD CONSTRAINT measurement_error_log_errors_fk
    FOREIGN KEY (ErrorID) REFERENCES measurement_errors (ErrorID)
      ON DELETE RESTRICT;
