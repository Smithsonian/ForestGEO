export class RowSaveFinalizationError extends Error {
  readonly persistedRow: Record<string, unknown>;

  constructor(message: string, persistedRow: Record<string, unknown>) {
    super(message);
    this.name = 'RowSaveFinalizationError';
    this.persistedRow = persistedRow;
  }
}
