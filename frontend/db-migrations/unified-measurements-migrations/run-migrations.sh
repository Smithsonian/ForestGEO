#!/usr/bin/env bash
# =============================================================================
# Unified Measurements Migration Runner
# =============================================================================
# Runs migrations 16-51 in order against a target schema.
# Takes a full schema backup before starting and restores on failure.
#
# Usage:
#   ./run-migrations.sh <schema_name> [--host HOST] [--user USER] [--port PORT]
#
# Example:
#   ./run-migrations.sh forestgeo_testing_mason --host localhost --user root
#   ./run-migrations.sh forestgeo_testing_mason \
#       --host forestgeo-mysqldataserver.mysql.database.azure.com --user admin@forestgeo
# =============================================================================

set -euo pipefail

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
STORED_PROCEDURES_FILE="$REPO_ROOT/sqlscripting/storedprocedures.sql"
MIGRATION_TRACKING_TABLE="_migration_log"
BACKUP_DIR="$SCRIPT_DIR/backups"

ORDERED_MIGRATIONS=(
    "16_failed_measurements_reasons.sql"
    "17_create_upload_errors.sql"
    "18_create_measurement_error_tables.sql"
    "19_alter_coremeasurements_unified_fields.sql"
    "20_migrate_legacy_measurement_errors.sql"
    "21_retarget_validation_definitions.sql"
    "23_update_bulkingestionprocess.sql"
    "22_deprecate_legacy_error_tables.sql"
    "24_fix_measurement_errors_fk_restrict.sql"
    "25_prune_temporarymeasurements_indexes.sql"
    "26_backfill_coremeasurement_upload_columns.sql"
    "27_add_upload_scope_indexes.sql"
    "28_add_bulk_ingestion_performance_indexes.sql"
    "29_fix_sitespecificvalidations_collation.sql"
    "30_seed_ingestion_integrity_error_codes.sql"
    "31_add_upload_session_scope_lock.sql"
    "32_add_cross_census_validation_indexes.sql"
    "33_refresh_measurements_summary_procedure.sql"
    "34_fix_validation5_subquery_census_filter.sql"
    "35_add_temporarymeasurements_session_id.sql"
    "36_add_error_log_indexes.sql"
    "37_seed_duplicate_conflict_error_codes.sql"
    "38_create_validation_runs.sql"
    "39_seed_ambiguous_reference_error_codes.sql"
    "40_add_upload_session_mode.sql"
    "41_add_plots_name_unique.sql"
    "42_add_census_plot_number_unique.sql"
    "43_add_sitespecificvalidations_name_unique.sql"
    "44_stems_stemtag_not_null.sql"
    "45_drop_redundant_personnel_full_index.sql"
    "46_add_species_active_code_unique.sql"
    "47_add_quadrats_active_name_unique.sql"
    "48_refresh_bulkingestionprocess_ambiguous_reference_resolution.sql"
    "49_add_duplicate_tag_stemtag_detection.sql"
    "50_relax_measurementssummary_add_rawcodes.sql"
    "51_backfill_hard_failure_error_log.sql"
)

# ---------------------------------------------------------------------------
# Parse arguments
# ---------------------------------------------------------------------------
SCHEMA=""
DB_HOST="localhost"
DB_USER="root"
DB_PORT="3306"
DB_PASSWORD=""
SKIP_BACKUP="false"
DRY_RUN="false"
START_FROM=""

