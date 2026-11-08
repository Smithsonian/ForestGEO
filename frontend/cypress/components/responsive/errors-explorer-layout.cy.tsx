import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  buildReadScopeKey,
  DEFAULT_ERROR_EXPLORER_FILTERS,
  ERROR_GROUP_GRID_MAX_HEIGHT,
  EDIT_LOCK_TOOLTIPS,
  ERRORS_FLAT_GRID_HEIGHT,
  VIEW_ERRORS_TEXT,
  type DetailsPanelRow,
  type ErrorExplorerRow,
  type ErrorsExplorerReadScope,
  type ErrorTypeFacet
} from '@/config/errorsexplorer';
import { useErrorsExplorerRowEdit } from '@/app/hooks/useerrorsexplorerrowedit';
import ErrorRowDetailsPanel from '@/components/errors/errorrowdetailspanel';
import ErrorsExplorerGrid, { type ErrorsExplorerGridHandle, type ErrorsExplorerGridModels } from '@/components/errors/errorsexplorergrid';
import { buildGroupColumnVisibility } from '@/components/errors/errorsexplorercolumns';
import CssBaseline from '@mui/joy/CssBaseline';
import { CssVarsProvider as JoyCssVarsProvider } from '@mui/joy/styles';
import { THEME_ID as MATERIAL_THEME_ID, ThemeProvider as MaterialCssVarsProvider } from '@mui/material/styles';
import { materialDarkTheme } from '@/components/themeregistry/themeregistry';
import appTheme from '@/components/themeregistry/theme';
import ErrorTypeGroup, { type ErrorTypeGroupProps } from '@/components/errors/errortypegroup';
import ErrorTypeGroupList from '@/components/errors/errortypegrouplist';

const PHONE_VIEWPORT = { width: 375, height: 667 };
const DESKTOP_VIEWPORT = { width: 1440, height: 1020 };
const PAGE_SIZE_FOR_HEIGHT_CHECK = 100;
const SUBPIXEL_TOLERANCE_PX = 1;
const QUERY_ENDPOINT_PATTERN = '**/api/errors/explorer/query';
const DETAILS_SHEET_TEST_ID = 'error-row-details-sheet';
const ACTIONS_FIELD = 'actions';
const EDITABLE_FIELD = 'treeTag';
const ACTIVE_MEASUREMENTS = 1000;
const EXPECTED_COUNT_TEXT = '100 rows';
const EDIT_STATE_ACTION_COUNT = 3;
const EDITING_ROW_SELECTOR = '.MuiDataGrid-row--editing';
const GRID_OVERLAY_SELECTOR = '.MuiDataGrid-overlay';
const EDIT_ENTRY_ATTEMPTS = 3;
const HEADER_PADDING_PX = 16;
const GROUP_HEADER_RIGHT_EDGE_TOLERANCE_PX = 4;
const GROUP_GRID_KEY = 'group:layout';
const FLAT_GRID_KEY = 'flat:layout';
const FILTERED_MESSAGE = 'Flagged;Different species';
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

function useGridHarness(variant: 'group' | 'flat') {
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
  const onOpenDetails = useCallback(() => undefined, []);
  const gridProps: ErrorTypeGroupProps['gridProps'] = {
    readScope: READ_SCOPE,
    readScopeKey,
    filters: DEFAULT_ERROR_EXPLORER_FILTERS,
    models,
    onModelsChange: setModels,
    canEditRows: true,
    canEditSpeciesCode: false,
    codeOptions: [],
    censusList: undefined,
    rowEdit,
    onOpenDetails,
    registerGrid: register
  };
  return { rowEdit, gridProps };
}

function GridHarness({ variant }: { variant: 'group' | 'flat' }) {
  const { gridProps } = useGridHarness(variant);
  const isGroup = variant === 'group';
  const noFaultedFields = useCallback(() => new Set<string>(), []);
  const errorLabelFor = useCallback((row: ErrorExplorerRow) => row.errorMessages[0] ?? '', []);
  const errorType = useMemo(() => (isGroup ? FACET : undefined), [isGroup]);
  return (
    <ErrorsExplorerGrid
      {...gridProps}
      gridKey={isGroup ? GROUP_GRID_KEY : FLAT_GRID_KEY}
      ariaLabel={isGroup ? `${FACET.code} rows` : 'Measurement Errors'}
      variant={variant}
      errorType={errorType}
      faultedFieldsFor={noFaultedFields}
      errorLabelFor={errorLabelFor}
    />
  );
}

function GroupHarness() {
  const { rowEdit, gridProps } = useGridHarness('group');
  return (
    <ErrorTypeGroup
      facet={FACET}
      gridKey={GROUP_GRID_KEY}
      expanded
      onToggle={() => undefined}
      collapseDisabledReason={rowEdit.reasons.owningGrid(GROUP_GRID_KEY)}
      activeMeasurements={ACTIVE_MEASUREMENTS}
      gridProps={gridProps}
    />
  );
}

function mountInAppTheme(node: React.ReactNode) {
  cy.mount(
    <MaterialCssVarsProvider theme={{ [MATERIAL_THEME_ID]: materialDarkTheme }}>
      <JoyCssVarsProvider theme={appTheme} defaultMode="dark" defaultColorScheme="dark">
        <CssBaseline />
        {node}
      </JoyCssVarsProvider>
    </MaterialCssVarsProvider>
  );
}

function doubleClickFirstRowUntilEditing(attemptsLeft: number) {
  cy.get(`.MuiDataGrid-row [data-field="${EDITABLE_FIELD}"]`).first().dblclick();
  cy.get('body').then($body => {
    if ($body.find(EDITING_ROW_SELECTOR).length > 0 || attemptsLeft <= 1) {
      cy.get(EDITING_ROW_SELECTOR).should('have.length', 1);
      return;
    }
    Cypress.log({ name: 'view-errors', message: `[view-errors edit entry] double-click did not open the row; ${attemptsLeft - 1} attempt(s) left` });
    doubleClickFirstRowUntilEditing(attemptsLeft - 1);
  });
}

