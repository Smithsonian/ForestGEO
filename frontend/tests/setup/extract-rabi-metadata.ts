/**
 * Extract Rabi plot metadata from Azure MySQL and save as SQL seed file.
 *
 * This script connects to the Azure MySQL `forestgeo_rabi` schema and exports
 * all metadata tables (plots, quadrats, census, personnel, roles, species chain,
 * attributes, specieslimits) as INSERT statements that can be loaded into the
 * local test database.
 *
 * Usage:
 *   npx tsx tests/setup/extract-rabi-metadata.ts
 *
 * Requires env vars (from .env.local):
 *   AZURE_SQL_USER, AZURE_SQL_PASSWORD, AZURE_SQL_SERVER, AZURE_SQL_PORT
 */

import mysql from 'mysql2/promise';
import fs from 'fs';
import path from 'path';

// Load env vars from frontend/.env.local manually (avoid dotenv dependency)
function loadEnvFile(filePath: string): void {
  if (!fs.existsSync(filePath)) return;
  const content = fs.readFileSync(filePath, 'utf-8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex === -1) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    let value = trimmed.slice(eqIndex + 1).trim();
    // Strip surrounding quotes
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

loadEnvFile(path.join(__dirname, '../../.env.local'));

const RABI_SCHEMA = 'forestgeo_rabi';
const OUTPUT_PATH = path.join(__dirname, 'rabi-seed-data.sql');

interface ColumnInfo {
  name: string;
  type: string;
}

async function getColumns(conn: mysql.Connection, schema: string, table: string): Promise<ColumnInfo[]> {
  const [rows] = await conn.query<mysql.RowDataPacket[]>(
    `SELECT COLUMN_NAME as name, DATA_TYPE as type
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
       AND (GENERATION_EXPRESSION IS NULL OR GENERATION_EXPRESSION = '')
     ORDER BY ORDINAL_POSITION`,
    [schema, table]
  );
  return rows as ColumnInfo[];
}

function escapeValue(value: any, colType: string): string {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number') return String(value);
  if (value instanceof Date) return `'${value.toISOString().slice(0, 19).replace('T', ' ')}'`;
  if (typeof value === 'boolean' || colType === 'tinyint' || colType === 'bit') {
    return value ? '1' : '0';
  }
  if (Buffer.isBuffer(value)) {
    // bit fields come as Buffer
    return value[0] ? '1' : '0';
  }
  // String - escape single quotes
  const str = String(value).replace(/'/g, "''").replace(/\\/g, '\\\\');
  return `'${str}'`;
}

async function exportTable(conn: mysql.Connection, schema: string, table: string, whereClause?: string): Promise<string> {
  const columns = await getColumns(conn, schema, table);
  const colNames = columns.map(c => c.name);

  let query = `SELECT * FROM \`${schema}\`.\`${table}\``;
  if (whereClause) query += ` WHERE ${whereClause}`;

  const [rows] = await conn.query<mysql.RowDataPacket[]>(query);

  if (rows.length === 0) return `-- ${table}: no rows\n`;

  const lines: string[] = [`-- ${table}: ${rows.length} rows`];

  for (const row of rows) {
    const values = colNames.map(col => {
      const colInfo = columns.find(c => c.name === col)!;
      return escapeValue(row[col], colInfo.type);
    });
    lines.push(`INSERT INTO \`${table}\` (${colNames.map(c => `\`${c}\``).join(', ')}) VALUES (${values.join(', ')});`);
  }

  return lines.join('\n') + '\n\n';
}

async function main() {
  const host = process.env.AZURE_SQL_SERVER;
  const user = process.env.AZURE_SQL_USER;
  const password = process.env.AZURE_SQL_PASSWORD;
  const port = parseInt(process.env.AZURE_SQL_PORT || '3306');

  if (!host || !user || !password) {
    console.error('Missing required env vars: AZURE_SQL_SERVER, AZURE_SQL_USER, AZURE_SQL_PASSWORD');
    console.error('Ensure frontend/.env.local has these set.');
    process.exit(1);
  }

  console.log(`Connecting to ${host}:${port} as ${user}...`);

  const conn = await mysql.createConnection({
    host,
    user,
    password,
    port,
    ssl: { rejectUnauthorized: false },
    multipleStatements: false
  });

  console.log(`Connected. Extracting metadata from ${RABI_SCHEMA}...`);

  let sql = '';
  sql += '-- Rabi plot metadata extracted from Azure MySQL\n';
  sql += `-- Generated: ${new Date().toISOString()}\n`;
  sql += `-- Source schema: ${RABI_SCHEMA}\n\n`;
  sql += 'SET FOREIGN_KEY_CHECKS = 0;\n\n';

  // Export tables in dependency order (parents first)
  // 1. Reference data (taxonomy chain)
  const tablesToExport = [
    { table: 'reference', where: undefined },
    { table: 'family', where: undefined },
    { table: 'genus', where: undefined },
    { table: 'species', where: undefined },
    // 2. Attributes (stem status codes)
    { table: 'attributes', where: undefined },
    // 3. Plot and spatial data
    { table: 'plots', where: undefined },
    { table: 'quadrats', where: undefined },
    // 4. Census
    { table: 'census', where: undefined },
    // 5. Personnel
    { table: 'roles', where: undefined },
    { table: 'personnel', where: undefined },
    { table: 'censusactivepersonnel', where: undefined },
    // 6. Species limits
    { table: 'specieslimits', where: undefined }
  ];

  for (const { table, where } of tablesToExport) {
    try {
      console.log(`  Exporting ${table}...`);
      sql += await exportTable(conn, RABI_SCHEMA, table, where);
    } catch (err: any) {
      console.warn(`  Warning: Could not export ${table}: ${err.message}`);
      sql += `-- ${table}: EXPORT FAILED - ${err.message}\n\n`;
    }
  }

  sql += 'SET FOREIGN_KEY_CHECKS = 1;\n';

  await conn.end();

  fs.writeFileSync(OUTPUT_PATH, sql, 'utf-8');
  console.log(`\nSeed data written to: ${OUTPUT_PATH}`);
  console.log(`File size: ${(fs.statSync(OUTPUT_PATH).size / 1024).toFixed(1)} KB`);
}

main().catch(err => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
