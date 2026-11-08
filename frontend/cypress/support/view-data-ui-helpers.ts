export const VIEW_DATA_SEARCH_PLACEHOLDER = 'Tree tag, stem tag, species, quadrat or code';
export const CLEAR_ERRORS_ENDPOINT_PATTERN = '**/api/validations/clearmeasurementerrors';
export const RESET_VALIDATION_MENU_ITEM = 'Reset all validation states';
export const CLEAR_VALIDATION_ERRORS_BUTTON = 'Clear validation errors';
export const CLEAR_SUCCESS_NOTICE = 'Validation errors cleared. The row is pending until validations run again.';
export const CLEAR_FAILURE_NOTICE = "Couldn't clear the validation errors. Nothing changed.";
export const ROW_RESOLVED_TEXT = 'This row has no unresolved errors any more.';

const DETAILS_BUTTON_SELECTOR = 'button[aria-label^="Details for tree"]';
const CLOSE_DETAILS_SELECTOR = 'button[aria-label="Close details"]';
const SHEET_SELECTOR = '[role="dialog"]';

export function openRowDetails(treeTag: string) {
  cy.contains('[role="row"]', treeTag).find(DETAILS_BUTTON_SELECTOR).click({ force: true });
  cy.get(SHEET_SELECTOR).should('be.visible');
}

export function closeRowDetails() {
  cy.get(CLOSE_DETAILS_SELECTOR).click();
  cy.get(SHEET_SELECTOR).should('not.exist');
}

export function chooseMoreActionsItem(label: string) {
  cy.contains('button', 'More actions').click();
  cy.contains('[role="menuitem"]', label).click();
}

export function showOnly(optionLabel: string) {
  cy.contains('[role="group"][aria-labelledby] button', new RegExp(`^${optionLabel}\\b`)).click();
}