function openFirstRowForEditing() {
  cy.wait('@explorerQuery');
  cy.get(GRID_OVERLAY_SELECTOR).should('not.exist');
  doubleClickFirstRowUntilEditing(EDIT_ENTRY_ATTEMPTS);
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

  it('keeps every Actions icon inside the cell and the Actions title untruncated while a row is open', () => {
    cy.viewport(DESKTOP_VIEWPORT.width, DESKTOP_VIEWPORT.height);
    mountInAppTheme(<GridHarness variant="group" />);
    openFirstRowForEditing();
    cy.get(`${EDITING_ROW_SELECTOR} [data-field="${ACTIONS_FIELD}"] button`).should('have.length', EDIT_STATE_ACTION_COUNT);
    cy.get(`${EDITING_ROW_SELECTOR} [data-field="${ACTIONS_FIELD}"]`).should($cell => {
      const cellBox = $cell[0].getBoundingClientRect();
      $cell.find('button').each((index, button) => {
        const buttonBox = button.getBoundingClientRect();
        Cypress.log({
          name: 'view-errors',
          message: `[view-errors actions icon ${index}] ${buttonBox.left}..${buttonBox.right}px in cell ${cellBox.left}..${cellBox.right}px`
        });
        expect(buttonBox.left, `icon ${index} left edge`).to.be.at.least(cellBox.left - SUBPIXEL_TOLERANCE_PX);
        expect(buttonBox.right, `icon ${index} right edge`).to.be.at.most(cellBox.right + SUBPIXEL_TOLERANCE_PX);
      });
    });
    cy.get(`[role="columnheader"][data-field="${ACTIONS_FIELD}"]`).should($header => {
      const title = $header.find('.MuiDataGrid-columnHeaderTitle')[0];
      const menuButton = $header.find('.MuiDataGrid-menuIcon')[0];
      const titleTextRight = title.getBoundingClientRect().left + title.scrollWidth;
      const menuButtonLeft = menuButton.getBoundingClientRect().left;
      Cypress.log({ name: 'view-errors', message: `[view-errors actions title] text ends at ${titleTextRight}px, menu button starts at ${menuButtonLeft}px` });
      expect(titleTextRight, 'Actions title ends before its menu button').to.be.at.most(menuButtonLeft + SUBPIXEL_TOLERANCE_PX);
      expect(title.scrollWidth, 'Actions title is not truncated').to.be.at.most(title.clientWidth);
    });
  });

  it('keeps the group row count at the right edge of the header whether or not the page is locked', () => {
    cy.viewport(DESKTOP_VIEWPORT.width, DESKTOP_VIEWPORT.height);
    mountInAppTheme(<GroupHarness />);
    cy.get('.MuiDataGrid-row').should('have.length.greaterThan', 0);
    const countRightGap = ($toggle: JQuery<HTMLElement>) => {
      const count = $toggle.find(`:contains("${EXPECTED_COUNT_TEXT}")`).last()[0];
      return $toggle.closest('h2')[0].getBoundingClientRect().right - count.getBoundingClientRect().right;
    };
    cy.get('h2 button[aria-expanded]').should($toggle => {
      const gap = countRightGap($toggle);
      Cypress.log({ name: 'view-errors', message: `[view-errors group count unlocked] ${gap}px from the heading's right edge` });
      expect(gap, 'unlocked gap').to.be.at.most(GROUP_HEADER_RIGHT_EDGE_TOLERANCE_PX + HEADER_PADDING_PX);
    });
    openFirstRowForEditing();
    cy.get('h2 button[aria-expanded]').should('be.disabled');
    cy.get('h2 button[aria-expanded]').should($toggle => {
      const gap = countRightGap($toggle);
      Cypress.log({ name: 'view-errors', message: `[view-errors group count locked] ${gap}px from the heading's right edge` });
      expect(gap, 'locked gap').to.be.at.most(GROUP_HEADER_RIGHT_EDGE_TOLERANCE_PX + HEADER_PADDING_PX);
    });
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

  it('lets a real pointer reach the locked Filtered-to remove icon so its lock tooltip can open', () => {
    cy.viewport(DESKTOP_VIEWPORT.width, DESKTOP_VIEWPORT.height);
    mountInAppTheme(
      <ErrorTypeGroupList
        errorTypes={[FACET]}
        renderGroup={() => null}
        exactMessages={[FILTERED_MESSAGE]}
        onClearExactMessages={() => undefined}
        clearDisabledReason={EDIT_LOCK_TOOLTIPS.editing}
      />
    );
    cy.get(`button[aria-label="${VIEW_ERRORS_TEXT.removeFilter}"]`).should($removeIcon => {
      const lockWrapper = $removeIcon[0].parentElement as HTMLElement;
      const { left, top, width, height } = $removeIcon[0].getBoundingClientRect();
      const elementUnderPointer = $removeIcon[0].ownerDocument.elementFromPoint(left + width / 2, top + height / 2);
      Cypress.log({
        name: 'view-errors',
        message: `[view-errors filtered-to remove icon] element under the pointer: <${elementUnderPointer?.tagName.toLowerCase()} class="${elementUnderPointer?.className}">`
      });
      expect(elementUnderPointer, 'an element is under the icon centre').not.to.equal(null);
      expect(lockWrapper.contains(elementUnderPointer), 'the lock tooltip wrapper (or its button) receives the pointer').to.equal(true);
    });
  });
});
