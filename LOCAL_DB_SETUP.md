# Local Database Setup Guide

This guide helps you set up a local MySQL database for development and testing.

## Quick Start with Docker Compose

### 1. Start MySQL Container

```bash
# Start the MySQL container
docker-compose up -d

# Check if it's running
docker-compose ps

# View logs
docker-compose logs -f mysql
```

### 2. Connection Details

Once the container is running, you can connect with:

- **Host**: `localhost` (or `127.0.0.1`)
- **Port**: `3306`
- **Root User**: `root`
- **Root Password**: `rootpassword`
- **Database**: `forestgeo_local`
- **User**: `forestgeo_user`
- **User Password**: `forestgeo_password`

### 3. Initialize Database Schema

The database `forestgeo_local` is created automatically, but you need to run the schema scripts:

```bash
# Connect to MySQL
docker exec -it forestgeo-mysql-local mysql -uroot -prootpassword

# Or use mysql client from your machine
mysql -h 127.0.0.1 -P 3306 -u root -prootpassword
```

Then run the schema setup:

```sql
USE forestgeo_local;

-- Load table structures
SOURCE /docker-entrypoint-initdb.d/sqlscripting/tablestructures.sql;

-- Load stored procedures
SOURCE /docker-entrypoint-initdb.d/sqlscripting/storedprocedures.sql;
```

Or from your local machine:

```bash
# Set environment variables
export MYSQL_HOST=localhost
export MYSQL_PORT=3306
export MYSQL_USER=root
export MYSQL_PASSWORD=rootpassword
export MYSQL_DATABASE=forestgeo_local

# Run table structures
mysql -h $MYSQL_HOST -P $MYSQL_PORT -u $MYSQL_USER -p$MYSQL_PASSWORD $MYSQL_DATABASE < frontend/sqlscripting/tablestructures.sql

# Run stored procedures
mysql -h $MYSQL_HOST -P $MYSQL_PORT -u $MYSQL_USER -p$MYSQL_PASSWORD $MYSQL_DATABASE < frontend/sqlscripting/storedprocedures.sql
```

## Alternative: Use Existing Test Setup Script

The project already has a test database setup script that can be used locally:

```bash
# Set environment variables for local MySQL
export TEST_DB_HOST=localhost
export TEST_DB_USER=root
export TEST_DB_PASSWORD=rootpassword
export TEST_DB_PORT=3306

# Run the test setup (creates a test database with schema and sample data)
# This is in TypeScript, so you'd need to run it via Node/tsx
npx tsx -e "
import { setupTestDatabase } from './frontend/tests/setup/local-db-setup';
setupTestDatabase().then(({ connection, testData }) => {
  console.log('Database setup complete!');
  console.log('Test data:', testData);
});
"
```

## For Azure Functions Development

If you're developing the Azure Functions locally, create a `local.settings.json` in the `backend/polluserinformation/` directory:

```json
{
  "IsEncrypted": false,
  "Values": {
    "FUNCTIONS_WORKER_RUNTIME": "python",
    "AZURE_SQL_USER": "root",
    "AZURE_SQL_PASSWORD": "rootpassword",
    "AZURE_SQL_SERVER": "localhost",
    "AZURE_SQL_PORT": "3306",
    "AZURE_SQL_CATALOG_SCHEMA": "forestgeo_local"
  }
}
```

## Running Migrations

If you want to run the database migrations locally:

```bash
# Set connection variables
export MYSQL_HOST=localhost
export MYSQL_PORT=3306
export MYSQL_USER=root
export MYSQL_PASSWORD=rootpassword
export MYSQL_DATABASE=forestgeo_local

# Run migrations in order (from db-migrations directory)
cd frontend/db-migrations

mysql -h $MYSQL_HOST -P $MYSQL_PORT -u $MYSQL_USER -p$MYSQL_PASSWORD $MYSQL_DATABASE < 00b_ensure_table_structures.sql
mysql -h $MYSQL_HOST -P $MYSQL_PORT -u $MYSQL_USER -p$MYSQL_PASSWORD $MYSQL_DATABASE < 14_add_performance_indexes.sql
# ... continue with other migrations as needed
```

## Testing Your Setup

```bash
# Connect and verify
mysql -h 127.0.0.1 -P 3306 -u root -prootpassword forestgeo_local -e "SHOW TABLES;"

# Check if stored procedures exist
mysql -h 127.0.0.1 -P 3306 -u root -prootpassword forestgeo_local -e "SHOW PROCEDURE STATUS WHERE Db = 'forestgeo_local';"
```

## Stopping the Container

```bash
# Stop the container (data persists in volume)
docker-compose stop

# Stop and remove container (data still persists)
docker-compose down

# Stop and remove container + data volume (⚠️ deletes all data)
docker-compose down -v
```

## Troubleshooting

### Container won't start
- Check if port 3306 is already in use: `lsof -i :3306`
- Change the port mapping in `docker-compose.yml` if needed

### Connection refused
- Wait for MySQL to fully initialize (check logs: `docker-compose logs mysql`)
- Verify health check: `docker-compose ps`

### Permission issues
- Make sure the SQL files are readable
- Check Docker volume permissions

## Files Reference

- **Schema**: `frontend/sqlscripting/tablestructures.sql` - All table definitions
- **Stored Procedures**: `frontend/sqlscripting/storedprocedures.sql` - All stored procedures
- **Migrations**: `frontend/db-migrations/*.sql` - Migration scripts
- **Test Setup**: `frontend/tests/setup/local-db-setup.ts` - Automated test database setup



