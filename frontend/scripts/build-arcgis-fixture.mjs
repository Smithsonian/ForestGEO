/**
 * Generates the two-sheet ArcGIS xlsx fixture for the column-mapping e2e specs.
 *
 * Uses the same `exceljs` dependency the app's ArcGIS workbook reader uses
 * (lib/arcgis/workbook-reader.ts), so the produced file round-trips through the
 * real reader. Headers are the canonical ArcGIS schema columns
 * (lib/arcgis/schema.ts): the trees sheet carries the required tree fields and
 * the stems sheet carries the `ParentGlobalID` stem-signature column, so the
 * file is genuinely trees-shaped and stems-shaped.
 */
import ExcelJS from 'exceljs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const FIXTURE_FILENAME = 'arcgis-two-sheet.xlsx';
const TREES_SHEET_NAME = 'Trees';
const STEMS_SHEET_NAME = 'Stems';

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'cypress', 'fixtures', 'column-mapping');
const workbook = new ExcelJS.Workbook();

const trees = workbook.addWorksheet(TREES_SHEET_NAME);
trees.addRow(['GlobalID', 'tag', 'StemTag', 'spcode', 'quadrat', 'lx', 'ly', 'Date_measured']);
trees.addRow(['tree-101', '101', '1', 'ABC', 'Q01', '1.5', '2.5', '2024-01-15']);

const stems = workbook.addWorksheet(STEMS_SHEET_NAME);
stems.addRow(['GlobalID', 'ParentGlobalID', 'tag', 'StemTag', 'spcode', 'quadrat', 'DBH_CURRENT', 'Date_measured']);
stems.addRow(['stem-101-1', 'tree-101', '101', '1', 'ABC', 'Q01', '12.3', '2024-01-15']);

await workbook.xlsx.writeFile(join(outDir, FIXTURE_FILENAME));
console.log(`wrote ${FIXTURE_FILENAME}`);
