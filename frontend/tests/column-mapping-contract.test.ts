import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { SourceFormat } from '@/config/macros/formdetails';
import { readArcgisWorkbookDetailed } from '@/lib/arcgis/workbook-reader';
import { seedMapping, validateMapping } from '@/lib/column-mapping/mapping';
import type { ArcgisSourceMetadata, ColumnMapping } from '@/lib/column-mapping/types';

async function buildWorkbook(sheets: Record<string, unknown[][]>): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook();
  for (const [name, aoa] of Object.entries(sheets)) {
    const ws = wb.addWorksheet(name);
    aoa.forEach(row => ws.addRow(row));
  }
  return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
}

/** Build ArcgisSourceMetadata from the sheets fixture, optionally pinning sheet roles. */
function metaFor(sheets: Record<string, unknown[][]>, trees?: string, stems?: string): ArcgisSourceMetadata {
  return {
    format: SourceFormat.arcgis_xlsx,
    sheets: Object.entries(sheets).map(([name, aoa]) => ({
      name,
      columns: (aoa[0] as string[]).map(String)
    })),
    detectedTreesSheet: trees,
    detectedStemsSheet: stems
  };
}

// Canonical headers matching the ARCGIS_SCHEMA aliases exactly.
const CANONICAL_TREE_HEADERS = ['GlobalID', 'quadrat', 'tag', 'StemTag', 'spcode', 'Date_measured', 'lx', 'ly'];
const CANONICAL_STEM_HEADERS = ['GlobalID', 'ParentGlobalID', 'quadrat', 'tag', 'StemTag', 'spcode', 'Date_measured'];
const CANONICAL_TREE_ROW = ['G1', 'A25', '100', '100', 'QURU', 46036, '5.1', '6.2'];
const CANONICAL_STEM_ROW = ['S1', 'G1', 'A25', '100', '100-1', 'QURU', 46036];

// Custom headers — deliberately non-canonical so they require an explicit mapping.
const CUSTOM_TREE_HEADERS = ['GlobalID', 'Q', 'TreeTag', 'StemTag', 'Sp', 'When', 'MyX', 'MyY'];
const CUSTOM_STEM_HEADERS = ['GlobalID', 'ParentGlobalID', 'Q', 'TreeTag', 'StemTag', 'Sp', 'When'];
const CUSTOM_TREE_ROW = ['G1', 'A25', '100', '100', 'QURU', 46036, '5.1', '6.2'];
const CUSTOM_STEM_ROW = ['S1', 'G1', 'A25', '100', '100-1', 'QURU', 46036];

interface ContractFixture {
  name: string;
  sheets: Record<string, unknown[][]>;
  buildMapping: (baseMetaWithoutRoles: ArcgisSourceMetadata) => ColumnMapping;
  expectedBothValid: boolean;
}

