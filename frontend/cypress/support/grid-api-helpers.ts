type GenericRow = Record<string, any>;

export interface MeasurementValidationFailure {
  coreMeasurementID: number;
  validationErrorIDs?: number[];
  descriptions: string[];
  criteria: string[];
}

interface MutationContext<Row extends GenericRow> {
  oldRow: Partial<Row>;
  newRow: Partial<Row>;
  state: {
    rows: Row[];
    validationFailures?: MeasurementValidationFailure[];
  };
}

interface MutationReply<Row extends GenericRow> {
  statusCode?: number;
  body?: Record<string, any>;
  rows?: Row[];
  validationFailures?: MeasurementValidationFailure[];
}

interface MockIsolatedGridApiOptions<Row extends GenericRow> {
  gridType: string;
  rows: Row[];
  schema?: string;
  refreshView?: string;
  onPatch?: (context: MutationContext<Row>) => MutationReply<Row> | void;
  onDelete?: (context: MutationContext<Row>) => MutationReply<Row> | void;
}

interface MockMeasurementsSummaryApiOptions<Row extends GenericRow> {
  rows: Row[];
  schema?: string;
  validationFailures?: MeasurementValidationFailure[];
  onPatch?: (context: MutationContext<Row>) => MutationReply<Row> | void;
}

const DEFAULT_SCHEMA = 'luquillo';

function normalizeRequestBody(body: any) {
  if (typeof body !== 'string') {
    return body;
  }

  try {
    return JSON.parse(body);
  } catch {
    return body;
  }
}

function extractPagination(url: string) {
  const pathname = new URL(url).pathname;
  const match = pathname.match(/\/api\/(?:fixeddata|fixeddatafilter)\/[^/]+\/[^/]+\/(\d+)\/(\d+)(?:\/|$)/);

  return {
    page: Number(match?.[1] ?? 0),
    pageSize: Number(match?.[2] ?? 10)
  };
}

function normalizeText(value: unknown): string {
  if (value == null) return '';
  if (Array.isArray(value)) return value.map(normalizeText).join(' ');
  if (typeof value === 'object')
    return Object.values(value as Record<string, unknown>)
      .map(normalizeText)
      .join(' ');
  return String(value).toLowerCase();
}

function matchesQuickFilter(row: GenericRow, quickFilterValues: unknown[] = []) {
  if (!quickFilterValues.length) return true;

  const haystack = Object.values(row).map(normalizeText).join(' ');
  return quickFilterValues.every(value => haystack.includes(String(value).toLowerCase()));
}

function paginateRows<Row extends GenericRow>(rows: Row[], url: string) {
  const { page, pageSize } = extractPagination(url);
  const start = page * pageSize;
  const end = start + pageSize;

  return {
    output: rows.slice(start, end),
    totalCount: rows.length
  };
}

function rowKeyCandidates(row?: GenericRow) {
  if (!row) return [];

  return [row.id, row.coreMeasurementID, row.code, row.failedMeasurementID, row.quadratID, row.speciesID, row.personnelID].filter(
    candidate => candidate !== undefined && candidate !== null && candidate !== ''
  );
}

function findRowIndex<Row extends GenericRow>(rows: Row[], oldRow?: Partial<Row>, newRow?: Partial<Row>) {
  const candidates = [...rowKeyCandidates(oldRow as GenericRow), ...rowKeyCandidates(newRow as GenericRow)];

  return rows.findIndex(row => {
    const rowCandidates = rowKeyCandidates(row);
    return candidates.some(candidate => rowCandidates.includes(candidate));
  });
}

function applyRowUpdate<Row extends GenericRow>(rows: Row[], oldRow: Partial<Row>, newRow: Partial<Row>) {
  const nextRows = [...rows];
  const index = findRowIndex(nextRows, oldRow, newRow);

  if (index === -1) return nextRows;

  nextRows[index] = {
    ...nextRows[index],
    ...newRow
  };

  return nextRows;
}

