#!/usr/bin/env bash
# =============================================================================
# Branch Refresh Migration Runner
# =============================================================================
# Purpose:
#   - Bring an existing ForestGEO schema up to the current branch contract
#   - Re-deploy the canonical storedprocedures.sql
#   - Apply the idempotent unified-measurements migrations this branch depends on
#   - Ensure upload tracking tables exist for schemas that predate them
#
# This is not a full bootstrap from a raw legacy schema. It expects the target
# schema to already contain the core ForestGEO tables (plots/census/trees/stems/
# coremeasurements/etc.). If those base tables are missing, use the full
# migration flow instead.
#
# Usage:
#   ./run-branch-refresh.sh <schema_name> [--host HOST] [--user USER] [--port PORT]
#
# Example:
#   ./run-branch-refresh.sh forestgeo_testing_mason --host localhost --user root
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
STORED_PROCEDURES_FILE="$REPO_ROOT/sqlscripting/storedprocedures.sql"
UPLOAD_TRACKING_HELPER_FILE="$SCRIPT_DIR/branch_refresh_00_ensure_upload_tracking_tables.sql"
MIGRATION_TRACKING_TABLE="_migration_log"
BACKUP_DIR="$SCRIPT_DIR/backups"

PRE_STORED_PROCEDURE_MIGRATIONS=(
    "17_create_upload_errors.sql"
    "18_create_measurement_error_tables.sql"
    "19_alter_coremeasurements_unified_fields.sql"
    "20_migrate_legacy_measurement_errors.sql"
    "21_retarget_validation_definitions.sql"
)

POST_STORED_PROCEDURE_MIGRATIONS=(
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
)

REQUIRED_BASE_TABLES=(
    "attributes"
    "census"
    "cmattributes"
    "coremeasurements"
    "plots"
    "quadrats"
    "sitespecificvalidations"
    "species"
    "stems"
    "temporarymeasurements"
    "trees"
)

SCHEMA=""
DB_HOST="localhost"
DB_USER="root"
DB_PORT="3306"
DB_PASSWORD=""
SKIP_BACKUP="false"
DRY_RUN="false"
FORCE_REAPPLY="false"

print_usage() {
    echo "Usage: $0 <schema_name> [OPTIONS]"
    echo ""
    echo "Options:"
    echo "  --host HOST        MySQL host (default: localhost)"
    echo "  --user USER        MySQL user (default: root)"
    echo "  --port PORT        MySQL port (default: 3306)"
    echo "  --password PASS    MySQL password (or set MYSQL_PWD env var)"
    echo "  --skip-backup      Skip pre-refresh backup (not recommended)"
    echo "  --dry-run          Print what would run without executing"
    echo "  --force-reapply    Re-run tracked branch migrations even if _migration_log says applied"
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
        --force-reapply) FORCE_REAPPLY="true"; shift ;;
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

MYSQL_BASE_ARGS=(-h "$DB_HOST" -u "$DB_USER" -P "$DB_PORT" --default-character-set=utf8mb4)

if [[ -n "$DB_PASSWORD" ]]; then
    MYSQL_BASE_ARGS+=(-p"$DB_PASSWORD")
fi

run_sql() {
    local sql="$1"
    shift || true
    mysql "${MYSQL_BASE_ARGS[@]}" "$SCHEMA" "$@" -e "$sql"
}

run_sql_file() {
    local sql_file="$1"
    shift || true
    mysql "${MYSQL_BASE_ARGS[@]}" "$SCHEMA" "$@" < "$sql_file"
}

if ! command -v mysql &>/dev/null; then
    echo "Error: mysql client not found. Install it or add it to PATH."
    exit 1
fi

if [[ "$DRY_RUN" == "false" ]] && ! command -v mysqldump &>/dev/null; then
    echo "Error: mysqldump not found. Install it or add it to PATH."
    exit 1
fi

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

log_info()    { echo -e "${CYAN}[INFO]${NC}  $*"; }
log_success() { echo -e "${GREEN}[OK]${NC}    $*"; }
log_warn()    { echo -e "${YELLOW}[WARN]${NC}  $*"; }
log_error()   { echo -e "${RED}[FAIL]${NC}  $*"; }