print_usage() {
    echo "Usage: $0 <schema_name> [OPTIONS]"
    echo ""
    echo "Options:"
    echo "  --host HOST        MySQL host (default: localhost)"
    echo "  --user USER        MySQL user (default: root)"
    echo "  --port PORT        MySQL port (default: 3306)"
    echo "  --password PASS    MySQL password (or set MYSQL_PWD env var)"
    echo "  --skip-backup      Skip pre-migration backup (not recommended)"
    echo "  --dry-run          Print what would run without executing"
    echo "  --start-from NUM   Resume from migration number (e.g. 20)"
    echo "  --help             Show this help"
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        --host)     DB_HOST="$2"; shift 2 ;;
        --user)     DB_USER="$2"; shift 2 ;;
        --port)     DB_PORT="$2"; shift 2 ;;
        --password) DB_PASSWORD="$2"; shift 2 ;;
        --skip-backup) SKIP_BACKUP="true"; shift ;;
        --dry-run)  DRY_RUN="true"; shift ;;
        --start-from) START_FROM="$2"; shift 2 ;;
        --help)     print_usage; exit 0 ;;
        -*)         echo "Unknown option: $1"; print_usage; exit 1 ;;
        *)
            if [[ -z "$SCHEMA" ]]; then
                SCHEMA="$1"; shift
            else
                echo "Unexpected argument: $1"; print_usage; exit 1
            fi
            ;;
    esac
done

if [[ -z "$SCHEMA" ]]; then
    echo "Error: schema name is required."
    print_usage
    exit 1
fi

# ---------------------------------------------------------------------------
# MySQL helper
# ---------------------------------------------------------------------------
MYSQL_BASE_ARGS=(-h "$DB_HOST" -u "$DB_USER" -P "$DB_PORT" --default-character-set=utf8mb4)

if [[ -n "$DB_PASSWORD" ]]; then
    MYSQL_BASE_ARGS+=(-p"$DB_PASSWORD")
fi

run_sql() {
    mysql "${MYSQL_BASE_ARGS[@]}" "$SCHEMA" -e "$1"
}

run_sql_file() {
    mysql "${MYSQL_BASE_ARGS[@]}" "$SCHEMA" < "$1"
}

# Check mysql client is available
if ! command -v mysql &>/dev/null; then
    echo "Error: mysql client not found. Install it or add it to PATH."
    exit 1
fi

if ! command -v mysqldump &>/dev/null; then
    echo "Error: mysqldump not found. Install it or add it to PATH."
    exit 1
fi

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

log_info()    { echo -e "${CYAN}[INFO]${NC}  $*"; }
log_success() { echo -e "${GREEN}[OK]${NC}    $*"; }
log_warn()    { echo -e "${YELLOW}[WARN]${NC}  $*"; }
log_error()   { echo -e "${RED}[FAIL]${NC}  $*"; }

# ---------------------------------------------------------------------------
# Verify connection
# ---------------------------------------------------------------------------
log_info "Testing connection to $DB_HOST:$DB_PORT as $DB_USER..."
if ! run_sql "SELECT 1 AS connected" &>/dev/null; then
    log_error "Cannot connect to MySQL. Check host/user/password/port."
    exit 1
fi
log_success "Connected to $DB_HOST:$DB_PORT, schema: $SCHEMA"

# ---------------------------------------------------------------------------
# Migration tracking table
# ---------------------------------------------------------------------------
run_sql "
CREATE TABLE IF NOT EXISTS $MIGRATION_TRACKING_TABLE (
    migration_file VARCHAR(255) NOT NULL PRIMARY KEY,
    applied_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    duration_sec   DECIMAL(8,2) NULL,
    status         ENUM('applied','rolled_back') NOT NULL DEFAULT 'applied'
) ENGINE=InnoDB;
"

is_already_applied() {
    local file="$1"
    local count
    count=$(run_sql "SELECT COUNT(*) FROM $MIGRATION_TRACKING_TABLE WHERE migration_file='$file' AND status='applied'" -sN 2>/dev/null)
    [[ "$count" == "1" ]]
}

mark_applied() {
    local file="$1"
    local duration="$2"
    run_sql "INSERT INTO $MIGRATION_TRACKING_TABLE (migration_file, duration_sec, status)
             VALUES ('$file', $duration, 'applied')
             ON DUPLICATE KEY UPDATE applied_at=NOW(), duration_sec=$duration, status='applied'"
}

# ---------------------------------------------------------------------------
# Backup
# ---------------------------------------------------------------------------
BACKUP_FILE=""

