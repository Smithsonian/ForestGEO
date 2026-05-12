import type { ProvisioningStep, StepContext, QuadratCsvRow } from '../types';
import { ProvisioningError } from '../types';

const SCHEMA_PATTERN = /^forestgeo_[a-z0-9_]+$/;

export function rectsOverlap(a: QuadratCsvRow, b: QuadratCsvRow): boolean {
  return a.startX < b.startX + b.dimensionX && a.startX + a.dimensionX > b.startX && a.startY < b.startY + b.dimensionY && a.startY + a.dimensionY > b.startY;
}

export const validateInputsStep: ProvisioningStep = {
  key: 'validate_inputs',
  label: 'Validate inputs',

  async alreadyDone(): Promise<boolean> {
    return false;
  },

  async run(ctx: StepContext): Promise<void> {
    const { input, catalogPool, schemaName } = ctx;

    if (!SCHEMA_PATTERN.test(schemaName)) {
      throw new ProvisioningError(`Schema name "${schemaName}" must match ${SCHEMA_PATTERN}`, 'validate_inputs');
    }

    const [catalogRows]: any = await catalogPool.query(`SELECT SiteID FROM catalog.sites WHERE SchemaName = ? LIMIT 1`, [schemaName]);
    if (catalogRows.length > 0) {
      throw new ProvisioningError(`A catalog site already references schema "${schemaName}"`, 'validate_inputs');
    }

    const [schemaRows]: any = await catalogPool.query(`SELECT schema_name FROM information_schema.schemata WHERE schema_name = ? LIMIT 1`, [schemaName]);
    if (schemaRows.length > 0) {
      throw new ProvisioningError(
        `Schema "${schemaName}" already exists in MySQL but is not in catalog.sites. Investigate before provisioning over it.`,
        'validate_inputs'
      );
    }

    if (input.quadrats.mode === 'grid') {
      const { quadratSizeX, quadratSizeY } = input.quadrats;
      if (input.plot.dimensionX % quadratSizeX !== 0) {
        throw new ProvisioningError(
          `Plot dimensionX (${input.plot.dimensionX}) is not divisible by quadrat size X (${quadratSizeX}). Use CSV mode for irregular grids.`,
          'validate_inputs'
        );
      }
      if (input.plot.dimensionY % quadratSizeY !== 0) {
        throw new ProvisioningError(
          `Plot dimensionY (${input.plot.dimensionY}) is not divisible by quadrat size Y (${quadratSizeY}). Use CSV mode for irregular grids.`,
          'validate_inputs'
        );
      }
    } else {
      const rows = input.quadrats.rows;
      for (const row of rows) {
        if (row.startX < 0 || row.startY < 0) {
          throw new ProvisioningError(`Quadrat "${row.quadratName}" has negative start coordinates`, 'validate_inputs');
        }
        if (row.startX + row.dimensionX > input.plot.dimensionX) {
          throw new ProvisioningError(`Quadrat "${row.quadratName}" extends past plot dimensionX`, 'validate_inputs');
        }
        if (row.startY + row.dimensionY > input.plot.dimensionY) {
          throw new ProvisioningError(`Quadrat "${row.quadratName}" extends past plot dimensionY`, 'validate_inputs');
        }
      }
      for (let i = 0; i < rows.length; i++) {
        for (let j = i + 1; j < rows.length; j++) {
          if (rectsOverlap(rows[i], rows[j])) {
            throw new ProvisioningError(`Quadrats "${rows[i].quadratName}" and "${rows[j].quadratName}" overlap`, 'validate_inputs');
          }
        }
      }
    }
  }
};
