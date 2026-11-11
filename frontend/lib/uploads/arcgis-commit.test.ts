import { describe, expect, it, vi } from 'vitest';
import { HTTPResponses } from '@/config/macros';
import { UploadMode } from '@/config/uploadmodes';
import { ArcgisImportSessionError } from '@/lib/arcgis/import-session';
import { BatchIDContainsSubBatchSeparatorError, SUB_BATCH_SEPARATOR } from '@/lib/uploads/batch-family';
import { commitArcgisImport, type CommitArcgisImportParams } from '@/lib/uploads/arcgis-commit';

vi.mock('@/ailogger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

const TEST_SCHEMA = 'forestgeo_testing';

function commitParams(batchID: string): CommitArcgisImportParams {
  return {
    schema: TEST_SCHEMA,
    plotID: 22,
    censusID: 6,
    importSessionId: 'import-session-1',
    fileName: 'arcgis.xlsx',
    batchID,
    uploadMode: UploadMode.REVISIONS,
    userId: 'user-1',
    uploadSessionID: 'upload-session-1'
  };
}

describe('commitArcgisImport batch ID validation', () => {
  it('rejects a batch ID containing the sub-batch separator before touching the database', async () => {
    const separatorBatchID = `arc-1${SUB_BATCH_SEPARATOR}001`;
    const connectionManager = { executeQuery: vi.fn(), beginTransaction: vi.fn() };

    const commit = commitArcgisImport(connectionManager as never, commitParams(separatorBatchID));

    await expect(commit).rejects.toSatisfy((error: unknown) => {
      console.log(`[arcgis-batch-id-separator] rejected with ${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}`);
      return (
        error instanceof ArcgisImportSessionError &&
        error.status === HTTPResponses.INVALID_REQUEST &&
        error.message === new BatchIDContainsSubBatchSeparatorError(separatorBatchID).message
      );
    });
    expect(connectionManager.executeQuery).not.toHaveBeenCalled();
    expect(connectionManager.beginTransaction).not.toHaveBeenCalled();
  });
});
