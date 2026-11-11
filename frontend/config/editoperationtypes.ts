// Shared, dependency-free types for the edit_operations ledger. Split out of
// config/editoperations.ts so lib/changelog/edit-operation-projection.ts can
// import these types without creating an import cycle (editoperations.ts
// imports projectEditOperationToChangelogRows from the projection module).
export type EditOperationType = 'single-row-edit' | 'bulk-revision-row' | 'revert';

export interface EditOperationStateRow {
  table: string;
  primaryKey: string;
  primaryKeyValue: string | number;
  row: Record<string, unknown> | null;
}
