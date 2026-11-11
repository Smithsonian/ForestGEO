// Shared row-mutation wording for both grid families (measurementscommons and isolateddatagridcommons),
// re-exported by measurementscommonsutils.ts. Keep this file free of imports: Cypress e2e specs import it
// directly, and the e2e bundler has no CSS loader for the stylesheet that measurementscommonsutils.ts reaches.
export const ROW_UPDATED_MESSAGE = 'Row successfully updated!';
export const NEW_ROW_ADDED_MESSAGE = 'New row added!';
export const ROW_DELETED_MESSAGE = 'Row successfully deleted';