const fixtures: ContractFixture[] = [
  {
    name: 'canonical workbook with seeded mapping',
    sheets: {
      trees: [CANONICAL_TREE_HEADERS, CANONICAL_TREE_ROW],
      stems: [CANONICAL_STEM_HEADERS, CANONICAL_STEM_ROW]
    },
    buildMapping: baseMetaWithoutRoles => seedMapping({ ...baseMetaWithoutRoles, detectedTreesSheet: 'trees', detectedStemsSheet: 'stems' }),
    expectedBothValid: true
  },
  {
    name: 'custom headers with explicit field overrides',
    sheets: {
      TreesCustom: [CUSTOM_TREE_HEADERS, CUSTOM_TREE_ROW],
      StemsCustom: [CUSTOM_STEM_HEADERS, CUSTOM_STEM_ROW]
    },
    buildMapping: baseMetaWithoutRoles => {
      const metaWithRoles: ArcgisSourceMetadata = {
        ...baseMetaWithoutRoles,
        detectedTreesSheet: 'TreesCustom',
        detectedStemsSheet: 'StemsCustom'
      };
      const seeded = seedMapping(metaWithRoles);
      // Override each non-canonical column to its custom header name.
      const overrideMap: Record<string, string> = {
        tag: 'TreeTag',
        spcode: 'Sp',
        quadrat: 'Q',
        Date_measured: 'When',
        lx: 'MyX',
        ly: 'MyY'
      };
      return {
        ...seeded,
        fields: seeded.fields.map(f => {
          const override = overrideMap[f.canonicalField];
          return override !== undefined ? { ...f, sourceColumns: [override] } : f;
        })
      };
    },
    expectedBothValid: true
  },
  {
    name: 'trees-scoped required field (lx/ly) mapped to stems-only columns',
    sheets: {
      // Trees sheet has no coords at all; stems sheet has PosX/PosY.
      trees: [['GlobalID', 'quadrat', 'tag', 'StemTag', 'spcode', 'Date_measured'], CANONICAL_TREE_ROW.slice(0, 6)],
      stems: [
        ['GlobalID', 'ParentGlobalID', 'quadrat', 'tag', 'StemTag', 'spcode', 'Date_measured', 'PosX', 'PosY'],
        [...CANONICAL_STEM_ROW, '5.1', '6.2']
      ]
    },
    buildMapping: baseMetaWithoutRoles => {
      const metaWithRoles: ArcgisSourceMetadata = {
        ...baseMetaWithoutRoles,
        detectedTreesSheet: 'trees',
        detectedStemsSheet: 'stems'
      };
      const seeded = seedMapping(metaWithRoles);
      // Map lx/ly to the stems-only columns; they cannot resolve on the trees sheet.
      return {
        ...seeded,
        fields: seeded.fields.map(f => {
          if (f.canonicalField === 'lx') return { ...f, sourceColumns: ['PosX'] };
          if (f.canonicalField === 'ly') return { ...f, sourceColumns: ['PosY'] };
          return f;
        })
      };
    },
    expectedBothValid: false
  },
  {
    name: 'duplicate sheet roles (both roles name the same sheet)',
    sheets: {
      trees: [CANONICAL_TREE_HEADERS, CANONICAL_TREE_ROW],
      stems: [CANONICAL_STEM_HEADERS, CANONICAL_STEM_ROW]
    },
    buildMapping: baseMetaWithoutRoles => {
      const seeded = seedMapping({ ...baseMetaWithoutRoles, detectedTreesSheet: 'trees', detectedStemsSheet: 'stems' });
      // Force both roles to the same sheet name — this is the duplicate-roles scenario.
      return {
        ...seeded,
        sheetRoles: { treesSheetName: 'trees', stemsSheetName: 'trees' }
      };
    },
    expectedBothValid: false
  },
  {
    name: 'missing required column (lx/ly absent from trees sheet, no custom mapping)',
    sheets: {
      // Trees sheet missing lx and ly entirely; stems sheet is valid.
      trees: [['GlobalID', 'quadrat', 'tag', 'StemTag', 'spcode', 'Date_measured'], CANONICAL_TREE_ROW.slice(0, 6)],
      stems: [CANONICAL_STEM_HEADERS, CANONICAL_STEM_ROW]
    },
    buildMapping: baseMetaWithoutRoles => seedMapping({ ...baseMetaWithoutRoles, detectedTreesSheet: 'trees', detectedStemsSheet: 'stems' }),
    expectedBothValid: false
  }
];

describe('column-mapping contract: client validateMapping agrees with server readArcgisWorkbookDetailed', () => {
  for (const fixture of fixtures) {
    it(fixture.name, async () => {
      // Build mapping from preliminary metadata (no roles yet); roles are set inside buildMapping.
      const preliminaryMeta = metaFor(fixture.sheets);
      const mapping = fixture.buildMapping(preliminaryMeta);

      // Client verdict: validateMapping against metadata that has the roles the mapping carries.
      const metaWithRoles = metaFor(fixture.sheets, mapping.sheetRoles?.treesSheetName, mapping.sheetRoles?.stemsSheetName);
      const clientVerdict = validateMapping(mapping, metaWithRoles).valid;

      // Server verdict: readArcgisWorkbookDetailed on the actual workbook buffer.
      const buffer = await buildWorkbook(fixture.sheets);
      const outcome = await readArcgisWorkbookDetailed(buffer, mapping);

      // Both sides must agree on acceptance. A disagreement is a bug — report it rather than masking.
      expect(outcome.ok, `"${fixture.name}": client said valid=${clientVerdict}; server said ok=${outcome.ok}`).toBe(clientVerdict);

      // Fixture-level assertion so both sides cannot be simultaneously wrong in the same direction.
      expect(clientVerdict, `"${fixture.name}": expected both to be ${fixture.expectedBothValid} but client was ${clientVerdict}`).toBe(
        fixture.expectedBothValid
      );
      expect(outcome.ok, `"${fixture.name}": expected both to be ${fixture.expectedBothValid} but server was ${outcome.ok}`).toBe(fixture.expectedBothValid);
    });
  }
});
