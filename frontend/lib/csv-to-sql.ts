/**
 * Convert an app-exported census CSV into a SQL file that creates and bulk-loads
 * a `TempAllTrees` staging table matching the legacy ctfsweb schema.
 *
 * Usage:
 *   npx tsx scripts/csv-to-sql.ts \
 *     --input <path/to/census.csv> \
 *     --site SERC \
 *     --plot-id 1 \
 *     --census-number 2 \
 *     [--output <path/to/out.sql>] \
 *     [--temp-table TempAllTrees]
 *
 * Produces a .sql file (default: <input>.sql) ready to run against MySQL.
 * Never connects to the database.
 *
 * See: frontend/docs/superpowers/specs/2026-05-11-csv-to-sql-design.md
 */

import { parseArgs } from 'node:util';

export interface CliArgs {
  input: string;
  site: string;
  plotId: number;
  censusNumber: number;
  output: string;
  tempTable: string;
}

const DEFAULT_TEMP_TABLE = 'TempAllTrees';

export function parseCliArgs(argv: string[]): CliArgs {
  const { values } = parseArgs({
    args: argv,
    options: {
      input: { type: 'string' },
      site: { type: 'string' },
      'plot-id': { type: 'string' },
      'census-number': { type: 'string' },
      output: { type: 'string' },
      'temp-table': { type: 'string' }
    },
    strict: true
  });

  if (!values.input) throw new Error('Missing required flag: --input');
  if (!values.site) throw new Error('Missing required flag: --site');
  if (!values['plot-id']) throw new Error('Missing required flag: --plot-id');
  if (!values['census-number']) throw new Error('Missing required flag: --census-number');

  const plotId = Number(values['plot-id']);
  if (!Number.isInteger(plotId)) throw new Error(`--plot-id must be an integer, got: ${values['plot-id']}`);

  const censusNumber = Number(values['census-number']);
  if (!Number.isInteger(censusNumber)) throw new Error(`--census-number must be an integer, got: ${values['census-number']}`);

  const output = values.output ?? defaultOutputPath(values.input);
  const tempTable = values['temp-table'] ?? DEFAULT_TEMP_TABLE;

  return { input: values.input, site: values.site, plotId, censusNumber, output, tempTable };
}

function defaultOutputPath(input: string): string {
  return input.endsWith('.csv') ? input.slice(0, -'.csv'.length) + '.sql' : input + '.sql';
}

async function main(): Promise<void> {
  const args = parseCliArgs(process.argv.slice(2));
  // Wired in Task 6. For now, echo the parsed args.
  process.stdout.write(JSON.stringify(args, null, 2) + '\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(err => {
    process.stderr.write(`${err.message}\n`);
    process.exit(1);
  });
}
