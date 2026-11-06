import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  buildReadScopeKey,
  DEFAULT_ERROR_EXPLORER_FILTERS,
  ERROR_GROUP_GRID_MAX_HEIGHT,
  ERRORS_FLAT_GRID_HEIGHT,
  type DetailsPanelRow,
  type ErrorExplorerRow,
  type ErrorsExplorerReadScope,
  type ErrorTypeFacet
} from '@/config/errorsexplorer';
import { useErrorsExplorerRowEdit } from '@/app/hooks/useerrorsexplorerrowedit';
import ErrorRowDetailsPanel from '@/components/errors/errorrowdetailspanel';
import ErrorsExplorerGrid, { type ErrorsExplorerGridHandle, type ErrorsExplorerGridModels } from '@/components/errors/errorsexplorergrid';
import { buildGroupColumnVisibility } from '@/components/errors/errorsexplorercolumns';

const PHONE_VIEWPORT = { width: 375, height: 667 };
const DESKTOP_VIEWPORT = { width: 1440, height: 1020 };
const PAGE_SIZE_FOR_HEIGHT_CHECK = 100;
const SUBPIXEL_TOLERANCE_PX = 1;
const QUERY_ENDPOINT_PATTERN = '**/api/errors/explorer/query';
const DETAILS_SHEET_TEST_ID = 'error-row-details-sheet';
const ACTIONS_FIELD = 'actions';
const GROUP_GRID_KEY = 'group:layout';
const FLAT_GRID_KEY = 'flat:layout';
const READ_SCOPE: ErrorsExplorerReadScope = { schema: 'forestgeo_testing', plotID: 1, censusID: 5, censusIDs: [5] };
const FACET: ErrorTypeFacet = {
  source: 'validation',
  code: '1',
  message: 'DBH growth exceeds maximum rate of 65 mm',
  fields: ['measuredDBH'],
  count: PAGE_SIZE_FOR_HEIGHT_CHECK,
  hasContradiction: false
};
const DETAILS_ROW: DetailsPanelRow = {
  measurementID: 101,
  treeTag: 'T101',
  stemTag: '1',
  quadratName: 'Q1',
  speciesCode: 'SP1',
  measurementDate: '2024-06-01',
  isLinkedToStem: true,
  markedInvalidWithoutLoggedError: false
};

function makeRow(id: number): ErrorExplorerRow {
  return {
    id,
    coreMeasurementID: id,
    plotID: READ_SCOPE.plotID,
    censusID: READ_SCOPE.censusID,
    treeTag: `T${id}`,
    stemTag: '1',
    speciesCode: 'SP1',
    quadratName: 'Q1',
    measurementDate: '2024-06-01',
    measuredDBH: 10,
    measuredHOM: 1.3,
    stemLocalX: 1,
    stemLocalY: 2,
    primaryErrorMessage: FACET.message,
    errorMessages: [FACET.message],
    errorSources: ['validation'],
    errorFields: ['measuredDBH'],
    errorCodes: ['1'],
    errorCount: 1,
    totalErrorCount: 1,
    hasContradiction: false,
    contradictionTypes: [],
    contradictionType: null,
    contradictionGroupKey: null,
    relatedMeasurementIDs: [],
    isFailedRow: false,
    priorDBH: null,
    dbhChangePercent: null
  } as ErrorExplorerRow;
}

const HUNDRED_ROWS = Array.from({ length: PAGE_SIZE_FOR_HEIGHT_CHECK }, (_, index) => makeRow(index + 1));

function stubQueryWithHundredRows() {
  cy.intercept('POST', QUERY_ENDPOINT_PATTERN, { rows: HUNDRED_ROWS, totalRows: PAGE_SIZE_FOR_HEIGHT_CHECK }).as('explorerQuery');
}

function selectPageSize(pageSize: number) {
  cy.get('[aria-label="Rows per page"]').last().click();
  cy.get('[role="option"]').contains(String(pageSize)).click();
}

function GridHarness({ variant }: { variant: 'group' | 'flat' }) {
  const grids = useRef(new Map<string, ErrorsExplorerGridHandle>());
  const readScopeKey = buildReadScopeKey(READ_SCOPE);
  const rowEdit = useErrorsExplorerRowEdit({
    readScope: READ_SCOPE,
    readScopeKey,
    refreshAllReads: async () => {
      await Promise.allSettled([...grids.current.values()].map(grid => grid.refresh()));
    },
    patchRowEverywhere: row => grids.current.forEach(grid => grid.patchRow(row)),
    showPageAlert: () => undefined
  });
  const isGroup = variant === 'group';
  const [models, setModels] = useState<ErrorsExplorerGridModels>({
    sortModel: [],
    filterModel: { items: [] },
    columnVisibilityModel: isGroup ? buildGroupColumnVisibility(FACET) : {}
  });
  const register = useCallback((gridKey: string, handle: ErrorsExplorerGridHandle | null) => {
    if (handle) grids.current.set(gridKey, handle);
    else grids.current.delete(gridKey);
  }, []);
  const noFaultedFields = useCallback(() => new Set<string>(), []);
  const errorLabelFor = useCallback((row: ErrorExplorerRow) => row.errorMessages[0] ?? '', []);
  const onOpenDetails = useCallback(() => undefined, []);
  const errorType = useMemo(() => (isGroup ? FACET : undefined), [isGroup]);
  return (
    <ErrorsExplorerGrid
      gridKey={isGroup ? GROUP_GRID_KEY : FLAT_GRID_KEY}
      ariaLabel={isGroup ? `${FACET.code} rows` : 'Measurement Errors'}
      variant={variant}
      readScope={READ_SCOPE}
      readScopeKey={readScopeKey}
      filters={DEFAULT_ERROR_EXPLORER_FILTERS}
      errorType={errorType}
      models={models}
      onModelsChange={setModels}
      canEditRows
      canEditSpeciesCode={false}
      codeOptions={[]}
      faultedFieldsFor={noFaultedFields}
      errorLabelFor={errorLabelFor}
      censusList={undefined}
      rowEdit={rowEdit}
      onOpenDetails={onOpenDetails}
      registerGrid={register}
    />
  );
}

