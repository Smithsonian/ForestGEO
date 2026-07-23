import type { ProvisioningStep, StepContext } from '../types';
import { ProvisioningError } from '../types';
import { acknowledgmentCoversLayout, validateQuadratCollectionDetailed } from '../quadrat-collection-validation';

const SCHEMA_PATTERN = /^forestgeo_[a-z0-9_]+$/;

export const validateInputsStep: ProvisioningStep = {
  key: 'validate_inputs',
  label: 'Validate inputs',

  async alreadyDone(): Promise<boolean> {
    return false;
  },

  async run(ctx: StepContext): Promise<void> {
    const { input, catalogPool, schemaName } = ctx;

    if (!SCHEMA_PATTERN.test(schemaName)) {
      throw new ProvisioningError(`Schema name "${schemaName}" must match ${SCHEMA_PATTERN}`, 'unsafe_input', {
        stepKey: 'validate_inputs',
        schemaName
      });
    }

    const [catalogRows]: any = await catalogPool.query(`SELECT SiteID FROM catalog.sites WHERE SchemaName = ? LIMIT 1`, [schemaName]);
    if (catalogRows.length > 0) {
      throw new ProvisioningError(`A catalog site already references schema "${schemaName}"`, 'conflict', {
        stepKey: 'validate_inputs',
        schemaName
      });
    }

    // On retry, the MySQL schema may already exist because create_schema completed
    // on a previous attempt. Treat that as expected, not an orphan.
    const [createSchemaStepRows]: any = await catalogPool.query(`SELECT Status FROM catalog.provisioning_steps WHERE RunID = ? AND StepKey = 'create_schema'`, [
      ctx.runId
    ]);
    const createSchemaStatus = createSchemaStepRows[0]?.Status ?? createSchemaStepRows[0]?.status;
    const createSchemaAlreadyComplete = createSchemaStatus === 'completed';

    const [schemaRows]: any = await catalogPool.query(`SELECT schema_name FROM information_schema.schemata WHERE schema_name = ? LIMIT 1`, [schemaName]);
    if (schemaRows.length > 0 && !createSchemaAlreadyComplete) {
      throw new ProvisioningError(
        `Schema "${schemaName}" already exists in MySQL but is not in catalog.sites. Investigate before provisioning over it.`,
        'conflict',
        {
          stepKey: 'validate_inputs',
          schemaName
        }
      );
    }

    if (input.quadrats.mode === 'grid') {
      const { quadratSizeX, quadratSizeY } = input.quadrats;
      if (input.plot.dimensionX % quadratSizeX !== 0) {
        throw new ProvisioningError(
          `Plot dimensionX (${input.plot.dimensionX}) is not divisible by quadrat size X (${quadratSizeX}). Use CSV mode for irregular grids.`,
          'invalid_input',
          { stepKey: 'validate_inputs' }
        );
      }
      if (input.plot.dimensionY % quadratSizeY !== 0) {
        throw new ProvisioningError(
          `Plot dimensionY (${input.plot.dimensionY}) is not divisible by quadrat size Y (${quadratSizeY}). Use CSV mode for irregular grids.`,
          'invalid_input',
          { stepKey: 'validate_inputs' }
        );
      }
    } else if (input.quadrats.mode === 'csv') {
      // Rows here are canonical south-west (run shape). Overlaps the admin acknowledged as
      // field measurements are not defects; every other issue kind fails the run.
      const validation = validateQuadratCollectionDetailed(input.quadrats.rows, input.plot, 'SW');
      const overlapsAcknowledged =
        validation.overlapSummary !== null && acknowledgmentCoversLayout(input.quadrats.overlapAcknowledgment, validation.overlapSummary.layoutSignature);
      if (validation.fatalIssues.length > 0) {
        throw new ProvisioningError(validation.fatalIssues[0].message, 'invalid_input', { stepKey: 'validate_inputs' });
      }
      if (validation.overlapSummary && !overlapsAcknowledged) {
        throw new ProvisioningError(validation.overlapSummary.pairs[0].message, 'invalid_input', { stepKey: 'validate_inputs' });
      }
    }
  }
};