function removeRow<Row extends GenericRow>(rows: Row[], rowToDelete: Partial<Row>) {
  const index = findRowIndex(rows, rowToDelete, rowToDelete);
  if (index === -1) return rows;

  return rows.filter((_row, rowIndex) => rowIndex !== index);
}

function uniqueValues(rows: GenericRow[], field: string) {
  return Array.from(new Set(rows.map(row => row[field]).filter(value => value !== undefined && value !== null && `${value}`.trim() !== ''))).sort();
}

function replyWithPage<Row extends GenericRow>(req: Cypress.Request, rows: Row[]) {
  req.reply({
    statusCode: 200,
    body: paginateRows(rows, req.url)
  });
}

function defaultTssFilters() {
  return ['old tree', 'multi stem', 'new recruit'];
}

function matchesTreeStemState(row: GenericRow, tss: string[] = defaultTssFilters()) {
  if (!tss.length) return false;

  const userDefinedFields = normalizeText(row.userDefinedFields);
  return tss.some(filter => userDefinedFields.includes(filter));
}

function buildCounts(rows: GenericRow[], validationFailures: MeasurementValidationFailure[]) {
  const failedIDs = new Set(validationFailures.map(failure => Number(failure.coreMeasurementID)));

  const countInvalid = rows.filter(row => failedIDs.has(Number(row.coreMeasurementID))).length;
  const countPending = rows.filter(row => !failedIDs.has(Number(row.coreMeasurementID)) && row.isValidated == null).length;
  const countValid = rows.filter(row => !failedIDs.has(Number(row.coreMeasurementID)) && row.isValidated === true).length;

  return {
    CountValid: countValid,
    CountInvalid: countInvalid,
    CountValidationErrors: countInvalid,
    CountPending: countPending,
    CountOldTrees: rows.filter(row => normalizeText(row.userDefinedFields).includes('old tree')).length,
    CountNewRecruits: rows.filter(row => normalizeText(row.userDefinedFields).includes('new recruit')).length,
    CountMultiStems: rows.filter(row => normalizeText(row.userDefinedFields).includes('multi stem')).length
  };
}

function buildLookupRows(rows: GenericRow[], field: string, key: string) {
  return uniqueValues(rows, field).map(value => ({
    [key]: value
  }));
}

export function buildMeasurementsSummaryRow(overrides: Record<string, any> = {}) {
  const coreMeasurementID = Number(overrides.coreMeasurementID ?? overrides.id ?? 1);

  return {
    id: coreMeasurementID,
    coreMeasurementID,
    censusID: 7,
    quadratID: 101,
    plotID: 1,
    treeID: 5000 + coreMeasurementID,
    stemGUID: 9000 + coreMeasurementID,
    speciesID: 300 + coreMeasurementID,
    quadratName: 'Q0101',
    speciesName: 'Rubiaceae example',
    subspeciesName: '',
    speciesCode: 'RUBI04',
    treeTag: `TREE${String(coreMeasurementID).padStart(3, '0')}`,
    stemTag: '1',
    stemLocalX: 10.1,
    stemLocalY: 20.2,
    measurementDate: '2024-06-15',
    measuredDBH: 15.5,
    measuredHOM: 1.3,
    isValidated: true,
    description: '',
    attributes: 'A',
    userDefinedFields: 'old tree',
    errors: '',
    ...overrides
  };
}

