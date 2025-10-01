# MySQL Connection Troubleshooting - Azure MySQL Database

## Issue Summary

Unable to connect to Azure MySQL database using command-line `mysql` client.

## Root Cause

**Authentication Plugin Incompatibility**

- **Local MySQL Client:** Version 9.4.0_3
- **Azure MySQL Server:** Requires `mysql_native_password` authentication
- **Problem:** MySQL 9.x **removed** the `mysql_native_password` plugin (considered insecure)

### Error Message:

```
ERROR 2059 (HY000): Authentication plugin 'mysql_native_password' cannot be loaded:
dlopen(/usr/local/Cellar/mysql/9.4.0_3/lib/plugin/mysql_native_password.so, 0x0002):
tried: '/usr/local/Cellar/mysql/9.4.0_3/lib/plugin/mysql_native_password.so' (no such file)
```

## Connection Details

From `.env` and `.env.local`:

```bash
Host: forestgeo-mysqldataserver.mysql.database.azure.com
User: azureroot
Password: P@ssw0rd
Port: 3306
Database: forestgeo_testing (or catalog)
```

**Note:** You previously tried connecting to `forestgeo-database.c2ez3x1qofnn.us-east.1.rds.amazonaws.com` which is incorrect - that's an AWS RDS hostname that doesn't exist in your configuration.

## Solutions

### Solution 1: Install MariaDB Client (Recommended)

MariaDB client still supports `mysql_native_password` and is fully compatible:

```bash
# Install MariaDB client via Homebrew
brew install mariadb

# Connect using mariadb client
mariadb -h forestgeo-mysqldataserver.mysql.database.azure.com \\
        -u azureroot \\
        -p'P@ssw0rd' \\
        -P 3306 \\
        -D forestgeo_testing
```

### Solution 2: Downgrade MySQL Client to 8.x

MySQL 8.x still includes the `mysql_native_password` plugin:

```bash
# Uninstall MySQL 9.x
brew uninstall mysql

# Install MySQL 8.x
brew install mysql@8.0

# Add to PATH
echo 'export PATH="/usr/local/opt/mysql@8.0/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc

# Connect
mysql -h forestgeo-mysqldataserver.mysql.database.azure.com \\
      -u azureroot \\
      -p'P@ssw0rd' \\
      -P 3306 \\
      -D forestgeo_testing
```

### Solution 3: Use MySQL Workbench (GUI)

MySQL Workbench includes all necessary authentication plugins:

1. Download: https://dev.mysql.com/downloads/workbench/
2. Create New Connection:
   - Connection Name: ForestGEO Azure
   - Hostname: forestgeo-mysqldataserver.mysql.database.azure.com
   - Port: 3306
   - Username: azureroot
   - Password: P@ssw0rd
   - Default Schema: forestgeo_testing

### Solution 4: Use Docker with MySQL 8 Client

Run MySQL 8 client in a Docker container:

```bash
docker run -it --rm mysql:8.0 mysql \\
  -h forestgeo-mysqldataserver.mysql.database.azure.com \\
  -u azureroot \\
  -p'P@ssw0rd' \\
  -P 3306 \\
  -D forestgeo_testing
```

### Solution 5: Connect via Node.js (Already Working)

The application uses `mysql2` package which supports all authentication methods:

```javascript
// This already works in your application
const connection = mysql.createConnection({
  host: 'forestgeo-mysqldataserver.mysql.database.azure.com',
  user: 'azureroot',
  password: 'P@ssw0rd',
  port: 3306,
  database: 'forestgeo_testing'
});
```

## Verification

Once connected, verify with:

```sql
-- Check connection
SELECT 'Connection successful!' as status, VERSION() as mysql_version;

-- List databases
SHOW DATABASES;

-- Check current database
SELECT DATABASE();

-- List tables in forestgeo_testing
USE forestgeo_testing;
SHOW TABLES;

-- Verify attributes table exists
DESC attributes;
SELECT * FROM attributes LIMIT 10;
```

## Common Issues

### Issue: "Host is not allowed to connect"

**Solution:** IP must be whitelisted in Azure MySQL firewall rules

### Issue: "Access denied for user"

**Solution:** Check username and password are correct

### Issue: "SSL connection error"

**Solution:** Add `--ssl-mode=DISABLED` to mysql command (not recommended for production)

## Testing New Validations

Once connected, you can test the new validation queries:

```sql
-- Execute new validations
SOURCE /path/to/frontend/sqlscripting/new-validations.sql;

-- Verify installation
SELECT ValidationID, ProcedureName, Description, IsEnabled
FROM forestgeo_testing.sitespecificvalidations
WHERE ValidationID IN (14, 15);

-- Test invalid code validation
SELECT * FROM forestgeo_testing.cmverrors WHERE ValidationErrorID = 14;

-- Test abnormal DBH validation
SELECT * FROM forestgeo_testing.cmverrors WHERE ValidationErrorID = 15;
```

## Recommended Action

**Install MariaDB client** - it's the simplest solution that maintains compatibility:

```bash
brew install mariadb
mariadb -h forestgeo-mysqldataserver.mysql.database.azure.com \\
        -u azureroot \\
        -p'P@ssw0rd' \\
        forestgeo_testing
```

Then you'll be able to run all SQL commands directly from the terminal.