log_info "Testing connection to $DB_HOST:$DB_PORT as $DB_USER..."
if ! run_sql "SELECT 1 AS connected" &>/dev/null; then
    log_error "Cannot connect to MySQL. Check host/user/password/port."
    exit 1
fi
log_success "Connected to $DB_HOST:$DB_PORT, schema: $SCHEMA"

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
    if [[ "$FORCE_REAPPLY" == "true" ]]; then
        return 1
    fi
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

assert_required_base_tables() {
    local missing=()
    local table
    for table in "${REQUIRED_BASE_TABLES[@]}"; do
        local count
        count=$(run_sql "SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = '$table'" -sN 2>/dev/null)
        if [[ "$count" != "1" ]]; then
            missing+=("$table")
        fi
    done

    if [[ ${#missing[@]} -gt 0 ]]; then
        log_error "Schema $SCHEMA is missing required base tables:"
        printf '  - %s\n' "${missing[@]}"
        log_error "This branch refresh runner is for existing ForestGEO schemas, not raw legacy schemas."
        log_error "Use frontend/db-migrations/unified-measurements-migrations/run-migrations.sh for a fuller migration path."
        exit 1
    fi
}

BACKUP_FILE=""

take_backup() {
    mkdir -p "$BACKUP_DIR"
    local timestamp
    timestamp=$(date +%Y%m%d_%H%M%S)
    BACKUP_FILE="$BACKUP_DIR/${SCHEMA}_branch_refresh_${timestamp}.sql.gz"

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
        return 1
    fi

    log_warn "Restoring $SCHEMA from backup: $BACKUP_FILE"
    log_warn "This will DROP and recreate all tables in $SCHEMA."
    echo ""
    read -rp "Proceed with restore? [y/N] " confirm
    if [[ "$confirm" != "y" && "$confirm" != "Y" ]]; then
        log_warn "Restore cancelled. Schema may be in a partially refreshed state."
        log_warn "Backup is available at: $BACKUP_FILE"
        return 1
    fi

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
    log_success "Schema restored to pre-refresh state."
}

deploy_stored_procedures() {
    if [[ ! -f "$STORED_PROCEDURES_FILE" ]]; then
        log_error "Stored procedures file not found: $STORED_PROCEDURES_FILE"
        return 1
    fi

    local start_time
    start_time=$(date +%s)
    log_info "Deploying stored procedures from storedprocedures.sql..."
    run_sql_file "$STORED_PROCEDURES_FILE"
    local end_time
    end_time=$(date +%s)
    mark_applied "branch_refresh::storedprocedures.sql" "$(( end_time - start_time ))"
    log_success "Stored procedures deployed."
}

run_refresh_sql_file() {
    local label="$1"
    local filepath="$2"

    log_info "Applying: $label ..."
    local start_time
    start_time=$(date +%s)

    run_sql_file "$filepath"

    local end_time
    end_time=$(date +%s)
    local duration=$(( end_time - start_time ))
    mark_applied "$label" "$duration"
    log_success "Applied: $label (${duration}s)"
}

main() {
    echo ""
    echo "============================================================"
    echo "  Branch Refresh Migration Runner"
    echo "  Schema:  $SCHEMA"
    echo "  Host:    $DB_HOST:$DB_PORT"
    echo "  User:    $DB_USER"
    echo "============================================================"
    echo ""

    if [[ ! -f "$STORED_PROCEDURES_FILE" ]]; then
        log_error "Missing: $STORED_PROCEDURES_FILE"
        exit 1
    fi

    if [[ ! -f "$UPLOAD_TRACKING_HELPER_FILE" ]]; then
        log_error "Missing helper SQL: $UPLOAD_TRACKING_HELPER_FILE"
        exit 1
    fi

    assert_required_base_tables

    local file
    log_info "Branch refresh plan:"
    echo "         always: branch_refresh_00_ensure_upload_tracking_tables.sql"
    for file in "${PRE_STORED_PROCEDURE_MIGRATIONS[@]}"; do
        if is_already_applied "$file"; then
            echo "         skip:   $file"
        else
            echo "         apply:  $file"
        fi
    done
    echo "         always: storedprocedures.sql"
    for file in "${POST_STORED_PROCEDURE_MIGRATIONS[@]}"; do
        if is_already_applied "$file"; then
            echo "         skip:   $file"
        else
            echo "         apply:  $file"
        fi
    done
    echo ""

    if [[ "$DRY_RUN" == "true" ]]; then
        log_info "Dry run complete. No changes made."
        exit 0
    fi

    if [[ "$SKIP_BACKUP" == "false" ]]; then
        take_backup
    else
        log_warn "Skipping backup (--skip-backup). You are on your own if things break."
    fi

    local failed_step=""
    local applied_count=0

    if ! run_refresh_sql_file "branch_refresh::ensure_upload_tracking_tables.sql" "$UPLOAD_TRACKING_HELPER_FILE"; then
        failed_step="branch_refresh::ensure_upload_tracking_tables.sql"
    fi

    if [[ -z "$failed_step" ]]; then
        for file in "${PRE_STORED_PROCEDURE_MIGRATIONS[@]}"; do
            if is_already_applied "$file"; then
                log_info "Already applied, skipping: $file"
                continue
            fi

            if ! run_refresh_sql_file "$file" "$SCRIPT_DIR/$file"; then
                failed_step="$file"
                break
            fi
            applied_count=$(( applied_count + 1 ))
        done
    fi

    if [[ -z "$failed_step" ]]; then
        if ! deploy_stored_procedures; then
            failed_step="branch_refresh::storedprocedures.sql"
        fi
    fi

    if [[ -z "$failed_step" ]]; then
        for file in "${POST_STORED_PROCEDURE_MIGRATIONS[@]}"; do
            if is_already_applied "$file"; then
                log_info "Already applied, skipping: $file"
                continue
            fi

            if ! run_refresh_sql_file "$file" "$SCRIPT_DIR/$file"; then
                failed_step="$file"
                break
            fi
            applied_count=$(( applied_count + 1 ))
        done
    fi

    echo ""
    echo "============================================================"

    if [[ -n "$failed_step" ]]; then
        log_error "Branch refresh failed at: $failed_step"
        echo ""
        if [[ "$SKIP_BACKUP" == "false" ]]; then
            log_warn "A pre-refresh backup exists. Would you like to restore?"
            echo ""
            restore_backup
        else
            log_error "No backup available (--skip-backup was used)."
            log_error "Schema $SCHEMA may be in a partially refreshed state."
        fi
        exit 1
    fi

    log_success "Branch refresh completed successfully!"
    echo ""
    log_info "Migration log:"
    run_sql "SELECT migration_file, applied_at, CONCAT(duration_sec, 's') AS duration
             FROM $MIGRATION_TRACKING_TABLE
             WHERE status='applied'
               AND (migration_file IN ('branch_refresh::ensure_upload_tracking_tables.sql',
                                       'branch_refresh::storedprocedures.sql',
                                       '17_create_upload_errors.sql',
                                       '18_create_measurement_error_tables.sql',
                                       '19_alter_coremeasurements_unified_fields.sql',
                                       '20_migrate_legacy_measurement_errors.sql',
                                       '21_retarget_validation_definitions.sql',
                                       '22_deprecate_legacy_error_tables.sql',
                                       '24_fix_measurement_errors_fk_restrict.sql',
                                       '25_prune_temporarymeasurements_indexes.sql',
                                       '26_backfill_coremeasurement_upload_columns.sql',
                                       '27_add_upload_scope_indexes.sql',
                                       '28_add_bulk_ingestion_performance_indexes.sql',
                                       '29_fix_sitespecificvalidations_collation.sql',
                                       '30_seed_ingestion_integrity_error_codes.sql',
                                       '31_add_upload_session_scope_lock.sql',
                                       '32_add_cross_census_validation_indexes.sql'))
             ORDER BY applied_at" 2>/dev/null
    echo ""

    if [[ "$SKIP_BACKUP" == "false" && -n "$BACKUP_FILE" ]]; then
        log_info "Pre-refresh backup retained at: $BACKUP_FILE"
        log_info "Delete it when you're satisfied: rm $BACKUP_FILE"
    fi

    echo "============================================================"
}

main