describe('View Errors layout in a real browser', () => {
  beforeEach(() => {
    stubQueryWithHundredRows();
  });

  it('opens the details sheet full width on a phone', () => {
    cy.viewport(PHONE_VIEWPORT.width, PHONE_VIEWPORT.height);
    cy.mount(
      <ErrorRowDetailsPanel
        open
        row={DETAILS_ROW}
        status="ready"
        onRetry={() => undefined}
        onClose={() => undefined}
        canOpenRelatedRow={() => true}
        onOpenRelatedRow={() => undefined}
      />
    );
    cy.get(`[data-testid="${DETAILS_SHEET_TEST_ID}"]`).should($sheet => {
      const measuredWidth = $sheet[0].getBoundingClientRect().width;
      Cypress.log({ name: 'view-errors', message: `[view-errors sheet width] measured ${measuredWidth}px, viewport ${PHONE_VIEWPORT.width}px` });
      expect(measuredWidth, 'sheet width at 375 px').to.be.closeTo(PHONE_VIEWPORT.width, SUBPIXEL_TOLERANCE_PX);
    });
  });

  it('shows every column-menu button without hover, Actions included (D-b)', () => {
    cy.viewport(DESKTOP_VIEWPORT.width, DESKTOP_VIEWPORT.height);
    cy.mount(<GridHarness variant="group" />);
    cy.get('.MuiDataGrid-row').should('have.length.greaterThan', 0);
    cy.get('[role="columnheader"]').should('have.length.greaterThan', 1);
    cy.get('[role="columnheader"]').each($header => {
      cy.wrap($header, { log: false }).find('.MuiDataGrid-menuIcon').should('be.visible');
    });
    cy.get(`[role="columnheader"][data-field="${ACTIONS_FIELD}"] .MuiDataGrid-menuIcon button`).should('be.visible');
  });

  it('caps a group grid at its maximum height and virtualizes 100 rows', () => {
    cy.viewport(DESKTOP_VIEWPORT.width, DESKTOP_VIEWPORT.height);
    cy.mount(<GridHarness variant="group" />);
    selectPageSize(PAGE_SIZE_FOR_HEIGHT_CHECK);
    cy.get('.MuiDataGrid-root').should($grid => {
      const measuredHeight = $grid[0].getBoundingClientRect().height;
      Cypress.log({ name: 'view-errors', message: `[view-errors group height] measured ${measuredHeight}px, max ${ERROR_GROUP_GRID_MAX_HEIGHT}px` });
      expect(measuredHeight, 'group grid height').to.be.at.most(ERROR_GROUP_GRID_MAX_HEIGHT + SUBPIXEL_TOLERANCE_PX);
    });
    cy.get('.MuiDataGrid-row').should($rows => {
      Cypress.log({ name: 'view-errors', message: `[view-errors group rows] ${$rows.length} rows in the DOM` });
      expect($rows.length, 'rows loaded').to.be.greaterThan(0);
      expect($rows.length, 'virtualized').to.be.lessThan(PAGE_SIZE_FOR_HEIGHT_CHECK);
    });
  });

  it('gives the flat grid a fixed height whose virtual scroller scrolls', () => {
    cy.viewport(DESKTOP_VIEWPORT.width, DESKTOP_VIEWPORT.height);
    cy.mount(<GridHarness variant="flat" />);
    selectPageSize(PAGE_SIZE_FOR_HEIGHT_CHECK);
    cy.get('.MuiDataGrid-root').should($grid => {
      const measuredHeight = $grid[0].getBoundingClientRect().height;
      Cypress.log({ name: 'view-errors', message: `[view-errors flat height] measured ${measuredHeight}px, expected ${ERRORS_FLAT_GRID_HEIGHT}px` });
      expect(measuredHeight, 'flat grid height').to.be.closeTo(ERRORS_FLAT_GRID_HEIGHT, SUBPIXEL_TOLERANCE_PX);
    });
    cy.get('.MuiDataGrid-row').should($rows => {
      Cypress.log({ name: 'view-errors', message: `[view-errors flat rows] ${$rows.length} rows in the DOM` });
      expect($rows.length, 'rows loaded').to.be.greaterThan(0);
      expect($rows.length, 'virtualized').to.be.lessThan(PAGE_SIZE_FOR_HEIGHT_CHECK);
    });
    cy.get('.MuiDataGrid-virtualScroller').scrollTo('bottom');
    cy.get('.MuiDataGrid-virtualScroller').its('0.scrollTop').should('be.greaterThan', 0);
  });
});
