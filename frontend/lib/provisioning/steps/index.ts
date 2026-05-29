import type { ProvisioningStep } from '../types';
import { validateInputsStep } from './validate-inputs';
import { createSchemaStep, initTablesStep, deployProceduresStep, seedValidationsStep } from './sql-steps';
import { insertCatalogRowStep, insertPlotStep, insertCensusStep } from './catalog-and-rows';
import { insertQuadratsStep } from './insert-quadrats';
import { verifyStep } from './verify';

/**
 * Canonical order of provisioning steps. The orchestrator iterates this list
 * once per run. The catalog row insert (insert_catalog_row) is intentionally
 * ordered AFTER all schema-initialization steps so the catalog never points
 * at an empty or partial schema.
 *
 * Note: `apply_migrations` is deliberately absent. The current sqlscripting/
 * tablestructures.sql already contains every column/table that the unified
 * measurements migrations (16-58) introduce; running them against a fresh
 * schema would fail with "already exists" errors.
 */
export const STEPS: ProvisioningStep[] = [
  validateInputsStep,
  createSchemaStep,
  initTablesStep,
  deployProceduresStep,
  seedValidationsStep,
  insertCatalogRowStep,
  insertPlotStep,
  insertCensusStep,
  insertQuadratsStep,
  verifyStep
];