take_backup() {
    mkdir -p "$BACKUP_DIR"
    local timestamp
    timestamp=$(date +%Y%m%d_%H%M%S)
    BACKUP_FILE="$BACKUP_DIR/${SCHEMA}_pre_migration_${timestamp}.sql.gz"

    log_info "Backing up $SCHEMA to $BACKUP_FILE ..."
    mysqldump "${MYSQL_BASE_ARGS[@]}" \
        --single-transaction \
        --routines \
        --triggers \
        --events \
        --set-gtid-purged=OFF \
        "$SCHEMA" 2>/dev/null | gzip > "$BACKUP_FILE"

    local backup_size
    backup_size=$(du -h "$BACKUP_FILE" | cut -f1)
    log_success "Backup complete ($backup_size)"
}

restore_backup() {
    if [[ -z "$BACKUP_FILE" || ! -f "$BACKUP_FILE" ]]; then
        log_error "No backup file available to restore from!"
        log_error "Manual intervention required. Check schema state in: $SCHEMA"
        return 1
    fi

    log_warn "Restoring $SCHEMA from backup: $BACKUP_FILE"
    log_warn "This will DROP and recreate all tables in $SCHEMA."
    echo ""
    read -rp "Proceed with restore? [y/N] " confirm
    if [[ "$confirm" != "y" && "$confirm" != "Y" ]]; then
        log_warn "Restore cancelled. Schema may be in a partially migrated state."
        log_warn "Backup is available at: $BACKUP_FILE"
        return 1
    fi

    # Drop all tables, procedures, functions in the schema before restoring
    log_info "Dropping existing objects in $SCHEMA..."
    local drop_tables
    drop_tables=$(run_sql "
        SELECT CONCAT('DROP TABLE IF EXISTS \`', TABLE_NAME, '\`;')
        FROM INFORMATION_SCHEMA.TABLES
        WHERE TABLE_SCHEMA = '$SCHEMA' AND TABLE_TYPE = 'BASE TABLE'
    " -sN 2>/dev/null)

    if [[ -n "$drop_tables" ]]; then
        run_sql "SET FOREIGN_KEY_CHECKS=0; $drop_tables SET FOREIGN_KEY_CHECKS=1;"
    fi

    local drop_procs
    drop_procs=$(run_sql "
        SELECT CONCAT('DROP PROCEDURE IF EXISTS \`', ROUTINE_NAME, '\`;')
        FROM INFORMATION_SCHEMA.ROUTINES
        WHERE ROUTINE_SCHEMA = '$SCHEMA' AND ROUTINE_TYPE = 'PROCEDURE'
    " -sN 2>/dev/null)

    if [[ -n "$drop_procs" ]]; then
        run_sql "$drop_procs"
    fi

    log_info "Restoring from backup..."
    gunzip -c "$BACKUP_FILE" | mysql "${MYSQL_BASE_ARGS[@]}" "$SCHEMA"
    log_success "Schema restored to pre-migration state."
}

# ---------------------------------------------------------------------------
# Deploy stored procedures when a migration requires a routine refresh
# ---------------------------------------------------------------------------
deploy_stored_procedures() {
    if [[ ! -f "$STORED_PROCEDURES_FILE" ]]; then
        log_error "Stored procedures file not found: $STORED_PROCEDURES_FILE"
        return 1
    fi
    log_info "Deploying stored procedures from storedprocedures.sql..."
    run_sql_file "$STORED_PROCEDURES_FILE"
    log_success "Stored procedures deployed."
}

# ---------------------------------------------------------------------------
# Run migrations
# ---------------------------------------------------------------------------
main() {
    echo ""
    echo "============================================================"
    echo "  Unified Measurements Migration Runner"
    echo "  Schema:  $SCHEMA"
    echo "  Host:    $DB_HOST:$DB_PORT"
    echo "  User:    $DB_USER"
    echo "============================================================"
    echo ""

    # Pre-flight: verify stored procedures file exists
    if [[ ! -f "$STORED_PROCEDURES_FILE" ]]; then
        log_error "Missing: $STORED_PROCEDURES_FILE"
        log_error "This file is required after migration 23. Aborting."
        exit 1
    fi

    # Pre-flight: list what will run
    local migrations_to_run=()
    local skipping="false"
    if [[ -n "$START_FROM" ]]; then
        skipping="true"
    fi

    for file in "${ORDERED_MIGRATIONS[@]}"; do
        local num="${file%%_*}"

        if [[ "$skipping" == "true" ]]; then
            if [[ "$num" == "$START_FROM" ]]; then
                skipping="false"
            else
                continue
            fi
        fi

        if is_already_applied "$file"; then
            log_info "Already applied, skipping: $file"
            continue
        fi

        migrations_to_run+=("$file")
    done

    if [[ ${#migrations_to_run[@]} -eq 0 ]]; then
        log_success "All migrations already applied. Nothing to do."
        exit 0
    fi

    echo ""
    log_info "Migrations to apply (${#migrations_to_run[@]}):"
    for file in "${migrations_to_run[@]}"; do
        echo "         $file"
    done
    echo ""

    if [[ "$DRY_RUN" == "true" ]]; then
        log_info "Dry run complete. No changes made."
        exit 0
    fi

    # Take backup
    if [[ "$SKIP_BACKUP" == "false" ]]; then
        take_backup
    else
        log_warn "Skipping backup (--skip-backup). You are on your own if things break."
    fi

    # Run each migration
    local failed_migration=""
    local applied_count=0

    for file in "${migrations_to_run[@]}"; do
        local filepath="$SCRIPT_DIR/$file"

        if [[ ! -f "$filepath" ]]; then
            log_error "Migration file not found: $filepath"
            failed_migration="$file"
            break
        fi

        log_info "Applying: $file ..."
        local start_time
        start_time=$(date +%s)

        if ! run_sql_file "$filepath" 2>&1; then
            log_error "Migration FAILED: $file"
            failed_migration="$file"
            break
        fi

        local end_time
        end_time=$(date +%s)
        local duration=$(( end_time - start_time ))

        mark_applied "$file" "$duration"
        log_success "Applied: $file (${duration}s)"
        applied_count=$((applied_count + 1))

        # Some migrations rely on the canonical storedprocedures.sql deployment
        if [[ "$file" == "23_update_bulkingestionprocess.sql" || "$file" == "33_refresh_measurements_summary_procedure.sql" || "$file" == "48_refresh_bulkingestionprocess_ambiguous_reference_resolution.sql" || "$file" == "49_add_duplicate_tag_stemtag_detection.sql" ]]; then
            log_info "Migration $file requires a stored procedure redeploy. Deploying stored procedures..."
            if ! deploy_stored_procedures; then
                log_error "Stored procedure deployment failed after $file."
                failed_migration="$file (stored procedures)"
                break
            fi
        fi
    done

    echo ""
    echo "============================================================"

    if [[ -n "$failed_migration" ]]; then
        log_error "$applied_count migration(s) applied before failure at: $failed_migration"
        echo ""

        if [[ "$SKIP_BACKUP" == "false" ]]; then
            log_warn "A pre-migration backup exists. Would you like to restore?"
            echo ""
            restore_backup
        else
            log_error "No backup available (--skip-backup was used)."
            log_error "Schema $SCHEMA may be in a partially migrated state."
            log_error "Review the _migration_log table to see what was applied."
        fi
        exit 1
    else
        log_success "All ${applied_count} migration(s) applied successfully!"
        echo ""
        log_info "Migration log:"
        run_sql "SELECT migration_file, applied_at, CONCAT(duration_sec, 's') AS duration
                 FROM $MIGRATION_TRACKING_TABLE
                 WHERE status='applied'
                 ORDER BY applied_at" 2>/dev/null
        echo ""

        if [[ "$SKIP_BACKUP" == "false" && -n "$BACKUP_FILE" ]]; then
            log_info "Pre-migration backup retained at: $BACKUP_FILE"
            log_info "Delete it when you're satisfied: rm $BACKUP_FILE"
        fi
    fi

    echo "============================================================"
}

main
