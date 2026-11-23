import { fromBody, withRouteAuthz } from '@/lib/route-authz';
import { DEFAULT_CHANGE_EXPORT_LIMITS } from '@/lib/changes/exportsnapshot';
import { createChangeExportHandler } from './handler';

// mysql2 needs the Node.js runtime.
export const runtime = 'nodejs';

export const POST = withRouteAuthz('changes/explorer/export', createChangeExportHandler(DEFAULT_CHANGE_EXPORT_LIMITS), { schema: fromBody('schema') });