export function buildViewFullTableRow(overrides: Record<string, any> = {}) {
  const coreMeasurementID = Number(overrides.coreMeasurementID ?? overrides.id ?? 1);

  return {
    id: coreMeasurementID,
    coreMeasurementID,
    plotID: 1,
    censusID: 7,
    quadratID: 101,
    treeID: 5000 + coreMeasurementID,
    stemGUID: 9000 + coreMeasurementID,
    speciesID: 300 + coreMeasurementID,
    genusID: 25,
    familyID: 7,
    measurementDate: '2024-06-15',
    measuredDBH: 15.5,
    measuredHOM: 1.3,
    description: '',
    isValidated: true,
    plotName: 'Luquillo Main Plot',
    locationName: 'Luquillo',
    countryName: 'Puerto Rico',
    dimensionX: 500,
    dimensionY: 1000,
    plotArea: 50,
    plotGlobalX: 0,
    plotGlobalY: 0,
    plotGlobalZ: 0,
    plotShape: 'rectangle',
    plotDescription: 'Main plot',
    plotDefaultDimensionUnits: 'm',
    plotDefaultCoordinateUnits: 'm',
    plotDefaultAreaUnits: 'ha',
    plotDefaultDBHUnits: 'mm',
    plotDefaultHOMUnits: 'm',
    censusStartDate: '2020-01-01',
    censusEndDate: '2020-12-31',
    censusDescription: 'Fifth census',
    plotCensusNumber: 5,
    quadratName: 'Q0101',
    quadratDimensionX: 20,
    quadratDimensionY: 20,
    quadratArea: 400,
    quadratStartX: 0,
    quadratStartY: 0,
    quadratShape: 'square',
    treeTag: `TREE${String(coreMeasurementID).padStart(3, '0')}`,
    stemTag: '1',
    stemLocalX: 10.1,
    stemLocalY: 20.2,
    speciesCode: 'RUBI04',
    speciesName: 'Rubiaceae example',
    subspeciesName: '',
    subspeciesAuthority: '',
    speciesIDLevel: 'species',
    genus: 'Examplegenus',
    genusAuthority: '',
    family: 'Rubiaceae',
    attributes: 'A',
    userDefinedFields: '',
    ...overrides
  };
}

export function buildAttributeRow(overrides: Record<string, any> = {}) {
  const id = Number(overrides.id ?? 1);

  return {
    id,
    code: `ATTR${String(id).padStart(3, '0')}`,
    description: `Attribute ${id}`,
    status: 'active',
    ...overrides
  };
}

export function buildQuadratRow(overrides: Record<string, any> = {}) {
  const quadratID = Number(overrides.quadratID ?? overrides.id ?? 1);

  return {
    id: quadratID,
    quadratID,
    plotID: 1,
    quadratName: `Q${String(quadratID).padStart(4, '0')}`,
    startX: 0,
    startY: 0,
    dimensionX: 20,
    dimensionY: 20,
    area: 400,
    quadratShape: 'square',
    ...overrides
  };
}

export function buildTaxonomyRow(overrides: Record<string, any> = {}) {
  const speciesID = Number(overrides.speciesID ?? overrides.id ?? 1);
  const speciesCode = overrides.speciesCode ?? `SP${String(speciesID).padStart(4, '0')}`;
  const speciesDescription = overrides.speciesDescription ?? overrides.description ?? 'Example species description';

  return {
    id: speciesID,
    familyID: 100 + speciesID,
    genusID: 200 + speciesID,
    speciesID,
    family: 'Rubiaceae',
    genus: 'Psychotria',
    genusAuthority: 'L.',
    speciesCode,
    speciesName: 'berteriana',
    subspeciesName: '',
    idLevel: 'species',
    speciesAuthority: 'DC.',
    subspeciesAuthority: '',
    validCode: overrides.validCode ?? speciesCode,
    fieldFamily: 'Rubiaceae',
    speciesDescription,
    description: speciesDescription,
    ...overrides
  };
}

