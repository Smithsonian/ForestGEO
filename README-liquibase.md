# ForestGEO Liquibase Setup

This setup allows you to manage database schema changes across all ForestGEO databases using Liquibase.

## Files Created

- `liquibase.properties` - Main Liquibase configuration
- `changelog/master-changelog.xml` - Master changelog file
- `changelog/initial-schema.xml` - Generated initial schema (206 changesets)
- `deploy-schemas.sh` - Deployment script for all schemas

## Available Schemas

- forestgeo_harvard
- forestgeo_mpala
- forestgeo_panama
- forestgeo_serc
- forestgeo_testing

## Usage

### Deploy to all schemas
```bash
./deploy-schemas.sh all
```

### Deploy to specific schema
```bash
./deploy-schemas.sh forestgeo_testing
```

### Check deployment status
```bash
./deploy-schemas.sh status
```

## Workflow

1. Make changes to `forestgeo_testing` schema manually
2. Generate new changelog:
   ```bash
   liquibase diffChangeLog --referenceUrl=jdbc:mysql://forestgeo-mysqldataserver.mysql.database.azure.com:3306/forestgeo_testing
   ```
3. Deploy changes to other schemas:
   ```bash
   ./deploy-schemas.sh all
   ```

## Adding New Changes

Create new changelog files in the `changelog/` directory and include them in `master-changelog.xml`:

```xml
<include file="changelog/new-feature-changes.xml"/>
```