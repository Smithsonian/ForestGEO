# ForestGEO Schema Automation Guide

This guide explains the different automation options for keeping your ForestGEO schemas synchronized.

## 🚀 Quick Start

### Option 1: Manual Sync (Recommended to start)
```bash
# Check if schemas need syncing
./auto-sync-schemas.sh check

# Sync all schemas once
./auto-sync-schemas.sh sync

# Sync a specific schema
./auto-sync-schemas.sh sync-single forestgeo_harvard
```

### Option 2: Scheduled Sync (Cron)
```bash
# Set up automatic syncing every 15 minutes
./setup-cron.sh
# Choose option 2 when prompted
```

### Option 3: Continuous Monitoring
```bash
# Monitor and sync every 5 minutes (300 seconds)
./auto-sync-schemas.sh monitor 300

# Or run in background
nohup ./auto-sync-schemas.sh monitor 300 > sync-monitor.log 2>&1 &
```

## 📋 Available Options

### 1. On-Demand Sync (`auto-sync-schemas.sh`)

**Commands:**
- `check` - Check if schemas are out of sync
- `sync` - Perform one-time sync of all schemas
- `monitor [interval]` - Continuously monitor and sync
- `sync-single <schema>` - Sync specific schema

**How it works:**
- Compares schema checksums between forestgeo_testing and other schemas
- Uses Liquibase to generate and apply difference changelogs
- Only applies changes when differences are detected
- Logs all activities to dated log files

### 2. Cron Automation (`setup-cron.sh`)

**Frequencies:**
- Every 5 minutes
- Every 15 minutes
- Every hour
- Every 4 hours
- Daily at 2 AM
- Custom schedule

**Benefits:**
- Runs automatically in background
- No manual intervention required
- Survives system restarts (if cron is configured properly)

### 3. Database Triggers (`create-sync-triggers.sql`)

**Features:**
- Tracks data changes in real-time
- Creates notification system
- Monitors specific tables for changes
- Provides audit trail

**Note:** MySQL doesn't support DDL triggers, so schema structure changes need external monitoring.

## 🔄 Recommended Workflow

### For Development
1. Make changes to `forestgeo_testing` schema
2. Test changes thoroughly
3. Run: `./auto-sync-schemas.sh check`
4. If changes detected, run: `./auto-sync-schemas.sh sync`

### For Production
1. Set up cron job: `./setup-cron.sh` (choose 15-minute or hourly sync)
2. Monitor logs: `tail -f cron-sync.log`
3. Optionally set up database triggers for data change tracking

## 📊 Monitoring

### Check Sync Status
```bash
# Check if sync is needed
./auto-sync-schemas.sh check

# View recent log
tail -20 schema-sync-$(date +%Y%m%d).log
```

### View Cron Logs
```bash
# View cron sync logs
tail -f cron-sync.log

# View all logs
ls -la *sync*.log
```

### Database Change Tracking
```sql
-- View pending changes (if triggers are installed)
USE forestgeo_testing;
SELECT * FROM pending_sync_changes;

-- View sync notifications
SELECT * FROM sync_notifications WHERE processed_at IS NULL;
```

## ⚠️ Important Notes

1. **Test First**: Always test automation on a non-production environment
2. **Backup**: Ensure you have database backups before enabling automation
3. **Monitor**: Regularly check logs for sync failures
4. **Credentials**: Scripts use credentials from .env.local - keep them secure
5. **Network**: Ensure stable connection to Azure MySQL server

## 🛠️ Troubleshooting

### Sync Failures
```bash
# Check recent logs
tail -50 schema-sync-$(date +%Y%m%d).log

# Test connection
mysql -h forestgeo-mysqldataserver.mysql.database.azure.com -u azureroot -p

# Validate Liquibase setup
liquibase status
```

### Cron Issues
```bash
# Check if cron job exists
crontab -l | grep auto-sync

# Check cron service
systemctl status cron  # Linux
launchctl list | grep cron  # macOS
```

### Performance Impact
- Schema comparisons are lightweight (checksum-based)
- Actual sync only happens when changes are detected
- Monitor database performance if running frequent checks

## 📈 Advanced Configuration

### Custom Sync Intervals
Edit the scripts to change:
- Checksum comparison frequency
- Retry logic for failed syncs
- Email notifications on sync failures
- Specific table exclusions

### Integration with CI/CD
Add to your deployment pipeline:
```bash
# After schema changes
./auto-sync-schemas.sh sync
```