export function mockIsolatedGridApi<Row extends GenericRow>({
  gridType,
  rows,
  schema = DEFAULT_SCHEMA,
  refreshView = gridType,
  onPatch,
  onDelete
}: MockIsolatedGridApiOptions<Row>) {
  const state = {
    rows: [...rows]
  };

  cy.intercept('GET', `**/api/fixeddata/${gridType}/${schema}/**`, req => {
    req.reply({
      statusCode: 200,
      body: {
        ...paginateRows(state.rows, req.url),
        finishedQuery: `SELECT * FROM ${schema}.${gridType}`
      }
    });
  }).as('fetchIsolatedGridRows');

  cy.intercept('POST', `**/api/fixeddatafilter/${gridType}/${schema}/**`, req => {
    const quickFilterValues = req.body?.filterModel?.quickFilterValues ?? [];
    const filteredRows = state.rows.filter(row => matchesQuickFilter(row, quickFilterValues));
    req.reply({
      statusCode: 200,
      body: {
        ...paginateRows(filteredRows, req.url),
        finishedQuery: `SELECT * FROM ${schema}.${gridType}`
      }
    });
  }).as('filterIsolatedGridRows');

  cy.intercept('PATCH', `**/api/fixeddata/${gridType}/${schema}/**`, req => {
    const oldRow = (req.body?.oldRow ?? {}) as Partial<Row>;
    const newRow = (req.body?.newRow ?? {}) as Partial<Row>;
    const mutation = onPatch?.({ oldRow, newRow, state });
    const statusCode = mutation?.statusCode ?? 200;

    if (mutation?.rows) {
      state.rows = mutation.rows;
    } else if (statusCode < 400) {
      state.rows = applyRowUpdate(state.rows, oldRow, newRow);
    }

    req.reply({
      statusCode,
      body:
        mutation?.body ??
        (statusCode < 400
          ? {
              message: 'Row updated successfully',
              row: newRow
            }
          : {
              message: 'Row update failed'
            })
    });
  }).as('saveIsolatedGridRow');

  cy.intercept('DELETE', `**/api/fixeddata/${gridType}/${schema}/**`, req => {
    const rowToDelete = (req.body?.newRow ?? {}) as Partial<Row>;
    const mutation = onDelete?.({ oldRow: rowToDelete, newRow: rowToDelete, state });
    const statusCode = mutation?.statusCode ?? 200;

    if (mutation?.rows) {
      state.rows = mutation.rows;
    } else if (statusCode < 400) {
      state.rows = removeRow(state.rows, rowToDelete);
    }

    req.reply({
      statusCode,
      body:
        mutation?.body ??
        (statusCode < 400
          ? {
              success: true
            }
          : {
              message: 'Row deletion failed'
            })
    });
  }).as('deleteIsolatedGridRow');

  cy.intercept('POST', '/api/query', req => {
    const body = normalizeRequestBody(req.body);

    if (typeof body === 'string') {
      req.reply({
        statusCode: 200,
        body: state.rows
      });
      return;
    }

    req.reply({
      statusCode: 200,
      body: { success: true }
    });
  }).as('runIsolatedGridQuery');

  cy.intercept('POST', `**/api/refreshviews/${refreshView}/${schema}**`, {
    statusCode: 200,
    body: { success: true }
  }).as('refreshIsolatedGridView');

  return state;
}

export function mockMeasurementsSummaryApi<Row extends GenericRow>({
  rows,
  schema = DEFAULT_SCHEMA,
  validationFailures = [],
  onPatch
}: MockMeasurementsSummaryApiOptions<Row>) {
  const state = {
    rows: [...rows],
    validationFailures: [...validationFailures]
  };

  const filteredRows = (req: Cypress.Request) => {
    const filterModel = req.body?.filterModel ?? {};
    const quickFilterValues = filterModel.quickFilterValues ?? [];
    const visible = Array.isArray(filterModel.visible) && filterModel.visible.length ? filterModel.visible : ['errors', 'valid', 'pending'];
    const tss = Array.isArray(filterModel.tss) && filterModel.tss.length ? filterModel.tss : defaultTssFilters();
    const invalidIDs = new Set(state.validationFailures.map(failure => Number(failure.coreMeasurementID)));

    return state.rows.filter(row => {
      const rowHasError = invalidIDs.has(Number(row.coreMeasurementID));
      const matchesVisibleFilter = rowHasError ? visible.includes('errors') : row.isValidated == null ? visible.includes('pending') : visible.includes('valid');

      return matchesVisibleFilter && matchesTreeStemState(row, tss) && matchesQuickFilter(row, quickFilterValues);
    });
  };

  cy.intercept('POST', `**/api/fixeddatafilter/measurementssummary/${schema}/**`, req => {
    replyWithPage(req, filteredRows(req));
  }).as('filterMeasurementsSummaryRows');

  cy.intercept('PATCH', `**/api/fixeddata/measurementssummary/${schema}/coreMeasurementID**`, req => {
    const oldRow = (req.body?.oldRow ?? {}) as Partial<Row>;
    const newRow = (req.body?.newRow ?? {}) as Partial<Row>;
    const mutation = onPatch?.({ oldRow, newRow, state });
    const statusCode = mutation?.statusCode ?? 200;

    if (mutation?.rows) {
      state.rows = mutation.rows;
    } else if (statusCode < 400) {
      state.rows = applyRowUpdate(state.rows, oldRow, newRow);
    }

    if (mutation?.validationFailures) {
      state.validationFailures = mutation.validationFailures;
    }

    req.reply({
      statusCode,
      body:
        mutation?.body ??
        (statusCode < 400
          ? {
              message: 'Row updated successfully',
              row: newRow
            }
          : {
              message: 'Row update failed'
            })
    });
  });

  cy.intercept('GET', '**/api/validations/validationerrordisplay?*', req => {
    req.reply({
      statusCode: 200,
      body: {
        failed: state.validationFailures.map((failure, index) => ({
          coreMeasurementID: failure.coreMeasurementID,
          validationErrorIDs: failure.validationErrorIDs ?? failure.descriptions.map((_description, descriptionIndex) => index * 10 + descriptionIndex + 1),
          descriptions: failure.descriptions,
          criteria: failure.criteria
        }))
      }
    });
  });

  cy.intercept('POST', '/api/query', req => {
    const body = normalizeRequestBody(req.body);

    if (typeof body === 'string') {
      if (body.includes('CountValid') || body.includes('CountInvalid') || body.includes('CountPending') || body.includes('CountValidationErrors')) {
        req.reply({
          statusCode: 200,
          body: [buildCounts(state.rows, state.validationFailures)]
        });
        return;
      }

      req.reply({
        statusCode: 200,
        body: state.rows
      });
      return;
    }

    if (body?.query && typeof body.query === 'string') {
      if (body.query.includes('DELETE mel')) {
        const measurementID = Number(body.params?.[2]);
        state.validationFailures = state.validationFailures.filter(failure => Number(failure.coreMeasurementID) !== measurementID);
      }

      if (body.query.includes('UPDATE ??.coremeasurements SET IsValidated = NULL')) {
        const measurementID = Number(body.params?.[1]);
        state.rows = state.rows.map(row => (Number(row.coreMeasurementID) === measurementID ? { ...row, isValidated: null } : row));
      }

      req.reply({
        statusCode: 200,
        body: { success: true }
      });
      return;
    }

    req.reply({
      statusCode: 200,
      body: []
    });
  });

  cy.intercept('POST', `**/api/refreshviews/measurementssummary/${schema}**`, {
    statusCode: 200,
    body: { success: true }
  });

  cy.intercept('GET', '**/api/fetchall/attributes/**', {
    statusCode: 200,
    body: buildLookupRows(state.rows, 'attributes', 'Code').map(row => ({
      Code: row.Code,
      Description: `Attribute ${row.Code}`,
      Status: 'active'
    }))
  });

  cy.intercept('GET', '**/api/fetchall/trees/**', {
    statusCode: 200,
    body: buildLookupRows(state.rows, 'treeTag', 'TreeTag')
  });

  cy.intercept('GET', '**/api/fetchall/stems/**', {
    statusCode: 200,
    body: buildLookupRows(state.rows, 'stemTag', 'StemTag')
  });

  cy.intercept('GET', '**/api/fetchall/quadrats/**', {
    statusCode: 200,
    body: buildLookupRows(state.rows, 'quadratName', 'QuadratName')
  });

  cy.intercept('GET', '**/api/fetchall/species/**', {
    statusCode: 200,
    body: buildLookupRows(state.rows, 'speciesCode', 'SpeciesCode')
  });

  return state;
}
